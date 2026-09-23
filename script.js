// Vocalizando – contador de exercícios diários (UI moderna + feedback)

const MODEL_URL = new URL("/models/exercises-20260724/", window.location.origin).href;
const MODEL_VERSION = "20260728-1";
const EX_TARA_LABEL = "Tá Rá Lá";
const EX_III_LABEL  = "III";
const IS_IOS_DEVICE = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const THRESHOLD = IS_IOS_DEVICE ? 0.55 : 0.75; // microfones móveis variam mais
const RELEASE_THRESHOLD = IS_IOS_DEVICE ? 0.30 : 0.45;
const STABLE_FRAMES = 2;
const RELEASE_FRAMES = 2;
const MIN_REP_INTERVAL_MS = 650;

// ---------------- helpers ----------------
function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/* Mapeia o rótulo normalizado do modelo para a chave de estado */
const LABEL2KEY = {
  "ta ra la": "tara",
  "iii": "iii",
  "exercicio ta ra la": "tara",
  "exercicio iii": "iii"
};

/* Uma repetição precisa ser confirmada e depois encerrada antes da próxima. */
let detectionCycle = {
  armed: true,
  candidateKey: null,
  candidateFrames: 0,
  candidateConfidenceSum: 0,
  releaseFrames: 0,
  lastCountAt: 0
};

/* Metas diárias */
const TARGETS = {
  [EX_TARA_LABEL]: { key: "tara", goal: 15, span: null, bar: null, feedback: null, card: null },
  [EX_III_LABEL] : { key: "iii",  goal: 20, span: null, bar: null, feedback: null, card: null }
};

let recognizer = null;
let modelLoadPromise = null;
let tensorflowReadyPromise = null;
let state = { tara: 0, iii: 0 };
let modelListening = false;
const PROFILE_KEY = "vocalizing-profile";
const SETTINGS_KEY = "vocalizing-settings";
const GUIDE_CONFIG = {
  tara: { label: "Tá Rá Lá", sets: 3, reps: 5, rest: 20 },
  iii: { label: "III", sets: 4, reps: 5, rest: 20 }
};
let guided = { active: false, key: "tara", set: 1, reps: 0, resting: false, remaining: 0, timer: null };

// ---------------- eye tracking (WebGazer) ----------------
const WEBGAZER_URL = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/webgazer.js";
const FACE_MESH_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";
const EYE_DWELL_MS = 950;
const EYE_SMOOTHING = 0.34;
const EYE_STABLE_MS = 320;
const EYE_STABILITY_RADIUS = 72;
const EYE_MAGNET_RADIUS = 88;
const CALIBRATION_SAMPLES = 5;
const CALIBRATION_SEQUENCE = ["5", "1", "3", "9", "7", "2", "6", "8", "4"];
const VALIDATION_SEQUENCE = ["5", "1", "3", "9", "7"];
let webgazerLoadPromise = null;
let calibrationPhase = "calibrate";
let calibrationStepIndex = 0;
let calibrationAdvanceTimer = null;
let calibrationLastSampleAt = 0;
let validationErrors = [];

let eye = {
  enabled: false,
  calibrated: false,
  preview: false,
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  dwellStart: 0,
  stableStart: 0,
  dwellEl: null,
  hoverEl: null,
  cursor: null,
  ring: null,
  lastPredictionAt: 0,
  cameraStream: null,
  gazeHistory: [],
  stability: Infinity,
  validationError: null
};

function smooth(prev, next, a) { return prev + (next - prev) * a; }

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function updateFilteredGaze(data, now) {
  eye.gazeHistory.push({ x: data.x, y: data.y, time: now });
  eye.gazeHistory = eye.gazeHistory.filter(sample => now - sample.time <= 650).slice(-11);
  const recent = eye.gazeHistory.slice(-7);
  const centerX = median(recent.map(sample => sample.x));
  const centerY = median(recent.map(sample => sample.y));
  eye.stability = recent.length < 4 ? Infinity : median(recent.map(sample => Math.hypot(sample.x - centerX, sample.y - centerY)));
  eye.x = smooth(eye.x, centerX, EYE_SMOOTHING);
  eye.y = smooth(eye.y, centerY, EYE_SMOOTHING);
}

function setEyeStatus(text) {
  const s = document.getElementById("eye-status");
  if (s) s.textContent = text;
}

function setEyeHint(text) {
  const h = document.getElementById("eye-hint");
  if (h) h.textContent = text;
}

function setRingProgress(p) {
  if (!eye.ring) return;
  const clamped = Math.max(0, Math.min(1, p));
  eye.ring.style.setProperty("--p", (clamped * 1) + "turn");
}

function setGazeCursorVisible(on) {
  if (!eye.cursor) return;
  eye.cursor.style.display = on ? "block" : "none";
}

function setHover(el) {
  if (eye.hoverEl && eye.hoverEl !== el) eye.hoverEl.classList.remove("gaze-hover");
  eye.hoverEl = el;
  if (eye.hoverEl) eye.hoverEl.classList.add("gaze-hover");
}

function isUsableGazeButton(button) {
  if (!button || button.disabled) return false;
  if (button.closest("[aria-hidden='true']")) return false;
  const style = getComputedStyle(button);
  if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.15) return false;
  const rect = button.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function pickClickableAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const exact = el && el.closest ? el.closest("button") : null;
  if (isUsableGazeButton(exact)) return exact;

  let best = null;
  let bestDistance = EYE_MAGNET_RADIUS;
  document.querySelectorAll("button").forEach(button => {
    if (!isUsableGazeButton(button) || button.classList.contains("calib-dot")) return;
    const rect = button.getBoundingClientRect();
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = button;
    }
  });
  return best;
}

function handleDwellClick(now) {
  if (!eye.calibrated) return;
  const target = pickClickableAt(eye.x, eye.y);

  if (!target) {
    setHover(null);
    eye.dwellEl = null;
    eye.dwellStart = 0;
    eye.stableStart = 0;
    setRingProgress(0);
    return;
  }

  setHover(target);
  const targetRect = target.getBoundingClientRect();
  if (eye.cursor) {
    eye.cursor.style.left = (targetRect.left + targetRect.width / 2) + "px";
    eye.cursor.style.top = (targetRect.top + targetRect.height / 2) + "px";
  }

  if (eye.dwellEl !== target) {
    eye.dwellEl = target;
    eye.dwellStart = 0;
    eye.stableStart = 0;
    setRingProgress(0);
    return;
  }

  if (eye.stability > EYE_STABILITY_RADIUS) {
    eye.stableStart = 0;
    eye.dwellStart = 0;
    setRingProgress(0);
    return;
  }

  if (!eye.stableStart) eye.stableStart = now;
  if (now - eye.stableStart < EYE_STABLE_MS) {
    setRingProgress(0);
    return;
  }
  if (!eye.dwellStart) eye.dwellStart = now;

  const elapsed = now - eye.dwellStart;
  const p = elapsed / EYE_DWELL_MS;
  setRingProgress(p);

  if (p >= 1) {
    try { target.click(); } catch (e) {}
    eye.dwellStart = now + 350; // evita duplo clique
    eye.stableStart = now;
    setRingProgress(0);
  }
}

function loadWebgazer() {
  if (window.webgazer) return Promise.resolve(window.webgazer);
  if (webgazerLoadPromise) return webgazerLoadPromise;

  webgazerLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => reject(new Error("timeout")), 30000);
    script.src = WEBGAZER_URL;
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.webgazer) resolve(window.webgazer);
      else reject(new Error("WebGazer não inicializou"));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Falha ao baixar WebGazer"));
    };
    document.head.appendChild(script);
  }).catch(error => {
    webgazerLoadPromise = null;
    throw error;
  });

  return webgazerLoadPromise;
}

async function requestCameraAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("camera-unsupported");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  return stream;
}

function stopEyeCameraStream() {
  if (!eye.cameraStream) return;
  eye.cameraStream.getTracks().forEach(track => track.stop());
  eye.cameraStream = null;
}

