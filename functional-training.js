const FUNCTIONAL_STORAGE = "vocalizing-functional-v1";
const FUNCTIONAL_BASELINE_STORAGE = "vocalizing-functional-baseline-v1";
const FUNCTIONAL_TARGETS_STORAGE = "vocalizing-functional-targets-v1";

const FUNCTIONAL_EXERCISES = [
  {
    id: "respiracao",
    name: "Respiração e fonação",
    instruction: "Inspire confortavelmente. Solte o ar em /s/, faça um /a/ confortável e passe para uma frase curta em uma expiração.",
    prompts: ["/s/ por alguns segundos → /a/ confortável", "Hoje eu tenho aula.", "Eu quero falar agora."],
    guidance: "Faça blocos curtos. Pare se houver dor, aperto ou rouquidão."
  },
  {
    id: "voz",
    name: "Voz clara",
    instruction: "Diga a mesma frase de forma habitual e depois com voz clara e presente. Compare a compreensão, sem gritar.",
    prompts: ["/a/ confortável por alguns segundos", "Glissando curto grave → agudo, depois agudo → grave", "Eu quero conversar com você.", "Hoje eu preciso explicar uma ideia."],
    guidance: "Use as versões Habitual e Clara ao gravar. Prefira a que soa mais compreensível e confortável."
  },
  {
    id: "articulacao",
    name: "Fala clara e palavras difíceis",
    instruction: "Produza uma palavra importante com movimentos bem definidos. Em seguida, use a palavra em uma frase.",
    prompts: ["Escolha uma palavra importante para você.", "Diga a palavra em uma frase curta."],
    guidance: "Movimentos mais nítidos são úteis quando ajudam o ouvinte; mantenha a fala confortável."
  },
  {
    id: "vogais",
    name: "Contraste de vogais",
    instruction: "Alterne devagar /i-a-u/ e /u-a-i/, completando cada transição. Depois use palavras reais.",
    prompts: ["/i-a-u/ → /u-a-i/", "vida → casa → tudo", "medicina → neurologia"],
    guidance: "Faça cinco sequências confortáveis de cada direção e migre para palavras reais."
  },
  {
    id: "consoantes",
    name: "Precisão de consoantes",
    instruction: "Escolha dois ou três sons difíceis. Passe de sílaba para palavra, frase e fala espontânea.",
    prompts: ["TA → DA → NA → LA", "tarde → dado → nada → lado", "O dado caiu do lado da mesa."],
    guidance: "Treine os contrastes que mais afetam sua comunicação; não é preciso praticar todos os sons."
  },
  {
    id: "ritmo",
    name: "Ritmo e pausas",
    instruction: "Diga a frase normalmente e depois com pausas nas divisões naturais. Compare qual versão foi mais fácil de entender.",
    prompts: ["Hoje eu fui à faculdade / conversei com o professor / e voltei para casa.", "Eu quero falar / sobre a prova de amanhã."],
    guidance: "Use a menor redução de velocidade que realmente ajude a compreensão."
  },
  {
    id: "prosodia",
    name: "Ênfase e entonação",
    instruction: "Mude a palavra enfatizada. Depois diga a mesma frase como afirmação e pergunta.",
    prompts: ["EU quero falar com você.", "Eu QUERO falar com você.", "Eu quero FALAR com você.", "Eu quero falar com VOCÊ."],
    guidance: "Deixe apenas a palavra importante se destacar por duração, tom ou intensidade confortável."
  },
  {
    id: "sequenciamento",
    name: "Sequenciamento de sílabas",
    instruction: "Experimente transições entre sílabas e alterne o acento, com pausas curtas entre tentativas.",
    prompts: ["PA-ta-ku → pa-TA-ku → pa-ta-KU", "MI-va-to → mi-VA-to → mi-va-TO", "GO-pi-la → go-PI-la → go-pi-LA"],
    guidance: "Prática inspirada em sequenciamento motor. Não substitui o protocolo ReST formal."
  },
  {
    id: "transferencia",
    name: "Conversa e fala espontânea",
    instruction: "Explique algo importante para você por um ou dois minutos. Use pausas e reformule se precisar.",
    prompts: ["Conte como foi seu dia.", "Explique um assunto que você conhece bem.", "Faça um pedido que seria útil em uma conversa real."],
    guidance: "O objetivo é ser compreendido em situações reais, com um esforço sustentável."
  }
];

