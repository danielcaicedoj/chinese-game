/*
 * Generador de ejercicios para el modo "Lección".
 *
 * Módulo PURO (sin DOM, sin localStorage): recibe los datos de las lecciones y
 * devuelve objetos de ejercicio serializables. Funciona en el navegador
 * (window.LessonExercises) y en Node (require) para las pruebas unitarias.
 *
 * Tipos de ejercicio:
 *   fill       completar la frase (hueco ＿＿, pista en español, 4 opciones)
 *   translate  español → chino con 4 opciones (palabra o frase)
 *   match      emparejar carácter ↔ pinyin ↔ significado
 *   order      ordenar palabras para armar la frase
 *   listen     escuchar y elegir (Web Speech API; el UI lo oculta si no hay voz)
 *
 * Invariantes que garantiza (y que verifican las pruebas):
 *   - los ejercicios de elección tienen 4 opciones, exactamente 1 correcta
 *   - no hay opciones duplicadas (ni por texto ni por significado)
 *   - ningún distractor reproduce una frase conocida del corpus
 *   - en "emparejar" no hay pinyin ni significados repetidos
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LessonExercises = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BLANK = "＿＿";
  var PUNCT_CHARS = "，。？！、：；“”（）()";
  var PUNCT_RE = /[，。？！、：；“”（）()\s]/g;
  var MAX_WORD_LEN = 5;
  var CHOICES = 4;
  var STOPWORDS = {
    para: 1, como: 1, este: 1, esta: 1, esto: 1, muy: 1, con: 1, sin: 1, una: 1, uno: 1,
    unos: 1, unas: 1, cual: 1, cuál: 1, qué: 1, que: 1, hasta: 1, desde: 1, donde: 1, dónde: 1,
    cuánto: 1, cuántos: 1, partícula: 1, clasificador: 1,
  };

  // ------------------------------------------------------------------ utilidades

  function makeRng(seed) {
    if (seed === undefined || seed === null) return Math.random;
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function weightedSample(items, weightFn, k, rng) {
    var pool = items.slice();
    var out = [];
    while (out.length < k && pool.length) {
      var total = 0;
      var ws = pool.map(function (x) {
        var w = Math.max(0, weightFn(x));
        total += w;
        return w;
      });
      var idx = 0;
      if (total <= 0) {
        idx = Math.floor(rng() * pool.length);
      } else {
        var r = rng() * total;
        for (; idx < pool.length; idx++) {
          r -= ws[idx];
          if (r <= 0) break;
        }
        if (idx >= pool.length) idx = pool.length - 1;
      }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function stripPunct(s) {
    return String(s || "").replace(PUNCT_RE, "");
  }

  function toneless(p) {
    return String(p || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z]/g, "")
      .toLowerCase();
  }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function keywords(significado) {
    return String(significado || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-záéíóúñü]+/)
      .filter(function (w) {
        return w.length >= 4 && !STOPWORDS[w];
      });
  }

  var SHORT_STOP = { de: 1, el: 1, la: 1, en: 1, un: 1, es: 1, se: 1, me: 1, te: 1, mi: 1, tu: 1, su: 1, lo: 1, al: 1, ser: 1, hoy: 1 };

  /** Palabras cortas con significado propio ("yo", "él", "no"...), comparadas como palabra completa. */
  function shortKeywords(significado) {
    return String(significado || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-záéíóúñü]+/)
      .filter(function (w) {
        return w.length >= 2 && w.length <= 3 && !SHORT_STOP[w];
      });
  }

  /** ¿El significado de una palabra aparece en el texto (p. ej. la pista en español)? */
  function meaningHits(significado, text) {
    var t = norm(text);
    if (
      keywords(significado).some(function (k) {
        return t.indexOf(k) !== -1;
      })
    )
      return true;
    var tokens = t.split(/[^a-záéíóúñü]+/);
    return shortKeywords(significado).some(function (k) {
      return tokens.indexOf(k) !== -1;
    });
  }

  function failWeight(weights, char) {
    var f = (weights && weights[char]) || 0;
    return 1 + 2 * Math.min(f, 5);
  }

  // ------------------------------------------------------------------- contexto

  /** Reúne el vocabulario acumulado (lecciones ≤ id), el corpus de frases y el diccionario. */
  function buildContext(lessons, lessonId) {
    var sorted = lessons.slice().sort(function (a, b) {
      return a.id - b.id;
    });
    var lesson = sorted.filter(function (l) {
      return l.id === lessonId;
    })[0];
    if (!lesson) throw new Error("Lección no encontrada: " + lessonId);

    var vocab = [];
    var vocabIndex = {};
    sorted.forEach(function (l) {
      if (l.id > lessonId) return;
      l.vocabulario.forEach(function (w) {
        if (vocabIndex[w.caracter]) return;
        var item = {
          caracter: w.caracter,
          pinyin: w.pinyin,
          significado: w.significado,
          tipo: w.tipo || "",
          leccion: l.id,
        };
        vocab.push(item);
        vocabIndex[w.caracter] = item;
      });
    });

    var corpus = {};
    sorted.forEach(function (l) {
      l.frases.forEach(function (s) {
        corpus[stripPunct(s.zh)] = true;
      });
    });

    var wordSet = {};
    vocab.forEach(function (v) {
      wordSet[v.caracter] = true;
    });

    return {
      lessonId: lessonId,
      lesson: lesson,
      vocab: vocab,
      vocabIndex: vocabIndex,
      currentVocab: vocab.filter(function (v) {
        return v.leccion === lessonId;
      }),
      sentences: lesson.frases.filter(function (s) {
        return s.zh && s.es;
      }),
      corpus: corpus,
      wordSet: wordSet,
    };
  }

  // --------------------------------------------------------------- segmentación

  /** Divide un texto sin puntuación en palabras conocidas (más larga primero) o caracteres. */
  function segment(text, wordSet) {
    var chars = Array.from(text);
    var out = [];
    var i = 0;
    while (i < chars.length) {
      var found = chars[i];
      for (var L = Math.min(MAX_WORD_LEN, chars.length - i); L > 1; L--) {
        var w = chars.slice(i, i + L).join("");
        if (wordSet[w]) {
          found = w;
          break;
        }
      }
      out.push(found);
      i += Array.from(found).length;
    }
    return out;
  }

  /** Tokens [{text, punct}] conservando la puntuación. */
  function tokenize(zh, wordSet) {
    var out = [];
    var buf = "";
    Array.from(zh).forEach(function (ch) {
      if (PUNCT_CHARS.indexOf(ch) !== -1 || /\s/.test(ch)) {
        if (buf) {
          segment(buf, wordSet).forEach(function (t) {
            out.push({ text: t, punct: false });
          });
          buf = "";
        }
        if (!/\s/.test(ch)) out.push({ text: ch, punct: true });
      } else {
        buf += ch;
      }
    });
    if (buf) {
      segment(buf, wordSet).forEach(function (t) {
        out.push({ text: t, punct: false });
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- distractores

  function similar(a, b) {
    if (toneless(a.pinyin) && toneless(a.pinyin) === toneless(b.pinyin)) return true;
    var ca = Array.from(a.caracter);
    var cb = Array.from(b.caracter);
    for (var i = 0; i < ca.length; i++) if (cb.indexOf(ca[i]) !== -1) return true;
    return ca.length === cb.length && a.tipo === b.tipo;
  }

  function sameMeaning(a, b) {
    if (norm(a.significado) === norm(b.significado)) return true;
    var ka = keywords(a.significado);
    var kb = keywords(b.significado);
    return ka.some(function (k) {
      return kb.indexOf(k) !== -1;
    });
  }

  /** Elige `n` distractores para una palabra. `reject(c)` permite filtros extra. */
  function pickWordDistractors(ctx, target, n, rng, reject) {
    var cands = ctx.vocab.filter(function (c) {
      return c.caracter !== target.caracter && !sameMeaning(c, target) && !(reject && reject(c));
    });
    var scored = cands.map(function (c) {
      return {
        c: c,
        s:
          (c.tipo && c.tipo === target.tipo ? 3 : 0) +
          (similar(c, target) ? 2 : 0) +
          (c.leccion === target.leccion ? 1 : 0) +
          rng() * 0.9,
      };
    });
    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    var out = [];
    var usedMeanings = [target];
    for (var i = 0; i < scored.length && out.length < n; i++) {
      var c = scored[i].c;
      var clash = usedMeanings.some(function (u) {
        return sameMeaning(u, c) || u.caracter === c.caracter;
      });
      if (clash) continue;
      out.push(c);
      usedMeanings.push(c);
    }
    return out.length === n ? out : null;
  }

  function makeOptions(correctItem, distractors, rng, textFn, subFn) {
    var all = [{ item: correctItem, correct: true }].concat(
      distractors.map(function (d) {
        return { item: d, correct: false };
      })
    );
    return shuffle(all, rng).map(function (o, i) {
      return { id: "o" + i, text: textFn(o.item), sub: subFn ? subFn(o.item) : "", correct: o.correct };
    });
  }

  // ------------------------------------------------------------------ generadores

  function sentenceInfo(s) {
    return s.zh + " — " + s.pinyin + " — " + s.es;
  }

  function wordInfo(v) {
    return v.caracter + " (" + v.pinyin + ") = " + v.significado;
  }

  /** Completar la frase. */
  function makeFill(ctx, sentence, rng, weights) {
    var toks = tokenize(sentence.zh, ctx.wordSet);
    var counts = {};
    toks.forEach(function (t) {
      if (!t.punct) counts[t.text] = (counts[t.text] || 0) + 1;
    });
    var cands = [];
    toks.forEach(function (t, idx) {
      if (t.punct || counts[t.text] !== 1) return;
      var v = ctx.vocabIndex[t.text];
      if (v) cands.push({ idx: idx, vocab: v });
    });
    if (!cands.length) return null;

    var chosen = weightedSample(
      cands,
      function (c) {
        return (
          (c.vocab.leccion === ctx.lessonId ? 3 : 1) *
          failWeight(weights, c.vocab.caracter) *
          (/^partícula/.test(c.vocab.tipo) ? 0.4 : 1)
        );
      },
      1,
      rng
    )[0];
    var target = chosen.vocab;

    var inSentence = {};
    toks.forEach(function (t) {
      inSentence[t.text] = true;
    });
    var translation = norm(sentence.es);

    var plain = stripPunct(sentence.zh);
    var distractors = pickWordDistractors(ctx, target, CHOICES - 1, rng, function (c) {
      if (inSentence[c.caracter] || plain.indexOf(c.caracter) !== -1) return true;
      // si el significado del distractor aparece en la pista, podría encajar
      if (meaningHits(c.significado, translation)) return true;
      // si al sustituir queda una frase conocida, también encajaría
      var swapped = toks
        .map(function (t, i) {
          return i === chosen.idx ? c.caracter : t.punct ? "" : t.text;
        })
        .join("");
      return !!ctx.corpus[swapped];
    });
    if (!distractors) return null;

    var shown = toks
      .map(function (t, i) {
        return i === chosen.idx ? BLANK : t.text;
      })
      .join("");

    return {
      type: "fill",
      id: "fill:" + stripPunct(sentence.zh) + ":" + target.caracter,
      prompt: shown,
      hint: sentence.es,
      sentence: sentence,
      options: makeOptions(
        target,
        distractors,
        rng,
        function (v) {
          return v.caracter;
        },
        function (v) {
          return v.pinyin;
        }
      ),
      focus: [target.caracter],
      explicacion: wordInfo(target) + ". " + sentenceInfo(sentence),
      speak: sentence.zh,
    };
  }

  /** Español → chino, con una palabra. */
  function makeTranslateWord(ctx, target, rng) {
    var distractors = pickWordDistractors(ctx, target, CHOICES - 1, rng);
    if (!distractors) return null;
    return {
      type: "translate",
      subtype: "palabra",
      id: "translate:" + target.caracter,
      prompt: target.significado,
      options: makeOptions(
        target,
        distractors,
        rng,
        function (v) {
          return v.caracter;
        },
        function (v) {
          return v.pinyin;
        }
      ),
      focus: [target.caracter],
      explicacion: wordInfo(target),
      speak: target.caracter,
    };
  }

  function sentenceDistractors(ctx, sentence, n, rng) {
    var key = stripPunct(sentence.zh);
    var len = Array.from(key).length;
    var cands = ctx.sentences.filter(function (s) {
      return stripPunct(s.zh) !== key && norm(s.es) !== norm(sentence.es) && stripPunct(s.zh).length > 0;
    });
    var words = tokenize(sentence.zh, ctx.wordSet)
      .filter(function (t) {
        return !t.punct;
      })
      .map(function (t) {
        return t.text;
      });
    var scored = cands.map(function (s) {
      var l2 = Array.from(stripPunct(s.zh)).length;
      var shared = tokenize(s.zh, ctx.wordSet).filter(function (t) {
        return !t.punct && words.indexOf(t.text) !== -1;
      }).length;
      return { s: s, score: -Math.abs(l2 - len) + shared * 0.6 + rng() * 1.5 };
    });
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    var out = [];
    var seenZh = {};
    var seenEs = {};
    seenZh[key] = true;
    seenEs[norm(sentence.es)] = true;
    for (var i = 0; i < scored.length && out.length < n; i++) {
      var s = scored[i].s;
      var k = stripPunct(s.zh);
      if (seenZh[k] || seenEs[norm(s.es)]) continue;
      seenZh[k] = true;
      seenEs[norm(s.es)] = true;
      out.push(s);
    }
    return out.length === n ? out : null;
  }

  /** Español → chino, con una frase completa. */
  function makeTranslateSentence(ctx, sentence, rng) {
    var distractors = sentenceDistractors(ctx, sentence, CHOICES - 1, rng);
    if (!distractors) return null;
    return {
      type: "translate",
      subtype: "frase",
      id: "translate:" + stripPunct(sentence.zh),
      prompt: sentence.es,
      options: makeOptions(
        sentence,
        distractors,
        rng,
        function (s) {
          return s.zh;
        },
        function (s) {
          return s.pinyin;
        }
      ),
      focus: wordsOf(ctx, sentence),
      explicacion: sentenceInfo(sentence),
      speak: sentence.zh,
    };
  }

  /** Escuchar y elegir (frase). El UI decide si se ofrece según el soporte de voz. */
  function makeListen(ctx, sentence, rng) {
    var distractors = sentenceDistractors(ctx, sentence, CHOICES - 1, rng);
    if (!distractors) return null;
    return {
      type: "listen",
      id: "listen:" + stripPunct(sentence.zh),
      speak: sentence.zh,
      options: makeOptions(
        sentence,
        distractors,
        rng,
        function (s) {
          return s.zh;
        },
        function (s) {
          return s.pinyin;
        }
      ),
      focus: wordsOf(ctx, sentence),
      explicacion: sentenceInfo(sentence),
    };
  }

  /** Ordenar las palabras de una frase. */
  function makeOrder(ctx, sentence, rng) {
    var toks = tokenize(sentence.zh, ctx.wordSet);
    var words = toks
      .filter(function (t) {
        return !t.punct;
      })
      .map(function (t) {
        return t.text;
      });
    if (words.length < 3 || words.length > 8) return null;
    var tiles = null;
    for (var attempt = 0; attempt < 10; attempt++) {
      var s = shuffle(words, rng);
      if (s.join("|") !== words.join("|")) {
        tiles = s;
        break;
      }
    }
    if (!tiles) return null;
    var end = toks.length && toks[toks.length - 1].punct ? toks[toks.length - 1].text : "";
    return {
      type: "order",
      id: "order:" + stripPunct(sentence.zh),
      hint: sentence.es,
      tiles: tiles.map(function (t, i) {
        return { id: "t" + i, text: t };
      }),
      answer: words,
      endPunct: end,
      sentence: sentence,
      focus: wordsOf(ctx, sentence),
      explicacion: sentenceInfo(sentence),
      speak: sentence.zh,
    };
  }

  /** Emparejar carácter ↔ pinyin ↔ significado con 4 palabras. */
  function makeMatch(ctx, words, rng) {
    if (words.length !== 4) return null;
    var py = {};
    var mean = {};
    for (var i = 0; i < words.length; i++) {
      var p = norm(words[i].pinyin);
      if (py[p]) return null;
      py[p] = true;
      for (var j = 0; j < i; j++) if (sameMeaning(words[i], words[j])) return null;
    }
    var items = words.map(function (w, i) {
      return { id: "m" + i, caracter: w.caracter, pinyin: w.pinyin, significado: w.significado };
    });
    return {
      type: "match",
      id: "match:" + words.map(function (w) { return w.caracter; }).sort().join(""),
      items: items,
      columns: {
        caracter: shuffle(items, rng),
        pinyin: shuffle(items, rng),
        significado: shuffle(items, rng),
      },
      focus: words.map(function (w) {
        return w.caracter;
      }),
      explicacion: words.map(wordInfo).join(" · "),
    };
  }

  function wordsOf(ctx, sentence) {
    var out = [];
    tokenize(sentence.zh, ctx.wordSet).forEach(function (t) {
      if (!t.punct && ctx.vocabIndex[t.text] && out.indexOf(t.text) === -1) out.push(t.text);
    });
    return out;
  }

  // ------------------------------------------------------------------- evaluación

  /** Respuesta correcta? choice: índice de opción; order: array de textos; match: {h,p,m} ids. */
  function evaluate(ex, response) {
    if (!ex) return false;
    if (ex.type === "fill" || ex.type === "translate" || ex.type === "listen") {
      var o = ex.options[response];
      return !!(o && o.correct);
    }
    if (ex.type === "order") {
      return Array.isArray(response) && response.join("|") === ex.answer.join("|");
    }
    if (ex.type === "match") {
      return !!response && response.h === response.p && response.p === response.m;
    }
    return false;
  }

  // ------------------------------------------------------------------- sesión

  function sentenceWeight(ctx, s, weights) {
    var w = 1;
    wordsOf(ctx, s).forEach(function (c) {
      var v = ctx.vocabIndex[c];
      w += (v.leccion === ctx.lessonId ? 0.6 : 0.15) * failWeight(weights, c);
    });
    return w;
  }

  /**
   * Construye la lista de ejercicios de una sesión (por defecto 12).
   * opts: { count, rng|seed, weights, canListen }
   */
  function buildSession(lessons, lessonId, opts) {
    opts = opts || {};
    var rng = opts.rng || makeRng(opts.seed);
    var weights = opts.weights || {};
    var count = Math.max(10, Math.min(15, opts.count || 12));
    var ctx = buildContext(lessons, lessonId);

    var quotas = { fill: 0.36, translate: 0.22, order: 0.2, listen: opts.canListen ? 0.12 : 0, match: 0.1 };
    var slots = [];
    Object.keys(quotas).forEach(function (t) {
      var n = Math.round(count * quotas[t]);
      if (t === "match") n = ctx.currentVocab.length >= 4 ? Math.max(1, n) : 0;
      for (var i = 0; i < n; i++) slots.push(t);
    });
    while (slots.length < count) slots.push("fill");
    slots = shuffle(slots.slice(0, count), rng);

    var used = {};
    var exercises = [];

    function add(ex) {
      if (!ex || used[ex.id]) return false;
      used[ex.id] = true;
      exercises.push(ex);
      return true;
    }

    function pickSentence() {
      return weightedSample(
        ctx.sentences,
        function (s) {
          return sentenceWeight(ctx, s, weights);
        },
        1,
        rng
      )[0];
    }

    function pickWord() {
      var pool = ctx.currentVocab.length ? ctx.currentVocab : ctx.vocab;
      return weightedSample(
        pool,
        function (v) {
          return failWeight(weights, v.caracter);
        },
        1,
        rng
      )[0];
    }

    function attempt(type) {
      if (type === "fill") return makeFill(ctx, pickSentence(), rng, weights);
      if (type === "order") return makeOrder(ctx, pickSentence(), rng);
      if (type === "listen") return makeListen(ctx, pickSentence(), rng);
      if (type === "match") {
        var pool = ctx.currentVocab.length >= 4 ? ctx.currentVocab : ctx.vocab;
        var four = weightedSample(
          pool,
          function (v) {
            return failWeight(weights, v.caracter);
          },
          4,
          rng
        );
        return makeMatch(ctx, four, rng);
      }
      // translate: mitad palabras, mitad frases
      return rng() < 0.55 ? makeTranslateWord(ctx, pickWord(), rng) : makeTranslateSentence(ctx, pickSentence(), rng);
    }

    var fallbacks = ["fill", "translate", "order"];
    slots.forEach(function (type) {
      var ok = false;
      for (var i = 0; i < 25 && !ok; i++) ok = add(attempt(type));
      for (var f = 0; f < fallbacks.length && !ok; f++) {
        for (var k = 0; k < 25 && !ok; k++) ok = add(attempt(fallbacks[f]));
      }
    });
    return exercises;
  }

  return {
    BLANK: BLANK,
    CHOICES: CHOICES,
    makeRng: makeRng,
    shuffle: shuffle,
    stripPunct: stripPunct,
    toneless: toneless,
    keywords: keywords,
    meaningHits: meaningHits,
    buildContext: buildContext,
    segment: segment,
    tokenize: tokenize,
    makeFill: makeFill,
    makeTranslateWord: makeTranslateWord,
    makeTranslateSentence: makeTranslateSentence,
    makeListen: makeListen,
    makeOrder: makeOrder,
    makeMatch: makeMatch,
    evaluate: evaluate,
    buildSession: buildSession,
  };
});
