# Word timings for an audio file: uv run --with faster-whisper python alinhar.py <audio> <modelo>
# Prints JSON [{w, t, d}]. Used when the voice provider (Gemini) gives no
# word boundaries; runs on CPU.
import json, sys
from faster_whisper import WhisperModel

audio, modelo = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "small")
model = WhisperModel(modelo, device="cpu", compute_type="int8")
segments, _ = model.transcribe(audio, language="pt", word_timestamps=True, vad_filter=False, beam_size=5)
words = [{"w": w.word.strip(), "t": round(w.start, 3), "d": round(w.end - w.start, 3)} for s in segments for w in s.words]
print(json.dumps(words, ensure_ascii=False))
