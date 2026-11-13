/*
 * Interfaz del modo "Lección": selección de lecciones, sesión de ejercicios,
 * feedback y resumen. Usa los módulos puros (exercises / session / progress) y
 * los estilos del juego actual. Expone window.LessonUI.open().
 */
(function () {
  "use strict";

  if (typeof LESSONS === "undefined" || !window.LessonExercises || !window.LessonSession || !window.LessonProgress) {
    return;
  }

  var E = window.LessonExercises;
  var S = window.LessonSession;
  var progress = window.LessonProgress.shared();
  var ORDERED = LESSONS.slice().sort(function (a, b) {
    return a.id - b.id;
  });
  var IDS = ORDERED.map(function (l) {
    return l.id;
  });

  // ------------------------------------------------------------------- DOM
  var $ = function (id) {
    return document.getElementById(id);
  };
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.toggle("active", s.id === id);
    });
    window.scrollTo(0, 0);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function stars(n) {
    return "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n);
  }

  // ------------------------------------------------------------------- voz

  var speech = {
    supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    voice: null,
  };

  function refreshVoices() {
    if (!speech.supported) return;
    var voices = window.speechSynthesis.getVoices() || [];
    var zh = voices.filter(function (v) {
      return /^zh/i.test(v.lang);
    });
    speech.voice =
      zh.filter(function (v) {
        return /zh[-_]CN/i.test(v.lang);
      })[0] ||
      zh[0] ||
      null;
  }

  if (speech.supported) {
    refreshVoices();
    if (window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    }
  }

  function canListen() {
    refreshVoices();
    return speech.supported && !!speech.voice;
  }

  function speak(text) {
    if (!speech.supported) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      if (speech.voice) u.voice = speech.voice;
      u.rate = 0.85;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* sin voz: se ignora */
    }
  }

  // ------------------------------------------------------------ estado de UI

  var ui = {
    lesson: null,
    session: null,
    current: null,
    answered: false,
    timerId: null,
    tickId: null,
    startedAt: 0,
    matchMistake: false,
  };

  function applyPinyinSetting() {
    var on = progress.getShowPinyin();
    document.body.classList.toggle("hide-pinyin", !on);
    var cb = $("opt-pinyin");
    if (cb) cb.checked = on;
  }

  // ----------------------------------------------------- selección de lecciones

  function syncTabs() {
    document.querySelectorAll(".mode-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.mode === "lesson");
    });
  }

  function renderList() {
    var list = $("lesson-list");
    list.innerHTML = "";
    $("lesson-empty").style.display = ORDERED.length ? "none" : "";
    var streak = progress.getStreak();
    $("lesson-streak").textContent = "🔥 " + streak + (streak === 1 ? " día" : " días");
    $("lesson-points").textContent = "⭐ " + progress.getTotalPoints() + " puntos";
    $("opt-challenge").checked = progress.getChallenge();
    applyPinyinSetting();

    ORDERED.forEach(function (lesson, i) {
      var unlocked = progress.isUnlocked(lesson.id, IDS);
      var rec = progress.getLesson(lesson.id);
      var card = el("button", "lesson-card" + (unlocked ? "" : " locked"));
      card.type = "button";
      card.disabled = !unlocked;

      card.appendChild(el("div", "lesson-num", unlocked ? String(i + 1) : "🔒"));

      var body = el("div", "lesson-body");
      body.appendChild(el("div", "lesson-card-title", lesson.titulo));
      body.appendChild(el("div", "lesson-card-py py", lesson.titulo_pinyin || ""));
      body.appendChild(el("div", "lesson-card-es", lesson.titulo_es || ""));
      var meta = el("div", "lesson-card-meta");
      meta.appendChild(el("span", "lesson-stars", stars(rec.stars)));
      meta.appendChild(
        el(
          "span",
          "",
          lesson.vocabulario.length + " palabras" + (rec.bestXp ? " · mejor: " + rec.bestXp + " XP" : "")
        )
      );
      body.appendChild(meta);
      card.appendChild(body);

      if (unlocked) card.addEventListener("click", function () { start(lesson.id); });
      list.appendChild(card);
    });
  }

  function open() {
    syncTabs();
    renderList();
    showScreen("screen-lessons");
  }

  // ------------------------------------------------------------------ sesión

  function start(lessonId) {
    var lesson = ORDERED.filter(function (l) {
      return l.id === lessonId;
    })[0];
    if (!lesson) return;
    var exercises = E.buildSession(LESSONS, lessonId, {
      weights: progress.getFails(),
      canListen: canListen(),
    });
    if (!exercises.length) {
      alert("Esta lección aún no tiene suficiente contenido para generar ejercicios.");
      return;
    }
    ui.lesson = lesson;
    ui.session = S.create({ exercises: exercises, challenge: progress.getChallenge() });
    $("lesson-title").textContent = "Lección " + (IDS.indexOf(lessonId) + 1) + " · " + (lesson.titulo_es || lesson.titulo);
    $("lesson-timer").style.display = progress.getChallenge() ? "" : "none";
    showScreen("screen-lesson");
    renderExercise();
  }

  function renderHud() {
    var s = ui.session;
    var hearts = "";
    for (var i = 0; i < S.MAX_LIVES; i++) hearts += i < s.getLives() ? "❤️" : "🖤";
    $("lesson-hearts").textContent = hearts;
    $("lesson-progress-bar").style.width = Math.round(s.getProgress() * 100) + "%";
    $("lesson-xp").textContent = String(s.getXp());
    $("lesson-mult").textContent = "x" + s.getMultiplier().toFixed(1);
  }

  function stopTimer() {
    if (ui.timerId) clearTimeout(ui.timerId);
    if (ui.tickId) clearInterval(ui.tickId);
    ui.timerId = ui.tickId = null;
  }

  function startTimer() {
    stopTimer();
    if (!ui.session || !progress.getChallenge()) return;
    var bar = $("lesson-timer-bar");
    bar.classList.remove("low");
    bar.style.transition = "none";
    bar.style.width = "100%";
    void bar.offsetWidth;
    bar.style.transition = "width " + S.CHALLENGE_SECONDS + "s linear";
    bar.style.width = "0%";
    ui.startedAt = performance.now();
    ui.tickId = setInterval(function () {
      if (secondsLeft() <= 5) bar.classList.add("low");
    }, 250);
    ui.timerId = setTimeout(onTimeout, S.CHALLENGE_SECONDS * 1000);
  }

  function secondsLeft() {
    return Math.max(0, S.CHALLENGE_SECONDS - (performance.now() - ui.startedAt) / 1000);
  }

  function freezeTimer() {
    var left = secondsLeft();
    stopTimer();
    var bar = $("lesson-timer-bar");
    if (bar) {
      bar.style.transition = "none";
      bar.style.width = (left / S.CHALLENGE_SECONDS) * 100 + "%";
    }
    return left;
  }

  function renderExercise() {
    var cur = ui.session.current();
    if (!cur) return finishSession();
    ui.current = cur;
    ui.answered = false;
    ui.matchMistake = false;
    $("feedback").hidden = true;
    renderHud();

    var box = $("exercise");
    box.innerHTML = "";
    box.className = "exercise ex-" + cur.exercise.type;
    if (cur.isRetry) box.appendChild(el("div", "retry-badge", "Repaso de un ejercicio fallado"));

    var ex = cur.exercise;
    if (ex.type === "fill") renderFill(box, ex);
    else if (ex.type === "translate") renderTranslate(box, ex);
    else if (ex.type === "listen") renderListen(box, ex);
    else if (ex.type === "order") renderOrder(box, ex);
    else if (ex.type === "match") renderMatch(box, ex);

    startTimer();
  }

  // ------------------------------------------------------ ejercicios de elección

  function instruction(box, text) {
    box.appendChild(el("div", "ex-instruction", text));
  }

  function renderOptions(box, ex, longText) {
    var grid = el("div", "options-grid" + (longText ? " one-col" : ""));
    ex.options.forEach(function (o, i) {
      var b = el("button", "option-btn lesson-option");
      b.type = "button";
      b.appendChild(el("span", "opt-zh", o.text));
      if (o.sub) b.appendChild(el("span", "opt-py py", o.sub));
      b.addEventListener("click", function () {
        onChoice(i, b);
      });
      grid.appendChild(b);
    });
    box.appendChild(grid);
  }

  function renderFill(box, ex) {
    instruction(box, "Completa la frase");
    box.appendChild(el("div", "ex-sentence", ex.prompt));
    box.appendChild(el("div", "ex-hint", ex.hint));
    renderOptions(box, ex, false);
  }

  function renderTranslate(box, ex) {
    instruction(box, ex.subtype === "frase" ? "¿Cómo se dice en chino?" : "Elige la traducción al chino");
    box.appendChild(el("div", "ex-prompt-es", ex.prompt));
    renderOptions(box, ex, ex.subtype === "frase");
  }

  function renderListen(box, ex) {
    instruction(box, "Escucha y elige lo que oyes");
    var b = el("button", "listen-btn", "🔊");
    b.type = "button";
    b.setAttribute("aria-label", "Reproducir audio");
    b.addEventListener("click", function () {
      speak(ex.speak);
    });
    box.appendChild(b);
    renderOptions(box, ex, true);
    setTimeout(function () {
      speak(ex.speak);
    }, 250);
  }

  function onChoice(index, btn) {
    if (ui.answered) return;
    ui.answered = true;
    var ex = ui.current.exercise;
    var left = progress.getChallenge() ? freezeTimer() : 0;
    var ok = E.evaluate(ex, index);
    var buttons = document.querySelectorAll("#exercise .lesson-option");
    buttons.forEach(function (b, i) {
      b.disabled = true;
      if (ex.options[i].correct) b.classList.add("correct");
    });
    if (!ok) btn.classList.add("incorrect");
    finishExercise(ok, left, false);
  }

  // ------------------------------------------------------------------ ordenar

  function renderOrder(box, ex) {
    instruction(box, "Ordena las palabras para formar la frase");
    box.appendChild(el("div", "ex-hint big", ex.hint));
    var answer = el("div", "order-answer");
    answer.id = "order-answer";
    var pool = el("div", "order-pool");
    pool.id = "order-pool";
    box.appendChild(answer);
    box.appendChild(pool);
    var check = el("button", "btn-primary", "Comprobar");
    check.type = "button";
    check.id = "order-check";
    check.disabled = true;
    box.appendChild(check);

    var placed = [];
    var tileById = {};
    ex.tiles.forEach(function (t) {
      tileById[t.id] = t;
    });

    function draw() {
      answer.innerHTML = "";
      pool.innerHTML = "";
      placed.forEach(function (id) {
        var b = el("button", "tile placed", tileById[id].text);
        b.type = "button";
        b.addEventListener("click", function () {
          if (ui.answered) return;
          placed.splice(placed.indexOf(id), 1);
          draw();
        });
        answer.appendChild(b);
      });
      if (ex.endPunct && placed.length) answer.appendChild(el("span", "tile-punct", ex.endPunct));
      ex.tiles.forEach(function (t) {
        var b = el("button", "tile", t.text);
        b.type = "button";
        if (placed.indexOf(t.id) !== -1) {
          b.classList.add("used");
          b.disabled = true;
        }
        b.addEventListener("click", function () {
          if (ui.answered) return;
          placed.push(t.id);
          draw();
        });
        pool.appendChild(b);
      });
      check.disabled = placed.length !== ex.tiles.length;
    }

    check.addEventListener("click", function () {
      if (ui.answered) return;
      ui.answered = true;
      var left = progress.getChallenge() ? freezeTimer() : 0;
      var response = placed.map(function (id) {
        return tileById[id].text;
      });
      var ok = E.evaluate(ex, response);
      answer.classList.add(ok ? "correct" : "incorrect");
      pool.querySelectorAll(".tile").forEach(function (b) {
        b.disabled = true;
      });
      answer.querySelectorAll(".tile").forEach(function (b) {
        b.disabled = true;
      });
      check.hidden = true;
      finishExercise(ok, left, false);
    });

    draw();
  }

  // ---------------------------------------------------------------- emparejar

  function renderMatch(box, ex) {
    instruction(box, "Une el carácter, su pinyin y su significado");
    box.appendChild(el("div", "ex-hint", "Toca uno de cada columna"));
    var board = el("div", "match-board");
    var cols = [
      { key: "caracter", label: "Carácter", cls: "zh" },
      { key: "pinyin", label: "Pinyin", cls: "py-card" },
      { key: "significado", label: "Significado", cls: "" },
    ];
    var chosen = { caracter: null, pinyin: null, significado: null };
    var done = {};
    var doneCount = 0;
    var cards = {};

    cols.forEach(function (c) {
      var col = el("div", "match-col");
      col.appendChild(el("div", "match-col-title", c.label));
      ex.columns[c.key].forEach(function (item) {
        var b = el("button", "match-card " + c.cls, item[c.key]);
        b.type = "button";
        b.dataset.id = item.id;
        b.dataset.col = c.key;
        cards[c.key + ":" + item.id] = b;
        b.addEventListener("click", function () {
          if (ui.answered || done[item.id]) return;
          if (chosen[c.key]) cards[c.key + ":" + chosen[c.key]].classList.remove("sel");
          chosen[c.key] = chosen[c.key] === item.id ? null : item.id;
          if (chosen[c.key]) b.classList.add("sel");
          if (chosen.caracter && chosen.pinyin && chosen.significado) checkGroup();
        });
        col.appendChild(b);
      });
      board.appendChild(col);
    });
    box.appendChild(board);

    function checkGroup() {
      var group = { h: chosen.caracter, p: chosen.pinyin, m: chosen.significado };
      var ok = E.evaluate(ex, group);
      var involved = [cards["caracter:" + group.h], cards["pinyin:" + group.p], cards["significado:" + group.m]];
      chosen = { caracter: null, pinyin: null, significado: null };
      if (ok) {
        done[group.h] = true;
        doneCount++;
        involved.forEach(function (b) {
          b.classList.remove("sel");
          b.classList.add("done");
          b.disabled = true;
        });
        if (doneCount === ex.items.length) {
          ui.answered = true;
          var left = progress.getChallenge() ? freezeTimer() : 0;
          finishExercise(!ui.matchMistake, left, false);
        }
      } else {
        ui.matchMistake = true;
        involved.forEach(function (b) {
          b.classList.remove("sel");
          b.classList.add("wrong");
        });
        setTimeout(function () {
          involved.forEach(function (b) {
            b.classList.remove("wrong");
          });
        }, 450);
      }
    }
  }

  // ----------------------------------------------------- respuesta y feedback

  function flash(kind) {
    var overlay = $("flash-overlay");
    if (!overlay) return;
    overlay.className = "";
    void overlay.offsetWidth;
    overlay.classList.add("flash-" + kind);
  }

  function onTimeout() {
    if (ui.answered || !ui.session) return;
    ui.answered = true;
    stopTimer();
    var ex = ui.current.exercise;
    if (ex.options) {
      document.querySelectorAll("#exercise .lesson-option").forEach(function (b, i) {
        b.disabled = true;
        if (ex.options[i].correct) b.classList.add("correct");
      });
    } else if (ex.type === "order") {
      document.querySelectorAll("#exercise .tile, #order-check").forEach(function (b) {
        b.disabled = true;
      });
    } else if (ex.type === "match") {
      document.querySelectorAll("#exercise .match-card").forEach(function (b) {
        b.disabled = true;
      });
    }
    finishExercise(false, 0, true);
  }

  function correctAnswerText(ex) {
    if (ex.type === "order") return ex.answer.join(" ") + ex.endPunct;
    if (ex.type === "match") return "";
    var right = ex.options.filter(function (o) {
      return o.correct;
    })[0];
    return right ? right.text : "";
  }

  function finishExercise(ok, secondsLeft, timeout) {
    var result = ui.session.submit(ok, { secondsLeft: secondsLeft, timeout: timeout });
    var ex = ui.current.exercise;
    renderHud();
    flash(ok ? "correct" : "incorrect");

    var fb = $("feedback");
    fb.className = "feedback " + (ok ? "ok" : "bad");
    var status = ok
      ? "¡Correcto!" + (result.xp ? "  +" + result.xp + " XP" : "")
      : timeout
      ? "⏱ Se acabó el tiempo"
      : "Incorrecto";
    $("feedback-status").textContent = status;

    var detail = $("feedback-detail");
    detail.innerHTML = "";
    if (!ok) {
      var ans = correctAnswerText(ex);
      if (ans) detail.appendChild(el("div", "fb-answer", "Respuesta correcta: " + ans));
      if (result.failed) detail.appendChild(el("div", "fb-note", "Te quedaste sin vidas."));
      else detail.appendChild(el("div", "fb-note", "Lo repetiremos al final de la lección."));
    }
    detail.appendChild(el("div", "fb-explain", ex.explicacion || ""));

    var sp = $("feedback-speak");
    sp.hidden = !(canListen() && ex.speak);
    sp.onclick = function () {
      speak(ex.speak);
    };

    fb.hidden = false;
    var next = $("feedback-next");
    next.textContent = result.failed ? "Ver resultado" : "Continuar";
    setTimeout(function () {
      next.focus({ preventScroll: false });
      fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
  }

  $("feedback-next").addEventListener("click", function () {
    if (!ui.session) return;
    stopTimer();
    var next = ui.session.advance();
    if (!next) finishSession();
    else renderExercise();
  });

  // ------------------------------------------------------------------ resumen

  function finishSession() {
    stopTimer();
    if (speech.supported) window.speechSynthesis.cancel();
    var sum = ui.session.summary();
    var lessonId = ui.lesson.id;
    progress.recordSession(lessonId, sum);

    $("lesson-end-title").textContent = sum.failed ? "¡Te quedaste sin vidas!" : "¡Lección completada!";
    $("lesson-end-stars").textContent = stars(sum.stars);
    $("lesson-end-stars").className = "lesson-end-stars s" + sum.stars;

    var pct = Math.round(sum.accuracy * 100);
    $("lesson-end-summary").innerHTML =
      '<div><div class="stat-value">' + pct + '%</div><div class="stat-label">Precisión</div></div>' +
      '<div><div class="stat-value">' + sum.xp + '</div><div class="stat-label">XP ganado</div></div>' +
      '<div><div class="stat-value">' + sum.lives + '/' + S.MAX_LIVES + '</div><div class="stat-label">Vidas</div></div>' +
      '<div><div class="stat-value">' + progress.getTotalPoints() + '</div><div class="stat-label">Puntos totales</div></div>';

    var review = $("lesson-end-review");
    var vocab = {};
    ORDERED.forEach(function (l) {
      l.vocabulario.forEach(function (v) {
        if (!vocab[v.caracter]) vocab[v.caracter] = v;
      });
    });
    if (!sum.review.length) {
      review.innerHTML = "<h3>Caracteres a repasar</h3><p>¡Sin errores, nada que repasar!</p>";
    } else {
      var html = "<h3>Caracteres a repasar (" + sum.review.length + ")</h3>";
      sum.review.forEach(function (w) {
        var v = vocab[w];
        var meaning = v ? v.significado : "";
        var py = v ? v.pinyin : "";
        html +=
          '<div class="missed-row"><div class="missed-char">' + w + '</div><div class="missed-meaning"><span class="py">' +
          py + "</span> " + meaning + "</div></div>";
      });
      review.innerHTML = html;
    }

    var nextId = IDS[IDS.indexOf(lessonId) + 1];
    var back = $("lesson-end-back");
    back.textContent = !sum.failed && nextId && progress.isUnlocked(nextId, IDS) ? "Continuar a las lecciones" : "Volver a las lecciones";
    showScreen("screen-lesson-end");
  }

  $("lesson-end-back").addEventListener("click", open);
  $("lesson-end-retry").addEventListener("click", function () {
    if (ui.lesson) start(ui.lesson.id);
  });

  $("lesson-quit").addEventListener("click", function () {
    if (!ui.session) return open();
    if (window.confirm("¿Salir de la lección? Perderás el avance de esta sesión.")) {
      stopTimer();
      if (speech.supported) window.speechSynthesis.cancel();
      ui.session = null;
      open();
    }
  });

  // ------------------------------------------------------------------ ajustes

  $("opt-pinyin").addEventListener("change", function (e) {
    progress.setShowPinyin(e.target.checked);
    applyPinyinSetting();
  });
  $("opt-challenge").addEventListener("change", function (e) {
    progress.setChallenge(e.target.checked);
  });
  $("lesson-pinyin-toggle").addEventListener("click", function () {
    progress.setShowPinyin(!progress.getShowPinyin());
    applyPinyinSetting();
  });

  document.querySelectorAll('.mode-tab[data-mode="lesson"]').forEach(function (t) {
    t.addEventListener("click", open);
  });

  applyPinyinSetting();
  window.LessonUI = { open: open };
})();
