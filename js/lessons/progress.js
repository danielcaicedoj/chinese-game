/*
 * Progreso persistente (localStorage): lecciones desbloqueadas en orden, mejor
 * puntuación y estrellas por lección, racha diaria, puntos totales (compartidos
 * con el modo clásico), estadística de fallos por carácter (repetición espaciada
 * simple) y preferencias. El almacenamiento y la fecha se inyectan para probarlo.
 * Navegador: window.LessonProgress.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LessonProgress = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY = "mandarin.progreso.v1";
  var FAIL_DECAY = 0.5; // cada acierto a la primera "olvida" medio fallo

  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) {
        data[k] = String(v);
      },
    };
  }

  function browserStorage() {
    try {
      var ls = typeof localStorage !== "undefined" ? localStorage : null;
      if (!ls) return memoryStorage();
      var probe = "__probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return memoryStorage(); // modo privado / almacenamiento bloqueado
    }
  }

  function localDay(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function daysBetween(a, b) {
    var pa = a.split("-").map(Number);
    var pb = b.split("-").map(Number);
    var da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
    var db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((db - da) / 86400000);
  }

  function empty() {
    return {
      version: 1,
      lessons: {},
      totalPoints: 0,
      streak: { count: 0, lastDay: null },
      fails: {},
      showPinyin: true,
      challenge: false,
    };
  }

  function create(opts) {
    opts = opts || {};
    var storage = opts.storage || browserStorage();
    var today = opts.today || function () { return localDay(); };
    var state = load();

    function load() {
      try {
        var raw = storage.getItem(KEY);
        if (!raw) return empty();
        var parsed = JSON.parse(raw);
        var base = empty();
        for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) base[k] = parsed[k];
        return base;
      } catch (e) {
        return empty();
      }
    }

    function save() {
      try {
        storage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        /* sin espacio o bloqueado: el progreso queda solo en memoria */
      }
    }

    function getLesson(id) {
      return state.lessons[id] || { stars: 0, bestXp: 0, completions: 0, attempts: 0 };
    }

    /** Desbloqueada si es la primera o si la anterior tiene al menos 1 estrella. */
    function isUnlocked(id, orderedIds) {
      var i = orderedIds.indexOf(id);
      if (i <= 0) return i === 0;
      return getLesson(orderedIds[i - 1]).stars >= 1;
    }

    function touchStreak() {
      var t = today();
      var s = state.streak;
      if (s.lastDay === t) return;
      if (s.lastDay && daysBetween(s.lastDay, t) === 1) s.count += 1;
      else s.count = 1;
      s.lastDay = t;
    }

    /** Racha vigente: si pasó más de un día sin practicar, se muestra 0. */
    function getStreak() {
      var s = state.streak;
      if (!s.lastDay) return 0;
      return daysBetween(s.lastDay, today()) > 1 ? 0 : s.count;
    }

    /** Registra una sesión terminada (o abandonada tras perder las vidas). */
    function recordSession(lessonId, summary) {
      var rec = getLesson(lessonId);
      rec = {
        stars: Math.max(rec.stars, summary.stars || 0),
        bestXp: Math.max(rec.bestXp, summary.xp || 0),
        completions: rec.completions + (summary.completed ? 1 : 0),
        attempts: rec.attempts + 1,
      };
      state.lessons[lessonId] = rec;
      state.totalPoints += summary.xp || 0;

      var mistakes = summary.mistakes || {};
      Object.keys(mistakes).forEach(function (w) {
        state.fails[w] = (state.fails[w] || 0) + mistakes[w];
      });
      var ok = summary.correctWords || {};
      Object.keys(ok).forEach(function (w) {
        if (mistakes[w]) return;
        var left = (state.fails[w] || 0) - FAIL_DECAY * ok[w];
        if (left <= 0) delete state.fails[w];
        else state.fails[w] = left;
      });

      if (summary.answers > 0) touchStreak();
      save();
      return rec;
    }

    return {
      getLesson: getLesson,
      isUnlocked: isUnlocked,
      recordSession: recordSession,
      getStreak: getStreak,
      getFails: function () {
        return Object.assign({}, state.fails);
      },
      getTotalPoints: function () {
        return state.totalPoints;
      },
      /** Suma puntos de otras modalidades (p. ej. el modo clásico). */
      addPoints: function (n) {
        if (n > 0) {
          state.totalPoints += Math.round(n);
          save();
        }
      },
      getShowPinyin: function () {
        return !!state.showPinyin;
      },
      setShowPinyin: function (v) {
        state.showPinyin = !!v;
        save();
      },
      getChallenge: function () {
        return !!state.challenge;
      },
      setChallenge: function (v) {
        state.challenge = !!v;
        save();
      },
      reset: function () {
        state = empty();
        save();
      },
      _state: function () {
        return state;
      },
    };
  }

  var sharedInstance = null;

  /** Instancia única para toda la app (modo clásico y lecciones comparten los puntos totales). */
  function shared() {
    if (!sharedInstance) sharedInstance = create();
    return sharedInstance;
  }

  return {
    KEY: KEY,
    create: create,
    shared: shared,
    localDay: localDay,
    daysBetween: daysBetween,
    memoryStorage: memoryStorage,
  };
});