function waitForWebgazerReady(webgazer, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const check = () => {
      if (typeof webgazer.isReady === "function" && webgazer.isReady()) {
        resolve();
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        reject(new Error("webgazer-ready-timeout"));
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

function applyWebgazerPreview(on) {
  if (!window.webgazer) return;
  eye.preview = !!on;
  try {
    window.webgazer
      .showVideoPreview(eye.preview)
      .showFaceOverlay(eye.preview)
      .showFaceFeedbackBox(eye.preview)
      .showPredictionPoints(false);
  } catch (e) {}
}

async function enableEyeTracking() {
  const toggleBtn = document.getElementById("eye-toggle");
  const calibBtn = document.getElementById("eye-calibrate");
  const prevBtn  = document.getElementById("eye-preview");

  if (!window.isSecureContext && location.hostname !== "localhost") {
    setEyeHint("Precisa abrir em HTTPS (ou localhost) pra liberar a câmera.");
    return;
  }

  if (!eye.cursor) {
    eye.cursor = document.getElementById("gaze-cursor");
    eye.ring = eye.cursor?.querySelector(".ring") || null;
  }

  setEyeStatus("Preparando…");
  setEyeHint("Permita a câmera. O vídeo é processado somente neste dispositivo.");
  if (toggleBtn) {
    toggleBtn.disabled = true;
    toggleBtn.classList.add("loading");
    toggleBtn.textContent = "Preparando câmera";
  }

  try {
    stopEyeCameraStream();
    eye.cameraStream = await requestCameraAccess();
    setEyeStatus("Carregando…");
    setEyeHint("Carregando o rastreador ocular. Na primeira vez, isso pode levar alguns segundos.");

    const webgazer = await loadWebgazer();
    // O pacote do WebGazer não inclui os arquivos binários do Face Mesh.
    // Sem esse endereço ele procura em /mediapipe/face_mesh e recebe 404.
    webgazer.params.faceMeshSolutionPath = FACE_MESH_URL;
    // Reutiliza a câmera já autorizada. Evita que o Safari precise encerrá-la e
    // abri-la novamente em poucos milissegundos, situação que pode gerar erro.
    if (typeof webgazer.setStaticVideo === "function") {
      webgazer.setStaticVideo(eye.cameraStream);
    }
    webgazer
      .saveDataAcrossSessions(false)
      .setRegression("ridge")
      .setTracker("TFFacemesh")
      .applyKalmanFilter(true)
      .showPredictionPoints(false)
      .showVideoPreview(true)
      .showFaceOverlay(true)
      .showFaceFeedbackBox(true)
      .setGazeListener((data) => {
        if (!eye.enabled || !data) return;
        const now = performance.now();
        eye.lastPredictionAt = now;
        updateFilteredGaze(data, now);
        if (eye.cursor) {
          eye.cursor.style.left = eye.x + "px";
          eye.cursor.style.top  = eye.y + "px";
        }
        handleDwellClick(now);
      });

    await webgazer.begin();
    await waitForWebgazerReady(webgazer);
    if (typeof webgazer.removeMouseEventListeners === "function") {
      webgazer.removeMouseEventListeners();
    }

    eye.enabled = true;
    eye.calibrated = false;
    eye.preview = true;
    setGazeCursorVisible(true);

    setEyeStatus("Calibre agora");
    setEyeHint("Câmera pronta. Complete os nove pontos para ativar o controle pelo olhar.");

    if (toggleBtn) {
      toggleBtn.disabled = false;
      toggleBtn.classList.remove("loading");
      toggleBtn.textContent = "Desativar câmera";
      toggleBtn.classList.add("on");
    }
    if (calibBtn) calibBtn.disabled = false;
    if (prevBtn) {
      prevBtn.disabled = false;
      prevBtn.textContent = "Ocultar preview";
    }

    openCalibration();
  } catch (e) {
    console.error("Falha ao iniciar o controle ocular:", e);
    try {
      if (window.webgazer && typeof window.webgazer.end === "function") window.webgazer.end();
    } catch (cleanupError) {}
    stopEyeCameraStream();
    eye.enabled = false;
    eye.calibrated = false;
    setGazeCursorVisible(false);
    setEyeStatus("Erro");
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    const timeout = e && e.message === "webgazer-ready-timeout";
    setEyeHint(denied
      ? `A câmera foi bloqueada. ${permissionGuidance("camera")}`
      : timeout
        ? "A câmera abriu, mas não encontrou seu rosto. Fique de frente, aumente a iluminação e tente novamente."
        : "Não consegui iniciar o rastreador. Verifique a conexão, recarregue a página e tente novamente.");
    if (toggleBtn) {
      toggleBtn.disabled = false;
      toggleBtn.classList.remove("loading", "on");
      toggleBtn.textContent = "Tentar novamente";
    }
  }
}

function disableEyeTracking() {
  const toggleBtn = document.getElementById("eye-toggle");
  const calibBtn = document.getElementById("eye-calibrate");
  const prevBtn  = document.getElementById("eye-preview");

  eye.enabled = false;
  eye.calibrated = false;
  setGazeCursorVisible(false);
  setHover(null);
  eye.dwellEl = null;
  eye.dwellStart = 0;
  eye.stableStart = 0;
  eye.gazeHistory = [];
  eye.stability = Infinity;
  closeCalibration();
  setRingProgress(0);

  try {
    if (window.webgazer) {
      applyWebgazerPreview(false);
      if (typeof window.webgazer.end === "function") window.webgazer.end();
      if (typeof window.webgazer.clearGazeListener === "function") {
        window.webgazer.clearGazeListener();
      }
    }
  } catch (e) {}
  stopEyeCameraStream();

  setEyeStatus("Desligado");
  setEyeHint("Controle ocular desligado.");
  const accuracy = document.getElementById("eye-accuracy");
  if (accuracy) accuracy.hidden = true;

  if (toggleBtn) {
    toggleBtn.textContent = "Ativar câmera";
    toggleBtn.classList.remove("on", "loading");
    toggleBtn.disabled = false;
  }
  if (calibBtn) calibBtn.disabled = true;
  if (prevBtn) {
    prevBtn.disabled = true;
    prevBtn.textContent = "Preview";
  }
}

// ---------------- trava-línguas e pronúncia ----------------
const TONGUE_TWISTERS = [
  { text: "O rato roeu a roupa do rei de Roma.", difficulty: "facil", label: "Fácil", focus: "Som do R" },
  { text: "Casa suja, chão sujo.", difficulty: "facil", label: "Fácil", focus: "S e CH" },
  { text: "Bagre branco, branco bagre.", difficulty: "facil", label: "Fácil", focus: "BR e GR" },
  { text: "A aranha arranha a rã. A rã arranha a aranha.", difficulty: "facil", label: "Fácil", focus: "R e NH" },
  { text: "O peito do pé de Pedro é preto.", difficulty: "medio", label: "Médio", focus: "P e PR" },
  { text: "Pedro pregou um prego na porta preta.", difficulty: "medio", label: "Médio", focus: "PR" },
  { text: "Três pratos de trigo para três tigres tristes.", difficulty: "medio", label: "Médio", focus: "TR" },
  { text: "Fala, arara loura. A arara loura falará.", difficulty: "medio", label: "Médio", focus: "R e L" },
  { text: "Sabia que a mãe do sabiá não sabia que o sabiá sabia assobiar?", difficulty: "medio", label: "Médio", focus: "S e B" },
  { text: "Num ninho de mafagafos há sete mafagafinhos.", difficulty: "dificil", label: "Difícil", focus: "F e G" },
  { text: "Farofa feita com muita farinha fofa faz uma fofoca feia.", difficulty: "dificil", label: "Difícil", focus: "Som do F" },
  { text: "A Iara agarra e amarra a rara arara de Araraquara.", difficulty: "dificil", label: "Difícil", focus: "R e RR" },
  { text: "Em rápido rapto, um rápido rato raptou três ratos sem deixar rastros.", difficulty: "dificil", label: "Difícil", focus: "R e TR" },
  { text: "Se o papa papasse papa, se o papa papasse pão, o papa tudo papava.", difficulty: "dificil", label: "Difícil", focus: "Som do P" }
];

let tongueState = {
  index: 0,
  difficulty: "todos",
  listening: false,
  transcript: "",
  best: 0,
  streak: 0,
  attempts: 0,
  hadError: false,
  history: [],
  alternatives: [],
  transcriptParts: [],
  stopRequested: false,
  recognitionRestarts: 0,
  recognitionDeadline: 0,
  recognitionTimer: null
};
let pronunciationRecognizer = null;
let activeTwisterSpeech = null;
let activeTwisterAudio = null;

function tongueStorageKey() {
  return "vocalizing-twisters-" + localDateKey(new Date());
}

function normalizeSpeech(text) {
  return normalize(text).replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function wordDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length, 1);
  return Math.max(0, 1 - wordDistance(a, b) / longest);
}

function phoneticPortuguese(text) {
  return normalizeSpeech(text)
    .replace(/rr/g, "r")
    .replace(/lh/g, "li")
    .replace(/nh/g, "ni")
    .replace(/ch/g, "x")
    .replace(/qu/g, "k")
    .replace(/ph/g, "f")
    .replace(/h/g, "")
    .replace(/[cz]/g, "s")
    .replace(/y/g, "i")
    .replace(/\s+/g, " ");
}

function calculatePronunciationScore(target, spoken, assisted = false) {
  const targetWords = normalizeSpeech(target).split(" ").filter(Boolean);
  const spokenWords = normalizeSpeech(spoken).split(" ").filter(Boolean);
  const longest = Math.max(targetWords.length, spokenWords.length, 1);
  const sequence = Math.max(0, 1 - wordDistance(targetWords, spokenWords) / longest);
  if (!assisted) return Math.round(sequence * 100);

  const character = similarity(phoneticPortuguese(target), phoneticPortuguese(spoken));
  const coverage = targetWords.length
    ? targetWords.reduce((sum, targetWord) => {
        const targetSound = phoneticPortuguese(targetWord);
        const best = spokenWords.reduce((highest, spokenWord) => Math.max(highest, similarity(targetSound, phoneticPortuguese(spokenWord))), 0);
        return sum + best;
      }, 0) / targetWords.length
    : 0;
  return Math.round(Math.min(1, sequence * 0.25 + character * 0.3 + coverage * 0.45) * 100);
}

function bestPronunciationResult(target, candidates, assisted) {
  return candidates
    .filter(Boolean)
    .map(text => ({ text, score: calculatePronunciationScore(target, text, assisted) }))
    .sort((a, b) => b.score - a.score)[0] || { text: "", score: 0 };
}

function saveTongueProgress() {
  localStorage.setItem(tongueStorageKey(), JSON.stringify({
    best: tongueState.best,
    streak: tongueState.streak,
    attempts: tongueState.attempts,
    history: tongueState.history
  }));
}

function loadTongueProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(tongueStorageKey()) || "{}");
    tongueState.best = Number(saved.best) || 0;
    tongueState.streak = Number(saved.streak) || 0;
    tongueState.attempts = Number(saved.attempts) || 0;
    tongueState.history = Array.isArray(saved.history) ? saved.history : [];
  } catch (e) {}
  updateTongueStats();
}

function updateTongueStats() {
  const best = document.getElementById("twister-best");
  const streak = document.getElementById("twister-streak");
  const attempts = document.getElementById("twister-attempts");
  if (best) best.textContent = tongueState.best || "—";
  if (streak) streak.textContent = tongueState.streak;
  if (attempts) attempts.textContent = tongueState.attempts;
}

function currentTwister() { return TONGUE_TWISTERS[tongueState.index]; }

function resetScorePanel() {
  document.getElementById("score-empty").hidden = false;
  document.getElementById("score-result").hidden = true;
  document.getElementById("twister-error").hidden = true;
  document.getElementById("register-practice").hidden = true;
  document.getElementById("live-transcript").textContent = "Diga a frase acima";
}

