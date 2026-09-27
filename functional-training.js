const FUNCTIONAL_STORAGE = "vocalizing-functional-v1";
const FUNCTIONAL_BASELINE_STORAGE = "vocalizing-functional-baseline-v1";
const FUNCTIONAL_TARGETS_STORAGE = "vocalizing-functional-targets-v1";
const FUNCTIONAL_REFERENCES_STORAGE = "vocalizing-functional-references-v1";

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
let functionalReferences = {};
let functionalLastSignature = null;
let functionalIndex = 0;
let functionalPromptIndex = 0;
let functionalRemaining = 180;
let functionalTimer = null;
let functionalTimerEnd = 0;
let functionalRecorder = null;
let functionalStream = null;
let functionalAudioContext = null;
let functionalMonitor = null;
let functionalListening = false;
let functionalStarting = false;
let functionalStartToken = 0;
let functionalNoiseFloor = 0.002;
let functionalSegment = null;
let functionalLastSampleAt = 0;
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

function functionalMicStatus(label, active = false) {
  document.getElementById("functional-live").textContent = label;
  const mic = document.getElementById("mic-indicator");
  if (mic && (active || !(typeof modelListening !== "undefined" && modelListening) && !(typeof tongueState !== "undefined" && tongueState.listening))) {
    mic.classList.toggle("on", active);
    mic.querySelector(".label").textContent = active ? "Ouvindo treino funcional" : label;
  }
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
  functionalPromptIndex = Math.max(0, Math.min(functionalPromptIndex, prompts.length - 1));
  document.getElementById("functional-exercise").value = exercise.id;
  document.getElementById("functional-step").textContent = `${functionalIndex + 1} de ${FUNCTIONAL_EXERCISES.length}`;
  document.getElementById("functional-name").textContent = exercise.name;
  document.getElementById("functional-instruction").textContent = exercise.instruction;
  document.getElementById("functional-prompt").textContent = prompts[functionalPromptIndex];
  document.getElementById("functional-guidance").textContent = exercise.guidance;
  document.getElementById("functional-prev").disabled = functionalIndex === 0;
  document.getElementById("functional-next").textContent = functionalIndex === FUNCTIONAL_EXERCISES.length - 1 ? "Voltar ao início" : "Próximo foco";
  document.getElementById("functional-repeat-prompt").disabled = prompts.length < 2;
  document.getElementById("functional-next-prompt").disabled = prompts.length < 2;
  functionalRenderRecordButton();
  functionalRenderAudio();
}

function functionalRenderRecordButton() {
  const button = document.getElementById("functional-record");
  if (functionalStarting) button.textContent = "Abrindo microfone…";
  else if (functionalListening) button.textContent = "Escutando…";
  else {
    const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
    const prompt = functionalPrompts(exercise)[functionalPromptIndex];
    button.textContent = functionalAttempts.some(item => item.exercise === exercise.id && item.prompt === prompt) ? "Tentar novamente" : "Iniciar escuta";
  }
}

