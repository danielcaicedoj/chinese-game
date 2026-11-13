#!/usr/bin/env python3
"""
Extrae el contenido de las presentaciones PPTX de las lecciones y genera:

  data/lessons/leccion-NN.json   (un JSON por leccion)
  data/lessons/lessons.js        (bundle para <script>; el juego NO lee los PPTX)
  data/lessons/reporte.txt       (inconsistencias y elementos para revisar)

Uso (desde la carpeta chinese-game):
  .venv/bin/python.exe scripts/extract_lessons.py            (Windows, venv del proyecto)
  python scripts/extract_lessons.py "D:/Chino Mingzhi"       (otra carpeta de PPTX)

Requiere python-pptx. Archivos de apoyo (editables a mano):
  scripts/lessons_extra.json   traducciones y frases generadas, correcciones manuales
"""
import io
import json
import os
import re
import sys
import unicodedata

from pptx import Presentation

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SRC = r"D:\Chino Mingzhi"
OUT_DIR = os.path.join(ROOT, "data", "lessons")
EXTRA_PATH = os.path.join(HERE, "lessons_extra.json")
DATA_JS = os.path.join(ROOT, "data.js")

# Lecciones que se omiten (L1 es solo fonetica: pinyin, tonos y trazos).
SKIP_LESSONS = {1}

CJK = "\u4e00-\u9fff"
CJK_PUNCT = "，。？！、…（）“”：；～·—／/()"
ZH_CHAR = re.compile("[" + CJK + "]")
POS_RE = re.compile(r"^(?:n|v|adj|adv|pron|prI|prep|conj|m|mw|num|ptI|pt|int|aux|nm|vi|vt|v\.o|pr)\.\s*", re.I)

# ---------------------------------------------------------------- utilidades


