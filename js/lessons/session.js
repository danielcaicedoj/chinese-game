/*
 * Lógica de una sesión de lección: vidas, cola de ejercicios, repetición de los
 * fallados, XP con multiplicador y estrellas. Sin DOM ni almacenamiento, para
 * poder probarla en Node. Navegador: window.LessonSession.
 *
 * Reglas:
 *  - 3 vidas; cada respuesta incorrecta (o tiempo agotado en "Desafío") resta una.
 *    Con 0 vidas la lección termina.
 *  - Un ejercicio fallado se vuelve a poner AL FINAL de la cola hasta acertarlo.
 *  - XP (integrado con el sistema de puntos del juego): base 10 por acierto a la
 *    primera (en "Desafío": los segundos restantes, igual que en el modo clásico),
 *    multiplicado por el multiplicador de racha (empieza en 1, +0,2 por acierto,
 *    vuelve a 1 al fallar). Los aciertos en repeticiones no dan XP.
 *  - Estrellas: 0 si se pierden las 3 vidas; si no, 3 con ≥90% de aciertos a la
 *    primera, 2 con ≥70% y 1 en caso contrario.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LessonSession = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_LIVES = 3;
  var BASE_XP = 10;
  var CHALLENGE_SECONDS = 15;
  var MULTIPLIER_STEP = 0.2;

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function starsFor(accuracy, failed) {
    if (failed) return 0;
    if (accuracy >= 0.9) return 3;
    if (accuracy >= 0.7) return 2;
    return 1;
  }

  function create(opts) {
    opts = opts || {};
    var exercises = opts.exercises || [];
    var challenge = !!opts.challenge;
    var lives = opts.lives || MAX_LIVES;
    var queue = exercises.map(function (ex) {
      return { ex: ex, attempt: 0 };
    });
    var pos = 0;
    var multiplier = 1;
    var xp = 0;
    var firstTryCorrect = 0;
    var resolved = 0;
    var mistakes = {}; // palabra -> nº de fallos
    var correctWords = {}; // palabra -> aciertos a la primera
    var answers = 0;
    var finished = false;
    var failed = false;
    var pending = null; // item respondido, a la espera de advance()

    function current() {
      if (finished || pos >= queue.length) return null;
      var item = queue[pos];
      return {
        exercise: item.ex,
        attempt: item.attempt,
        isRetry: item.attempt > 0,
        number: Math.min(resolved + 1, exercises.length),
        total: exercises.length,
      };
    }

    /**
     * Registra la respuesta al ejercicio actual.
     * @param {boolean} correct
     * @param {{secondsLeft?:number, timeout?:boolean}} info
     */
    function submit(correct, info) {
      if (finished || pending) throw new Error("No hay ejercicio pendiente de responder");
      info = info || {};
      var item = queue[pos];
      pending = item;
      answers++;
      var earned = 0;

      if (correct) {
        if (item.attempt === 0) {
          firstTryCorrect++;
          var base = challenge ? Math.max(1, Math.ceil(info.secondsLeft || 0)) : BASE_XP;
          earned = Math.round(base * multiplier);
          xp += earned;
          multiplier = round1(multiplier + MULTIPLIER_STEP);
          item.ex.focus.forEach(function (w) {
            correctWords[w] = (correctWords[w] || 0) + 1;
          });
        }
        resolved++;
      } else {
        lives--;
        multiplier = 1;
        item.ex.focus.forEach(function (w) {
          mistakes[w] = (mistakes[w] || 0) + 1;
        });
        queue.push({ ex: item.ex, attempt: item.attempt + 1 });
        if (lives <= 0) {
          failed = true;
          finished = true;
        }
      }

      return {
        correct: !!correct,
        timeout: !!info.timeout,
        xp: earned,
        totalXp: xp,
        lives: Math.max(0, lives),
        multiplier: multiplier,
        failed: failed,
        retryQueued: !correct && !failed,
      };
    }

    /** Pasa al siguiente ejercicio tras mostrar el feedback. Devuelve current() o null. */
    function advance() {
      if (!pending && !finished) throw new Error("Primero hay que responder");
      pending = null;
      if (finished) return null;
      pos++;
      if (pos >= queue.length) {
        finished = true;
        return null;
      }
      return current();
    }

    function summary() {
      var total = exercises.length;
      var accuracy = total ? firstTryCorrect / total : 0;
      var review = Object.keys(mistakes).sort(function (a, b) {
        return mistakes[b] - mistakes[a] || (a < b ? -1 : 1);
      });
      return {
        total: total,
        firstTryCorrect: firstTryCorrect,
        accuracy: accuracy,
        xp: xp,
        stars: starsFor(accuracy, failed),
        lives: Math.max(0, lives),
        completed: finished && !failed && resolved >= total,
        failed: failed,
        challenge: challenge,
        answers: answers,
        mistakes: mistakes,
        correctWords: correctWords,
        review: review,
      };
    }

    return {
      current: current,
      submit: submit,
      advance: advance,
      summary: summary,
      isFinished: function () {
        return finished;
      },
      getLives: function () {
        return Math.max(0, lives);
      },
      getMultiplier: function () {
        return multiplier;
      },
      getXp: function () {
        return xp;
      },
      getProgress: function () {
        return exercises.length ? resolved / exercises.length : 0;
      },
    };
  }

  return {
    MAX_LIVES: MAX_LIVES,
    BASE_XP: BASE_XP,
    CHALLENGE_SECONDS: CHALLENGE_SECONDS,
    starsFor: starsFor,
    create: create,
  };
});