function functionalSelect(index) {
  window.vocalizandoVoice?.stop();
  functionalStopRecording();
  functionalResetTimer();
  functionalIndex = (index + FUNCTIONAL_EXERCISES.length) % FUNCTIONAL_EXERCISES.length;
  functionalPromptIndex = 0;
  functionalRenderExercise();
  functionalRenderHistory();
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

function functionalLastAttemptIndex() {
  const today = new Date().toLocaleDateString("sv-SE");
  const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
  const prompt = functionalPrompts(exercise)[functionalPromptIndex];
  for (let index = functionalAttempts.length - 1; index >= 0; index--) {
    const item = functionalAttempts[index];
    if (item.exercise === exercise.id && item.prompt === prompt && new Date(item.at).toLocaleDateString("sv-SE") === today) return index;
  }
  return -1;
}

function functionalReferenceKey(exercise, prompt) {
  return `${exercise}\n${prompt}`;
}

function functionalFrameDistance(left, right) {
  if (!left && !right) return 0;
  if (!left || !right) return 0.7;
  return left.reduce((sum, value, index) => sum + Math.abs(value - (right[index] || 0)), 0) / 2;
}

function functionalAcousticScore(signature, reference) {
  const left = signature?.frames;
  const right = reference?.frames;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 4 || right.length < 4 || !reference.durationMs || !reference.voicedMs) return null;
  const previous = new Float64Array(right.length + 1).fill(Infinity);
  const steps = new Uint16Array(right.length + 1);
  previous[0] = 0;
  for (const frame of left) {
    const current = new Float64Array(right.length + 1).fill(Infinity);
    const currentSteps = new Uint16Array(right.length + 1);
    for (let index = 1; index <= right.length; index++) {
      const options = [
        [previous[index], steps[index]],
        [current[index - 1], currentSteps[index - 1]],
        [previous[index - 1], steps[index - 1]]
      ];
      const best = options.reduce((a, b) => a[0] <= b[0] ? a : b);
      current[index] = best[0] + functionalFrameDistance(frame, right[index - 1]);
      currentSteps[index] = best[1] + 1;
    }
    previous.set(current);
    steps.set(currentSteps);
  }
  const spectralDistance = Math.min(1, previous[right.length] / steps[right.length]);
  const durationDistance = Math.min(1, Math.abs(Math.log(signature.durationMs / reference.durationMs)) / Math.log(2));
  const voicedDistance = Math.min(1, Math.abs(Math.log(signature.voicedMs / reference.voicedMs)) / Math.log(2));
  return Math.max(0, Math.min(100, Math.round(100 - spectralDistance * 65 - durationDistance * 20 - voicedDistance * 15)));
}

function functionalCountAttempt(source, voicedMs = null, signature = null) {
  const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
  const prompt = functionalPrompts(exercise)[functionalPromptIndex];
  const reference = functionalReferences[functionalReferenceKey(exercise.id, prompt)];
  const attempt = {
    at: new Date().toISOString(),
    exercise: exercise.id,
    prompt,
    source,
    voicedMs,
    score: signature && reference ? functionalAcousticScore(signature, reference) : null,
    clarity: null,
    effort: null,
    note: ""
  };
  const next = [...functionalAttempts, attempt];
  if (!functionalPersist(FUNCTIONAL_STORAGE, next)) return false;
  functionalAttempts = next;
  functionalLastSignature = signature ? { at: attempt.at, exercise: exercise.id, prompt, signature } : null;
  document.getElementById("functional-consent-features").checked = false;
  functionalRenderExercise();
  functionalRenderHistory();
  if (typeof updateReport === "function") updateReport();
  functionalMessage(source === "auto"
    ? Number.isFinite(attempt.score) ? `Tentativa contada. Semelhança com sua referência: ${attempt.score} de 100.` : "Tentativa contada. Defina uma referência desta frase para receber nota."
    : "Contagem corrigida; sem nota de áudio.");
  return true;
}

function functionalFinishSegment() {
  const segment = functionalSegment;
  functionalSegment = null;
  if (!segment) return;
  const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
  const minimumMs = exercise.id === "transferencia" ? 1800 : ["respiracao", "voz"].includes(exercise.id) ? 500 : 250;
  if (segment.voicedMs >= minimumMs) {
    while (segment.frames[segment.frames.length - 1] === null) segment.frames.pop();
    const signature = segment.frames.length >= 4 ? {
      frames: segment.frames,
      durationMs: Math.round(segment.lastSoundAt - segment.startedAt + 70),
      voicedMs: Math.round(segment.voicedMs)
    } : null;
    functionalCountAttempt("auto", Math.round(segment.voicedMs), signature);
  }
  functionalMicStatus(functionalListening ? "Aguardando sua voz" : "Microfone desligado", functionalListening);
}