function renderTwister() {
  const item = currentTwister();
  const level = document.getElementById("twister-difficulty");
  document.getElementById("twister-text").textContent = item.text;
  document.getElementById("twister-focus").textContent = "Foco: " + item.focus;
  level.textContent = item.label;
  level.className = "level-badge " + item.difficulty;
  resetScorePanel();
}

function chooseRandomTwister() {
  stopTwisterPlayback();
  const allowed = TONGUE_TWISTERS
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => (tongueState.difficulty === "todos" || item.difficulty === tongueState.difficulty) && index !== tongueState.index);
  const pool = allowed.length ? allowed : TONGUE_TWISTERS.map((item, index) => ({ item, index })).filter(({ item }) => tongueState.difficulty === "todos" || item.difficulty === tongueState.difficulty);
  tongueState.index = pool[Math.floor(Math.random() * pool.length)].index;
  renderTwister();
}

function warmUpSpeechSynthesis() {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
  } catch (e) {}
}

function stopTwisterPlayback() {
  if (activeTwisterAudio) {
    activeTwisterAudio.onended = null;
    activeTwisterAudio.onerror = null;
    activeTwisterAudio.pause();
    activeTwisterAudio.currentTime = 0;
    activeTwisterAudio = null;
  }
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  activeTwisterSpeech = null;
  const pauseButton = document.getElementById("pause-twister");
  if (pauseButton) pauseButton.classList.remove("active");
}

function twisterPlaybackRate() {
  return Number(document.getElementById("twister-speed")?.value) || 1;
}

function speakTwisterFallback(error) {
  if (!("speechSynthesis" in window)) {
    error.textContent = "Não foi possível carregar o áudio deste exemplo.";
    error.hidden = false;
    return;
  }

  const synthesizer = window.speechSynthesis;
  try {
    // No Safari para iPhone, uma fala cancelada pode deixar o sintetizador pausado.
    // Retomar antes e depois do speak mantém a leitura dentro do gesto do toque.
    synthesizer.cancel();
    synthesizer.resume();
  } catch (e) {}

  const speech = new SpeechSynthesisUtterance(currentTwister().text);
  speech.lang = "pt-BR";
  speech.rate = Math.max(0.6, Math.min(1.35, 0.82 * twisterPlaybackRate()));
  speech.volume = 1;
  activeTwisterSpeech = speech;

  speech.onend = () => {
    if (activeTwisterSpeech === speech) activeTwisterSpeech = null;
  };
  speech.onerror = event => {
    if (activeTwisterSpeech !== speech) return;
    activeTwisterSpeech = null;
    if (event.error === "canceled" || event.error === "interrupted") return;
    error.textContent = "Não foi possível reproduzir o exemplo. Verifique se o som do celular está ligado e tente novamente.";
    error.hidden = false;
  };

  try {
    synthesizer.speak(speech);
    synthesizer.resume();
  } catch (e) {
    activeTwisterSpeech = null;
    error.textContent = "Não foi possível iniciar a leitura em voz alta neste navegador.";
    error.hidden = false;
  }
}

function hearTwister() {
  const error = document.getElementById("twister-error");
  error.hidden = true;
  stopTwisterPlayback();

  const number = String(tongueState.index + 1).padStart(2, "0");
  const playback = new Audio(`audio/twister-${number}.wav`);
  let fallbackStarted = false;
  const fallback = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    if (activeTwisterAudio === playback) activeTwisterAudio = null;
    speakTwisterFallback(error);
  };

  playback.preload = "auto";
  playback.playbackRate = twisterPlaybackRate();
  playback.setAttribute("playsinline", "");
  playback.onended = () => {
    if (activeTwisterAudio === playback) activeTwisterAudio = null;
    document.getElementById("pause-twister")?.classList.remove("active");
  };
  playback.onerror = fallback;
  activeTwisterAudio = playback;

  try {
    const started = playback.play();
    if (started && typeof started.catch === "function") started.catch(fallback);
  } catch (e) {
    fallback();
  }
}

function toggleTwisterPause() {
  if (!activeTwisterAudio) {
    hearTwister();
    return;
  }
  const button = document.getElementById("pause-twister");
  if (activeTwisterAudio.paused) {
    activeTwisterAudio.play().catch(() => {});
    button.classList.remove("active");
  } else {
    activeTwisterAudio.pause();
    button.classList.add("active");
  }
}

function repeatTwister() {
  if (!activeTwisterAudio) {
    hearTwister();
    return;
  }
  activeTwisterAudio.currentTime = 0;
  activeTwisterAudio.playbackRate = twisterPlaybackRate();
  activeTwisterAudio.play().catch(() => hearTwister());
  document.getElementById("pause-twister")?.classList.remove("active");
}

function setPronunciationListening(on) {
  tongueState.listening = on;
  const panel = document.getElementById("twister-listening");
  const button = document.getElementById("record-twister");
  const mic = document.getElementById("mic-indicator");
  panel.hidden = !on;
  button.classList.toggle("recording", on);
  button.innerHTML = on
    ? '<span class="record-dot" aria-hidden="true"></span> Parar e avaliar'
    : '<span class="mic-shape" aria-hidden="true"></span> Gravar minha voz';
  if (mic && !modelListening) {
    mic.classList.toggle("on", on);
    mic.querySelector(".label").textContent = on ? "Ouvindo desafio" : "Aguardando";
  }
}

function showTongueError(message) {
  const error = document.getElementById("twister-error");
  error.textContent = message;
  error.hidden = false;
}

function isSafariBrowser() {
  return /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);
}

function permissionGuidance(kind) {
  const label = kind === "camera" ? "a câmera" : "o microfone";
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    ? `Abra as configurações deste site no navegador do celular, permita ${label} e recarregue a página.`
    : `Abra as configurações de privacidade do navegador, permita ${label} para este endereço e tente novamente.`;
}

function showMicrophoneCompatibility(title, message) {
  const note = document.getElementById("microphone-compatibility");
  document.getElementById("compatibility-title").textContent = title;
  document.getElementById("compatibility-text").textContent = message;
  note.hidden = false;
}

function checkMicrophoneEnvironment(requiresSpeechRecognition = true) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (location.protocol === "file:" || !window.isSecureContext) {
    showMicrophoneCompatibility(
      "Abra em um endereço local seguro",
      "O Safari bloqueia reconhecimento e captura de voz quando o arquivo é aberto diretamente. Use o atalho “Abrir Vocalizando.command” desta pasta para iniciar em localhost."
    );
    return false;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMicrophoneCompatibility("Microfone indisponível", "Atualize o Safari e verifique se o acesso ao microfone está permitido para este site.");
    return false;
  }
  if (requiresSpeechRecognition && !SpeechRecognition) {
    showMicrophoneCompatibility(
      "Reconhecimento de fala indisponível",
      isSafariBrowser() ? "Ative a Siri nos Ajustes do Sistema e recarregue a página. O Safari usa o mecanismo de fala da Siri." : "Use uma versão atualizada do Safari, Chrome ou Edge."
    );
    return false;
  }
  return true;
}

async function requestMicrophoneAccess(requiresSpeechRecognition = true) {
  if (!checkMicrophoneEnvironment(requiresSpeechRecognition)) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
    showTongueError(denied
      ? `O acesso ao microfone foi negado. ${permissionGuidance("microphone")}`
      : "Não encontrei um microfone disponível. Verifique a entrada de áudio do dispositivo e tente novamente.");
    return false;
  }
}

function scoreFeedback(score) {
  if (score >= 92) return ["Excelente articulação!", "A frase ficou completa e muito clara. Agora experimente aumentar um pouco a velocidade."];
  if (score >= 75) return ["Muito bem!", "Você chegou bem perto. Repita articulando cada encontro consonantal."];
  if (score >= 50) return ["Prática registrada", "O navegador reconheceu boa parte da frase. Você pode continuar usando pausas entre os trechos."];
  return ["Tentativa registrada", "O navegador entendeu apenas uma parte. Isso não significa que sua fala esteja incorreta; tente por trechos ou repita com o modo assistido."];
}

function finishPronunciationAttempt() {
  clearTimeout(tongueState.recognitionTimer);
  setPronunciationListening(false);
  const assisted = document.getElementById("assisted-recognition")?.checked !== false;
  const combined = tongueState.transcriptParts.join(" ").trim();
  const candidates = Array.from(new Set([combined, tongueState.transcript, ...tongueState.alternatives].map(value => (value || "").trim())));
  const result = bestPronunciationResult(currentTwister().text, candidates, assisted);
  const spoken = result.text;
  if (!spoken) {
    showTongueError("O navegador não conseguiu transformar esta tentativa em texto. Tente novamente em trechos; isso não é uma avaliação da qualidade da sua fala.");
    document.getElementById("register-practice").hidden = false;
    return;
  }

  const score = result.score;
  const feedback = scoreFeedback(score);
  tongueState.best = Math.max(tongueState.best, score);
  tongueState.streak = score >= 75 ? tongueState.streak + 1 : 0;
  tongueState.attempts += 1;
  tongueState.history.push({ score, focus: currentTwister().focus, transcript: spoken, assisted, at: Date.now() });
  saveTongueProgress();
  updateTongueStats();

  document.getElementById("score-empty").hidden = true;
  document.getElementById("score-result").hidden = false;
  document.getElementById("pronunciation-score").textContent = score;
  document.getElementById("score-ring").style.setProperty("--score", (score * 3.6) + "deg");
  document.getElementById("score-title").textContent = feedback[0];
  document.getElementById("score-feedback").textContent = feedback[1];
  document.getElementById("heard-text").textContent = spoken;
  updateReport();
}

