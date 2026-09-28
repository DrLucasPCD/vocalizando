(function () {
  let activeAudio = null;
  let activeUrl = null;
  let requestId = 0;
  let runtimePromise = null;

  function stop() {
    requestId++;
    if (typeof stopTwisterPlayback === "function") stopTwisterPlayback();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio.removeAttribute("src");
      activeAudio.load();
      if (activeAudio.id === "functional-voice-player" || activeAudio.classList.contains("explanation-player")) activeAudio.hidden = true;
      activeAudio = null;
    }
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    activeUrl = null;
    const status = document.getElementById("voice-status");
    if (status) status.textContent = "";
  }

  function startPlayback(audio, status, endMessage = "Áudio concluído.") {
    activeAudio = audio;
    audio.setAttribute("playsinline", "");
    audio.onended = () => {
      if (activeAudio === audio && status) status.textContent = endMessage;
    };
    audio.play().then(() => {
      if (status) status.textContent = "Reproduzindo.";
    }).catch(() => {
      if (status) status.textContent = "Toque no player para ouvir.";
    });
  }

  function playExplanation(id, status, player) {
    stop();
    const target = player || document.getElementById(id === "trava" ? "twister-explanation-player" : "exercise-explanation-player");
    const audio = target || new Audio();
    audio.src = `/audio/explanations/${id}.mp3`;
    audio.hidden = false;
    audio.onerror = () => {
      audio.hidden = true;
      if (status) status.textContent = "Não foi possível carregar a explicação.";
    };
    if (status) status.textContent = "Preparando explicação...";
    startPlayback(audio, status, "Explicação concluída.");
  }

  async function speak(text, player, status) {
    stop();
    const current = requestId;
    player.hidden = true;
    player.removeAttribute("src");
    status.textContent = "Preparando voz. Na primeira vez, o modelo pode demorar para baixar.";
    try {
      runtimePromise ||= import("/vendor/voice/voice-runtime.js");
      const runtime = await runtimePromise;
      const blob = await runtime.synthesizeVoice(text, progress => {
        if (current !== requestId || !progress.total) return;
        status.textContent = `Baixando voz: ${Math.round(progress.loaded / progress.total * 100)}%.`;
      });
      if (current !== requestId) return;
      activeUrl = URL.createObjectURL(blob);
      player.src = activeUrl;
      player.hidden = false;
      startPlayback(player, status);
    } catch (error) {
      if (current !== requestId) return;
      console.warn("Piper voice unavailable", error);
      status.textContent = "Não foi possível gerar a frase neste aparelho. A explicação gravada continua disponível.";
    }
  }

  window.vocalizandoVoice = { playExplanation, speak, stop };

  document.querySelectorAll("[data-explanation]").forEach(button => {
    button.addEventListener("click", () => {
      playExplanation(button.dataset.explanation, document.getElementById("voice-status"));
    });
  });
})();