function functionalSpectrum(analyser, frequencies, bands) {
  analyser.getFloatFrequencyData(frequencies);
  const values = bands.map(([start, end]) => {
    let power = 0;
    for (let index = start; index < end; index++) power += 10 ** (Math.max(-100, frequencies[index]) / 10);
    return Math.sqrt(power / Math.max(1, end - start));
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => Math.round(value / total * 10000) / 10000);
}

function functionalObserveAudio(analyser) {
  const samples = new Uint8Array(analyser.fftSize);
  const frequencies = new Float32Array(analyser.frequencyBinCount);
  const edges = [80, 150, 240, 360, 540, 800, 1200, 1800, 2700, 4000, 6000];
  const bands = edges.slice(0, -1).map((start, index) => [
    Math.max(1, Math.floor(start * analyser.fftSize / analyser.context.sampleRate)),
    Math.max(2, Math.ceil(edges[index + 1] * analyser.fftSize / analyser.context.sampleRate))
  ]);
  functionalMonitor = setInterval(() => {
    if (!functionalListening) return;
    analyser.getByteTimeDomainData(samples);
    let power = 0;
    for (const sample of samples) power += ((sample - 128) / 128) ** 2;
    const rms = Math.sqrt(power / samples.length);
    const now = performance.now();
    const elapsed = functionalLastSampleAt ? Math.min(150, now - functionalLastSampleAt) : 70;
    functionalLastSampleAt = now;
    document.getElementById("functional-level-bar").style.width = `${Math.min(100, Math.round(rms / 0.08 * 100))}%`;
    const threshold = Math.max(0.004, functionalNoiseFloor * 2);
    if (rms >= threshold) {
      if (!functionalSegment) {
        functionalSegment = { voicedMs: 0, startedAt: now, lastSoundAt: now, frames: [] };
        functionalMicStatus("Som captado", true);
      }
      functionalSegment.voicedMs += elapsed;
      functionalSegment.lastSoundAt = now;
      functionalSegment.frames.push(functionalSpectrum(analyser, frequencies, bands));
    } else if (functionalSegment) {
      const exercise = FUNCTIONAL_EXERCISES[functionalIndex];
      const gapMs = exercise.id === "transferencia" ? 5000 : ["ritmo", "prosodia", "voz"].includes(exercise.id) ? 1500 : 1000;
      if (now - functionalSegment.lastSoundAt >= gapMs) functionalFinishSegment();
      else functionalSegment.frames.push(null);
    } else {
      functionalNoiseFloor = functionalNoiseFloor * 0.98 + rms * 0.02;
    }
    if (functionalSegment?.frames.length > 120) functionalSegment.frames = functionalSegment.frames.filter((_, index) => index % 2 === 0);
  }, 70);
}

async function functionalStartRecording() {
  window.vocalizandoVoice?.stop();
  if (functionalListening || functionalStarting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    functionalMessage("Microfone indisponível. Abra o site em HTTPS e permita o acesso ao microfone.");
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    functionalMessage("Este navegador não oferece a escuta necessária para contar as tentativas.");
    return;
  }
  const token = ++functionalStartToken;
  functionalStarting = true;
  document.getElementById("functional-record").disabled = true;
  functionalRenderRecordButton();
  functionalMicStatus("Solicitando microfone");
  functionalMessage("Abrindo o microfone…");
  let context = null;
  let stream = null;
  try {
    if (typeof modelListening !== "undefined" && modelListening) stopRecognition();
    if (typeof tongueState !== "undefined" && tongueState.listening) stopPronunciation();
    context = new AudioContextClass();
    const resume = context.resume().catch(error => error);
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
    const resumeError = await resume;
    if (resumeError) throw resumeError;
    if (token !== functionalStartToken) {
      stream.getTracks().forEach(track => track.stop());
      await context.close();
      return;
    }
    functionalStream = stream;
    functionalAudioContext = context;
    const source = context.createMediaStreamSource(stream);
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 90;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(filter);
    filter.connect(analyser);
    functionalNoiseFloor = 0.002;
    functionalSegment = null;
    functionalLastSampleAt = 0;
    functionalListening = true;
    functionalObserveAudio(analyser);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (functionalListening) {
        functionalStopRecording("interrupted");
        functionalMessage("O microfone foi interrompido. Inicie a escuta novamente.");
      }
    });

    if (window.MediaRecorder) {
      try {
        const preferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported?.(type));
        const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
        const version = document.getElementById("functional-version").value;
        const exerciseId = FUNCTIONAL_EXERCISES[functionalIndex].id;
        const chunks = [];
        recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
        recorder.onstop = () => {
          if (functionalRecorder === recorder) functionalRecorder = null;
          if (!chunks.length) return;
          const blob = new Blob(chunks, { type: preferred || chunks[0].type || "audio/mp4" });
          const key = `${exerciseId}:${version}`;
          const previous = functionalAudio.get(key);
          if (previous) URL.revokeObjectURL(previous.url);
          functionalAudio.set(key, { url: URL.createObjectURL(blob), extension: blob.type.includes("webm") ? "webm" : "m4a" });
          functionalRenderAudio();
        };
        recorder.start();
        functionalRecorder = recorder;
      } catch (error) {
        functionalRecorder = null;
      }
    }
    document.getElementById("functional-stop").disabled = false;
    functionalMicStatus("Aguardando sua voz", true);
    functionalRenderRecordButton();
    functionalMessage("Escutando e contando as tentativas automaticamente.");
  } catch (error) {
    if (functionalListening) functionalStopRecording();
    else {
      stream?.getTracks().forEach(track => track.stop());
      if (context?.state !== "closed") context?.close().catch(() => {});
      functionalStream = null;
      functionalAudioContext = null;
    }
    functionalMicStatus(error.name === "NotAllowedError" ? "Microfone bloqueado" : "Falha no microfone");
    functionalMessage(`Não foi possível iniciar a escuta (${error.name || "microfone indisponível"}). Verifique a permissão do microfone.`);
  } finally {
    if (token === functionalStartToken) {
      functionalStarting = false;
      document.getElementById("functional-record").disabled = functionalListening;
      functionalRenderRecordButton();
    }
  }
}