function registerUnscoredPractice() {
  tongueState.attempts += 1;
  tongueState.history.push({ score: null, focus: currentTwister().focus, assisted: true, unscored: true, at: Date.now() });
  saveTongueProgress();
  updateTongueStats();
  document.getElementById("register-practice").hidden = true;
  document.getElementById("twister-error").hidden = true;
  document.getElementById("score-empty").hidden = true;
  document.getElementById("score-result").hidden = false;
  document.getElementById("pronunciation-score").textContent = "—";
  document.getElementById("score-ring").style.setProperty("--score", "0deg");
  document.getElementById("score-title").textContent = "Prática registrada";
  document.getElementById("score-feedback").textContent = "A tentativa foi salva sem nota porque o navegador não conseguiu gerar uma transcrição confiável.";
  document.getElementById("heard-text").textContent = "Sem transcrição";
  updateReport();
}

function stopPronunciation() {
  if (!pronunciationRecognizer || !tongueState.listening) return;
  tongueState.stopRequested = true;
  clearTimeout(tongueState.recognitionTimer);
  try { pronunciationRecognizer.stop(); } catch (e) { finishPronunciationAttempt(); }
}

async function startPronunciation() {
  if (tongueState.listening) {
    stopPronunciation();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    checkMicrophoneEnvironment();
    showTongueError(isSafariBrowser()
      ? "O reconhecimento não está disponível. Ative a Siri nos Ajustes do Sistema, use o Safari 14.1 ou mais recente e recarregue a página."
      : "Este navegador não oferece reconhecimento de fala. Use Safari, Chrome ou Edge atualizados.");
    return;
  }

  if (modelListening) stopRecognition();
  stopTwisterPlayback();
  tongueState.transcript = "";
  tongueState.hadError = false;
  tongueState.alternatives = [];
  tongueState.transcriptParts = [];
  tongueState.stopRequested = false;
  tongueState.recognitionRestarts = 0;
  tongueState.recognitionDeadline = Date.now() + 18000;
  resetScorePanel();

  const microphoneReady = await requestMicrophoneAccess();
  if (!microphoneReady) return;

  const recognition = new SpeechRecognition();
  pronunciationRecognizer = recognition;
  const assisted = document.getElementById("assisted-recognition")?.checked !== false;
  recognition.lang = "pt-BR";
  recognition.continuous = assisted;
  recognition.interimResults = assisted || !isSafariBrowser();
  recognition.maxAlternatives = assisted ? 5 : 1;
  recognition.onstart = () => setPronunciationListening(true);
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex || 0; i < event.results.length; i++) {
      const speechResult = event.results[i];
      const options = Array.from({ length: speechResult.length }, (_, index) => speechResult[index].transcript.trim()).filter(Boolean);
      const prefix = tongueState.transcriptParts.join(" ").trim();
      options.forEach(option => tongueState.alternatives.push(`${prefix} ${option}`.trim()));
      if (speechResult.isFinal) {
        const bestChunk = bestPronunciationResult(currentTwister().text, options, assisted).text || options[0];
        if (bestChunk && tongueState.transcriptParts[tongueState.transcriptParts.length - 1] !== bestChunk) tongueState.transcriptParts.push(bestChunk);
      } else if (options[0]) {
        interim += options[0] + " ";
      }
    }
    tongueState.transcript = `${tongueState.transcriptParts.join(" ")} ${interim}`.trim();
    document.getElementById("live-transcript").textContent = tongueState.transcript || "Pode falar com calma e fazer pausas";
  };
  recognition.onerror = (event) => {
    const recoverable = assisted && (event.error === "no-speech" || event.error === "aborted");
    if (recoverable && !tongueState.stopRequested) {
      document.getElementById("live-transcript").textContent = "Continuo ouvindo. Pode retomar quando estiver pronto.";
      return;
    }
    tongueState.hadError = true;
    const messages = {
      "not-allowed": `O navegador não tem permissão para ouvir. ${permissionGuidance("microphone")}`,
      "service-not-allowed": "Ative a Siri nos Ajustes do Sistema para usar o reconhecimento de fala do Safari.",
      "audio-capture": "Não encontrei um microfone disponível. Verifique a entrada de áudio do dispositivo.",
      "network": "O serviço de reconhecimento não respondeu. Verifique a conexão e tente novamente.",
      "no-speech": "Não detectei fala. Fale mais perto do microfone e tente novamente.",
      "aborted": "A gravação foi interrompida. Tente novamente quando estiver pronto."
    };
    showTongueError(messages[event.error] || "Não consegui reconhecer sua voz. Tente em um lugar mais silencioso.");
  };
  recognition.onend = () => {
    if (tongueState.stopRequested || tongueState.hadError || !assisted || Date.now() >= tongueState.recognitionDeadline || tongueState.recognitionRestarts >= 3) {
      finishPronunciationAttempt();
      return;
    }
    tongueState.recognitionRestarts++;
    tongueState.recognitionTimer = setTimeout(() => {
      try { recognition.start(); } catch (e) { finishPronunciationAttempt(); }
    }, 220);
  };
  tongueState.recognitionTimer = setTimeout(() => stopPronunciation(), 18000);
  try { recognition.start(); }
  catch (e) { showTongueError("O microfone está ocupado. Aguarde um instante e tente novamente."); }
}

function initTongueTwisters() {
  loadTongueProgress();
  renderTwister();
  warmUpSpeechSynthesis();
  checkMicrophoneEnvironment();
  document.getElementById("new-twister").addEventListener("click", chooseRandomTwister);
  document.getElementById("hear-twister").addEventListener("click", hearTwister);
  document.getElementById("record-twister").addEventListener("click", startPronunciation);
  document.getElementById("try-again").addEventListener("click", startPronunciation);
  document.querySelectorAll("[data-difficulty]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-difficulty]").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      tongueState.difficulty = button.dataset.difficulty;
      chooseRandomTwister();
    });
  });
}

function toggleEyeTracking() {
  if (eye.enabled) disableEyeTracking();
  else enableEyeTracking();
}

function openCalibration() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;
  overlay.classList.add("open");
  overlay.classList.remove("complete", "needs-retry", "validation-mode");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("calibrating");
  eye.calibrated = false;
  setEyeStatus("Calibrando");
  setEyeHint("Siga somente o ponto amarelo e mantenha a cabeça parada.");
  applyWebgazerPreview(true);
  resetCalibrationDots();
}

function closeCalibration() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;
  clearTimeout(calibrationAdvanceTimer);
  overlay.classList.remove("open", "complete", "needs-retry", "validation-mode");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("calibrating");
  applyWebgazerPreview(eye.preview);
  if (eye.enabled && !eye.calibrated) {
    setEyeStatus("Calibração pendente");
    setEyeHint("Conclua a calibração para liberar o controle pelo olhar.");
  }
}

function calibrationDots() {
  const overlay = document.getElementById("calibration-overlay");
  return overlay ? Array.from(overlay.querySelectorAll(".calib-dot")) : [];
}

function setCalibrationProgress(completed, total) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const progressText = document.getElementById("calib-progress-text");
  const progressBar = document.getElementById("calib-progress-bar");
  if (progressText) progressText.textContent = percent + "%";
  if (progressBar) progressBar.style.width = percent + "%";
}

function updateCalibrationProgress() {
  const completed = calibrationDots().reduce((sum, dot) => {
    return sum + Math.min(CALIBRATION_SAMPLES, parseInt(dot.dataset.c || "0", 10));
  }, 0);
  setCalibrationProgress(completed, CALIBRATION_SEQUENCE.length * CALIBRATION_SAMPLES);
}

function resetDotStates() {
  calibrationDots().forEach(dot => {
    dot.disabled = true;
    dot.dataset.c = "0";
    dot.dataset.count = "";
    dot.classList.remove("active", "done", "transitioning", "validation-target");
    dot.removeAttribute("aria-current");
  });
}

function activateCalibrationStep(index) {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay || !overlay.classList.contains("open")) return;
  calibrationDots().forEach(dot => {
    dot.disabled = true;
    dot.classList.remove("active", "transitioning");
    dot.removeAttribute("aria-current");
  });
  calibrationStepIndex = index;
  const activeDot = calibrationDots().find(dot => dot.dataset.dot === CALIBRATION_SEQUENCE[index]);
  if (!activeDot) return;
  const count = parseInt(activeDot.dataset.c || "0", 10);
  activeDot.disabled = false;
  activeDot.classList.add("active");
  activeDot.setAttribute("aria-current", "step");
  activeDot.dataset.count = count + "/" + CALIBRATION_SAMPLES;
  activeDot.setAttribute("aria-label", `Ponto ${index + 1} de ${CALIBRATION_SEQUENCE.length}, ${count} de ${CALIBRATION_SAMPLES} cliques`);
  document.getElementById("calib-instruction").textContent = "Olhe para o ponto amarelo sem mover a cabeça e clique devagar.";
  document.getElementById("calib-step").textContent = `Ponto ${index + 1} de ${CALIBRATION_SEQUENCE.length} · faltam ${CALIBRATION_SAMPLES - count} cliques`;
  setTimeout(() => {
    try { activeDot.focus({ preventScroll: true }); } catch (e) { activeDot.focus(); }
  }, 80);
}

function activateValidationStep(index) {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay || !overlay.classList.contains("open")) return;
  calibrationDots().forEach(dot => {
    dot.disabled = true;
    dot.classList.remove("active", "transitioning", "validation-target");
    dot.removeAttribute("aria-current");
  });
  calibrationStepIndex = index;
  const target = calibrationDots().find(dot => dot.dataset.dot === VALIDATION_SEQUENCE[index]);
  if (!target) return;
  eye.gazeHistory = [];
  target.classList.add("validation-target", "transitioning");
  target.dataset.count = "teste";
  target.setAttribute("aria-label", `Teste de precisão ${index + 1} de ${VALIDATION_SEQUENCE.length}`);
  document.getElementById("calib-step").textContent = `Teste ${index + 1} de ${VALIDATION_SEQUENCE.length} · olhe para o ponto azul`;
  calibrationAdvanceTimer = setTimeout(() => {
    if (!overlay.classList.contains("open")) return;
    target.disabled = false;
    target.classList.remove("transitioning");
    target.classList.add("active");
    target.setAttribute("aria-current", "step");
    document.getElementById("calib-step").textContent = `Teste ${index + 1} de ${VALIDATION_SEQUENCE.length} · continue olhando e clique uma vez`;
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }, 650);
}

