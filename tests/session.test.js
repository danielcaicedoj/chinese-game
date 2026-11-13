"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../js/lessons/session.js");
const P = require("../js/lessons/progress.js");

const ex = (id, ...focus) => ({ id, type: "fill", focus });
const mk = (n, extra = {}) =>
  S.create({ exercises: Array.from({ length: n }, (_, i) => ex("e" + i, "w" + i)), ...extra });

/** Responde todo bien y avanza hasta el final. */
function playPerfect(s) {
  while (s.current()) {
    s.submit(true);
    s.advance();
  }
}

test("sesión perfecta: 3 estrellas, sin repeticiones y XP con multiplicador", () => {
  const s = mk(10);
  playPerfect(s);
  const sum = s.summary();
  assert.equal(sum.completed, true);
  assert.equal(sum.failed, false);
  assert.equal(sum.stars, 3);
  assert.equal(sum.accuracy, 1);
  assert.equal(sum.lives, 3);
  // 10 × (1.0 + 1.2 + 1.4 + ... + 2.8) redondeado por ejercicio
  let expected = 0;
  let m = 1;
  for (let i = 0; i < 10; i++) {
    expected += Math.round(10 * m);
    m = Math.round((m + 0.2) * 10) / 10;
  }
  assert.equal(sum.xp, expected);
});

test("5 aciertos seguidos llevan el multiplicador a x2 (igual que el modo clásico)", () => {
  const s = mk(12);
  for (let i = 0; i < 5; i++) {
    s.submit(true);
    s.advance();
  }
  assert.equal(s.getMultiplier(), 2);
});

test("un fallo resta una vida, reinicia el multiplicador y repite el ejercicio al final", () => {
  const s = mk(3);
  s.submit(true);
  s.advance();
  assert.equal(s.getMultiplier(), 1.2);
  const r = s.submit(false); // e1 falla
  assert.equal(r.lives, 2);
  assert.equal(r.retryQueued, true);
  assert.equal(s.getMultiplier(), 1);
  s.advance(); // e2
  assert.equal(s.current().exercise.id, "e2");
  s.submit(true);
  const next = s.advance();
  assert.equal(next.exercise.id, "e1", "el fallado vuelve al final");
  assert.equal(next.isRetry, true);
  s.submit(true);
  assert.equal(s.advance(), null);
  const sum = s.summary();
  assert.equal(sum.completed, true);
  assert.equal(sum.firstTryCorrect, 2);
  assert.deepEqual(sum.review, ["w1"]);
});

test("los fallados se repiten hasta acertarlos (varias veces si hace falta)", () => {
  const s = mk(2);
  s.submit(false);
  s.advance(); // e1
  s.submit(true);
  let c = s.advance(); // e0 (reintento 1)
  assert.equal(c.exercise.id, "e0");
  s.submit(false);
  c = s.advance(); // e0 (reintento 2)
  assert.equal(c.exercise.id, "e0");
  assert.equal(c.attempt, 2);
  s.submit(true);
  assert.equal(s.advance(), null);
  assert.equal(s.summary().completed, true);
  assert.equal(s.getLives(), 1);
});

test("los aciertos en repeticiones no dan XP ni suben el multiplicador", () => {
  const s = mk(1);
  s.submit(false);
  s.advance();
  const before = s.getXp();
  const r = s.submit(true);
  assert.equal(r.xp, 0);
  assert.equal(s.getXp(), before);
  assert.equal(s.getMultiplier(), 1);
});

test("al perder las 3 vidas la lección termina, sin estrellas", () => {
  const s = mk(10);
  s.submit(false);
  s.advance();
  s.submit(false);
  s.advance();
  const r = s.submit(false);
  assert.equal(r.failed, true);
  assert.equal(r.lives, 0);
  assert.equal(s.advance(), null);
  assert.equal(s.isFinished(), true);
  const sum = s.summary();
  assert.equal(sum.failed, true);
  assert.equal(sum.completed, false);
  assert.equal(sum.stars, 0);
  assert.equal(sum.review.length, 3);
});

test("estrellas según precisión: ≥90% → 3, ≥70% → 2, resto → 1", () => {
  assert.equal(S.starsFor(1, false), 3);
  assert.equal(S.starsFor(0.9, false), 3);
  assert.equal(S.starsFor(0.89, false), 2);
  assert.equal(S.starsFor(0.7, false), 2);
  assert.equal(S.starsFor(0.69, false), 1);
  assert.equal(S.starsFor(0.1, false), 1);
  assert.equal(S.starsFor(1, true), 0);

  // 10 ejercicios, 2 fallos → 80% → 2 estrellas
  const s = mk(10);
  let i = 0;
  while (s.current()) {
    s.submit(!(i === 3 || i === 6) || s.current().isRetry);
    s.advance();
    i++;
  }
  assert.equal(s.summary().stars, 2);
});

test("modo Desafío: el XP son los segundos restantes (como en el modo clásico) × multiplicador", () => {
  const s = mk(5, { challenge: true });
  let r = s.submit(true, { secondsLeft: 8.4 });
  assert.equal(r.xp, 9); // ceil(8.4) × 1.0
  s.advance();
  r = s.submit(true, { secondsLeft: 5 });
  assert.equal(r.xp, 6); // 5 × 1.2
  s.advance();
  r = s.submit(false, { timeout: true });
  assert.equal(r.timeout, true);
  assert.equal(s.getLives(), 2);
  assert.equal(s.getMultiplier(), 1);
});