function functionalStopRecording(reason = "stopped") {
  functionalStartToken++;
  functionalStarting = false;
  functionalListening = false;
  if (functionalMonitor) clearInterval(functionalMonitor);
  functionalMonitor = null;
  functionalFinishSegment();
  if (functionalRecorder?.state === "recording") functionalRecorder.stop();
  functionalStream?.getTracks().forEach(track => track.stop());
  functionalStream = null;
  if (functionalAudioContext?.state !== "closed") functionalAudioContext?.close().catch(() => {});
  functionalAudioContext = null;
  functionalLastSampleAt = 0;
  document.getElementById("functional-record").disabled = false;
  functionalRenderRecordButton();
  document.getElementById("functional-stop").disabled = true;
  document.getElementById("functional-level-bar").style.width = "0%";
  functionalMicStatus(reason === "background" ? "Pausado ao sair do app" : reason === "interrupted" ? "Microfone interrompido" : "Microfone desligado");
  if (reason === "background") functionalMessage("Escuta pausada ao sair do app. Toque em Iniciar escuta para continuar.");
}

function functionalSaveReview() {
  const index = functionalLastAttemptIndex();
  if (index < 0) return;
  const updated = functionalAttempts.map((attempt, itemIndex) => itemIndex === index ? {
    ...attempt,
    clarity: Number(document.getElementById("functional-clarity").value),
    effort: Number(document.getElementById("functional-effort").value),
    note: document.getElementById("functional-note").value.trim()
  } : attempt);
  if (!functionalPersist(FUNCTIONAL_STORAGE, updated)) return;
  functionalAttempts = updated;
  document.getElementById("functional-note").value = "";
  functionalRenderHistory();
  functionalMessage("Sua avaliação foi adicionada à tentativa mais recente desta frase.");
}