function startValidation() {
  calibrationPhase = "validate";
  calibrationStepIndex = 0;
  validationErrors = [];
  resetDotStates();
  const overlay = document.getElementById("calibration-overlay");
  overlay.classList.add("validation-mode");
  document.getElementById("calib-title").textContent = "Validação de precisão";
  document.getElementById("calib-instruction").textContent = "Agora vamos medir a precisão. Olhe para cada ponto azul e clique uma vez.";
  setCalibrationProgress(0, VALIDATION_SEQUENCE.length);
  activateValidationStep(0);
}

function showEyeAccuracy(kind, text) {
  const accuracy = document.getElementById("eye-accuracy");
  if (!accuracy) return;
  accuracy.hidden = false;
  accuracy.className = "eye-accuracy " + kind;
  accuracy.textContent = text;
}

function finishValidation() {
  const overlay = document.getElementById("calibration-overlay");
  const averageError = validationErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, validationErrors.length);
  const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
  const errorRatio = averageError / diagonal;
  const score = Math.max(0, Math.min(100, Math.round(100 - errorRatio * 300)));
  eye.validationError = averageError;
  setCalibrationProgress(VALIDATION_SEQUENCE.length, VALIDATION_SEQUENCE.length);
  resetDotStates();

  if (errorRatio <= 0.17) {
    const kind = errorRatio <= 0.08 ? "high" : "good";
    const label = errorRatio <= 0.08 ? "Precisão alta" : "Precisão boa";
    eye.calibrated = true;
    eye.preview = false;
    overlay.classList.add("complete");
    setEyeStatus("Ligado");
    setEyeHint("Olhar estabilizado. Encare um botão até o círculo completar.");
    showEyeAccuracy(kind, `${label} · ${score}%`);
    applyWebgazerPreview(false);
    document.getElementById("calib-instruction").textContent = `${label}. O controle magnético já está ativo.`;
    document.getElementById("calib-step").textContent = `Resultado: ${score}% de precisão`;
    document.getElementById("eye-preview").textContent = "Mostrar preview";
    calibrationAdvanceTimer = setTimeout(closeCalibration, 1500);
  } else {
    eye.calibrated = false;
    overlay.classList.add("needs-retry");
    setEyeStatus("Ajuste necessário");
    setEyeHint("A validação detectou baixa precisão. Refaça a calibração com mais luz e a cabeça parada.");
    showEyeAccuracy("low", `Precisão baixa · ${score}%`);
    document.getElementById("calib-instruction").textContent = "A precisão ficou baixa. Recalibre mantendo o rosto centralizado e imóvel.";
    document.getElementById("calib-step").textContent = `Resultado: ${score}% · recomendamos calibrar novamente`;
    document.getElementById("calib-reset").textContent = "Calibrar novamente";
    document.getElementById("calib-use-anyway").hidden = false;
  }
}

function resetCalibrationDots() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;
  clearTimeout(calibrationAdvanceTimer);
  calibrationPhase = "calibrate";
  calibrationStepIndex = 0;
  calibrationLastSampleAt = 0;
  validationErrors = [];
  overlay.classList.remove("complete", "needs-retry", "validation-mode");
  resetDotStates();
  eye.calibrated = false;
  eye.validationError = null;
  eye.gazeHistory = [];
  setEyeStatus("Calibrando");
  setEyeHint("Siga somente o ponto amarelo e mantenha a cabeça parada.");
  const accuracy = document.getElementById("eye-accuracy");
  if (accuracy) accuracy.hidden = true;
  document.getElementById("calib-title").textContent = "Calibração guiada";
  document.getElementById("calib-instruction").textContent = "Mantenha a cabeça parada, olhe para o ponto destacado e clique nele.";
  document.getElementById("calib-reset").textContent = "Reiniciar";
  document.getElementById("calib-use-anyway").hidden = true;
  try { if (window.webgazer && typeof window.webgazer.clearData === "function") window.webgazer.clearData(); } catch (e) {}
  updateCalibrationProgress();
  activateCalibrationStep(0);
}

function bindCalibrationUI() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;

  const dots = Array.from(overlay.querySelectorAll(".calib-dot"));
  const closeBtn = document.getElementById("calib-close");
  const resetBtn = document.getElementById("calib-reset");
  const useAnywayBtn = document.getElementById("calib-use-anyway");

  dots.forEach(d => {
    d.addEventListener("click", () => {
      if (!d.classList.contains("active") || d.disabled) return;
      const now = performance.now();
      if (now - calibrationLastSampleAt < 140) return;
      calibrationLastSampleAt = now;

      if (calibrationPhase === "validate") {
        const samples = eye.gazeHistory.filter(sample => now - sample.time <= 650);
        if (samples.length < 4 || now - eye.lastPredictionAt > 500) {
          document.getElementById("calib-step").textContent = "Não detectei um olhar estável. Continue olhando e tente novamente.";
          return;
        }
        const predictedX = median(samples.map(sample => sample.x));
        const predictedY = median(samples.map(sample => sample.y));
        const rect = d.getBoundingClientRect();
        validationErrors.push(Math.hypot(predictedX - (rect.left + rect.width / 2), predictedY - (rect.top + rect.height / 2)));
        d.disabled = true;
        d.classList.remove("active", "validation-target");
        d.classList.add("done");
        d.dataset.count = "";
        setCalibrationProgress(validationErrors.length, VALIDATION_SEQUENCE.length);
        if (calibrationStepIndex >= VALIDATION_SEQUENCE.length - 1) {
          document.getElementById("calib-step").textContent = "Calculando precisão…";
          calibrationAdvanceTimer = setTimeout(finishValidation, 450);
        } else {
          document.getElementById("calib-step").textContent = "Ótimo. Prepare-se para o próximo teste…";
          calibrationAdvanceTimer = setTimeout(() => activateValidationStep(calibrationStepIndex + 1), 430);
        }
        return;
      }

      const c = parseInt(d.dataset.c || "0", 10) + 1;

      // >>> IMPORTANTE: grava o ponto no WebGazer (senão calibração não treina de verdade)
      try {
        if (window.webgazer && typeof window.webgazer.recordScreenPosition === "function") {
          const r = d.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          window.webgazer.recordScreenPosition(cx, cy, "click");
        }
      } catch (e) {}

      d.dataset.c = String(c);
      d.dataset.count = Math.min(c, CALIBRATION_SAMPLES) + "/" + CALIBRATION_SAMPLES;
      updateCalibrationProgress();
      if (c >= CALIBRATION_SAMPLES) {
        d.classList.remove("active");
        d.classList.add("done");
        d.disabled = true;
        d.removeAttribute("aria-current");
        if (calibrationStepIndex >= CALIBRATION_SEQUENCE.length - 1) {
          document.getElementById("calib-step").textContent = "Calibração concluída. Preparando validação…";
          calibrationAdvanceTimer = setTimeout(startValidation, 650);
        } else {
          const next = dots.find(dot => dot.dataset.dot === CALIBRATION_SEQUENCE[calibrationStepIndex + 1]);
          if (next) next.classList.add("transitioning");
          document.getElementById("calib-step").textContent = "Muito bem. Agora leve os olhos ao próximo ponto…";
          calibrationAdvanceTimer = setTimeout(() => activateCalibrationStep(calibrationStepIndex + 1), 480);
        }
      } else {
        const remaining = CALIBRATION_SAMPLES - c;
        document.getElementById("calib-step").textContent = `Ponto ${calibrationStepIndex + 1} de ${CALIBRATION_SEQUENCE.length} · faltam ${remaining} ${remaining === 1 ? "clique" : "cliques"}`;
      }
    });
  });

  if (closeBtn) closeBtn.addEventListener("click", closeCalibration);
  if (resetBtn) resetBtn.addEventListener("click", resetCalibrationDots);
  if (useAnywayBtn) useAnywayBtn.addEventListener("click", () => {
    eye.calibrated = true;
    eye.preview = false;
    setEyeStatus("Ligado");
    setEyeHint("Controle ativo com precisão limitada. Recalibre se os botões ficarem difíceis de selecionar.");
    closeCalibration();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay.classList.contains("open")) closeCalibration();
  });
}

function renderGuidedTraining() {
  const config = GUIDE_CONFIG[guided.key];
  document.querySelectorAll("[data-guide]").forEach(button => button.classList.toggle("active", button.dataset.guide === guided.key));
  document.getElementById("guide-set").textContent = `Série ${Math.min(guided.set, config.sets)} de ${config.sets}`;
  document.getElementById("guide-reps").textContent = `${guided.reps} de ${config.reps}`;
  document.getElementById("guide-status").textContent = guided.resting ? `Descanso: ${guided.remaining}s` : guided.active ? "Em andamento" : state[guided.key] >= config.sets * config.reps ? "Concluído hoje" : "Pronto";
  document.querySelector(".guided-panel")?.classList.toggle("resting", guided.resting);
  document.getElementById("guide-start").textContent = guided.active ? "Encerrar treino guiado" : "Começar treino guiado";
}

function stopGuidedTraining(stopModel = false) {
  clearInterval(guided.timer);
  guided.active = false;
  guided.resting = false;
  guided.remaining = 0;
  if (stopModel && modelListening) stopRecognition();
  renderGuidedTraining();
}

async function toggleGuidedTraining() {
  if (guided.active) {
    stopGuidedTraining(true);
    return;
  }
  const config = GUIDE_CONFIG[guided.key];
  const goal = config.sets * config.reps;
  if (state[guided.key] >= goal) {
    document.getElementById("guide-status").textContent = "Meta concluída hoje";
    return;
  }
  guided.set = Math.floor(state[guided.key] / config.reps) + 1;
  guided.reps = state[guided.key] % config.reps;
  guided.active = true;
  guided.resting = false;
  renderGuidedTraining();
  if (!modelListening) {
    await startRecognition();
    if (!modelListening) stopGuidedTraining(false);
  }
}