let functionalAttempts = [];
let functionalBaselines = [];
let functionalTargets = { words: [], phrases: [] };
let functionalIndex = 0;
let functionalPromptIndex = 0;
let functionalRemaining = 180;
let functionalTimer = null;
let functionalTimerEnd = 0;
let functionalRecorder = null;
let functionalStream = null;
let functionalAudio = new Map();

function functionalRead(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value == null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function functionalPersist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    functionalMessage("Não foi possível salvar neste navegador. Exporte seus dados antes de fechar a página.");
    return false;
  }
}

function functionalMessage(message) {
  document.getElementById("functional-status").textContent = message;
}

function functionalPrompts(exercise) {
  if (exercise.id === "articulacao" && functionalTargets.words.length) {
    return functionalTargets.words.flatMap(word => [word, `Use "${word}" em uma frase curta.`]);
  }
  if (["voz", "ritmo", "prosodia", "transferencia"].includes(exercise.id) && functionalTargets.phrases.length) {
    return [...functionalTargets.phrases, ...exercise.prompts];
  }
  return exercise.prompts;
}

function functionalRenderTimer() {
  const minutes = Math.floor(functionalRemaining / 60);
  const seconds = functionalRemaining % 60;
  document.getElementById("functional-clock").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  document.getElementById("functional-timer").textContent = functionalTimer ? "Pausar tempo" : functionalRemaining === 0 ? "Reiniciar tempo" : "Iniciar tempo";
}

function functionalPauseTimer() {
  if (functionalTimer) functionalRemaining = Math.max(0, Math.ceil((functionalTimerEnd - Date.now()) / 1000));
  if (functionalTimer) clearInterval(functionalTimer);
  functionalTimer = null;
  functionalTimerEnd = 0;
  functionalRenderTimer();
}

function functionalResetTimer() {
  functionalPauseTimer();
  functionalRemaining = Number(document.getElementById("functional-duration").value) * 60;
  functionalRenderTimer();
}

function functionalRenderExercise() {
  const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
  const prompts = functionalPrompts(exercise);
  functionalPromptIndex = Math.min(functionalPromptIndex, prompts.length - 1);
  document.getElementById("functional-exercise").value = exercise.id;
  document.getElementById("functional-step").textContent = `${functionalIndex + 1} de ${FUNCTIONAL_EXERCISES.length}`;
  document.getElementById("functional-name").textContent = exercise.name;
  document.getElementById("functional-instruction").textContent = exercise.instruction;
  document.getElementById("functional-prompt").textContent = prompts[functionalPromptIndex];
  document.getElementById("functional-guidance").textContent = exercise.guidance;
  document.getElementById("functional-prev").disabled = functionalIndex === 0;
  document.getElementById("functional-next").textContent = functionalIndex === FUNCTIONAL_EXERCISES.length - 1 ? "Voltar ao início" : "Próximo foco";
  functionalRenderAudio();
}

function functionalSelect(index) {
  functionalStopRecording();
  functionalResetTimer();
  functionalIndex = (index + FUNCTIONAL_EXERCISES.length) % FUNCTIONAL_EXERCISES.length;
  functionalPromptIndex = 0;
  functionalRenderExercise();
  functionalMessage("Faça pausas sempre que precisar.");
}

