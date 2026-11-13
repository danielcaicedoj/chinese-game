"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const E = require("../js/lessons/exercises.js");

const DIR = path.join(__dirname, "..", "data", "lessons");
const LESSONS = fs
  .readdirSync(DIR)
  .filter((f) => /^leccion-\d+\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))
  .sort((a, b) => a.id - b.id);

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

function allExercises(opts = {}) {
  const out = [];
  for (const lesson of LESSONS) {
    for (const seed of SEEDS) {
      for (const ex of E.buildSession(LESSONS, lesson.id, { seed, canListen: true, ...opts })) {
        out.push({ lesson, ex });
      }
    }
  }
  return out;
}

const ALL = allExercises();

test("hay datos de lecciones para probar", () => {
  assert.ok(LESSONS.length >= 9);
  assert.ok(ALL.length > 1000);
});

test("cada sesión trae entre 10 y 15 ejercicios", () => {
  for (const lesson of LESSONS) {
    for (const seed of SEEDS) {
      const s = E.buildSession(LESSONS, lesson.id, { seed, canListen: true });
      assert.ok(s.length >= 10 && s.length <= 15, `lección ${lesson.id} seed ${seed}: ${s.length}`);
    }
  }
});

test("la sesión es determinista con la misma semilla y no repite ejercicios", () => {
  const a = E.buildSession(LESSONS, 5, { seed: 42, canListen: true }).map((e) => e.id);
  const b = E.buildSession(LESSONS, 5, { seed: 42, canListen: true }).map((e) => e.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, "ids repetidos en una sesión");
});

test("elección múltiple: 4 opciones, exactamente 1 correcta y sin duplicados", () => {
  let checked = 0;
  for (const { ex } of ALL) {
    if (!["fill", "translate", "listen"].includes(ex.type)) continue;
    checked++;
    assert.equal(ex.options.length, E.CHOICES, ex.id);
    assert.equal(ex.options.filter((o) => o.correct).length, 1, `${ex.id}: no hay una única correcta`);
    const texts = ex.options.map((o) => o.text);
    assert.equal(new Set(texts).size, texts.length, `${ex.id}: opciones duplicadas ${texts.join("|")}`);
    ex.options.forEach((o, i) => assert.equal(E.evaluate(ex, i), o.correct, ex.id));
  }
  assert.ok(checked > 500);
});

test("completar la frase: un solo hueco y la respuesta correcta reconstruye la frase", () => {
  let checked = 0;
  for (const { ex } of ALL) {
    if (ex.type !== "fill") continue;
    checked++;
    assert.equal(ex.prompt.split(E.BLANK).length, 2, `${ex.id}: debe haber un único hueco`);
    const right = ex.options.find((o) => o.correct);
    assert.equal(E.stripPunct(ex.prompt.replace(E.BLANK, right.text)), E.stripPunct(ex.sentence.zh), ex.id);
    assert.ok(ex.hint && ex.hint.length > 0, `${ex.id}: falta la pista en español`);
  }
  assert.ok(checked > 200);
});

test("completar la frase: ningún distractor encaja (ni forma una frase conocida, ni aparece en la frase, ni su significado está en la pista)", () => {
  const corpus = new Set();
  LESSONS.forEach((l) => l.frases.forEach((s) => corpus.add(E.stripPunct(s.zh))));
  for (const { ex } of ALL) {
    if (ex.type !== "fill") continue;
    const sentence = E.stripPunct(ex.sentence.zh);
    const hint = ex.hint.toLowerCase();
    for (const o of ex.options.filter((o) => !o.correct)) {
      const filled = E.stripPunct(ex.prompt.replace(E.BLANK, o.text));
      assert.ok(!corpus.has(filled), `${ex.id}: el distractor "${o.text}" forma una frase válida: ${filled}`);
      assert.ok(!sentence.includes(o.text), `${ex.id}: el distractor "${o.text}" ya está en la frase`);
      const vocab = LESSONS.flatMap((l) => l.vocabulario).find((v) => v.caracter === o.text);
      assert.ok(vocab, `${ex.id}: distractor fuera del vocabulario: ${o.text}`);
      assert.ok(!E.meaningHits(vocab.significado, hint), `${ex.id}: la pista menciona el significado de "${o.text}" (${vocab.significado})`);
    }
  }
});

test("completar la frase: los distractores no repiten significado", () => {
  const meaning = new Map();
  LESSONS.forEach((l) => l.vocabulario.forEach((v) => meaning.set(v.caracter, v.significado)));
  for (const { ex } of ALL) {
    if (ex.type !== "fill" && !(ex.type === "translate" && ex.subtype === "palabra")) continue;
    const ms = ex.options.map((o) => meaning.get(o.text).toLowerCase());
    assert.equal(new Set(ms).size, ms.length, `${ex.id}: significados repetidos ${ms.join("|")}`);
  }
});

test("traducir frase / escuchar: opciones con frases y traducciones distintas", () => {
  const es = new Map();
  LESSONS.forEach((l) => l.frases.forEach((s) => es.set(s.zh, s.es.toLowerCase())));
  let checked = 0;
  for (const { ex } of ALL) {
    const isSentence = (ex.type === "translate" && ex.subtype === "frase") || ex.type === "listen";
    if (!isSentence) continue;
    checked++;
    const ts = ex.options.map((o) => es.get(o.text));
    assert.ok(ts.every(Boolean), `${ex.id}: opción que no es una frase conocida`);
    assert.equal(new Set(ts).size, ts.length, `${ex.id}: dos opciones significan lo mismo`);
  }
  assert.ok(checked > 100);
});