function handleGuidedRepetition(key) {
  if (!guided.active || guided.resting || guided.key !== key) return;
  const config = GUIDE_CONFIG[key];
  guided.reps++;
  if (guided.reps < config.reps) {
    renderGuidedTraining();
    return;
  }
  if (guided.set >= config.sets) {
    document.getElementById("guide-status").textContent = "Treino concluído";
    stopGuidedTraining(true);
    return;
  }

  guided.resting = true;
  guided.remaining = config.rest;
  resetDetectionCycle();
  renderGuidedTraining();
  clearInterval(guided.timer);
  guided.timer = setInterval(() => {
    guided.remaining--;
    if (guided.remaining <= 0) {
      clearInterval(guided.timer);
      guided.set++;
      guided.reps = 0;
      guided.resting = false;
      resetDetectionCycle();
    }
    renderGuidedTraining();
  }, 1000);
}

function adjustExerciseCount(key, delta) {
  const target = Object.values(TARGETS).find(item => item.key === key);
  if (!target) return;
  const previous = state[key];
  state[key] = Math.max(0, Math.min(target.goal, state[key] + delta));
  if (state[key] === previous) return;
  state.manual = state.manual || { tara: 0, iii: 0 };
  const metric = state.metrics[key];
  if (delta > 0) {
    state.manual[key] = (Number(state.manual[key]) || 0) + 1;
    handleGuidedRepetition(key);
  } else if (state.manual[key] > 0) {
    state.manual[key]--;
  } else if (metric.accepted > 0) {
    const average = metric.confidenceSum / metric.accepted;
    metric.accepted--;
    metric.confidenceSum = Math.max(0, metric.confidenceSum - average);
    if (!metric.accepted) metric.bestConfidence = 0;
  }
  updateProgressUI();
  renderGuidedTraining();
  saveCounts();
  updateReport();
  setFeedback(key, delta > 0 ? "Repetição adicionada manualmente." : "Contagem corrigida.", "good");
}

function assessmentSuggestion(profile) {
  const options = [
    { key: "tara", score: profile.tara, text: "Comece com Tá Rá Lá em ritmo confortável, separando as sílabas." },
    { key: "iii", score: profile.iii, text: "Comece com III e faça emissões curtas antes de aumentar a duração." },
    { key: "twister", score: profile.twister, text: "Comece por um trava-língua fácil, usando o modo assistido e pausas entre trechos." }
  ];
  return options.sort((a, b) => b.score - a.score)[0];
}

function loadAssessment() {
  let profile = { tara: 0, iii: 0, twister: 0 };
  try { profile = { ...profile, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") }; } catch (e) {}
  document.getElementById("assessment-tara").value = String(profile.tara);
  document.getElementById("assessment-iii").value = String(profile.iii);
  document.getElementById("assessment-twister").value = String(profile.twister);
  if (profile.saved) document.getElementById("assessment-result").textContent = assessmentSuggestion(profile).text;
  return profile;
}

function saveAssessment() {
  const profile = {
    tara: Number(document.getElementById("assessment-tara").value),
    iii: Number(document.getElementById("assessment-iii").value),
    twister: Number(document.getElementById("assessment-twister").value),
    saved: true,
    updatedAt: Date.now()
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  document.getElementById("assessment-result").textContent = assessmentSuggestion(profile).text;
  updateReport();
}

function loadSettings() {
  let settings = { assisted: true, speed: "1" };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch (e) {}
  document.getElementById("assisted-recognition").checked = settings.assisted !== false;
  document.getElementById("twister-speed").value = String(settings.speed || "1");
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    assisted: document.getElementById("assisted-recognition").checked,
    speed: document.getElementById("twister-speed").value
  }));
}

function setPermissionStatus(id, status, type = "") {
  const element = document.getElementById(id);
  element.textContent = status;
  element.classList.remove("allowed", "denied");
  if (type) element.classList.add(type);
}

async function inspectPermissions() {
  if (!navigator.permissions?.query) return;
  for (const permission of [{ name: "microphone", id: "microphone-permission" }, { name: "camera", id: "camera-permission" }]) {
    try {
      const result = await navigator.permissions.query({ name: permission.name });
      const label = result.state === "granted" ? "Permitido" : result.state === "denied" ? "Bloqueado" : "Será solicitado";
      setPermissionStatus(permission.id, label, result.state === "granted" ? "allowed" : result.state === "denied" ? "denied" : "");
    } catch (e) {}
  }
}

async function verifyMicrophonePermission() {
  const allowed = await requestMicrophoneAccess(false);
  setPermissionStatus("microphone-permission", allowed ? "Permitido" : "Bloqueado", allowed ? "allowed" : "denied");
}

async function verifyCameraPermission() {
  try {
    const stream = await requestCameraAccess();
    stream.getTracks().forEach(track => track.stop());
    setPermissionStatus("camera-permission", "Permitida", "allowed");
  } catch (e) {
    setPermissionStatus("camera-permission", "Bloqueada", "denied");
  }
}

function exportVocalizingData() {
  const data = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith("vocalizing-")) {
      try { data[key] = JSON.parse(localStorage.getItem(key)); }
      catch (e) { data[key] = localStorage.getItem(key); }
    }
  }
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `vocalizando-${localDateKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function deleteVocalizingData() {
  if (!window.confirm("Apagar todo o histórico e as preferências salvas neste navegador?")) return;
  const keys = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith("vocalizing-")) keys.push(key);
  }
  keys.forEach(key => localStorage.removeItem(key));
  location.reload();
}

/* ---- persistência por dia ---- */
const todayKey = () => "vocalizing-" + localDateKey(new Date());

function loadCounts() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(todayKey()) || "{}"); } catch (e) {}
  state.tara = Number(saved.tara) || 0;
  state.iii  = Number(saved.iii) || 0;
  state.metrics = saved.metrics || {};
  state.manual = saved.manual || { tara: 0, iii: 0 };
  ["tara", "iii"].forEach(key => {
    state.metrics[key] = state.metrics[key] || { accepted: 0, confidenceSum: 0, bestConfidence: 0 };
    state.manual[key] = Number(state.manual[key]) || 0;
  });
}

function saveCounts() {
  localStorage.setItem(todayKey(), JSON.stringify(state));
}

function reportExerciseScore(key, goal) {
  const completion = Math.min(1, state[key] / goal);
  const metric = state.metrics?.[key];
  const confidence = metric?.accepted ? metric.confidenceSum / metric.accepted : 0;
  return state[key] ? Math.round((completion * 0.65 + confidence * 0.35) * 100) : 0;
}

function reportTip(key, completion, confidence) {
  if (!completion) return key === "tara" ? "Inicie devagar e separe bem as sílabas Tá, Rá e Lá." : "Sustente o som sem apertar a garganta e mantenha o volume estável.";
  if (confidence && confidence < 0.82) return key === "tara" ? "Articule o R e o L com mais nitidez; diminua o ritmo até o modelo reconhecer com segurança." : "Evite oscilar o volume; mantenha o som III contínuo e com a mesma intensidade.";
  if (completion < 1) return `Faltam ${Math.max(0, (key === "tara" ? 15 : 20) - state[key])} repetições. Preserve a mesma qualidade até concluir.`;
  return key === "tara" ? "Meta concluída. Aumente o ritmo sem perder a separação das sílabas." : "Meta concluída. Alongue cada emissão mantendo a voz relaxada e uniforme.";
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readDailyActivity(date) {
  let exercises = {}, twisters = {};
  const key = localDateKey(date);
  try { exercises = JSON.parse(localStorage.getItem("vocalizing-" + key) || "{}"); } catch (e) {}
  try { twisters = JSON.parse(localStorage.getItem("vocalizing-twisters-" + key) || "{}"); } catch (e) {}
  return { reps: (Number(exercises.tara) || 0) + (Number(exercises.iii) || 0), attempts: Number(twisters.attempts) || 0 };
}

function readExerciseDay(date, key) {
  let exercises = {};
  try { exercises = JSON.parse(localStorage.getItem("vocalizing-" + localDateKey(date)) || "{}"); } catch (e) {}
  const metric = exercises.metrics?.[key];
  return {
    reps: Number(exercises[key]) || 0,
    confidence: metric?.accepted ? metric.confidenceSum / metric.accepted : 0
  };
}

function renderExerciseHistory(days) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
  ["tara", "iii"].forEach(key => {
    const container = document.getElementById(`history-${key}`);
    if (!container) return;
    container.innerHTML = days.map((day, index) => {
      const result = readExerciseDay(day.date, key);
      const label = index === days.length - 1 ? "Hoje" : formatter.format(day.date).replace(".", "");
      const confidence = result.confidence ? `${Math.round(result.confidence * 100)}%` : "—";
      return `<div class="history-day"><span>${label}</span><strong>${result.reps}</strong><small>${confidence}</small></div>`;
    }).join("");
  });
}

function updateReport() {
  if (!document.getElementById("overall-score")) return;
  const goals = { tara: 15, iii: 20 };
  const scores = {};
  ["tara", "iii"].forEach(key => {
    const metric = state.metrics?.[key];
    const confidence = metric?.accepted ? metric.confidenceSum / metric.accepted : 0;
    const completion = Math.min(1, state[key] / goals[key]);
    scores[key] = reportExerciseScore(key, goals[key]);
    document.getElementById(`report-${key}-score`).textContent = scores[key];
    document.getElementById(`report-${key}-bar`).style.width = scores[key] + "%";
    document.getElementById(`report-${key}-reps`).textContent = `${state[key]} de ${goals[key]}`;
    document.getElementById(`report-${key}-confidence`).textContent = metric?.accepted ? Math.round(confidence * 100) + "%" : "—";
    document.getElementById(`report-${key}-tip`).textContent = reportTip(key, completion, confidence);
  });

  const history = Array.isArray(tongueState.history) ? tongueState.history : [];
  const scoredHistory = history.filter(item => Number.isFinite(item.score));
  const twisterAverage = scoredHistory.length ? Math.round(scoredHistory.reduce((sum, item) => sum + item.score, 0) / scoredHistory.length) : tongueState.best;
  scores.twister = twisterAverage;
  document.getElementById("report-twister-score").textContent = twisterAverage;
  document.getElementById("report-twister-bar").style.width = twisterAverage + "%";
  document.getElementById("report-twister-attempts").textContent = `${tongueState.attempts} hoje`;
  document.getElementById("report-twister-best").textContent = tongueState.best || "—";
  const lowestAttempt = scoredHistory.slice().sort((a, b) => a.score - b.score)[0];
  const twisterTip = !tongueState.attempts
    ? "Grave um desafio para receber uma orientação de dicção."
    : !scoredHistory.length
      ? "Sua prática foi registrada sem nota. Use pausas e o modo assistido na próxima tentativa."
      : twisterAverage < 75
        ? `Pratique em trechos e reforce ${lowestAttempt?.focus || "os sons da frase"}; a nota reflete apenas o que o navegador transcreveu.`
        : "Boa correspondência com a frase. Aumente a velocidade apenas se estiver confortável.";
  document.getElementById("report-twister-tip").textContent = twisterTip;

  const activeScores = Object.values(scores).filter(value => value > 0);
  const overall = activeScores.length ? Math.round(activeScores.reduce((sum, value) => sum + value, 0) / activeScores.length) : 0;
  document.getElementById("overall-score").textContent = overall;
  document.getElementById("overall-ring").style.setProperty("--score", (overall * 3.6) + "deg");
  document.getElementById("overall-title").textContent = overall >= 85 ? "Excelente treino!" : overall >= 65 ? "Você está evoluindo" : overall > 0 ? "Bom começo" : "Comece seu treino";
  document.getElementById("overall-copy").textContent = overall >= 85 ? "Seu desempenho está consistente. Continue refinando ritmo e estabilidade." : overall > 0 ? "Complete as metas e aplique as orientações abaixo para elevar sua nota." : "Conclua repetições ou grave um trava-língua para gerar sua análise.";

  const focusOptions = [
    { score: scores.tara, started: state.tara > 0, title: "Articulação do R e L", copy: document.getElementById("report-tara-tip").textContent, href: "#tara" },
    { score: scores.iii, started: state.iii > 0, title: "Sustentação e estabilidade", copy: document.getElementById("report-iii-tip").textContent, href: "#iii" },
    { score: scores.twister, started: tongueState.attempts > 0, title: "Clareza na dicção", copy: twisterTip, href: "#trava-linguas" }
  ];
  let focus = focusOptions.filter(item => item.started).sort((a, b) => a.score - b.score)[0];
  if (!focus) {
    try {
      const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      if (profile.saved) {
        const suggestion = assessmentSuggestion(profile);
        focus = {
          title: suggestion.key === "tara" ? "Articulação do R e L" : suggestion.key === "iii" ? "Sustentação e estabilidade" : "Clareza na dicção",
          copy: suggestion.text,
          href: suggestion.key === "twister" ? "#trava-linguas" : `#${suggestion.key}`
        };
      }
    } catch (e) {}
  }
  document.getElementById("next-focus-title").textContent = focus ? focus.title : "Faça a primeira avaliação";
  document.getElementById("next-focus-copy").textContent = focus ? focus.copy : "Seus pontos de melhoria aparecerão aqui conforme você pratica.";
  document.getElementById("next-focus-link").href = focus ? focus.href : "#exercicios";

  const formatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const activity = readDailyActivity(date);
    days.push({ date, value: activity.reps + activity.attempts * 5, active: activity.reps + activity.attempts > 0 });
  }
  const maxValue = Math.max(35, ...days.map(day => day.value));
  document.getElementById("weekly-active-days").textContent = days.filter(day => day.active).length;
  document.getElementById("weekly-chart").innerHTML = days.map((day, index) => {
    const height = day.value ? Math.max(12, Math.round(day.value / maxValue * 100)) : 4;
    const label = index === 6 ? "Hoje" : formatter.format(day.date).replace(".", "");
    return `<div class="week-day${day.active ? " active" : ""}"><span class="week-value">${day.value || "—"}</span><div class="week-track"><i style="height:${height}%"></i></div><small>${label}</small></div>`;
  }).join("");
  renderExerciseHistory(days);
  document.getElementById("report-date").textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(new Date());
}

