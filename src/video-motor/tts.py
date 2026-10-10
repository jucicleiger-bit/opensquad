# Narration as one continuous take: python tts.py <pasta-do-video>
# Speaks every scene's line in a single TTS call (natural flow between
# scenes), shortens any silence longer than MAX_GAP, then hands each scene
# its own words. Writes voz/narracao.mp3 and voz/tempos.json. Cached by the
# full text, so a re-render without script changes skips the TTS call.
#
# Voices (roteiro "voz"):
#   "gemini:Puck"            Gemini TTS with a spoken direction (roteiro "direcao");
#                            word times come from Whisper (alinhar.py). If Gemini
#                            fails (e.g. the free daily limit of 10), it tries the
#                            Gemini Live native-audio model (no daily limit, same
#                            voice and direction), and only then FALLBACK (Edge).
#   "pt-BR-AntonioNeural"... any Edge voice; word times come with the audio.
import asyncio, base64, difflib, json, os, re, shutil, subprocess, sys, unicodedata, urllib.error, urllib.request
from pathlib import Path
import aiohttp
import edge_tts

MAX_GAP = 0.22  # longest silence kept between two words, seconds
FALLBACK = "en-US-BrianMultilingualNeural"
UV = shutil.which("uv") or str(Path.home() / "AppData/Local/hermes/bin/uv.exe")
GEMINI_MODEL = "gemini-3.8-flash-tts"
LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"
DIRECAO_PADRAO = ("Leia em português do Brasil, como um criador de conteúdo de Instagram: animado, sorrindo, "
                  "ritmo rápido, com energia e variação de entonação, dando ênfase nas palavras importantes. "
                  "Leia exatamente o texto abaixo, sem acrescentar nada:")
motor = Path(__file__).resolve().parent
pasta = Path(sys.argv[1]).resolve()  # the video folder (absolute or relative to cwd)
roteiro = json.loads((pasta / "roteiro.json").read_text(encoding="utf-8"))
voz_dir = pasta / "voz"
voz_dir.mkdir(exist_ok=True)
voz, rate = roteiro.get("voz", "pt-BR-AntonioNeural"), roteiro.get("velocidade", "+8%")
direcao = roteiro.get("direcao", DIRECAO_PADRAO)
falas = [c["fala"].strip() for c in roteiro["cenas"]]

def norm(w):
    return unicodedata.normalize("NFC", w).lower()

def tokens(texto):
    return re.findall(r"[\w]+(?:['-][\w]+)*", texto)

