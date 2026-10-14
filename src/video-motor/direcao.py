# Gemini TTS sometimes reads its voice direction aloud before the script
# ("Directors Notes. Leia em português…" then the real lines, after a pause).
# inicio_do_roteiro finds the heard word where the script itself starts, so
# the take can be trimmed there instead of being thrown away.
# Self-check: python direcao.py
import difflib


def inicio_do_roteiro(ouvidas, esperadas, n=4):
    """Index in `ouvidas` (heard words, normalized) where the first `n` words
    of `esperadas` (script words, normalized) start, or None. Whisper mishears
    a word now and then, so a window counts when at least n-1 of its words
    match the script's opening words."""
    alvo = esperadas[:n]
    if not alvo:
        return None
    precisa = max(1, len(alvo) - 1)
    for i in range(len(ouvidas) - len(alvo) + 1):
        janela = ouvidas[i:i + len(alvo)]
        iguais = sum(1 for a, b in zip(janela, alvo) if a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.8)
        if iguais >= precisa and janela[0] and (janela[0] == alvo[0] or difflib.SequenceMatcher(None, janela[0], alvo[0]).ratio() >= 0.8):
            return i
    return None


if __name__ == "__main__":
    script = "black friday no mercado carvalho omo de setecentos gramas".split()
    direcao = "directors notes leia em português do brasil como locutor imperdível".split()
    assert inicio_do_roteiro(direcao + script, script) == len(direcao)
    assert inicio_do_roteiro(script, script) == 0
    # A misheard word inside the window still matches.
    assert inicio_do_roteiro("leia em portugues black fraide no mercado".split(), script) == 3
    # The script's first word must match: "no mercado carvalho" alone is not the start.
    assert inicio_do_roteiro("leia no mercado carvalho omo".split(), script) is None
    assert inicio_do_roteiro("nada a ver aqui".split(), script) is None
    assert inicio_do_roteiro([], script) is None
    print("ok")