def normalize(text):
    """Limpia ruido tipico de los PPTX (glifos raros de pinyin, ',,' sueltos...)."""
    if text is None:
        return ""
    text = text.replace("\x0b", "\n").replace("\u2028", "\n")
    text = text.replace("\u0261", "g").replace("\u0251", "a")  # ɡ ɑ -> g a
    text = text.replace("\u00a0", " ")
    # artefactos ',,' / '，，' (relleno o separador): al final de linea se quitan; en medio -> ', '
    text = re.sub(r"[ ]*[,，]{2,}[ ,，]*(?=\n|$)", "", text)
    text = re.sub(r"[ ]*[,，]{2,}[ ,，]*", ", ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def strip_tone(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("ü", "u").lower()


def load_char_readings():
    """Lecturas de pinyin por caracter desde data.js (sin tonos)."""
    readings = {}
    if not os.path.exists(DATA_JS):
        return readings
    src = io.open(DATA_JS, encoding="utf-8").read()
    for m in re.finditer(r'char:\s*"(.)",\s*pinyin:\s*"([^"]+)"', src):
        readings.setdefault(m.group(1), set()).add(strip_tone(m.group(2)))
    # polifonos y variantes frecuentes en HSK 1
    extra = {
        "了": ["le", "liao"], "不": ["bu"], "的": ["de", "di"], "得": ["de", "dei"],
        "地": ["de", "di"], "行": ["xing", "hang"], "长": ["chang", "zhang"],
        "都": ["dou", "du"], "好": ["hao"], "会": ["hui", "kuai"], "还": ["hai", "huan"],
        "着": ["zhe", "zhao"], "为": ["wei"], "乐": ["le", "yue"], "没": ["mei"],
        "们": ["men"], "什": ["shen"], "么": ["me"], "子": ["zi"], "头": ["tou"],
        "儿": ["er", "r"], "吗": ["ma"], "呢": ["ne"], "吧": ["ba"], "啊": ["a"],
        "一": ["yi"], "七": ["qi"], "八": ["ba"], "和": ["he", "han", "huo"],
        "谁": ["shei", "shui"], "家": ["jia"], "觉": ["jiao", "jue"], "喂": ["wei"],
        "给": ["gei"], "他": ["ta"], "她": ["ta"], "它": ["ta"],
    }
    for ch, rs in extra.items():
        readings.setdefault(ch, set()).update(rs)
    return readings


READINGS = load_char_readings()
SYLLABLES = set()
for _rs in READINGS.values():
    SYLLABLES.update(_rs)
SYLLABLES.update({
    "a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "er", "yi", "wu", "yu",
    "ye", "yao", "you", "yan", "yin", "ying", "yang", "yong", "yuan", "yue", "yun", "wa", "wo",
    "wai", "wei", "wan", "wen", "wang", "weng", "xie", "bu", "ma", "ne", "ni", "me", "de", "le",
    "ba", "la", "ya", "na", "nin", "xiao", "nar", "nali", "zher", "zhe", "nei", "zhei", "dei",
    "ke", "qi", "ge", "ya", "ai", "ao",
})
MAX_SYL = 6


def segment_pinyin(token):
    """True si 'token' (sin tonos, en minusculas) se puede segmentar en silabas conocidas."""
    t = re.sub(r"[^a-z]", "", strip_tone(token))
    if not t:
        return False
    n = len(t)
    ok = [False] * (n + 1)
    ok[0] = True
    for i in range(n):
        if not ok[i]:
            continue
        for L in range(1, MAX_SYL + 1):
            if i + L <= n and t[i:i + L] in SYLLABLES:
                ok[i + L] = True
    return ok[n]


def is_pinyin_text(s):
    s = normalize(s).strip()
    if not s or ZH_CHAR.search(s):
        return False
    s = re.sub(r"[()\[\]·?¿!¡.,;:'’\-/（）]", " ", s)
    toks = [t for t in s.split() if t]
    if not toks:
        return False
    for t in toks:
        if not segment_pinyin(t):
            return False
    # texto sin ninguna vocal con tono y con palabras tipicas del espanol -> no es pinyin
    return True


def hanzi_syllables_ok(hanzi, pinyin):
    """El pinyin (sin tonos) es compatible con las lecturas de data.js del hanzi?"""
    chars = [c for c in hanzi if ZH_CHAR.match(c)]
    if not chars:
        return False
    target = re.sub(r"[^a-z]", "", strip_tone(pinyin))

    def rec(i, pos):
        if i == len(chars):
            return pos == len(target)
        for r in READINGS.get(chars[i], {None}):
            if r is None:
                # caracter desconocido: acepta 1-6 letras
                for L in range(1, 7):
                    if pos + L <= len(target) and rec(i + 1, pos + L):
                        return True
            elif target.startswith(r, pos) and rec(i + 1, pos + len(r)):
                return True
        return False

    return rec(0, 0)


def is_zh_word(s):
    s = s.strip()
    return bool(s) and bool(ZH_CHAR.search(s)) and all(
        ZH_CHAR.match(c) or c in "·……（）()～" for c in s
    )


def is_sentence_text(zh):
    zh = zh.strip()
    if "____" in zh or "＿" in zh:
        return False
    if re.search(r"[A-Za-z]{3,}", re.sub(r"^[AB]：", "", zh)):
        return False
    return len(ZH_CHAR.findall(zh)) >= 2 and (
        re.search("[。？！]$", zh) or len(ZH_CHAR.findall(zh)) >= 4
    )


# -------------------------------------------------------------- lectura PPTX


def iter_shapes(shapes):
    for sh in shapes:
        if sh.shape_type == 6:  # grupo
            for x in iter_shapes(sh.shapes):
                yield x
        else:
            yield sh


def slide_items(slide):
    """Devuelve lista de dicts {top,left,lines} con el texto de cada cuadro/celda."""
    items = []
    for n_idx, sh in enumerate(iter_shapes(slide.shapes)):
        top = int(sh.top or 0) / 914400.0
        left = int(sh.left or 0) / 914400.0
        if sh.has_text_frame and sh.text_frame.text.strip():
            raw = "\n".join(p.text for p in sh.text_frame.paragraphs)
            lines = [l.strip() for l in normalize(raw).split("\n")]
            lines = [re.sub(r"\s+", " ", l).strip() for l in lines]
            items.append({"top": top, "left": left, "idx": n_idx, "lines": [l for l in lines if l]})
        elif getattr(sh, "has_table", False) and sh.has_table:
            for r_i, row in enumerate(sh.table.rows):
                for c_i, cell in enumerate(row.cells):
                    lines = [re.sub(r"\s+", " ", l).strip() for l in normalize(cell.text).split("\n")]
                    lines = [l for l in lines if l]
                    if lines:
                        items.append({"top": top + r_i * 0.1, "left": left + c_i * 0.1, "idx": n_idx, "lines": lines})
    return items


def slide_kind(items):
    head = " ".join(l for it in items for l in it["lines"][:1])
    for it in items:
        for l in it["lines"]:
            if "生词" in l:
                return "vocab"
            if "课文" in l:
                return "text"
            if "语言点" in l:
                return "grammar"
            if re.match(r"^练习", l):
                return "exercise"
            if "答案" in l:
                return "answers"
    return "other"


# ------------------------------------------------------------ clasificacion

HAS_TONE = re.compile("[̀-̄̌]")  # marcas de tono combinadas


def has_tone_mark(s):
    return bool(HAS_TONE.search(unicodedata.normalize("NFD", s)))


def split_zh_tail(line):
    """'你好吗？ Como estas?' -> ('你好吗？', 'Como estas?'). Si no hay hanzi, (None, None)."""
    last = None
    for m in ZH_CHAR.finditer(line):
        last = m.end()
    if last is None:
        return None, None
    end = last
    while end < len(line) and line[end] in "，。？！、…）)”":
        end += 1
    # la cola latina debe empezar tras la parte china (tolera '（对/是，）' ya incluido)
    zh, tail = line[:end].strip(), line[end:].strip()
    return zh, tail


POS_MAP = {
    "n": "sustantivo", "v": "verbo", "vi": "verbo", "vt": "verbo", "v.o": "verbo",
    "adj": "adjetivo", "adv": "adverbio", "pron": "pronombre", "pri": "pronombre interrogativo",
    "ptl": "partícula", "pti": "partícula interrogativa", "pt": "partícula", "m": "clasificador",
    "mw": "clasificador", "conj": "conjunción", "prep": "preposición", "num": "numeral",
    "int": "interjección", "aux": "verbo auxiliar", "nm": "sustantivo", "pr": "pronombre",
}


def split_pos(gloss):
    gloss = gloss.strip()
    m = POS_RE.match(gloss)
    pos = ""
    if m:
        key = m.group(0).strip().rstrip(".").lower()
        pos = POS_MAP.get(key, key)
        gloss = gloss[m.end():]
    gloss = re.sub(r"\s*,\s*", ", ", gloss.strip(" ,;."))
    return pos, gloss


def classify(line):
    """Clasifica una linea: pinyin | zh_word | zh_sent | zh_es | py_zh | es | title."""
    if not line:
        return ("empty", None)
    if re.search("生词|课文|语言点|^练习|汉字|拼音|课堂活动|补充|热身|运用", line) and len(line) < 40:
        return ("title", None)
    if not ZH_CHAR.search(line):
        if is_pinyin_text(line) and not re.search(
            r"[¿?]\s*$|(el|la|los|las|de|que|qué|una|un|es|y|en|con|para)", line.lower()
        ):
            return ("pinyin", line) if has_tone_mark(line) else ("amb", line)
        return ("es", line)
    # tiene hanzi
    zh, tail = split_zh_tail(line)
    if zh is not None:
        if tail:
            if is_pinyin_text(tail) and has_tone_mark(tail):
                return ("zh_py", (zh, tail))
            return ("zh_es", (zh, tail))
        return ("zh_word" if is_zh_word(zh) and len(zh) <= 8 else "zh_sent", zh)
    # pinyin + hanzi pegados ("shí十", "xiān 先 primero")
    m = re.match(r"^([A-Za-zÀ-ž̀-ͯ' ]+?)\s*([" + CJK + r"]+)\s*[,，]?\s*(.*)$", line)
    if m and is_pinyin_text(m.group(1)):
        return ("py_zh", (m.group(1).strip(), m.group(2), m.group(3).strip()))
    return ("other", line)


# ------------------------------------------------------------- vocabulario


def clean_gloss(g):
    g = re.sub(r"\s+", " ", g).strip(" ,;.:·")
    return g


def parse_vocab_slide(items, rep, tag):
    """Devuelve (palabras, frases) de una diapositiva '生词'."""
    pinyins, hanzis, glosses, words, sentences = [], [], [], [], []

    for it in items:
        lines = it["lines"]
        last_py = None
        for ln in lines:
            kind, val = classify(ln)
            if kind in ("title", "empty"):
                continue
            single = len(lines) == 1
            if kind in ("pinyin", "amb"):
                if single:
                    pinyins.append({"top": it["top"], "idx": it["idx"], "text": val, "amb": kind == "amb"})
                else:
                    last_py = val
                continue
            if kind == "zh_word":
                if not single and last_py:
                    words.append({"zh": val, "pinyin": last_py, "es": "", "pos": "", "top": it["top"]})
                    last_py = None
                else:
                    hanzis.append({"top": it["top"], "idx": it["idx"], "text": val})
                continue
            if kind == "zh_es":
                zh, es = val
                if is_zh_word(zh) and len(zh) <= 8 and "……" not in zh:
                    pos, g = split_pos(es)
                    words.append({"zh": zh, "pinyin": last_py or "", "es": clean_gloss(g), "pos": pos, "top": it["top"]})
                elif is_sentence_text(zh) or "……" in zh:
                    sentences.append({"zh": zh, "pinyin": last_py or "", "es": clean_gloss(es), "origen": "ejemplo"})
                last_py = None
                continue
            if kind == "zh_py":
                zh, py = val
                if is_sentence_text(zh):
                    sentences.append({"zh": zh, "pinyin": py, "es": "", "origen": "ejemplo"})
                continue
            if kind == "zh_sent":
                if is_sentence_text(val):
                    sentences.append({"zh": val, "pinyin": last_py or "", "es": "", "origen": "ejemplo"})
                last_py = None
                continue
            if kind == "py_zh":
                py, zh, tail = val
                pos, g = split_pos(tail) if tail else ("", "")
                words.append({"zh": zh, "pinyin": py, "es": clean_gloss(g), "pos": pos, "top": it["top"]})
                continue
            if kind == "es":
                if single:
                    pos, g = split_pos(val)
                    if g:
                        glosses.append({"top": it["top"], "idx": it["idx"], "text": clean_gloss(g), "pos": pos})
                continue

    # --- emparejar pinyin <-> hanzi (compatibilidad silabica) ----------------
    used_h = set()
    pair = []
    for p in sorted(pinyins, key=lambda x: (x["top"], x["idx"])):
        cands = [
            (abs(h["idx"] - p["idx"]), hi)
            for hi, h in enumerate(hanzis)
            if hi not in used_h and hanzi_syllables_ok(h["text"], p["text"])
        ]
        if cands:
            _, hi = min(cands)
            used_h.add(hi)
            pair.append({"zh": hanzis[hi]["text"], "pinyin": p["text"], "top": p["top"]})
        elif p["amb"]:
            pos, g = split_pos(p["text"])
            glosses.append({"top": p["top"], "idx": p["idx"], "text": clean_gloss(g), "pos": pos})
        # pinyin con tono sin hanzi (p. ej. 'Zhongguo ren'): suele ser un compuesto; se ignora
    for hi, h in enumerate(hanzis):
        if hi not in used_h:
            rep.append(f"[{tag}] hanzi sin pinyin en la diapositiva: {h['text']!r}")

    # --- glosas: por orden vertical con los pares ---------------------------
    pair.sort(key=lambda x: x["top"])
    glosses.sort(key=lambda x: (x["top"], x["idx"]))
    if len(pair) == len(glosses):
        for pr, gl in zip(pair, glosses):
            words.append({"zh": pr["zh"], "pinyin": pr["pinyin"], "es": gl["text"], "pos": gl["pos"], "top": pr["top"]})
    else:
        for pr in pair:
            words.append({"zh": pr["zh"], "pinyin": pr["pinyin"], "es": "", "pos": "", "top": pr["top"]})
        if glosses:
            rep.append(f"[{tag}] {len(pair)} palabras vs {len(glosses)} glosas sin emparejar: {[g['text'] for g in glosses]}")
    return words, sentences


# ----------------------------------------------------------- dialogos/frases

NUM_PREFIX = re.compile(r"^\s*(?:[（(]?\d{1,2}[)）.、．]\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)")
SPEAKER = re.compile(r"^([AB])\s*[：:]\s*(.*)$")


def clean_pinyin(p):
    p = (p or "").replace(")(", "").replace("(", "").replace(")", "")
    p = re.sub(r"\s+", " ", p).strip(" ,，")
    return p


def parse_text_slide(items):
    """Diapositiva '课文': devuelve (escena, turnos[{hablante, zh, pinyin}])."""
    scene, turns = "", []
    for it in sorted(items, key=lambda x: x["idx"]):
        last_py = None
        for ln in it["lines"]:
            m = SPEAKER.match(ln)
            if m:
                zh = m.group(2).strip()
                if zh and ZH_CHAR.search(zh):
                    turns.append({"hablante": m.group(1), "zh": zh, "pinyin": clean_pinyin(last_py)})
                last_py = None
                continue
            kind, val = classify(ln)
            if kind in ("pinyin", "amb"):
                last_py = val
            elif kind == "zh_es" and val[0].startswith("在"):
                scene = f"{val[0]} {val[1]}".strip()
            elif kind == "zh_word" and val.startswith("在") and not scene:
                scene = val
    return scene, turns


def parse_free_slide(items):
    """Frases sueltas (gramatica, ejercicios, otras): [{zh, pinyin, es, origen}]."""
    out = []
    for it in sorted(items, key=lambda x: x["idx"]):
        last_py = None
        for raw in it["lines"]:
            ln = NUM_PREFIX.sub("", raw)
            ln = re.sub(r"^[AB]\s*[：:]\s*", "", ln)
            kind, val = classify(ln)
            if kind in ("pinyin", "amb"):
                last_py = val
            elif kind == "zh_sent" and is_sentence_text(val):
                out.append({"zh": val, "pinyin": clean_pinyin(last_py), "es": ""})
                last_py = None
            elif kind == "zh_py" and is_sentence_text(val[0]):
                out.append({"zh": val[0], "pinyin": clean_pinyin(val[1]), "es": ""})
                last_py = None
            elif kind == "zh_es" and is_sentence_text(val[0]):
                out.append({"zh": val[0], "pinyin": clean_pinyin(last_py), "es": clean_gloss(val[1])})
                last_py = None
    return out


# -------------------------------------------------------------- ensamblado


def lesson_header(slide_items_list, fname):
    """(numero, titulo_zh, titulo_pinyin) desde la primera diapositiva."""
    num, title, tpy = None, "", ""
    for it in slide_items_list[0]:
        for ln in it["lines"]:
            m = re.search(r"第\s*(\d+)\s*课", ln)
            if m:
                num = int(m.group(1))
                continue
            if "HSK" in ln or "ZHENG" in ln or "《" in ln:
                continue
            kind, val = classify(ln)
            if kind in ("zh_word", "zh_sent") and not title:
                title = val
            elif kind in ("pinyin", "amb") and not tpy:
                tpy = val
    if num is None:
        m = re.search(r"L(\d+)", fname)
        num = int(m.group(1)) if m else 0
    return num, title, tpy


def merge_word(dst, src):
    for k in ("pinyin", "es", "pos"):
        if not dst.get(k) and src.get(k):
            dst[k] = src[k]


def load_extra():
    if os.path.exists(EXTRA_PATH):
        return json.load(io.open(EXTRA_PATH, encoding="utf-8"))
    return {}


def process_file(path, extra, report):
    fname = os.path.basename(path)
    prs = Presentation(path)
    slides = [slide_items(s) for s in prs.slides]
    num, title, tpy = lesson_header(slides, fname)
    tag = f"L{num}"

    words = {}
    order = []
    sentences = {}
    dialogs = {}
    diag = []

    for i, items in enumerate(slides, 1):
        kind = slide_kind(items)
        if kind == "vocab":
            ws, ss = parse_vocab_slide(items, diag, f"{tag}/d{i}")
            for w in ws:
                w["pinyin"] = clean_pinyin(w["pinyin"])
                key = w["zh"]
                if key not in words:
                    words[key] = {"zh": key, "pinyin": w["pinyin"], "es": w["es"], "pos": w["pos"]}
                    order.append(key)
                else:
                    merge_word(words[key], w)
            for s in ss:
                s["origen"] = "ejemplo"
                sentences.setdefault(s["zh"], s)
        elif kind == "text":
            scene, turns = parse_text_slide(items)
            idx = None
            for it in items:
                for ln in it["lines"]:
                    m = re.search(r"Text\s*o?\s*(\d)", ln)
                    if m:
                        idx = m.group(1)
            d = dialogs.setdefault(idx or str(i), {"escena": "", "turnos": {}})
            if scene:
                d["escena"] = scene
            for t in turns:
                cur = d["turnos"].setdefault(t["zh"], t)
                if not cur.get("pinyin") and t.get("pinyin"):
                    cur["pinyin"] = t["pinyin"]
        elif kind in ("grammar", "exercise"):
            for s in parse_free_slide(items):
                s["origen"] = "gramatica" if kind == "grammar" else "ejercicio"
                cur = sentences.setdefault(s["zh"], s)
                for k in ("pinyin", "es"):
                    if not cur.get(k) and s.get(k):
                        cur[k] = s[k]

    # frases de los dialogos
    for d in dialogs.values():
        for t in d["turnos"].values():
            s = sentences.setdefault(t["zh"], {"zh": t["zh"], "pinyin": t["pinyin"], "es": "", "origen": "dialogo"})
            if not s.get("pinyin") and t.get("pinyin"):
                s["pinyin"] = t["pinyin"]

    return {
        "num": num, "fname": fname, "titulo": title, "titulo_pinyin": clean_pinyin(tpy),
        "words": [words[k] for k in order], "sentences": list(sentences.values()),
        "dialogs": {k: {"escena": v["escena"], "turnos": list(v["turnos"].values())} for k, v in dialogs.items()},
        "diag": diag,
    }


# ------------------------------------------------- limpieza y salida final

SENT_END = re.compile(r"[。？！]$")


def normalize_zh(s):
    s = re.sub(r"^[AB]\s*[：:]\s*", "", s.strip())
    s = re.sub(r"(?<=[" + CJK + r"0-9，。？！、])\s+(?=[" + CJK + r"0-9])", "", s)
    s = s.replace(",", "，")
    return s.strip()


def valid_sentence(zh):
    """Frase completa y util como ejercicio."""
    if not SENT_END.search(zh):
        return False
    if re.search(r"[A-Za-z_＿/／]|……|XX|\+|=", zh):
        return False
    if len(ZH_CHAR.findall(zh)) < 2:
        return False
    if "、" in zh and len(ZH_CHAR.findall(zh)) > 14:
        return False
    return True


def split_turns(zh):
    """'A:你吃哪国菜？B:我吃中国菜。' -> dos frases."""
    parts = re.split(r"(?:^|\s)?[AB]\s*[：:]\s*", zh)
    parts = [p.strip() for p in parts if p.strip()]
    return parts if len(parts) > 1 else [zh]


CHAR_FIRST_READING = {}
if os.path.exists(DATA_JS):
    for _m in re.finditer(r'char:\s*"(.)",\s*pinyin:\s*"([^"]+)"', io.open(DATA_JS, encoding="utf-8").read()):
        CHAR_FIRST_READING.setdefault(_m.group(1), _m.group(2))


def auto_pinyin(zh, word_pinyin):
    """Pinyin aproximado: palabras de la leccion (mas largas primero) y, si no, lecturas de data.js."""
    out, i = [], 0
    words = sorted(word_pinyin, key=len, reverse=True)
    while i < len(zh):
        ch = zh[i]
        if not ZH_CHAR.match(ch):
            i += 1
            continue
        for w in words:
            if zh.startswith(w, i):
                out.append(word_pinyin[w].replace(" ", ""))
                i += len(w)
                break
        else:
            out.append(CHAR_FIRST_READING.get(ch, "?"))
            i += 1
    text = " ".join(out)
    return text[:1].upper() + text[1:]


def tidy_pinyin(p):
    p = clean_pinyin(p)
    p = re.sub(r"\s*([,，.。?？!！])\s*", r"\1 ", p).strip()
    p = re.sub(r"\s+", " ", p)
    return p[:1].upper() + p[1:] if p else p


def pinyin_key(p):
    """Clave para comparar pinyin ignorando mayusculas, espacios y puntuacion."""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFC", p or "").lower())


def build_lesson(raw, extra, report, pending):
    num = raw["num"]
    cfg = extra.get("lecciones", {}).get(str(num), {})
    tag = f"L{num}"
    overrides = extra.get("palabras", {})
    deck = {w["zh"]: w for w in raw["words"]}

    # --- vocabulario -----------------------------------------------------
    vocab = []
    official = cfg.get("vocabulario")
    if official:
        for zh in official:
            ov = overrides.get(zh, {})
            d = deck.get(zh, {})
            pinyin = ov.get("pinyin") or d.get("pinyin") or ""
            es = ov.get("es") or d.get("es") or ""
            tipo = ov.get("tipo") or d.get("pos") or ""
            entry = {"caracter": zh, "pinyin": clean_pinyin(pinyin), "significado": clean_gloss(es), "tipo": tipo}
            if not d:
                entry["fuente"] = "manual"
                report.append(f"[{tag}] '{zh}' no aparece como palabra en el PPTX (valor manual de lessons_extra.json)")
            elif ov.get("es") and not d.get("es"):
                entry["significado_generado"] = True
            if d.get("pinyin") and ov.get("pinyin") and pinyin_key(d["pinyin"]) != pinyin_key(ov["pinyin"]):
                report.append(f"[{tag}] pinyin distinto en '{zh}': PPTX '{d['pinyin']}' -> final '{ov['pinyin']}'")
            if zh in cfg.get("previas", []):
                entry["previa"] = True
            if not entry["pinyin"] or not entry["significado"]:
                report.append(f"[{tag}] '{zh}' sin pinyin o significado")
            vocab.append(entry)
    else:
        report.append(f"[{tag}] sin lista oficial en lessons_extra.json: se usan las palabras detectadas (revisar)")
        for w in raw["words"]:
            if w["es"] and w["pinyin"] and len(w["zh"]) <= 4 and not re.search("[讠艹钅犭]", w["zh"]):
                vocab.append({"caracter": w["zh"], "pinyin": w["pinyin"], "significado": w["es"], "tipo": w["pos"]})

    word_pinyin = {v["caracter"]: v["pinyin"].lower() for v in vocab if v["pinyin"]}
    for zh, ov in overrides.items():
        if ov.get("pinyin"):
            word_pinyin.setdefault(zh, ov["pinyin"].lower())

    # --- frases ----------------------------------------------------------
    frases_extra = extra.get("frases", {})  # zh -> [pinyin, traduccion]
    skip = set(extra.get("descartar_frases", []))
    seen, sentences = set(), []

    def add(zh, pinyin, es, origen, generada=False):
        zh = normalize_zh(zh)
        if zh in seen or zh in skip or not valid_sentence(zh):
            return
        seen.add(zh)
        ex = frases_extra.get(zh)
        item = {"zh": zh, "origen": origen}
        if ex and ex[0]:
            item["pinyin"] = tidy_pinyin(ex[0])
            if pinyin and pinyin_key(pinyin) != pinyin_key(ex[0]):
                report.append(f"[{tag}] pinyin de frase corregido: {zh}  PPTX '{clean_pinyin(pinyin)}' -> '{ex[0]}'")
        elif pinyin and hanzi_syllables_ok(re.sub(r"[^" + CJK + "]", "", zh), pinyin):
            item["pinyin"] = tidy_pinyin(pinyin)
        else:
            item["pinyin"] = auto_pinyin(zh, word_pinyin)
            item["pinyin_generada"] = True
        es_final = clean_gloss(ex[1]) if ex and ex[1] else clean_gloss(es)
        item["es"] = es_final
        if ex and ex[1] and not es and not generada:
            item["traduccion_generada"] = True
        if generada:
            item["generada"] = True
        if not es_final:
            report.append(f"[{tag}] frase sin traduccion: {zh}")
            pending.setdefault(zh, {"pinyin": item["pinyin"], "lecciones": []})["lecciones"].append(num)
        sentences.append(item)

    for s in raw["sentences"]:
        for part in split_turns(s["zh"]):
            add(part, s.get("pinyin", ""), s.get("es", ""), s.get("origen", "ejemplo"))
    for g in cfg.get("frases_generadas", []):
        add(g[0], g[1], g[2], "generada", generada=True)

    sentences = [s for s in sentences if s["es"]]
    return {
        "id": num,
        "titulo": raw["titulo"],
        "titulo_pinyin": cfg.get("titulo_pinyin") or tidy_pinyin(raw["titulo_pinyin"]),
        "titulo_es": cfg.get("titulo_es", ""),
        "fuente": raw["fname"],
        "vocabulario": vocab,
        "frases": sentences,
    }


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    files = sorted(
        (f for f in os.listdir(src) if f.lower().endswith(".pptx") and not f.startswith("~$")),
        key=lambda f: int(re.search(r"L(\d+)", f).group(1)) if re.search(r"L(\d+)", f) else 0,
    )
    if not files:
        print("No se encontraron PPTX en", src)
        sys.exit(1)

    extra = load_extra()
    report, lessons, pending, diag_all = [], [], {}, []
    for f in files:
        m = re.search(r"L(\d+)", f)
        if m and int(m.group(1)) in SKIP_LESSONS:
            report.append(f"[{f}] omitida (SKIP_LESSONS: leccion de fonetica)")
            continue
        raw = process_file(os.path.join(src, f), extra, report)
        diag_all.extend(raw["diag"])
        lessons.append(build_lesson(raw, extra, report, pending))

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in os.listdir(OUT_DIR):
        if re.match(r"leccion-\d+\.json$", old):
            os.remove(os.path.join(OUT_DIR, old))
    for les in lessons:
        with io.open(os.path.join(OUT_DIR, "leccion-%02d.json" % les["id"]), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(les, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    with io.open(os.path.join(OUT_DIR, "lessons.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("// GENERADO por scripts/extract_lessons.py. No editar a mano.\n")
        fh.write("const LESSONS = ")
        json.dump(lessons, fh, ensure_ascii=False, indent=1)
        fh.write(";\n")

    with io.open(os.path.join(OUT_DIR, "pendientes.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(pending, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    with io.open(os.path.join(OUT_DIR, "reporte.txt"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("REPORTE DE EXTRACCION\n=====================\n\n")
        for les in lessons:
            n_gen = sum(1 for s in les["frases"] if s.get("generada"))
            n_tr = sum(1 for s in les["frases"] if s.get("traduccion_generada"))
            fh.write(f"Leccion {les['id']:>2} {les['titulo']}: {len(les['vocabulario'])} palabras, "
                     f"{len(les['frases'])} frases ({n_tr} con traduccion generada, {n_gen} frases generadas)\n")
        fh.write("\nINCONSISTENCIAS / REVISAR\n")
        for r in report:
            fh.write(" - " + r + "\n")

    print(f"OK: {len(lessons)} lecciones en {OUT_DIR}")
    print(f"Reporte: {os.path.join(OUT_DIR, 'reporte.txt')}")


if __name__ == "__main__":
    main()