function functionalRenderAudio() {
  const list = document.getElementById("functional-audio-list");
  list.replaceChildren();
  for (const version of ["habitual", "clara"]) {
    const item = functionalAudio.get(`${FUNCTIONAL_EXERCISES[functionalIndex].id}:${version}`);
    if (!item) continue;
    const row = document.createElement("div");
    row.className = "functional-audio-row";
    const label = document.createElement("strong");
    label.textContent = version === "habitual" ? "Habitual" : "Clara";
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    player.src = item.url;
    const download = document.createElement("a");
    download.href = item.url;
    download.download = `vocalizando-${FUNCTIONAL_EXERCISES[functionalIndex].id}-${version}.${item.extension}`;
    download.textContent = "Baixar áudio";
    row.append(label, player, download);
    list.appendChild(row);
  }
}

async function functionalStartRecording() {
  if (functionalRecorder || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    functionalMessage("A gravação não está disponível neste navegador. Você ainda pode registrar a prática.");
    return;
  }
  try {
    if (typeof modelListening !== "undefined" && modelListening) stopRecognition();
    if (typeof tongueState !== "undefined" && tongueState.listening) stopPronunciation();
    functionalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const preferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported?.(type));
    functionalRecorder = new MediaRecorder(functionalStream, preferred ? { mimeType: preferred } : undefined);
    const version = document.getElementById("functional-version").value;
    const exerciseId = FUNCTIONAL_EXERCISES[functionalIndex].id;
    const chunks = [];
    functionalRecorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    functionalRecorder.onstop = () => {
      functionalStream?.getTracks().forEach(track => track.stop());
      functionalStream = null;
      functionalRecorder = null;
      document.getElementById("functional-record").disabled = false;
      document.getElementById("functional-stop").disabled = true;
      if (!chunks.length) {
        functionalMessage("O áudio ficou vazio. Tente gravar novamente.");
        return;
      }
      const blob = new Blob(chunks, { type: preferred || chunks[0].type || "audio/mp4" });
      const key = `${exerciseId}:${version}`;
      const previous = functionalAudio.get(key);
      if (previous) URL.revokeObjectURL(previous.url);
      functionalAudio.set(key, { url: URL.createObjectURL(blob), extension: blob.type.includes("webm") ? "webm" : "m4a" });
      functionalRenderAudio();
      functionalMessage("Gravação pronta para ouvir ou baixar.");
    };
    functionalRecorder.onerror = () => functionalMessage("A gravação falhou. Você pode registrar a tentativa sem áudio.");
    functionalRecorder.start();
    document.getElementById("functional-record").disabled = true;
    document.getElementById("functional-stop").disabled = false;
    functionalMessage("Gravando. Toque em Parar quando terminar.");
  } catch (error) {
    functionalStream?.getTracks().forEach(track => track.stop());
    functionalStream = null;
    functionalRecorder = null;
    functionalMessage(`Não foi possível gravar (${error.name || "microfone indisponível"}). Verifique a permissão do microfone.`);
  }
}

function functionalStopRecording() {
  if (functionalRecorder?.state === "recording") functionalRecorder.stop();
}

function functionalSaveAttempt() {
  functionalStopRecording();
  const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
  const attempt = {
    at: new Date().toISOString(),
    exercise: exercise.id,
    prompt: functionalPrompts(exercise)[functionalPromptIndex],
    clarity: Number(document.getElementById("functional-clarity").value),
    effort: Number(document.getElementById("functional-effort").value),
    note: document.getElementById("functional-note").value.trim()
  };
  const next = [...functionalAttempts, attempt];
  if (!functionalPersist(FUNCTIONAL_STORAGE, next)) return;
  functionalAttempts = next;
  document.getElementById("functional-note").value = "";
  const prompts = functionalPrompts(exercise);
  functionalPromptIndex = (functionalPromptIndex + 1) % prompts.length;
  functionalRenderExercise();
  functionalRenderHistory();
  functionalMessage("Tentativa registrada. Você pode continuar, descansar ou mudar de foco.");
}