function functionalSaveListener() {
  const index = functionalLastAttemptIndex();
  const result = document.getElementById("functional-listener-result").value;
  if (index < 0 || !["all", "part", "none"].includes(result)) {
    functionalMessage("Selecione o que o ouvinte entendeu.");
    return;
  }
  const attempt = functionalAttempts[index];
  const candidate = functionalLastSignature?.at === attempt.at ? functionalLastSignature : null;
  const signature = candidate?.signature || attempt.listenerSignature;
  const consent = document.getElementById("functional-consent-features").checked && !!signature;
  const updated = functionalAttempts.map((item, itemIndex) => {
    if (itemIndex !== index) return item;
    const { listenerSignature, ...rest } = item;
    return { ...rest, listenerResult: result, listenerAt: new Date().toISOString(), ...(consent ? { listenerSignature: signature } : {}) };
  });
  if (!functionalPersist(FUNCTIONAL_STORAGE, updated)) return;
  functionalAttempts = updated;
  const key = functionalReferenceKey(attempt.exercise, attempt.prompt);
  let referenceSaved = false;
  if (result === "all" && consent) {
    const references = { ...functionalReferences, [key]: { ...signature, basedOn: attempt.at } };
    if (functionalPersist(FUNCTIONAL_REFERENCES_STORAGE, references)) {
      functionalReferences = references;
      referenceSaved = true;
    }
  } else if (functionalReferences[key]?.basedOn === attempt.at) {
    const references = { ...functionalReferences };
    delete references[key];
    if (functionalPersist(FUNCTIONAL_REFERENCES_STORAGE, references)) functionalReferences = references;
  }
  document.getElementById("functional-listener-result").value = "";
  document.getElementById("functional-consent-features").checked = false;
  functionalRenderHistory();
  if (typeof updateReport === "function") updateReport();
  functionalMessage(referenceSaved ? "Retorno salvo. Esta tentativa virou sua referência pessoal para a frase." : "Retorno do ouvinte salvo separadamente da nota acústica.");
}

function functionalUndoAttempt() {
  const index = functionalLastAttemptIndex();
  if (index < 0) return;
  const attempt = functionalAttempts[index];
  const updated = functionalAttempts.filter((_, itemIndex) => itemIndex !== index);
  if (!functionalPersist(FUNCTIONAL_STORAGE, updated)) return;
  functionalAttempts = updated;
  if (functionalLastSignature?.at === attempt.at) functionalLastSignature = null;
  const key = functionalReferenceKey(attempt.exercise, attempt.prompt);
  if (functionalReferences[key]?.basedOn === attempt.at) {
    const references = { ...functionalReferences };
    delete references[key];
    if (functionalPersist(FUNCTIONAL_REFERENCES_STORAGE, references)) functionalReferences = references;
  }
  functionalRenderHistory();
  if (typeof updateReport === "function") updateReport();
  functionalMessage("Última tentativa desta frase removida.");
}

function functionalRepeatPrompt() {
  window.vocalizandoVoice?.stop();
  const prompts = functionalPrompts(FUNCTIONAL_EXERCISES[functionalIndex]);
  if (prompts.length < 2) return;
  functionalStopRecording();
  functionalPromptIndex = (functionalPromptIndex - 1 + prompts.length) % prompts.length;
  functionalRenderExercise();
  functionalRenderHistory();
  functionalMessage("Frase anterior selecionada.");
}

function functionalNextPrompt() {
  window.vocalizandoVoice?.stop();
  const prompts = functionalPrompts(FUNCTIONAL_EXERCISES[functionalIndex]);
  if (prompts.length < 2) return;
  functionalStopRecording();
  functionalPromptIndex = (functionalPromptIndex + 1) % prompts.length;
  functionalRenderExercise();
  functionalRenderHistory();
  functionalMessage("Próxima frase selecionada.");
}

