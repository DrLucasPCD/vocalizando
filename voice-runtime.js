import { TtsSession } from "@mintplex-labs/piper-tts-web";

let sessionPromise;

export async function synthesizeVoice(text, onProgress) {
  if (!sessionPromise) {
    sessionPromise = TtsSession.create({
      voiceId: "pt_BR-faber-medium",
      progress: onProgress,
      wasmPaths: {
        onnxWasm: "/vendor/voice/",
        piperData: "/vendor/voice/piper_phonemize.data",
        piperWasm: "/vendor/voice/piper_phonemize.wasm",
      },
    }).catch(error => {
      sessionPromise = null;
      throw error;
    });
  }
  const session = await sessionPromise;
  return session.predict(text);
}
