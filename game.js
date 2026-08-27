(function () {
  "use strict";

  const ALL_CHARS = LEVELS.flatMap((lvl) => lvl.chars);

  const ROUND_SECONDS = 10;
  const FEEDBACK_DELAY_MS = 1200;
  const SUBLEVEL_SIZE = 30;

  // --- Elementos DOM ---
  const screens = {
    setup: document.getElementById("screen-setup"),
    game: document.getElementById("screen-game"),
    end: document.getElementById("screen-end"),
    review: document.getElementById("screen-review"),
  };

  const modeTabs = document.querySelectorAll(".mode-tab");
  const modeSubtitle = document.getElementById("mode-subtitle");
  const playOptions = document.getElementById("play-options");

  const levelListEl = document.getElementById("level-list");
  const btnBackLevel = document.getElementById("btn-back-level");
  const levelSubtitle = document.getElementById("level-subtitle");
  const qtyInput = document.getElementById("qty-input");
  const qtyRadios = document.getElementsByName("qty-mode");
  const btnStart = document.getElementById("btn-start");
  const setupError = document.getElementById("setup-error");

  const btnReviewBack = document.getElementById("btn-review-back");
  const reviewTitle = document.getElementById("review-title");
  const reviewList = document.getElementById("review-list");

  const progressLabel = document.getElementById("progress-label");
  const levelLabel = document.getElementById("level-label");
  const scoreLabel = document.getElementById("score-label");
  const multiplierLabel = document.getElementById("multiplier-label");
  const btnQuit = document.getElementById("btn-quit");
  const timerBar = document.getElementById("timer-bar");
  const characterBig = document.getElementById("character-big");
  const optionsGrid = document.getElementById("options-grid");

  const endSummary = document.getElementById("end-summary");
  const endMissed = document.getElementById("end-missed");
  const btnAgain = document.getElementById("btn-again");

  const flashOverlay = document.getElementById("flash-overlay");

  // --- Estado de configuración ---
  let mode = "play"; // "play" | "review"
  let selectedLevelId = null; // number | "all"
  let selectedLevelName = "";
  let selectedRange = null; // { start, end } (índices) cuando se elige un subnivel
  let browsingLevel = null; // nivel cuyos subniveles se están mostrando

  // --- Estado de partida ---
  let pool = [];
  let queue = [];
  let lastChar = null;
  let isInfinite = false;
  let totalQuestions = 0;
  let currentIndex = 0;
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let timeoutCount = 0;
  let missedList = [];
  let currentTarget = null;
  let roundTimeoutId = null;
  let lowTimeoutId = null;
  let advanceTimeoutId = null;
  let quitting = false;
  let roundStartTime = 0;
  let multiplier = 1;

  // --- Estado de música ---
  let musicQueue = [];
  let currentAudio = null;

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  // --- Configuración: niveles y subniveles ---
  function getSublevels(lvl) {
    const ranges = [];
    for (let start = 0; start < lvl.chars.length; start += SUBLEVEL_SIZE) {
      ranges.push({ start, end: Math.min(start + SUBLEVEL_SIZE, lvl.chars.length) });
    }
    return ranges;
  }

  function renderTopLevels() {
    browsingLevel = null;
    btnBackLevel.style.display = "none";
    levelSubtitle.style.display = "none";
    levelListEl.innerHTML = "";

    LEVELS.forEach((lvl) => {
      const sublevels = getSublevels(lvl);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-btn";
      btn.dataset.levelId = String(lvl.id);
      btn.innerHTML = `<strong>${lvl.name}</strong><small>${lvl.chars.length} caracteres</small>`;
      btn.addEventListener("click", () => {
        if (sublevels.length > 1) {
          renderSublevels(lvl);
        } else {
          selectWholeLevel(lvl);
        }
      });
      levelListEl.appendChild(btn);
    });

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "level-btn";
    allBtn.dataset.levelId = "all";
    allBtn.innerHTML = `<strong>Todos los niveles</strong><small>${ALL_CHARS.length} caracteres (mixto)</small>`;
    allBtn.addEventListener("click", () => selectLevel("all", "Todos los niveles", null));
    levelListEl.appendChild(allBtn);

    highlightSelection();
  }

  function renderSublevels(lvl) {
    browsingLevel = lvl;
    btnBackLevel.style.display = "";
    levelSubtitle.style.display = "";
    levelSubtitle.textContent = `${lvl.name} · elige un subnivel`;
    levelListEl.innerHTML = "";

    getSublevels(lvl).forEach((range, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-btn";
      btn.dataset.levelId = String(lvl.id);
      btn.dataset.subStart = String(range.start);
      const count = range.end - range.start;
      btn.innerHTML = `<strong>Subnivel ${i + 1}</strong><small>Caracteres ${range.start + 1}–${range.end} (${count})</small>`;
      btn.addEventListener("click", () => {
        const name = `${lvl.name} · Subnivel ${i + 1} (${range.start + 1}–${range.end})`;
        selectLevel(lvl.id, name, range);
      });
      levelListEl.appendChild(btn);
    });

    highlightSelection();
  }

  function highlightSelection() {
    document.querySelectorAll(".level-btn").forEach((b) => {
      const matchesLevel = b.dataset.levelId === String(selectedLevelId);
      const matchesRange = selectedRange
        ? Number(b.dataset.subStart) === selectedRange.start
        : b.dataset.subStart === undefined;
      b.classList.toggle("selected", matchesLevel && matchesRange);
    });
  }

  function selectWholeLevel(lvl) {
    selectLevel(lvl.id, lvl.name, null);
  }

  function selectLevel(id, name, range) {
    selectedLevelId = id;
    selectedLevelName = name;
    selectedRange = range;

    if (mode === "review") {
      showReview(getPool(id, range), name);
      return;
    }

    highlightSelection();
    updateStartButtonState();
  }

  btnBackLevel.addEventListener("click", renderTopLevels);

  // --- Modo Jugar / Repaso ---
  function setMode(newMode) {
    mode = newMode;
    modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === newMode));
    playOptions.style.display = newMode === "review" ? "none" : "";
    modeSubtitle.textContent =
      newMode === "review"
        ? "Elige un nivel para ver sus caracteres, como un diccionario."
        : "Elige un nivel de dificultad y la cantidad de caracteres para tu partida.";
    setupError.textContent = "";
    renderTopLevels();
  }

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  // --- Pantalla de repaso ---
  function showReview(chars, name) {
    reviewTitle.textContent = name;
    reviewList.innerHTML = chars
      .map(
        (c) => `
        <div class="review-row">
          <div class="review-char">${c.char}</div>
          <div class="review-info">
            <div class="review-pinyin">${c.pinyin}</div>
            <div class="review-meaning">${c.meaning}</div>
          </div>
        </div>`
      )
      .join("");
    showScreen("review");
  }

  btnReviewBack.addEventListener("click", () => {
    showScreen("setup");
    if (browsingLevel) {
      renderSublevels(browsingLevel);
    } else {
      renderTopLevels();
    }
  });

  function getPool(id, range) {
    let chars;
    if (id === "all") {
      chars = ALL_CHARS;
    } else {
      const lvl = LEVELS.find((l) => l.id === id);
      chars = lvl ? lvl.chars : [];
    }
    if (range) return chars.slice(range.start, range.end);
    return chars.slice();
  }

  function currentQtyMode() {
    for (const r of qtyRadios) if (r.checked) return r.value;
    return "fixed";
  }

  function updateStartButtonState() {
    let ok = selectedLevelId !== null;
    if (currentQtyMode() === "fixed") {
      const n = parseInt(qtyInput.value, 10);
      if (!Number.isInteger(n) || n < 1) ok = false;
    }
    btnStart.disabled = !ok;
    setupError.textContent = "";
  }

  qtyInput.addEventListener("input", updateStartButtonState);
  for (const r of qtyRadios) {
    r.addEventListener("change", () => {
      qtyInput.disabled = currentQtyMode() === "infinite";
      updateStartButtonState();
    });
  }

  // --- Utilidades ---
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function stopMusic() {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.pause();
      currentAudio = null;
    }
    musicQueue = [];
  }

  function playTrack(src, loop) {
    const audio = new Audio(src);
    audio.volume = 0.5;
    audio.loop = loop;
    audio.play().catch(() => {});
    return audio;
  }

  function playNextInQueue() {
    if (musicQueue.length === 0) musicQueue = shuffle(MUSIC_TRACKS);
    const track = musicQueue.shift();
    currentAudio = playTrack(track, false);
    currentAudio.onended = playNextInQueue;
  }

  function startMusic() {
    if (typeof MUSIC_TRACKS === "undefined" || MUSIC_TRACKS.length === 0) return;

    if (isInfinite) {
      musicQueue = shuffle(MUSIC_TRACKS);
      playNextInQueue();
    } else {
      const track = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)];
      currentAudio = playTrack(track, true);
    }
  }

  function nextChar() {
    if (queue.length === 0) {
      queue = shuffle(pool);
      if (queue.length > 1 && queue[queue.length - 1].char === lastChar) {
        [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
      }
    }
    const item = queue.pop();
    lastChar = item.char;
    return item;
  }

  function buildOptions(target) {
    const others = pool.filter((c) => c.char !== target.char);
    const shuffledOthers = shuffle(others);
    const distractors = [];
    const usedMeanings = new Set([target.meaning]);

    for (const c of shuffledOthers) {
      if (distractors.length >= 3) break;
      if (usedMeanings.has(c.meaning)) continue;
      distractors.push(c);
      usedMeanings.add(c.meaning);
    }

    if (distractors.length < 3) {
      const fallback = shuffle(ALL_CHARS.filter((c) => c.char !== target.char));
      for (const c of fallback) {
        if (distractors.length >= 3) break;
        if (usedMeanings.has(c.meaning)) continue;
        distractors.push(c);
        usedMeanings.add(c.meaning);
      }
    }

    return shuffle([target, ...distractors]);
  }

  // --- Flujo de partida ---
  btnStart.addEventListener("click", () => {
    if (btnStart.disabled) return;
    pool = getPool(selectedLevelId, selectedRange);
    if (pool.length < 1) {
      setupError.textContent = "Este nivel no tiene suficientes caracteres.";
      return;
    }

    isInfinite = currentQtyMode() === "infinite";
    totalQuestions = isInfinite ? Infinity : parseInt(qtyInput.value, 10);

    queue = [];
    lastChar = null;
    currentIndex = 0;
    score = 0;
    correctCount = 0;
    wrongCount = 0;
    timeoutCount = 0;
    missedList = [];
    quitting = false;
    multiplier = 1;

    levelLabel.textContent = selectedLevelName;
    scoreLabel.textContent = "0";
    updateMultiplierLabel();

    startMusic();
    showScreen("game");
    startRound();
  });

  function startRound() {
    if (!isInfinite && currentIndex >= totalQuestions) {
      endGame();
      return;
    }
    currentIndex++;

    progressLabel.textContent = isInfinite
      ? `Pregunta ${currentIndex}`
      : `Pregunta ${currentIndex} / ${totalQuestions}`;

    currentTarget = nextChar();
    characterBig.textContent = currentTarget.char;

    const options = buildOptions(currentTarget);
    optionsGrid.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";
      btn.textContent = `${opt.meaning} (${opt.pinyin})`;
      btn.dataset.correct = String(opt.char === currentTarget.char);
      btn.addEventListener("click", () => handleAnswer(btn, opt.char === currentTarget.char));
      optionsGrid.appendChild(btn);
    });

    resetTimerBar();
    roundTimeoutId = setTimeout(handleTimeout, ROUND_SECONDS * 1000);
  }

  function resetTimerBar() {
    timerBar.classList.remove("low");
    timerBar.style.transition = "none";
    timerBar.style.width = "100%";
    // Forzar reflow para que el navegador aplique el 100% antes de animar.
    void timerBar.offsetWidth;
    timerBar.style.transition = `width ${ROUND_SECONDS}s linear`;
    timerBar.style.width = "0%";
    roundStartTime = performance.now();
    lowTimeoutId = setTimeout(() => timerBar.classList.add("low"), (ROUND_SECONDS - 3) * 1000);
  }

  function getRemainingSeconds() {
    const elapsed = (performance.now() - roundStartTime) / 1000;
    return Math.max(0, ROUND_SECONDS - elapsed);
  }

  function freezeTimerBar() {
    const pct = (getRemainingSeconds() / ROUND_SECONDS) * 100;
    timerBar.style.transition = "none";
    timerBar.style.width = `${pct}%`;
    if (lowTimeoutId !== null) {
      clearTimeout(lowTimeoutId);
      lowTimeoutId = null;
    }
  }

  function clearRoundTimer() {
    if (roundTimeoutId !== null) {
      clearTimeout(roundTimeoutId);
      roundTimeoutId = null;
    }
  }

  function updateMultiplierLabel() {
    multiplierLabel.textContent = `x${multiplier.toFixed(1)}`;
  }

  function disableOptions() {
    optionsGrid.querySelectorAll(".option-btn").forEach((b) => (b.disabled = true));
  }

  function markCorrectOption() {
    const correctBtn = optionsGrid.querySelector('.option-btn[data-correct="true"]');
    if (correctBtn) correctBtn.classList.add("correct");
  }

  function flashScreen(kind) {
    flashOverlay.className = "";
    void flashOverlay.offsetWidth;
    flashOverlay.classList.add(`flash-${kind}`);
  }

  function handleAnswer(button, isCorrect) {
    clearRoundTimer();
    disableOptions();
    freezeTimerBar();

    if (isCorrect) {
      const remaining = getRemainingSeconds();
      const basePoints = Math.max(1, Math.min(ROUND_SECONDS, Math.ceil(remaining)));
      const earned = Math.round(basePoints * multiplier);

      button.classList.add("correct");
      score += earned;
      correctCount++;
      scoreLabel.textContent = String(score);
      multiplier = Math.round((multiplier + 0.2) * 10) / 10;
      updateMultiplierLabel();
      flashScreen("correct");
    } else {
      button.classList.add("incorrect");
      markCorrectOption();
      wrongCount++;
      missedList.push(currentTarget);
      multiplier = 1;
      updateMultiplierLabel();
      flashScreen("incorrect");
    }

    advanceTimeoutId = setTimeout(proceed, FEEDBACK_DELAY_MS);
  }

  function handleTimeout() {
    roundTimeoutId = null;
    disableOptions();
    freezeTimerBar();
    markCorrectOption();
    timeoutCount++;
    missedList.push(currentTarget);
    multiplier = 1;
    updateMultiplierLabel();
    flashScreen("neutral");

    advanceTimeoutId = setTimeout(proceed, FEEDBACK_DELAY_MS);
  }

  function proceed() {
    if (quitting) return;
    startRound();
  }

  btnQuit.addEventListener("click", () => {
    quitting = true;
    clearRoundTimer();
    if (advanceTimeoutId !== null) {
      clearTimeout(advanceTimeoutId);
      advanceTimeoutId = null;
    }
    endGame();
  });

  function endGame() {
    stopMusic();
    showScreen("end");
    const answered = correctCount + wrongCount + timeoutCount;
    const accuracy = answered > 0 ? Math.round((correctCount / answered) * 100) : 0;

    endSummary.innerHTML = `
      <div><div class="stat-value">${score}</div><div class="stat-label">Puntos</div></div>
      <div><div class="stat-value">${correctCount}</div><div class="stat-label">Correctas</div></div>
      <div><div class="stat-value">${wrongCount}</div><div class="stat-label">Incorrectas</div></div>
      <div><div class="stat-value">${timeoutCount}</div><div class="stat-label">Sin responder</div></div>
      <div><div class="stat-value">${accuracy}%</div><div class="stat-label">Precisión</div></div>
    `;

    if (missedList.length === 0) {
      endMissed.innerHTML = "<h3>Repaso</h3><p>¡Sin errores, partida perfecta!</p>";
    } else {
      const rows = missedList
        .map(
          (c) =>
            `<div class="missed-row"><div class="missed-char">${c.char}</div><div class="missed-meaning">${c.meaning} (${c.pinyin})</div></div>`
        )
        .join("");
      endMissed.innerHTML = `<h3>Caracteres para repasar (${missedList.length})</h3>${rows}`;
    }
  }

  btnAgain.addEventListener("click", () => {
    showScreen("setup");
    setupError.textContent = "";
    renderTopLevels();
  });

  // --- Inicialización ---
  renderTopLevels();
  updateStartButtonState();
})();