function functionalRenderScore() {
  const index = functionalLastAttemptIndex();
  const attempt = index >= 0 ? functionalAttempts[index] : null;
  const reference = attempt && functionalReferences[functionalReferenceKey(attempt.exercise, attempt.prompt)];
  const canSetReference = attempt?.source === "auto" && attempt.listenerResult !== "none" && attempt.listenerResult !== "part" && functionalLastSignature?.at === attempt.at && functionalLastSignature?.exercise === attempt.exercise && functionalPrompts(FUNCTIONAL_EXERCISES[functionalIndex]).includes(attempt.prompt);
  document.getElementById("functional-set-reference").disabled = !canSetReference;
  const value = document.getElementById("functional-score");
  const detail = document.getElementById("functional-score-detail");
  value.textContent = Number.isFinite(attempt?.score) && reference && reference.basedOn !== attempt.at ? `${attempt.score}/100` : "—";
  if (!attempt) detail.textContent = "Grave uma tentativa e escolha uma referência para esta frase.";
  else if (reference?.basedOn === attempt.at) detail.textContent = "Esta tentativa é sua referência. A próxima receberá nota.";
  else if (Number.isFinite(attempt.score) && reference) detail.textContent = attempt.listenerResult === "none" || attempt.listenerResult === "part" ? "O ouvinte não entendeu a frase toda. A nota acústica não mede compreensão." : "Semelhança com sua referência pessoal da mesma frase; não é nota de compreensão.";
  else if (attempt.source === "manual") detail.textContent = "Correções manuais de contagem não recebem nota de áudio.";
  else if (["none", "part"].includes(attempt.listenerResult)) detail.textContent = "O ouvinte não entendeu a frase toda. Isso fica registrado sem nota automática de compreensão.";
  else if (reference) detail.textContent = "Esta tentativa não teve áudio suficiente para comparação.";
  else if (canSetReference) detail.textContent = "Escolha esta tentativa como referência para esta frase.";
  else detail.textContent = "Sem áudio suficiente para referência. Faça outra tentativa.";
}

function functionalSetReference() {
  const index = functionalLastAttemptIndex();
  if (index < 0) return;
  const attempt = functionalAttempts[index];
  const candidate = functionalLastSignature;
  if (!candidate || candidate.at !== attempt.at || candidate.exercise !== attempt.exercise || candidate.prompt !== attempt.prompt || ["none", "part"].includes(attempt.listenerResult)) return;
  const key = functionalReferenceKey(attempt.exercise, attempt.prompt);
  const updated = { ...functionalReferences, [key]: { ...candidate.signature, basedOn: attempt.at } };
  if (!functionalPersist(FUNCTIONAL_REFERENCES_STORAGE, updated)) return;
  functionalReferences = updated;
  if (attempt.score != null) {
    const revised = functionalAttempts.map((item, itemIndex) => itemIndex === index ? { ...item, score: null } : item);
    if (functionalPersist(FUNCTIONAL_STORAGE, revised)) functionalAttempts = revised;
  }
  const prompts = functionalPrompts(FUNCTIONAL_EXERCISES[functionalIndex]);
  functionalPromptIndex = Math.max(0, prompts.indexOf(attempt.prompt));
  functionalRenderExercise();
  functionalRenderHistory();
  functionalMessage("Referência pessoal salva. A próxima tentativa desta frase receberá nota automática.");
}

