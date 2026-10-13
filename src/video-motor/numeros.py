# Whisper writes numbers as digits ("13,99", "5kg", ",90"); scripts spell them
# out ("treze e noventa e nove"). falado() turns one heard token into the words
# a narrator says, so alinhar() can match them. Same convention as
# precoPorExtenso in src/content-central-video-produtos.js.
import re

UN = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
      "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
SUFIXOS = {"kg": ["quilos"], "g": ["gramas"], "l": ["litros"], "ml": ["mililitros"], "%": ["por", "cento"], "un": ["unidades"]}


def _ate999(n):
    if n == 100:
        return "cem"
    c, r = divmod(n, 100)
    partes = [CEM[c]] if c else []
    if r:
        partes.append(UN[r] if r < 20 else DEZ[r // 10] + (f" e {UN[r % 10]}" if r % 10 else ""))
    return " e ".join(partes)


def _inteiro(n):
    if n == 0:
        return "zero"
    mil, resto = divmod(n, 1000)
    partes = []
    if mil:
        partes.append("mil" if mil == 1 else f"{_ate999(mil)} mil")
    if resto:
        partes.append(_ate999(resto))
    return (" e " if mil and resto and (resto < 100 or resto % 100 == 0) else " ").join(partes)


def falado(token):
    t = token.strip(" .!?…;:\"'()").lower()
    m = re.fullmatch(r",(\d{1,2})", t)  # Whisper sometimes splits "32 ,90"
    if m:
        return ["e"] + _inteiro(int(m.group(1).ljust(2, "0"))).split()
    m = re.fullmatch(r"(?:r\$)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(kg|g|l|ml|%|un)?", t)
    if not m:
        return [token]
    out = _inteiro(int(m.group(1).replace(".", ""))).split()
    if m.group(2):
        out += ["e"] + _inteiro(int(m.group(2).ljust(2, "0"))).split()
    return out + SUFIXOS.get(m.group(3) or "", [])


if __name__ == "__main__":
    assert falado("13,99") == "treze e noventa e nove".split()
    assert falado("32") == ["trinta", "e", "dois"]
    assert falado(",90") == ["e", "noventa"]
    assert falado("5kg") == ["cinco", "quilos"]
    assert falado("R$1.234,50") == "mil duzentos e trinta e quatro e cinquenta".split()
    assert falado("1100") == ["mil", "e", "cem"]
    assert falado("13,9!") == "treze e noventa".split()
    assert falado("Fralda") == ["Fralda"]
    print("ok")