def env_key(name):
    for line in (motor.parent.parent / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return os.environ.get(name)

async def falar_edge(texto, mp3, voice):
    words = []
    c = edge_tts.Communicate(texto, voice, rate=rate, boundary="WordBoundary")
    with open(mp3, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"w": ch["text"], "t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7})
    return words

def falar_gemini(texto, mp3, voice):
    key = env_key("OPENSQUAD_GEMINI_API_KEY")
    if not key:
        raise RuntimeError("sem OPENSQUAD_GEMINI_API_KEY no .env")
    body = json.dumps({
        "contents": [{"parts": [{"text": f"{direcao}\n\n{texto}"}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
    }).encode()
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                                 data=body, headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Gemini {e.code}: {e.read().decode(errors='ignore')[:200]}") from e
    part = next(p for p in j["candidates"][0]["content"]["parts"] if "inlineData" in p)
    srate = (re.search(r"rate=(\d+)", part["inlineData"]["mimeType"]) or [None, "24000"])[1]
    pcm = mp3.with_suffix(".pcm")
    pcm.write_bytes(base64.b64decode(part["inlineData"]["data"]))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", srate, "-ac", "1", "-i", str(pcm), "-b:a", "160k", str(mp3)], check=True)
    pcm.unlink()
    return alinhar(mp3, texto)

async def falar_live(texto, mp3, voice):
    # The Live API is a conversation; the system prompt makes it a narrator
    # that reads the script verbatim. alinhar() rejects a reading that strays.
    key = env_key("OPENSQUAD_GEMINI_API_KEY")
    url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={key}"
    setup = {"setup": {
        "model": f"models/{LIVE_MODEL}",
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}, "languageCode": "pt-BR"}},
        "systemInstruction": {"parts": [{"text": "Você é um locutor brasileiro de vídeos de Instagram. Quando receber um texto, leia-o em voz alta EXATAMENTE como está escrito, palavra por palavra, sem cumprimentar, sem comentar e sem acrescentar nada. Siga esta direção de voz: " + direcao}]},
    }}
    pcm = bytearray()
    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(url, timeout=aiohttp.ClientWSTimeout(ws_close=30), max_msg_size=0) as ws:
            await ws.send_str(json.dumps(setup))
            async for msg in ws:
                data = json.loads(msg.data if msg.type == aiohttp.WSMsgType.TEXT else msg.data.decode())
                if "setupComplete" in data:
                    pedido = "Leia:\n\n" + texto
                    await ws.send_str(json.dumps({"clientContent": {"turns": [{"role": "user", "parts": [{"text": pedido}]}], "turnComplete": True}}))
                sc = data.get("serverContent") or {}
                for part in (sc.get("modelTurn") or {}).get("parts", []):
                    if "inlineData" in part:
                        pcm += base64.b64decode(part["inlineData"]["data"])
                if sc.get("turnComplete") or "error" in data:
                    break
    if not pcm:
        raise RuntimeError("Gemini Live não devolveu áudio")
    raw = mp3.with_suffix(".pcm")
    raw.write_bytes(bytes(pcm))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", str(raw), "-b:a", "160k", str(mp3)], check=True)
    raw.unlink()
    return alinhar(mp3, texto)

def alinhar(mp3, texto):
    # Whisper hears the words; the script decides what they are. Matched words
    # take Whisper's times, unmatched ones are spread between their neighbours.
    out = subprocess.run([UV, "run", "--python", "3.11", "--with", "faster-whisper", "python", str(motor / "alinhar.py"), str(mp3), "small"],
                         capture_output=True, check=True, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    ouvidas = json.loads(out.stdout.decode("utf-8"))
    esperadas = tokens(texto)
    a = [norm(w) for w in esperadas]
    b = [norm(re.sub(r"[^\w'-]", "", w["w"])) for w in ouvidas]
    tempos = [None] * len(a)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            tempos[blk.a + k] = ouvidas[blk.b + k]
    achadas = [i for i, x in enumerate(tempos) if x]
    if len(achadas) < len(a) * 0.6:
        raise RuntimeError(f"a voz não leu o roteiro como escrito ({len(achadas)}/{len(a)} palavras reconhecidas)")
    words = []
    for i, w in enumerate(esperadas):
        if tempos[i]:
            words.append({"w": w, "t": tempos[i]["t"], "d": tempos[i]["d"]})
            continue
        prev = max([j for j in achadas if j < i], default=None)
        nxt = min([j for j in achadas if j > i], default=None)
        t0 = tempos[prev]["t"] + tempos[prev]["d"] if prev is not None else 0.0
        t1 = tempos[nxt]["t"] if nxt is not None else t0 + 0.4 * (i - (prev or 0))
        span = (nxt if nxt is not None else i + 1) - (prev if prev is not None else -1)
        pos = i - (prev if prev is not None else -1)
        t = t0 + (t1 - t0) * (pos - 0.5) / span
        words.append({"w": w, "t": round(t, 3), "d": round(max(0.08, (t1 - t0) / span), 3)})
    return words

def encurtar_silencios(bruto, words, saida):
    # Keep audio segments, cutting the excess out of the middle of long gaps.
    cortes = []  # (inicio, fim) of audio removed, in raw time
    for a, b in zip(words, words[1:]):
        gap = b["t"] - (a["t"] + a["d"])
        if gap > MAX_GAP:
            meio = a["t"] + a["d"] + gap / 2
            excesso = gap - MAX_GAP
            cortes.append((meio - excesso / 2, meio + excesso / 2))
    lead = max(0.0, words[0]["t"] - 0.05)  # drop leading silence too
    partes, cursor = [], lead
    for ini, fim in cortes:
        partes.append((cursor, ini))
        cursor = fim
    partes.append((cursor, None))
    filtros = ";".join(f"[0:a]atrim=start={a:.3f}{'' if b is None else f':end={b:.3f}'},asetpts=PTS-STARTPTS[p{i}]" for i, (a, b) in enumerate(partes))
    filtros += ";" + "".join(f"[p{i}]" for i in range(len(partes))) + f"concat=n={len(partes)}:v=0:a=1[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(bruto), "-filter_complex", filtros, "-map", "[out]", str(saida)], check=True)
    # Shift each word back by the audio removed before it.
    novos = []
    for w in words:
        removido = lead + sum(fim - ini for ini, fim in cortes if fim <= w["t"])
        novos.append({**w, "t": round(w["t"] - removido, 3)})
    return novos

async def main():
    texto = " ".join(falas)
    cache = voz_dir / "narracao.json"
    chave = {"texto": texto, "voz": voz, "rate": rate, "direcao": direcao if voz.startswith("gemini:") else None, "max_gap": MAX_GAP}
    old = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else None
    mp3 = voz_dir / "narracao.mp3"
    if old and old["chave"] == chave and mp3.exists():
        words, usada = old["words"], old.get("usada", voz)
    else:
        bruto = voz_dir / "narracao-bruta.mp3"
        usada = voz
        if voz.startswith("gemini:"):
            nome = voz.split(":", 1)[1]
            try:
                words = falar_gemini(texto, bruto, nome)
            except Exception as e:  # free daily limit, network, misread script...
                print(f"aviso: Gemini TTS falhou ({str(e)[:120]}); tentando o Gemini Live")
                try:
                    usada = f"gemini-live:{nome}"
                    words = await falar_live(texto, bruto, nome)
                except Exception as e2:
                    print(f"aviso: Gemini Live falhou ({str(e2)[:120]}); usando a voz {FALLBACK}")
                    usada = FALLBACK
                    words = await falar_edge(texto, bruto, FALLBACK)
        else:
            words = await falar_edge(texto, bruto, voz)
        words = encurtar_silencios(bruto, words, mp3)
        bruto.unlink()
        cache.write_text(json.dumps({"chave": chave, "usada": usada, "words": words}, ensure_ascii=False), encoding="utf-8")

    # Hand each scene the words of its own line, in order.
    cenas, i = [], 0
    for n, fala in enumerate(falas, 1):
        esperado = [norm(w) for w in tokens(fala)]
        mine = words[i:i + len(esperado)]
        if [norm(w["w"]) for w in mine] != esperado:
            sys.exit(f"cena {n}: a voz separou as palavras diferente do texto.\n  texto: {esperado}\n  voz:   {[w['w'] for w in mine]}")
        # Mark words that end a sentence, so captions never run across a full stop.
        fins = [bool(re.match(r"[^\w]*[.?!…]", fala[m.end():])) for m in re.finditer(r"[\w]+(?:['-][\w]+)*", fala)]
        cenas.append({"words": [{**w, "fim": f} for w, f in zip(mine, fins)]})
        i += len(esperado)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)]))
    # Plain text of the narration, scene by scene, for people to read.
    linhas = [f"Cena {n} ({c['tipo']}):\n{c['fala']}" for n, c in enumerate(roteiro["cenas"], 1)]
    (voz_dir / "narracao.txt").write_text("\n\n".join(linhas) + "\n", encoding="utf-8")
    (voz_dir / "tempos.json").write_text(json.dumps({"arquivo": "voz/narracao.mp3", "cenas": cenas}, ensure_ascii=False), encoding="utf-8")
    print(f"ok {len(cenas)} cenas, {dur:.1f}s de narração contínua ({usada})")

asyncio.run(main())