test("ordenar: las fichas reconstruyen exactamente la frase y no vienen ya ordenadas", () => {
  let checked = 0;
  for (const { ex } of ALL) {
    if (ex.type !== "order") continue;
    checked++;
    assert.ok(ex.tiles.length >= 3 && ex.tiles.length <= 8, ex.id);
    assert.equal(ex.answer.join(""), E.stripPunct(ex.sentence.zh), ex.id);
    assert.deepEqual([...ex.tiles.map((t) => t.text)].sort(), [...ex.answer].sort(), ex.id);
    assert.notEqual(ex.tiles.map((t) => t.text).join("|"), ex.answer.join("|"), `${ex.id}: ya ordenada`);
    assert.equal(E.evaluate(ex, ex.answer), true);
    const wrong = [...ex.answer].reverse();
    if (wrong.join("|") !== ex.answer.join("|")) assert.equal(E.evaluate(ex, wrong), false);
    const ids = ex.tiles.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.ok(checked > 100);
});

test("emparejar: 4 palabras sin pinyin ni significados repetidos", () => {
  let checked = 0;
  for (const { ex } of ALL) {
    if (ex.type !== "match") continue;
    checked++;
    assert.equal(ex.items.length, 4);
    assert.equal(new Set(ex.items.map((i) => i.pinyin.toLowerCase())).size, 4, `${ex.id}: pinyin repetido`);
    assert.equal(new Set(ex.items.map((i) => i.significado.toLowerCase())).size, 4, `${ex.id}: significado repetido`);
    assert.equal(new Set(ex.items.map((i) => i.caracter)).size, 4);
    for (const col of ["caracter", "pinyin", "significado"]) {
      assert.deepEqual(ex.columns[col].map((i) => i.id).sort(), ex.items.map((i) => i.id).sort(), ex.id);
    }
    const [a, b] = ex.items;
    assert.equal(E.evaluate(ex, { h: a.id, p: a.id, m: a.id }), true);
    assert.equal(E.evaluate(ex, { h: a.id, p: b.id, m: a.id }), false);
  }
  assert.ok(checked > 50);
});

test("emparejar: rechaza palabras con el mismo pinyin (他/她)", () => {
  const words = [
    { caracter: "他", pinyin: "tā", significado: "él" },
    { caracter: "她", pinyin: "tā", significado: "ella" },
    { caracter: "我", pinyin: "wǒ", significado: "yo" },
    { caracter: "是", pinyin: "shì", significado: "ser" },
  ];
  const ctx = E.buildContext(LESSONS, 4);
  assert.equal(E.makeMatch(ctx, words, Math.random), null);
});

test("evaluate: respuestas inválidas son incorrectas", () => {
  const ex = E.buildSession(LESSONS, 3, { seed: 1 }).find((e) => e.type === "fill");
  assert.equal(E.evaluate(ex, 99), false);
  assert.equal(E.evaluate(ex, -1), false);
  assert.equal(E.evaluate(null, 0), false);
});

test("sin voz disponible no se generan ejercicios de escuchar", () => {
  for (const lesson of LESSONS) {
    for (const seed of SEEDS.slice(0, 10)) {
      const s = E.buildSession(LESSONS, lesson.id, { seed, canListen: false });
      assert.ok(!s.some((e) => e.type === "listen"));
    }
  }
});

test("la mezcla incluye varios tipos de ejercicio por sesión", () => {
  for (const lesson of LESSONS.filter((l) => l.id >= 4)) {
    const types = new Set(E.buildSession(LESSONS, lesson.id, { seed: 7, canListen: true }).map((e) => e.type));
    assert.ok(types.size >= 4, `lección ${lesson.id}: solo ${[...types].join(",")}`);
  }
});

test("repetición espaciada: las palabras más falladas aparecen más", () => {
  const lesson = 6;
  const vocab = LESSONS.find((l) => l.id === lesson).vocabulario.map((v) => v.caracter);
  const hard = vocab[3];
  const count = (weights) => {
    let n = 0;
    for (let seed = 0; seed < 150; seed++) {
      for (const ex of E.buildSession(LESSONS, lesson, { seed, weights, canListen: true })) {
        if (ex.focus.includes(hard)) n++;
      }
    }
    return n;
  };
  assert.ok(count({ [hard]: 5 }) > count({}) * 1.2, "el carácter fallado debería salir más veces");
});

test("tokenize/segment conservan el texto y la puntuación", () => {
  const ctx = E.buildContext(LESSONS, 10);
  for (const l of LESSONS) {
    for (const s of l.frases) {
      const toks = E.tokenize(s.zh, ctx.wordSet);
      assert.equal(toks.map((t) => t.text).join(""), s.zh.replace(/\s/g, ""), s.zh);
    }
  }
});

test("todas las frases de las lecciones tienen pinyin y traducción", () => {
  for (const l of LESSONS) {
    for (const s of l.frases) {
      assert.ok(s.zh && s.pinyin && s.es, `lección ${l.id}: frase incompleta ${JSON.stringify(s)}`);
    }
    for (const v of l.vocabulario) {
      assert.ok(v.caracter && v.pinyin && v.significado, `lección ${l.id}: palabra incompleta ${JSON.stringify(v)}`);
    }
  }
});
