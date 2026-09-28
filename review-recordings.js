(function () {
  const button = document.getElementById("twister-audio-record");
  const status = document.getElementById("twister-audio-status");
  const list = document.getElementById("twister-saved-audio");
  let recorder = null;
  let stream = null;
  let timeout = null;
  let urls = [];

  function message(value) { status.textContent = value; }
  function stop() {
    clearTimeout(timeout);
    if (recorder?.state === "recording") recorder.stop();
  }

  async function render() {
    try {
      const records = (await window.vocalizandoData.recordings())
        .filter(item => item.kind === "twister")
        .sort((a, b) => b.at.localeCompare(a.at));
      urls.forEach(url => URL.revokeObjectURL(url));
      urls = [];
      list.replaceChildren();
      for (const item of records) {
        const row = document.createElement("div");
        row.className = "twister-audio-row";
        const phrase = document.createElement("strong");
        phrase.textContent = item.prompt;
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = URL.createObjectURL(item.blob);
        urls.push(audio.src);
        const rating = document.createElement("select");
        rating.setAttribute("aria-label", "O que o ouvinte entendeu");
        for (const [value, label] of [["", "Ouvinte: sem avaliação"], ["all", "Entendeu tudo"], ["part", "Entendeu parte"], ["none", "Não entendeu"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          rating.append(option);
        }
        rating.value = item.listenerResult || "";
        rating.addEventListener("change", async () => {
          await window.vocalizandoData.saveRecording({ ...item, listenerResult: rating.value, updatedAt: new Date().toISOString() });
          message("Avaliação do ouvinte guardada neste navegador.");
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Excluir";
        remove.addEventListener("click", async () => {
          await window.vocalizandoData.deleteRecording(item.id);
          await render();
        });
        row.append(phrase, audio, rating, remove);
        list.append(row);
      }
    } catch (error) { message(`Gravações indisponíveis: ${error.message}.`); }
  }

  async function start() {
    if (recorder?.state === "recording") { stop(); return; }
    if (!document.getElementById("twister-audio-consent").checked) {
      message("Autorize guardar a gravação antes de começar.");
      return;
    }
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      message("Este navegador não oferece gravação de áudio.");
      return;
    }
    if (typeof tongueState !== "undefined" && tongueState.listening) stopPronunciation();
    if (typeof modelListening !== "undefined" && modelListening) stopRecognition();
    if (typeof functionalListening !== "undefined" && functionalListening) functionalStopRecording();
    window.vocalizandoVoice?.stop();
    button.disabled = true;
    message("Abrindo microfone...");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts = [];
      const prompt = currentTwister().text;
      recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(timeout);
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        button.textContent = "Gravar para revisão";
        recorder = null;
        if (!parts.length) { message("Nenhum áudio foi capturado. Tente novamente."); return; }
        try {
          const blob = new Blob(parts, { type: parts[0].type || mime || "audio/webm" });
          await window.vocalizandoData.saveRecording({
            id: `twister-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: "twister", at: new Date().toISOString(), updatedAt: new Date().toISOString(), prompt, blob
          });
          message("Gravação guardada. Use Sincronizar agora para enviá-la à sua conta.");
          await render();
        } catch (error) { message(`Não foi possível guardar o áudio: ${error.message}.`); }
      };
      recorder.onerror = () => { stop(); message("A gravação foi interrompida."); };
      recorder.start();
      button.textContent = "Parar gravação";
      message("Gravando... até 20 segundos.");
      timeout = setTimeout(stop, 20000);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      message(error.name === "NotAllowedError" ? "Permita o microfone nas configurações deste site." : `Não foi possível gravar: ${error.message}.`);
    } finally { button.disabled = false; }
  }

  button.addEventListener("click", start);
  window.addEventListener("vocalizando-recordings-updated", render);
  render();
})();