test("estadística de fallos por carácter", () => {
  const s = S.create({ exercises: [ex("a", "我", "是"), ex("b", "你")] });
  s.submit(false);
  s.advance();
  s.submit(true);
  s.advance();
  s.submit(true);
  const sum = s.summary();
  assert.deepEqual(sum.mistakes, { 我: 1, 是: 1 });
  assert.deepEqual(sum.correctWords, { 你: 1 });
});

test("no se puede avanzar sin responder ni responder dos veces seguidas", () => {
  const s = mk(2);
  assert.throws(() => s.advance());
  s.submit(true);
  assert.throws(() => s.submit(true));
});

// ------------------------------------------------------------------ progreso

const freshProgress = (day) => {
  const clock = { day: day || "2026-03-10" };
  const storage = P.memoryStorage();
  const make = () => P.create({ storage, today: () => clock.day });
  return { clock, storage, make, p: make() };
};

const fakeSummary = (o = {}) => ({
  stars: 2,
  xp: 80,
  completed: true,
  answers: 12,
  mistakes: {},
  correctWords: {},
  ...o,
});

test("lecciones: solo la primera está desbloqueada y las demás en orden", () => {
  const { p } = freshProgress();
  const ids = [2, 3, 4];
  assert.equal(p.isUnlocked(2, ids), true);
  assert.equal(p.isUnlocked(3, ids), false);
  p.recordSession(2, fakeSummary({ stars: 1 }));
  assert.equal(p.isUnlocked(3, ids), true);
  assert.equal(p.isUnlocked(4, ids), false);
  p.recordSession(3, fakeSummary({ stars: 0, completed: false }));
  assert.equal(p.isUnlocked(4, ids), false, "sin estrellas no se desbloquea la siguiente");
});

test("guarda la mejor puntuación y estrellas por lección", () => {
  const { p } = freshProgress();
  p.recordSession(2, fakeSummary({ stars: 3, xp: 120 }));
  p.recordSession(2, fakeSummary({ stars: 1, xp: 40 }));
  const l = p.getLesson(2);
  assert.equal(l.stars, 3);
  assert.equal(l.bestXp, 120);
  assert.equal(l.attempts, 2);
  assert.equal(l.completions, 2);
  assert.equal(p.getTotalPoints(), 160, "los puntos totales suman todas las sesiones");
});

test("persiste en el almacenamiento y se recupera", () => {
  const { make, p } = freshProgress();
  p.recordSession(2, fakeSummary({ stars: 3, xp: 99 }));
  p.setShowPinyin(false);
  p.addPoints(50);
  const again = make();
  assert.equal(again.getLesson(2).stars, 3);
  assert.equal(again.getShowPinyin(), false);
  assert.equal(again.getTotalPoints(), 149);
});

test("almacenamiento corrupto o ausente no rompe el progreso", () => {
  const storage = P.memoryStorage();
  storage.setItem(P.KEY, "{esto no es json");
  const p = P.create({ storage });
  assert.equal(p.getTotalPoints(), 0);
  const broken = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  const q = P.create({ storage: broken });
  q.recordSession(2, fakeSummary());
  assert.equal(q.getLesson(2).stars, 2);
});

test("racha diaria: suma días consecutivos, no duplica el mismo día y se reinicia tras un salto", () => {
  const { p, clock } = freshProgress("2026-03-10");
  assert.equal(p.getStreak(), 0);
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 1);
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 1, "mismo día");
  clock.day = "2026-03-11";
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 2);
  clock.day = "2026-03-12";
  assert.equal(p.getStreak(), 2, "aún vigente: ayer practicó");
  clock.day = "2026-03-14";
  assert.equal(p.getStreak(), 0, "se rompió");
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 1);
  clock.day = "2026-04-01"; // cambio de mes / racha rota
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 1);
});

test("la racha cruza el fin de mes y de año", () => {
  const { p, clock } = freshProgress("2026-12-31");
  p.recordSession(2, fakeSummary());
  clock.day = "2027-01-01";
  p.recordSession(2, fakeSummary());
  assert.equal(p.getStreak(), 2);
});

test("una sesión sin respuestas no cuenta para la racha", () => {
  const { p } = freshProgress();
  p.recordSession(2, fakeSummary({ answers: 0, xp: 0 }));
  assert.equal(p.getStreak(), 0);
});

test("fallos por carácter: suben al fallar y bajan al acertar a la primera", () => {
  const { p } = freshProgress();
  p.recordSession(3, fakeSummary({ mistakes: { 我: 2, 是: 1 }, correctWords: { 你: 1 } }));
  assert.deepEqual(p.getFails(), { 我: 2, 是: 1 });
  p.recordSession(3, fakeSummary({ mistakes: {}, correctWords: { 我: 1, 是: 4 } }));
  const f = p.getFails();
  assert.equal(f["我"], 1.5);
  assert.equal(f["是"], undefined, "se olvida cuando llega a 0");
});

test("el modo clásico suma sus puntos al total compartido", () => {
  const { p } = freshProgress();
  p.addPoints(120);
  p.addPoints(-5);
  p.addPoints(0);
  assert.equal(p.getTotalPoints(), 120);
});