function functionalRenderHistory() {
  const today = new Date().toLocaleDateString("sv-SE");
  document.getElementById("functional-today-count").textContent = functionalAttempts.filter(item => item.at && new Date(item.at).toLocaleDateString("sv-SE") === today).length;
  const history = document.getElementById("functional-history");
  history.replaceChildren();
  if (!functionalAttempts.length) {
    history.textContent = "Nenhuma tentativa registrada ainda.";
    return;
  }
  const recent = functionalAttempts.slice(-8).reverse();
  for (const item of recent) {
    const row = document.createElement("div");
    row.className = "functional-history-row";
    const title = document.createElement("strong");
    title.textContent = FUNCTIONAL_EXERCISES.find(exercise => exercise.id === item.exercise)?.name || item.exercise;
    const meta = document.createElement("span");
    meta.textContent = `${new Date(item.at).toLocaleDateString("pt-BR")} · clareza ${item.clarity}/10 · esforço ${item.effort}/10`;
    row.append(title, meta);
    history.appendChild(row);
  }
}

function functionalOptionalNumber(id, max) {
  const input = document.getElementById(id);
  if (input.value.trim() === "") return null;
  const value = Number(input.value);
  return Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function functionalSaveBaseline(event) {
  event.preventDefault();
  const form = document.getElementById("functional-baseline");
  if (!form.reportValidity()) return;
  const entry = {
    at: new Date().toISOString(),
    goal: document.getElementById("baseline-goal").value.trim(),
    intelligibility: functionalOptionalNumber("baseline-intelligibility", 100),
    effort: functionalOptionalNumber("baseline-effort", 10),
    fatigue: functionalOptionalNumber("baseline-fatigue", 10),
    mpt: [1, 2, 3].map(index => functionalOptionalNumber(`baseline-mpt-${index}`, 120)),
    note: document.getElementById("baseline-note").value.trim()
  };
  if (!entry.goal && entry.intelligibility == null && entry.effort == null && entry.fatigue == null && entry.mpt.every(value => value == null) && !entry.note) {
    functionalMessage("Preencha ao menos um campo da linha de base.");
    return;
  }
  const next = [...functionalBaselines, entry];
  if (!functionalPersist(FUNCTIONAL_BASELINE_STORAGE, next)) return;
  functionalBaselines = next;
  form.reset();
  functionalRenderBaselines();
  functionalMessage("Linha de base salva. Repita em cerca de duas semanas nas mesmas condições.");
}

function functionalRenderBaselines() {
  const history = document.getElementById("baseline-history");
  history.replaceChildren();
  if (!functionalBaselines.length) {
    history.textContent = "Nenhuma linha de base registrada.";
    return;
  }
  for (const [index, entry] of functionalBaselines.slice(-4).reverse().entries()) {
    const row = document.createElement("div");
    row.className = "functional-history-row";
    const title = document.createElement("strong");
    title.textContent = new Date(entry.at).toLocaleDateString("pt-BR");
    const details = document.createElement("span");
    const values = [];
    if (entry.intelligibility != null) values.push(`${entry.intelligibility}% entendido pelo ouvinte`);
    if (entry.effort != null) values.push(`esforço ${entry.effort}/10`);
    if (entry.fatigue != null) values.push(`fadiga ${entry.fatigue}/10`);
    const trials = Array.isArray(entry.mpt) ? entry.mpt.filter(Number.isFinite) : [];
    if (trials.length) values.push(`/a/ melhor ${Math.max(...trials)} s`);
    if (entry.goal) values.push(entry.goal);
    const previous = functionalBaselines[functionalBaselines.length - 2 - index];
    if (previous && entry.intelligibility != null && previous.intelligibility != null) {
      const difference = entry.intelligibility - previous.intelligibility;
      values.push(`${difference > 0 ? "+" : ""}${difference} pontos percentuais desde a anterior`);
    }
    details.textContent = values.join(" · ") || entry.note;
    row.append(title, details);
    history.appendChild(row);
  }
}

function functionalInit() {
  const selector = document.getElementById("functional-exercise");
  if (!selector) return;
  functionalAttempts = functionalRead(FUNCTIONAL_STORAGE, []);
  functionalBaselines = functionalRead(FUNCTIONAL_BASELINE_STORAGE, []);
  functionalTargets = functionalRead(FUNCTIONAL_TARGETS_STORAGE, { words: [], phrases: [] });
  if (!Array.isArray(functionalAttempts)) functionalAttempts = [];
  if (!Array.isArray(functionalBaselines)) functionalBaselines = [];
  if (!Array.isArray(functionalTargets.words)) functionalTargets.words = [];
  if (!Array.isArray(functionalTargets.phrases)) functionalTargets.phrases = functionalTargets.phrase ? [functionalTargets.phrase] : [];
  for (const exercise of FUNCTIONAL_EXERCISES) selector.add(new Option(exercise.name, exercise.id));
  document.getElementById("functional-words").value = functionalTargets.words.join("\n");
  document.getElementById("functional-phrase").value = functionalTargets.phrases.join("\n");
  selector.addEventListener("change", () => functionalSelect(FUNCTIONAL_EXERCISES.findIndex(exercise => exercise.id === selector.value)));
  document.getElementById("functional-duration").addEventListener("change", functionalResetTimer);
  document.getElementById("functional-prev").addEventListener("click", () => functionalSelect(functionalIndex - 1));
  document.getElementById("functional-next").addEventListener("click", () => functionalSelect(functionalIndex + 1));
  document.getElementById("functional-reset-timer").addEventListener("click", functionalResetTimer);
  document.getElementById("functional-timer").addEventListener("click", () => {
    if (functionalTimer) {
      functionalPauseTimer();
      return;
    }
    if (functionalRemaining === 0) functionalResetTimer();
    functionalTimerEnd = Date.now() + functionalRemaining * 1000;
    functionalTimer = setInterval(() => {
      functionalRemaining = Math.max(0, Math.ceil((functionalTimerEnd - Date.now()) / 1000));
      functionalRenderTimer();
      if (!functionalRemaining) {
        functionalPauseTimer();
        functionalMessage("Bloco concluído. Descanse antes de continuar.");
      }
    }, 1000);
    functionalRenderTimer();
  });
  document.getElementById("functional-save-targets").addEventListener("click", () => {
    const words = document.getElementById("functional-words").value.split(/\n/).map(word => word.trim()).filter(Boolean).slice(0, 20);
    const phrases = document.getElementById("functional-phrase").value.split(/\n/).map(phrase => phrase.trim().slice(0, 180)).filter(Boolean).slice(0, 10);
    if (functionalPersist(FUNCTIONAL_TARGETS_STORAGE, { words, phrases })) {
      functionalTargets = { words, phrases };
      functionalPromptIndex = 0;
      functionalRenderExercise();
      functionalMessage("Palavras e frases salvas neste navegador.");
    }
  });
  document.getElementById("functional-record").addEventListener("click", functionalStartRecording);
  document.getElementById("functional-stop").addEventListener("click", functionalStopRecording);
  document.getElementById("functional-save-attempt").addEventListener("click", functionalSaveAttempt);
  document.getElementById("functional-baseline").addEventListener("submit", functionalSaveBaseline);
  for (const field of ["clarity", "effort"]) {
    document.getElementById(`functional-${field}`).addEventListener("input", event => {
      document.getElementById(`functional-${field}-value`).value = event.target.value;
    });
  }
  window.addEventListener("pagehide", () => {
    functionalStopRecording();
    functionalStream?.getTracks().forEach(track => track.stop());
    for (const audio of functionalAudio.values()) URL.revokeObjectURL(audio.url);
  });
  functionalResetTimer();
  functionalRenderExercise();
  functionalRenderHistory();
  functionalRenderBaselines();
}

window.addEventListener("DOMContentLoaded", functionalInit);