/* ---- UI helpers ---- */
function setListening(on) {
  const mic = document.getElementById("mic-indicator");
  const btn = document.getElementById("start-btn");
  const label = mic.querySelector(".label");
  const startLabel = btn.querySelector(".start-label");
  modelListening = !!on;
  mic.classList.toggle("on", !!on);
  btn.classList.toggle("listening", !!on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  label.textContent = on ? "Reconhecendo exercício" : "Aguardando";
  if (startLabel) startLabel.textContent = on ? "Parar reconhecimento" : "Iniciar reconhecimento";
}

function updateProgressUI() {
  TARGETS[EX_TARA_LABEL].span.textContent = state.tara;
  TARGETS[EX_III_LABEL].span.textContent  = state.iii;

  const taraPct = Math.min(100, (state.tara / TARGETS[EX_TARA_LABEL].goal) * 100);
  const iiiPct  = Math.min(100, (state.iii  / TARGETS[EX_III_LABEL].goal) * 100);
  TARGETS[EX_TARA_LABEL].bar.style.width = taraPct + "%";
  TARGETS[EX_III_LABEL].bar.style.width  = iiiPct + "%";

  const taraCard = TARGETS[EX_TARA_LABEL].card;
  const iiiCard  = TARGETS[EX_III_LABEL].card;
  taraCard.classList.toggle("done", state.tara >= TARGETS[EX_TARA_LABEL].goal);
  iiiCard.classList.toggle("done",  state.iii  >= TARGETS[EX_III_LABEL].goal);
}

function flashHit(cardEl) {
  cardEl.classList.add("hit");
  setTimeout(() => cardEl.classList.remove("hit"), 450);
}

function setFeedback(exKey, text, type = "") {
  const target = exKey === "tara" ? TARGETS[EX_TARA_LABEL] : TARGETS[EX_III_LABEL];
  target.feedback.textContent = text;
  target.feedback.classList.remove("good", "low", "done");
  if (type) target.feedback.classList.add(type);
}

function updateConfidence(conf, raw) {
  const confPct = Math.round(conf * 100);
  const bar = document.getElementById("conf-bar");
  const val = document.getElementById("conf-value");
  const last = document.getElementById("last-label");
  bar.style.width = Math.max(0, Math.min(100, confPct)) + "%";
  bar.className = conf >= THRESHOLD ? "ok" : "low";
  val.textContent = confPct + "%";
  if (raw) last.textContent = raw;
}

const FEEDBACK_GOOD = [
  "Perfeito!",
  "Ótimo timbre!",
  "Isso aí!",
  "Mantenha o ritmo!",
  "Belo ataque!"
];

/* ---- modelo ---- */
function prepareTensorFlow() {
  if (tensorflowReadyPromise) return tensorflowReadyPromise;

  tensorflowReadyPromise = (async () => {
    if (!window.tf) throw new Error("TensorFlow não foi carregado.");
    if (IS_IOS_DEVICE && tf.getBackend() !== "cpu") {
      const backendReady = await tf.setBackend("cpu");
      if (!backendReady) throw new Error("O backend CPU não pôde ser iniciado.");
    }
    await tf.ready();
    return tf.getBackend();
  })().catch(error => {
    tensorflowReadyPromise = null;
    throw error;
  });

  return tensorflowReadyPromise;
}

function createModel() {
  if (modelLoadPromise) return modelLoadPromise;

  modelLoadPromise = prepareTensorFlow().then(() => {
    recognizer = speechCommands.create(
      "BROWSER_FFT",
      undefined,
      `${MODEL_URL}model.json?v=${MODEL_VERSION}`,
      `${MODEL_URL}metadata.json?v=${MODEL_VERSION}`
    );
    return recognizer.ensureModelLoaded();
  }).catch(error => {
    recognizer = null;
    modelLoadPromise = null;
    throw error;
  });
  return modelLoadPromise;
}

function preloadExerciseModel() {
  const modelStatus = document.querySelector("#model-status span");
  if (recognizer && modelLoadPromise) return modelLoadPromise;
  if (modelStatus) modelStatus.textContent = "Carregando…";

  return createModel()
    .then(() => {
      if (modelStatus && !modelListening) modelStatus.textContent = "Pronto";
    })
    .catch(error => {
      console.warn("Não foi possível pré-carregar o modelo.", error);
      if (modelStatus && !modelListening) modelStatus.textContent = "Toque para carregar";
    });
}

function resetDetectionCandidate() {
  detectionCycle.candidateKey = null;
  detectionCycle.candidateFrames = 0;
  detectionCycle.candidateConfidenceSum = 0;
}

function resetDetectionCycle() {
  detectionCycle.armed = true;
  detectionCycle.releaseFrames = 0;
  detectionCycle.lastCountAt = 0;
  resetDetectionCandidate();
}

async function startRecognition() {
  if (modelListening) {
    if (guided.active) stopGuidedTraining(false);
    stopRecognition();
    return;
  }

  if (tongueState.listening) stopPronunciation();
  const modelStatus = document.querySelector("#model-status span");
  const debug = document.querySelector("#debug");

  if (!checkMicrophoneEnvironment(false)) {
    modelStatus.textContent = "Microfone indisponível";
    debug.textContent = "O navegador não permite usar o microfone nesta página.";
    return;
  }

  try {
    if (!recognizer || !modelLoadPromise) {
      modelStatus.textContent = "Carregando…";
    }
    await createModel();
  } catch (e) {
    modelStatus.textContent = "Erro ao carregar";
    const detail = e && e.message ? ` (${e.message})` : "";
    debug.textContent = `Não foi possível iniciar o modelo${detail}`;
    console.error("Falha ao carregar o modelo de exercícios.", e);
    return;
  }

  resetDetectionCycle();

  try {
    await recognizer.listen(result => {
      const labels = recognizer.wordLabels();
      const scores = result.scores;
      const idx    = scores.indexOf(Math.max(...scores));
      const raw    = labels[idx];
      const conf   = scores[idx];
      const now    = performance.now();

      let exerciseKey = null;
      let exerciseConf = 0;
      labels.forEach((label, index) => {
        const key = LABEL2KEY[normalize(label)];
        if (key && scores[index] > exerciseConf) {
          exerciseKey = key;
          exerciseConf = scores[index];
        }
      });

      document.querySelector("#debug").textContent = `${raw} (${conf.toFixed(2)})`;
      updateConfidence(conf, raw);

      if (guided.active && guided.resting) {
        resetDetectionCandidate();
        return;
      }

      if (!detectionCycle.armed) {
        if (exerciseConf <= RELEASE_THRESHOLD) {
          detectionCycle.releaseFrames++;
          if (
            detectionCycle.releaseFrames >= RELEASE_FRAMES &&
            now - detectionCycle.lastCountAt >= MIN_REP_INTERVAL_MS
          ) {
            detectionCycle.armed = true;
            detectionCycle.releaseFrames = 0;
          }
        } else {
          detectionCycle.releaseFrames = 0;
        }
        return;
      }

      if (!exerciseKey || exerciseConf < THRESHOLD) {
        resetDetectionCandidate();
        if (exerciseConf > THRESHOLD - 0.1) {
          const next = state.tara < TARGETS[EX_TARA_LABEL].goal ? "tara" : "iii";
          setFeedback(next, "Projete mais a voz e articule bem.", "low");
        }
        return;
      }

      if (guided.active && exerciseKey !== guided.key) {
        resetDetectionCandidate();
        return;
      }

      if (detectionCycle.candidateKey !== exerciseKey) {
        resetDetectionCandidate();
        detectionCycle.candidateKey = exerciseKey;
      }
      detectionCycle.candidateFrames++;
      detectionCycle.candidateConfidenceSum += exerciseConf;

      if (detectionCycle.candidateFrames < STABLE_FRAMES) return;

      const key = detectionCycle.candidateKey;
      const acceptedConfidence = detectionCycle.candidateConfidenceSum / detectionCycle.candidateFrames;

      if (key === "tara" && state.tara < TARGETS[EX_TARA_LABEL].goal) {
        state.tara++;
        state.metrics.tara.accepted++;
        state.metrics.tara.confidenceSum += acceptedConfidence;
        state.metrics.tara.bestConfidence = Math.max(state.metrics.tara.bestConfidence, acceptedConfidence);
        flashHit(TARGETS[EX_TARA_LABEL].card);
        const left = TARGETS[EX_TARA_LABEL].goal - state.tara;
        setFeedback("tara", left > 0 ? FEEDBACK_GOOD[state.tara % FEEDBACK_GOOD.length] : "🎉 Meta concluída!", left > 0 ? "good" : "done");
      } else if (key === "iii" && state.iii < TARGETS[EX_III_LABEL].goal) {
        state.iii++;
        state.metrics.iii.accepted++;
        state.metrics.iii.confidenceSum += acceptedConfidence;
        state.metrics.iii.bestConfidence = Math.max(state.metrics.iii.bestConfidence, acceptedConfidence);
        flashHit(TARGETS[EX_III_LABEL].card);
        const left = TARGETS[EX_III_LABEL].goal - state.iii;
        setFeedback("iii", left > 0 ? FEEDBACK_GOOD[state.iii % FEEDBACK_GOOD.length] : "🎉 Meta concluída!", left > 0 ? "good" : "done");
      } else {
        return;
      }

      detectionCycle.armed = false;
      detectionCycle.releaseFrames = 0;
      detectionCycle.lastCountAt = now;
      resetDetectionCandidate();
      handleGuidedRepetition(key);
      updateProgressUI();
      renderGuidedTraining();
      saveCounts();
      updateReport();
    }, {
      includeSpectrogram: false,
      probabilityThreshold: 0.01,
      invokeCallbackOnNoiseAndUnknown: true,
      overlapFactor: 0.5,
      audioTrackConstraints: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    modelStatus.textContent = "Pronto";
    debug.textContent = "Escutando…";
    setListening(true);
  } catch (error) {
    resetDetectionCycle();
    setListening(false);
    modelStatus.textContent = "Microfone bloqueado";
    debug.textContent = IS_IOS_DEVICE
      ? "No iPhone, permita o microfone em Ajustes > Safari e toque novamente."
      : "Não foi possível iniciar o microfone. Verifique a permissão e tente novamente.";
    console.error("Falha ao iniciar o reconhecimento dos exercícios.", error);
  }
}

function stopRecognition() {
  try {
    if (recognizer && typeof recognizer.stopListening === "function") recognizer.stopListening();
  } catch (e) {}
  resetDetectionCycle();
  setListening(false);
  document.querySelector("#debug").textContent = "Reconhecimento pausado.";
}

function reset(exKey) {
  state[exKey] = 0;
  state.metrics[exKey] = { accepted: 0, confidenceSum: 0, bestConfidence: 0 };
  state.manual[exKey] = 0;
  if (guided.key === exKey) {
    guided.set = 1;
    guided.reps = 0;
    stopGuidedTraining(false);
  }
  updateProgressUI();
  saveCounts();
  setFeedback(exKey, "Reiniciado. Bora de novo!");
  updateReport();
}

/* ---- bootstrap ---- */
window.addEventListener("DOMContentLoaded", () => {
  TARGETS[EX_TARA_LABEL].span = document.getElementById("tara-count");
  TARGETS[EX_III_LABEL].span  = document.getElementById("iii-count");
  TARGETS[EX_TARA_LABEL].bar = document.getElementById("tara-bar");
  TARGETS[EX_III_LABEL].bar  = document.getElementById("iii-bar");
  TARGETS[EX_TARA_LABEL].feedback = document.getElementById("tara-feedback");
  TARGETS[EX_III_LABEL].feedback  = document.getElementById("iii-feedback");
  TARGETS[EX_TARA_LABEL].card = document.getElementById("tara");
  TARGETS[EX_III_LABEL].card  = document.getElementById("iii");

  loadCounts();
  loadSettings();
  loadAssessment();
  updateProgressUI();
  initTongueTwisters();
  renderGuidedTraining();
  updateReport();
  inspectPermissions();
  window.setTimeout(preloadExerciseModel, 250);

  document.getElementById("start-btn").addEventListener("click", startRecognition);
  document.getElementById("reset-tara").addEventListener("click", () => reset("tara"));
  document.getElementById("reset-iii").addEventListener("click", () => reset("iii"));
  document.getElementById("pause-twister").addEventListener("click", toggleTwisterPause);
  document.getElementById("repeat-twister").addEventListener("click", repeatTwister);
  document.getElementById("twister-speed").addEventListener("change", () => {
    if (activeTwisterAudio) activeTwisterAudio.playbackRate = twisterPlaybackRate();
    saveSettings();
  });
  document.getElementById("assisted-recognition").addEventListener("change", saveSettings);
  document.getElementById("register-practice").addEventListener("click", registerUnscoredPractice);
  document.getElementById("save-assessment").addEventListener("click", saveAssessment);
  document.getElementById("guide-start").addEventListener("click", toggleGuidedTraining);
  document.querySelectorAll("[data-guide]").forEach(button => button.addEventListener("click", () => {
    if (guided.active) return;
    guided.key = button.dataset.guide;
    const config = GUIDE_CONFIG[guided.key];
    guided.set = Math.min(config.sets, Math.floor(state[guided.key] / config.reps) + 1);
    guided.reps = state[guided.key] % config.reps;
    renderGuidedTraining();
  }));
  document.querySelectorAll("[data-adjust]").forEach(button => button.addEventListener("click", () => adjustExerciseCount(button.dataset.adjust, Number(button.dataset.delta))));
  document.getElementById("check-microphone").addEventListener("click", verifyMicrophonePermission);
  document.getElementById("check-camera").addEventListener("click", verifyCameraPermission);
  document.getElementById("export-data").addEventListener("click", exportVocalizingData);
  document.getElementById("delete-data").addEventListener("click", deleteVocalizingData);

  // eye UI
  eye.cursor = document.getElementById("gaze-cursor");
  eye.ring = eye.cursor?.querySelector(".ring") || null;
  setRingProgress(0);

  const eyeToggle = document.getElementById("eye-toggle");
  const eyeCalib  = document.getElementById("eye-calibrate");
  const eyePrev   = document.getElementById("eye-preview");

  if (eyeToggle) eyeToggle.addEventListener("click", toggleEyeTracking);
  if (eyeCalib)  eyeCalib.addEventListener("click", () => { if (eye.enabled) openCalibration(); });
  if (eyePrev)   eyePrev.addEventListener("click", () => {
    if (!eye.enabled) return;
    eye.preview = !eye.preview;
    applyWebgazerPreview(eye.preview);
    eyePrev.textContent = eye.preview ? "Ocultar preview" : "Mostrar preview";
  });

  bindCalibrationUI();

  // Ajuda o WebGazer a aprender com cliques reais, sem duplicar os pontos da calibração.
  document.addEventListener("click", (ev) => {
    if (!eye.enabled) return;
    // Cliques gerados pelo próprio controle ocular têm coordenadas artificiais
    // e não podem ser usados para treinar o modelo.
    if (!ev.isTrusted) return;
    if (document.getElementById("calibration-overlay")?.classList.contains("open")) return;
    if (ev.target && ev.target.closest && ev.target.closest(".calib-dot")) return;
    try {
      if (window.webgazer && typeof window.webgazer.recordScreenPosition === "function") {
        window.webgazer.recordScreenPosition(ev.clientX, ev.clientY, "click");
      }
    } catch (e) {}
  }, true);
});
