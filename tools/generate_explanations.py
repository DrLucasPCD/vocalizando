"""Generate instant-play explanations from the bundled Piper voice."""

import argparse
import json
import subprocess
from pathlib import Path

from piper import PiperVoice


ROOT = Path(__file__).resolve().parents[1]
TEXTS = ROOT / "audio" / "explanations" / "texts.json"
OUTPUT = ROOT / "audio" / "explanations"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path, help="Downloaded model.onnx from Trelis/piper-pt-br-faber-medium")
    args = parser.parse_args()
    voice = PiperVoice.load(args.model, config_path=args.model.with_suffix(".onnx.json"))
    texts = json.loads(TEXTS.read_text(encoding="utf-8"))
    for name, spoken_text in texts.items():
        chunks = list(voice.synthesize(spoken_text))
        pcm = b"".join(chunk.audio_int16_bytes + bytes(int(chunk.sample_rate * 0.18) * 2) for chunk in chunks)
        destination = OUTPUT / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "22050", "-ac", "1", "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "64k", str(destination)],
            input=pcm,
            check=True,
        )
        print(destination)


if __name__ == "__main__":
    main()