function functionalRenderHistory() {
  const today = new Date().toLocaleDateString("sv-SE");
  const todayAttempts = functionalAttempts.filter(item => item.at && new Date(item.at).toLocaleDateString("sv-SE") === today);
  document.getElementById("functional-today-count").textContent = todayAttempts.length;
  document.getElementById("functional-exercise-count").textContent = todayAttempts.filter(item => item.exercise === FUNCTIONAL_EXERCISES[functionalIndex].id).length;
  const hasCurrentAttempt = functionalLastAttemptIndex() >= 0;
  document.getElementById("functional-save-review").disabled = !hasCurrentAttempt;
  document.getElementById("functional-undo-attempt").disabled = !hasCurrentAttempt;
  document.getElementById("functional-save-listener").disabled = !hasCurrentAttempt;
  const latest = hasCurrentAttempt ? functionalAttempts[functionalLastAttemptIndex()] : null;
  document.getElementById("functional-consent-features").disabled = !latest || (functionalLastSignature?.at !== latest.at && !latest.listenerSignature);
  functionalRenderScore();
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
    const details = [new Date(item.at).toLocaleDateString("pt-BR")];
    if (item.prompt) details.push(item.prompt);
    if (item.source === "auto") details.push("som detectado");
    if (item.source === "manual") details.push("contagem corrigida");
    if (item.voicedMs != null) details.push(`${(item.voicedMs / 1000).toFixed(1).replace(".", ",")} s de som`);
    if (Number.isFinite(item.score) && functionalReferences[functionalReferenceKey(item.exercise, item.prompt)]?.basedOn !== item.at) details.push(`semelhança ${item.score}/100`);
    if (item.clarity != null) details.push(`clareza ${item.clarity}/10`);
    if (item.effort != null) details.push(`esforço ${item.effort}/10`);
    if (item.listenerResult) details.push(`ouvinte: ${{ all: "entendeu tudo", part: "entendeu parte", none: "não entendeu" }[item.listenerResult] || item.listenerResult}`);
    meta.textContent = details.join(" · ");
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
  functionalReferences = functionalRead(FUNCTIONAL_REFERENCES_STORAGE, {});
  if (!Array.isArray(functionalAttempts)) functionalAttempts = [];
  if (!Array.isArray(functionalBaselines)) functionalBaselines = [];
  if (!Array.isArray(functionalTargets.words)) functionalTargets.words = [];
  if (!Array.isArray(functionalTargets.phrases)) functionalTargets.phrases = functionalTargets.phrase ? [functionalTargets.phrase] : [];
  if (!functionalReferences || typeof functionalReferences !== "object" || Array.isArray(functionalReferences)) functionalReferences = {};
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
      functionalRenderHistory();
      functionalMessage("Palavras e frases salvas neste navegador.");
    }
  });
  document.getElementById("functional-record").addEventListener("click", functionalStartRecording);
  document.getElementById("functional-stop").addEventListener("click", functionalStopRecording);
  document.getElementById("functional-save-review").addEventListener("click", functionalSaveReview);
  document.getElementById("functional-add-attempt").addEventListener("click", () => functionalCountAttempt("manual"));
  document.getElementById("functional-undo-attempt").addEventListener("click", functionalUndoAttempt);
  document.getElementById("functional-repeat-prompt").addEventListener("click", functionalRepeatPrompt);
  document.getElementById("functional-next-prompt").addEventListener("click", functionalNextPrompt);
  document.getElementById("functional-hear-explanation").addEventListener("click", () => {
    window.vocalizandoVoice.playExplanation(FUNCTIONAL_EXERCISES[functionalIndex].id, document.getElementById("voice-status"));
  });
  document.getElementById("functional-hear-prompt").addEventListener("click", () => {
    const phrase = functionalPrompts(FUNCTIONAL_EXERCISES[functionalIndex])[functionalPromptIndex];
    window.vocalizandoVoice.speak(phrase, document.getElementById("functional-voice-player"), document.getElementById("voice-status"));
  });
  document.getElementById("functional-set-reference").addEventListener("click", functionalSetReference);
  document.getElementById("functional-save-listener").addEventListener("click", functionalSaveListener);
  document.getElementById("functional-baseline").addEventListener("submit", functionalSaveBaseline);
  for (const field of ["clarity", "effort"]) {
    document.getElementById(`functional-${field}`).addEventListener("input", event => {
      document.getElementById(`functional-${field}-value`).value = event.target.value;
    });
  }
  window.addEventListener("pagehide", () => {
    functionalStopRecording("background");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && functionalListening) functionalStopRecording("background");
  });
  functionalResetTimer();
  functionalRenderExercise();
  functionalRenderHistory();
  functionalRenderBaselines();
}

window.addEventListener("DOMContentLoaded", functionalInit);
