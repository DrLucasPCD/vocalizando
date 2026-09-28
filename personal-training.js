(function () {
  const NAME = "vocalizando-personal-v1";
  const EXAMPLES_KEY = "personal-examples-v1";
  const TRAINED_FINGERPRINT_KEY = "vocalizing-personal-trained-fingerprint-v1";
  const LABELS = {
    personal_tara: "Tá Rá Lá",
    personal_iii: "III",
    _background_noise_: "Silêncio"
  };
  const MIN_PER_LABEL = 5;
  const MAX_PER_LABEL = 20;
  let transfer = null;
  let preparing = null;
  let busy = false;
  let enabled = false;
  let playerUrl = null;
  let currentFingerprint = null;

  const element = id => document.getElementById(id);
  const status = message => { element("personal-status").textContent = message; };

  function counts() {
    if (!transfer || transfer.isDatasetEmpty()) return Object.fromEntries(Object.keys(LABELS).map(label => [label, 0]));
    const saved = transfer.countExamples();
    return Object.fromEntries(Object.keys(LABELS).map(label => [label, saved[label] || 0]));
  }

  function total() {
    return Object.values(counts()).reduce((sum, count) => sum + count, 0);
  }

  function trained() {
    return total() >= MIN_PER_LABEL * 3 && !!currentFingerprint && localStorage.getItem(TRAINED_FINGERPRINT_KEY) === currentFingerprint;
  }

  async function fingerprint(buffer) {
    if (!buffer) return null;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function wavBlob(rawAudio) {
    const samples = rawAudio.data;
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rawAudio.sampleRateHz, true);
    view.setUint32(28, rawAudio.sampleRateHz * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
    return new Blob([buffer], { type: "audio/wav" });
  }

  function render() {
    const values = counts();
    element("personal-counts").replaceChildren(...Object.entries(LABELS).map(([label, name]) => {
      const cell = document.createElement("div");
      cell.textContent = `${name}: ${values[label]} / ${MIN_PER_LABEL}`;
      cell.classList.toggle("ready", values[label] >= MIN_PER_LABEL);
      return cell;
    }));
    element("personal-mode").textContent = enabled && trained() ? "Modelo personalizado ativo" : trained() ? "Modelo personalizado pronto" : "Modelo original";
    element("personal-record").disabled = busy;
    element("personal-train").disabled = busy || Object.values(values).some(count => count < MIN_PER_LABEL);
    element("personal-toggle").disabled = busy || !trained();
    element("personal-toggle").textContent = enabled && trained() ? "Usar modelo original" : "Usar modelo personalizado";
    element("personal-export").disabled = busy || !total();
    element("personal-delete").disabled = busy || !total();

    const list = element("personal-examples");
    list.replaceChildren();
    if (!transfer || transfer.isDatasetEmpty()) return;
    for (const [label, name] of Object.entries(LABELS)) {
      if (!values[label]) continue;
      for (const { uid, example } of transfer.getExamples(label)) {
        const row = document.createElement("div");
        row.className = "personal-example";
        const title = document.createElement("span");
        title.textContent = name;
        const play = document.createElement("button");
        play.type = "button";
        play.textContent = "Ouvir";
        play.disabled = busy || !example.rawAudio;
        play.addEventListener("click", () => {
          const player = element("personal-player");
          player.pause();
          if (playerUrl) URL.revokeObjectURL(playerUrl);
          playerUrl = URL.createObjectURL(wavBlob(example.rawAudio));
          player.src = playerUrl;
          player.hidden = false;
          player.play().catch(() => status("Toque no player para ouvir a gravação."));
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Excluir";
        remove.disabled = busy;
        remove.addEventListener("click", () => removeExample(uid));
        row.append(title, play, remove);
        list.append(row);
      }
    }
  }

  async function prepare() {
    if (preparing) return preparing;
    preparing = (async () => {
      await createModel();
      transfer = recognizer.createTransfer(NAME);
      const saved = await window.vocalizandoData.get(EXAMPLES_KEY);
      if (saved) transfer.loadExamples(saved);
      currentFingerprint = await fingerprint(saved);
      if (trained()) {
        try {
          await transfer.load();
          enabled = true;
          status("Modelo personalizado carregado e pronto para reconhecer sua voz.");
        } catch (error) {
          console.warn("Modelo personalizado indisponível", error);
          localStorage.removeItem(TRAINED_FINGERPRINT_KEY);
          status("Os exemplos foram mantidos, mas é preciso treinar novamente.");
        }
      } else if (total()) {
        status(`${total()} exemplos carregados. Treine o modelo para usá-los no reconhecimento.`);
      }
      render();
      return transfer;
    })().catch(error => {
      preparing = null;
      throw error;
    });
    return preparing;
  }

  async function saveExamples() {
    if (transfer.isDatasetEmpty()) {
      await window.vocalizandoData.remove(EXAMPLES_KEY);
      currentFingerprint = null;
    } else {
      const buffer = transfer.serializeExamples();
      await window.vocalizandoData.put(EXAMPLES_KEY, buffer);
      currentFingerprint = await fingerprint(buffer);
    }
    if (!trained()) enabled = false;
    render();
  }

  async function record() {
    if (busy) return;
    if (!element("personal-consent").checked) {
      status("Marque a autorização antes de gravar. Nada será salvo sem ela.");
      return;
    }
    const label = element("personal-label").value;
    busy = true;
    render();
    try {
      window.vocalizandoVoice?.stop();
      if (modelListening) stopRecognition();
      if (tongueState.listening) stopPronunciation();
      if (typeof functionalListening !== "undefined" && functionalListening) functionalStopRecording();
      status("Preparando o modelo e o microfone...");
      await prepare();
      if (counts()[label] >= MAX_PER_LABEL) throw new Error(`Limite de ${MAX_PER_LABEL} exemplos para ${LABELS[label]}. Exclua um antes de continuar.`);
      status(label === "_background_noise_" ? "Gravando silêncio. Fique em silêncio por um instante." : `Gravando ${LABELS[label]}. Fale agora, no seu ritmo.`);
      await transfer.collectExample(label, {
        includeRawAudio: true,
        durationSec: label === "personal_tara" ? 2 : 1.25
      });
      const newest = transfer.getExamples(label).at(-1);
      if (!newest?.example.rawAudio?.data?.length) {
        if (newest) transfer.removeExample(newest.uid);
        throw new Error("O navegador não entregou o áudio. Tente novamente.");
      }
      try {
        await saveExamples();
      } catch (error) {
        transfer.removeExample(newest.uid);
        throw error;
      }
      status(`Exemplo de ${LABELS[label]} guardado neste navegador. Ouça-o e exclua se não ficou bom.`);
    } catch (error) {
      console.warn("Falha ao gravar exemplo", error);
      status(error.name === "NotAllowedError" ? "Microfone bloqueado. Verifique a permissão do navegador." : error.message || "Não foi possível gravar este exemplo.");
    } finally {
      busy = false;
      render();
    }
  }

  async function removeExample(uid) {
    if (busy || !window.confirm("Excluir este exemplo e sua gravação?")) return;
    busy = true;
    try {
      transfer.removeExample(uid);
      await saveExamples();
      status("Exemplo excluído. Treine novamente para usar as mudanças.");
    } catch (error) {
      status(error.message || "Não foi possível excluir o exemplo.");
    } finally {
      busy = false;
      render();
    }
  }

  async function train() {
    if (busy || Object.values(counts()).some(count => count < MIN_PER_LABEL)) return;
    busy = true;
    enabled = false;
    localStorage.removeItem(TRAINED_FINGERPRINT_KEY);
    render();
    try {
      if (modelListening) stopRecognition();
      status("Treinando com seus exemplos. Mantenha esta página aberta.");
      await transfer.train({
        epochs: 20,
        batchSize: 8,
        callback: { onEpochEnd: async epoch => {
          status(`Treinando: etapa ${epoch + 1} de 20.`);
          if (tf.nextFrame) await tf.nextFrame();
        } }
      });
      await transfer.save();
      localStorage.setItem(TRAINED_FINGERPRINT_KEY, currentFingerprint);
      enabled = true;
      status("Modelo personalizado pronto. Inicie o reconhecimento para testar; corrija contagens incorretas.");
    } catch (error) {
      console.error("Falha no treino personalizado", error);
      status(`Não foi possível concluir o treino: ${error.message || "erro desconhecido"}. Os exemplos continuam guardados.`);
    } finally {
      busy = false;
      render();
    }
  }

  async function exportExamples() {
    if (!transfer || transfer.isDatasetEmpty()) return;
    const blob = new Blob([transfer.serializeExamples()], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vocalizando-exemplos-voz.bin";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importExamples(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!element("personal-consent").checked) {
      status("Marque a autorização antes de importar gravações.");
      return;
    }
    if (file.size > 40 * 1024 * 1024 || !window.confirm("Substituir seus exemplos de voz pelos deste arquivo? O modelo precisará ser treinado novamente.")) return;
    busy = true;
    render();
    try {
      await replaceExamples(await file.arrayBuffer());
      status("Exemplos importados. Treine o modelo novamente neste navegador.");
    } catch (error) {
      status(`Não foi possível importar: ${error.message || "arquivo inválido"}.`);
    } finally {
      busy = false;
      render();
    }
  }

  async function replaceExamples(buffer) {
    if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > 40 * 1024 * 1024) throw new Error("Arquivo de exemplos inválido ou grande demais.");
    await prepare();
    const previous = transfer.isDatasetEmpty() ? null : transfer.serializeExamples();
    try {
      if (previous) transfer.clearExamples();
      transfer.loadExamples(buffer);
      if (Object.keys(transfer.countExamples()).some(label => !(label in LABELS))) throw new Error("O arquivo contém um exercício desconhecido.");
      for (const label of Object.keys(LABELS)) {
        if (counts()[label] > MAX_PER_LABEL) throw new Error("O arquivo contém exemplos demais.");
      }
      await saveExamples();
      enabled = false;
    } catch (error) {
      if (!transfer.isDatasetEmpty()) transfer.clearExamples();
      if (previous) transfer.loadExamples(previous);
      currentFingerprint = await fingerprint(previous);
      render();
      throw error;
    }
    render();
  }

  async function clearAll() {
    await window.vocalizandoData.remove(EXAMPLES_KEY);
    localStorage.removeItem(TRAINED_FINGERPRINT_KEY);
    currentFingerprint = null;
    try { await speechCommands.deleteSavedTransferModel(NAME); } catch (error) { console.warn(error); }
    enabled = false;
  }

  function init() {
    element("personal-record").addEventListener("click", record);
    element("personal-train").addEventListener("click", train);
    element("personal-toggle").addEventListener("click", () => {
      if (modelListening) stopRecognition();
      enabled = !enabled;
      render();
      status(enabled ? "Modelo personalizado ativo." : "Modelo original ativo.");
    });
    element("personal-export").addEventListener("click", exportExamples);
    element("personal-import").addEventListener("click", () => element("personal-import-file").click());
    element("personal-import-file").addEventListener("change", importExamples);
    element("personal-delete").addEventListener("click", async () => {
      if (!window.confirm("Apagar os exemplos de voz e o modelo personalizado deste navegador?")) return;
      try {
        await clearAll();
        location.reload();
      } catch (error) {
        status(`Não foi possível apagar os dados: ${error.message}.`);
      }
    });
    prepare().catch(error => status(`Treino pessoal indisponível: ${error.message}.`));
  }

  window.vocalizandoPersonal = {
    ready: prepare,
    activeRecognizer: () => enabled && trained() ? transfer : null,
    examplesBuffer: async () => {
      await prepare();
      return transfer.isDatasetEmpty() ? null : transfer.serializeExamples();
    },
    replaceExamples,
    clearAll
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
