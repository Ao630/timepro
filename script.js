/**
 * TIMEPRO — script.js
 * Production-grade study timer application
 * Vanilla JS, no dependencies
 */

'use strict';

/* =====================================================================
   CONSTANTS & CONFIGURATION
   ===================================================================== */

const STORAGE_KEY   = 'timepro_v2';
const RING_RADIUS   = 120;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 754.0

const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];

/* =====================================================================
   STATE
   ===================================================================== */

let state = {
  // Tab
  activeTab: 'timer',

  // Normal Timer
  timer: {
    running:    false,
    startEpoch: null,   // Date.now() when started
    remaining:  0,      // seconds remaining at start
    total:      0,      // total seconds for this session
    rafId:      null,
  },

  // Pomodoro
  pom: {
    running:      false,
    isBreak:      false,
    startEpoch:   null,
    remaining:    0,
    total:        0,
    sessionsDone: 0,
    cycle:        0,    // cycles completed this run (4 = long break)
    rafId:        null,
    workMin:      25,
    breakMin:     5,
  },

  // Persisted data
  data: {
    totalSeconds:  0,
    todaySeconds:  0,
    todayDate:     '',   // 'YYYY-MM-DD'
    pomCount:      0,
    streak:        0,
    lastActiveDate:'',
    weekly:        {},   // { 'YYYY-MM-DD': seconds }
    logs:          [],   // [{ id, timestamp, duration, text }]
  },
};

/* =====================================================================
   STORAGE
   ===================================================================== */

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.data = Object.assign(state.data, parsed);
      }
    }
  } catch (e) {
    console.warn('Failed to load data from localStorage:', e);
  }
  // Reset today's seconds if date changed
  const today = todayStr();
  if (state.data.todayDate !== today) {
    state.data.todaySeconds = 0;
    state.data.todayDate = today;
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (e) {
    console.warn('Failed to save data to localStorage:', e);
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* =====================================================================
   AUDIO — Web Audio API beep (no file dependency)
   ===================================================================== */

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { /* audio not supported */ }
  }
  return audioCtx;
}

function playBeep(frequency = 880, duration = 0.15, volume = 0.3) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    // Resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration + 0.05);
  } catch(e) { /* silently ignore */ }
}

function playCompletionSound() {
  // Pleasant tri-tone chord sequence
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playBeep(freq, 0.3, 0.25), i * 80);
  });
}

function playTickSound() {
  playBeep(220, 0.04, 0.06);
}

/* =====================================================================
   NOTIFICATIONS
   ===================================================================== */

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function sendNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '', tag: 'timepro' });
    } catch(e) { /* silently ignore */ }
  }
}

/* =====================================================================
   CANVAS — DOT RAIN
   ===================================================================== */

const canvas = document.getElementById('bgCanvas');
const ctx2d   = canvas ? canvas.getContext('2d') : null;

const rain = {
  drops:   [],
  rafId:   null,
  running: false,
  cols:    0,
  SPEED:   1.5,
  DENSITY: 0.02,
};

function initCanvas() {
  if (!canvas) return;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  rain.cols = Math.floor(canvas.width / 14);
  rain.drops = [];
  for (let i = 0; i < rain.cols; i++) {
    // Stagger starting positions
    rain.drops.push(Math.random() * -canvas.height / 8);
  }
}

function drawRain() {
  if (!ctx2d || !canvas) return;
  // Semi-transparent clear for trail effect
  ctx2d.fillStyle = 'rgba(10, 10, 15, 0.2)';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  const colW = canvas.width / rain.cols;
  ctx2d.font = '10px monospace';

  for (let i = 0; i < rain.drops.length; i++) {
    const y = rain.drops[i] * 14;
    const x = i * colW;

    // Dot pixel character
    const brightness = 0.3 + 0.7 * Math.random();
    ctx2d.fillStyle = `rgba(108, 99, 255, ${brightness * 0.5})`;
    ctx2d.fillRect(x + 4, y, 4, 4);

    // Leading bright dot
    if (rain.drops[i] > 0) {
      ctx2d.fillStyle = `rgba(180, 170, 255, ${brightness})`;
      ctx2d.fillRect(x + 4, y - 2, 4, 4);
    }

    // Reset drop randomly after it goes off screen
    if (y > canvas.height && Math.random() > 1 - rain.DENSITY) {
      rain.drops[i] = 0;
    }
    rain.drops[i] += rain.SPEED;
  }
}

function startRain() {
  if (rain.running) return;
  rain.running = true;
  canvas.classList.add('active');
  const loop = () => {
    drawRain();
    rain.rafId = requestAnimationFrame(loop);
  };
  rain.rafId = requestAnimationFrame(loop);
}

function stopRain() {
  if (!rain.running) return;
  rain.running = false;
  canvas.classList.remove('active');
  cancelAnimationFrame(rain.rafId);
  if (ctx2d && canvas) {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* =====================================================================
   DOM HELPERS
   ===================================================================== */

function $(id) { return document.getElementById(id); }

function formatTime(secs) {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatShortTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function updateRing(ringEl, remaining, total) {
  if (!ringEl) return;
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 1;
  const offset = RING_CIRCUMFERENCE * (1 - ratio);
  ringEl.style.strokeDashoffset = offset;
}

/* =====================================================================
   NORMAL TIMER
   ===================================================================== */

const timerEl = {
  display:   $('timerDisplay'),
  label:     $('timerLabel'),
  ring:      $('timerRing'),
  startBtn:  $('timerStartBtn'),
  resetBtn:  $('timerResetBtn'),
  logBtn:    $('timerLogBtn'),
  inputMin:  $('inputMin'),
  inputSec:  $('inputSec'),
};

function getTimerInputSeconds() {
  const rawMin = parseInt(timerEl.inputMin.value, 10);
  const rawSec = parseInt(timerEl.inputSec.value, 10);
  const min = isNaN(rawMin) || rawMin < 0 ? 0 : Math.min(rawMin, 99);
  const sec = isNaN(rawSec) || rawSec < 0 ? 0 : Math.min(rawSec, 59);
  return min * 60 + sec;
}

function updateTimerUI(remaining) {
  timerEl.display.textContent = formatTime(remaining);
  updateRing(timerEl.ring, remaining, state.timer.total);
}

function timerTick() {
  if (!state.timer.running) return;
  const elapsed  = Math.floor((Date.now() - state.timer.startEpoch) / 1000);
  const remaining = Math.max(0, state.timer.remaining - elapsed);

  updateTimerUI(remaining);

  if (remaining <= 0) {
    timerComplete();
    return;
  }
  state.timer.rafId = requestAnimationFrame(timerTick);
}

function timerStart() {
  const total = getTimerInputSeconds();
  if (total <= 0) return;

  if (state.timer.running) {
    // Pause
    const elapsed = Math.floor((Date.now() - state.timer.startEpoch) / 1000);
    state.timer.remaining = Math.max(0, state.timer.remaining - elapsed);
    state.timer.running = false;
    cancelAnimationFrame(state.timer.rafId);
    stopRain();
    timerEl.label.textContent = '一時停止中';
    setStartBtnState(timerEl.startBtn, false);
    document.body.classList.remove('timer-running');
  } else {
    // Start / Resume
    if (state.timer.remaining === 0) {
      // Fresh start
      state.timer.total     = total;
      state.timer.remaining = total;
    }
    state.timer.startEpoch = Date.now();
    state.timer.running    = true;
    timerEl.label.textContent = 'タイマー稼働中';
    setStartBtnState(timerEl.startBtn, true);
    startRain();
    document.body.classList.add('timer-running');
    // Resume AudioContext on first user interaction
    getAudioCtx();
    requestAnimationFrame(timerTick);
  }
}

function timerReset() {
  cancelAnimationFrame(state.timer.rafId);
  state.timer.running    = false;
  state.timer.remaining  = 0;
  state.timer.startEpoch = null;
  stopRain();
  setStartBtnState(timerEl.startBtn, false);
  timerEl.label.textContent = '準備完了';
  timerEl.display.textContent = formatTime(getTimerInputSeconds());
  updateRing(timerEl.ring, 1, 1);
  document.body.classList.remove('timer-running');
}

function timerComplete() {
  cancelAnimationFrame(state.timer.rafId);
  state.timer.running = false;
  stopRain();
  setStartBtnState(timerEl.startBtn, false);
  timerEl.display.textContent = '00:00';
  timerEl.label.textContent = '完了！';
  updateRing(timerEl.ring, 0, state.timer.total);
  document.body.classList.remove('timer-running');

  const sessionSecs = state.timer.total;
  playCompletionSound();
  sendNotification('Timepro', `タイマー完了！ ${formatDuration(sessionSecs)} お疲れ様でした！`);
  showAchievement('🎉', '完了！');
  addStudyTime(sessionSecs);
  showLogModal(sessionSecs, false);
  state.timer.remaining = 0;
}

// Sync input display when user changes values
function syncTimerDisplay() {
  if (!state.timer.running && state.timer.remaining === 0) {
    const t = getTimerInputSeconds();
    timerEl.display.textContent = formatTime(t);
    updateRing(timerEl.ring, 1, 1);
  }
}

/* =====================================================================
   POMODORO TIMER
   ===================================================================== */

const pomEl = {
  display:    $('pomDisplay'),
  label:      $('pomLabel'),
  ring:       $('pomRing'),
  startBtn:   $('pomStartBtn'),
  resetBtn:   $('pomResetBtn'),
  skipBtn:    $('pomSkipBtn'),
  stateBadge: $('pomStateBadge'),
  stateText:  $('pomStateText'),
  sessionCount: $('pomSessionCount'),
  dots:       $('pomDots'),
  workMin:    $('pomWorkMin'),
  breakMin:   $('pomBreakMin'),
};

function getPomWorkSecs()  { return Math.max(1, parseInt(pomEl.workMin.value,10)  || 25) * 60; }
function getPomBreakSecs() { return Math.max(1, parseInt(pomEl.breakMin.value,10) || 5)  * 60; }

function updatePomUI(remaining) {
  pomEl.display.textContent = formatTime(remaining);
  updateRing(pomEl.ring, remaining, state.pom.total);
}

function pomTick() {
  if (!state.pom.running) return;
  const elapsed   = Math.floor((Date.now() - state.pom.startEpoch) / 1000);
  const remaining = Math.max(0, state.pom.remaining - elapsed);
  updatePomUI(remaining);
  if (remaining <= 0) {
    pomPhaseComplete();
    return;
  }
  state.pom.rafId = requestAnimationFrame(pomTick);
}

function pomStart() {
  if (state.pom.running) {
    // Pause
    const elapsed = Math.floor((Date.now() - state.pom.startEpoch) / 1000);
    state.pom.remaining = Math.max(0, state.pom.remaining - elapsed);
    state.pom.running = false;
    cancelAnimationFrame(state.pom.rafId);
    stopRain();
    pomEl.label.textContent = '一時停止中';
    setStartBtnState(pomEl.startBtn, false);
    document.body.classList.remove('timer-running');
  } else {
    // Start / Resume
    if (state.pom.remaining === 0) {
      const secs = state.pom.isBreak ? getPomBreakSecs() : getPomWorkSecs();
      state.pom.total     = secs;
      state.pom.remaining = secs;
    }
    state.pom.startEpoch = Date.now();
    state.pom.running    = true;
    const labelText = state.pom.isBreak ? '休憩中...' : '作業中...';
    pomEl.label.textContent = labelText;
    setStartBtnState(pomEl.startBtn, true);
    startRain();
    document.body.classList.add('timer-running');
    getAudioCtx();
    requestAnimationFrame(pomTick);
  }
}

function pomReset() {
  cancelAnimationFrame(state.pom.rafId);
  state.pom.running     = false;
  state.pom.remaining   = 0;
  state.pom.isBreak     = false;
  state.pom.startEpoch  = null;
  state.pom.sessionsDone = 0;
  state.pom.cycle       = 0;
  stopRain();
  setStartBtnState(pomEl.startBtn, false);
  pomEl.label.textContent = 'スタート待機中';
  pomEl.stateText.textContent = '作業中';
  pomEl.stateBadge.classList.remove('break');
  pomEl.sessionCount.textContent = '0';
  updatePomUI(getPomWorkSecs());
  updatePomDots(0);
  updateRing(pomEl.ring, 1, 1);
  document.body.classList.remove('timer-running');
}

function pomSkip() {
  cancelAnimationFrame(state.pom.rafId);
  const wasRunning = state.pom.running;
  state.pom.running = false;
  state.pom.remaining = 0;
  if (wasRunning) startRain(); // keep rain during transition
  pomPhaseComplete(true);
}

function pomPhaseComplete(skipped = false) {
  cancelAnimationFrame(state.pom.rafId);
  state.pom.running = false;

  if (!state.pom.isBreak) {
    // Work phase done
    if (!skipped) {
      const sessionSecs = state.pom.total;
      addStudyTime(sessionSecs);
      state.data.pomCount++;
      state.pom.sessionsDone++;
      state.pom.cycle++;
      saveData();
      updateStatsUI();
      updateHeaderStats();
      showAchievement('🍅', 'ポモドーロ完了！');
      playCompletionSound();
      sendNotification('Timepro', '作業セッション完了！休憩しましょう。');
      showLogModal(sessionSecs, true);
    }
    // Switch to break
    state.pom.isBreak = true;
    pomEl.stateText.textContent = '休憩中';
    pomEl.stateBadge.classList.add('break');
    pomEl.sessionCount.textContent = state.pom.sessionsDone;
    updatePomDots(state.pom.cycle % 4);
    const breakSecs = getPomBreakSecs();
    state.pom.total     = breakSecs;
    state.pom.remaining = breakSecs;
    updatePomUI(breakSecs);
    pomEl.label.textContent = 'スタート待機中';
    setStartBtnState(pomEl.startBtn, false);
    stopRain();
    document.body.classList.remove('timer-running');
  } else {
    // Break phase done
    if (!skipped) {
      playBeep(660, 0.2, 0.2);
      sendNotification('Timepro', '休憩終了！次のセッションを始めましょう。');
    }
    state.pom.isBreak = false;
    pomEl.stateText.textContent = '作業中';
    pomEl.stateBadge.classList.remove('break');
    const workSecs = getPomWorkSecs();
    state.pom.total     = workSecs;
    state.pom.remaining = workSecs;
    updatePomUI(workSecs);
    pomEl.label.textContent = 'スタート待機中';
    setStartBtnState(pomEl.startBtn, false);
    stopRain();
    document.body.classList.remove('timer-running');
  }
}

function updatePomDots(filled) {
  const dots = pomEl.dots.querySelectorAll('.pom-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < (filled % 4));
  });
}

/* =====================================================================
   SHARED UI HELPERS
   ===================================================================== */

function setStartBtnState(btn, running) {
  if (!btn) return;
  const play  = btn.querySelector('.icon-play');
  const pause = btn.querySelector('.icon-pause');
  if (play)  play.style.display  = running ? 'none' : 'block';
  if (pause) pause.style.display = running ? 'block' : 'none';
}

/* =====================================================================
   STUDY TIME TRACKING
   ===================================================================== */

function addStudyTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return;
  const today = todayStr();
  state.data.totalSeconds += seconds;
  if (state.data.todayDate === today) {
    state.data.todaySeconds += seconds;
  } else {
    state.data.todayDate    = today;
    state.data.todaySeconds = seconds;
  }
  // Weekly
  if (!state.data.weekly) state.data.weekly = {};
  state.data.weekly[today] = (state.data.weekly[today] || 0) + seconds;

  // Streak calculation
  updateStreak(today);
  saveData();
  updateStatsUI();
  updateHeaderStats();
}

function updateStreak(today) {
  if (state.data.lastActiveDate === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
  if (state.data.lastActiveDate === yStr || state.data.lastActiveDate === '') {
    state.data.streak = (state.data.streak || 0) + 1;
  } else {
    state.data.streak = 1;
  }
  state.data.lastActiveDate = today;
}

/* =====================================================================
   LOG MODAL
   ===================================================================== */

let _pendingLogData = null;

function showLogModal(durationSecs, isPom) {
  const overlay = $('logModal');
  const input   = $('logInput');
  const durEl   = $('modalDuration');
  const subEl   = $('modalSubtitle');
  if (!overlay) return;

  _pendingLogData = { durationSecs, isPom };
  durEl.textContent = `学習時間: ${formatDuration(durationSecs)}`;
  subEl.textContent = isPom ? '🍅 ポモドーロ完了！お疲れ様でした！' : 'タイマー完了！お疲れ様でした！';
  input.value = '';
  overlay.classList.add('open');

  // Focus textarea after animation
  setTimeout(() => { try { input.focus(); } catch(e) {} }, 450);
}

function hideLogModal() {
  const overlay = $('logModal');
  if (overlay) overlay.classList.remove('open');
  _pendingLogData = null;
}

function saveLog() {
  if (!_pendingLogData) { hideLogModal(); return; }
  const text = ($('logInput').value || '').trim();
  const { durationSecs } = _pendingLogData;
  const entry = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    duration:  durationSecs,
    text:      text || '（記録なし）',
  };
  if (!Array.isArray(state.data.logs)) state.data.logs = [];
  state.data.logs.unshift(entry);
  if (state.data.logs.length > 100) state.data.logs = state.data.logs.slice(0, 100);
  saveData();
  renderLogList();
  hideLogModal();
}

/* =====================================================================
   ACHIEVEMENT OVERLAY + CONFETTI
   ===================================================================== */

let _achievementTimeout = null;

function showAchievement(emoji, text) {
  const overlay = $('achievementOverlay');
  const emojiEl = $('achievementEmoji');
  const textEl  = $('achievementText');
  if (!overlay) return;

  emojiEl.textContent = emoji;
  textEl.textContent  = text;
  overlay.classList.add('show');

  clearTimeout(_achievementTimeout);
  _achievementTimeout = setTimeout(() => {
    overlay.classList.remove('show');
  }, 2200);

  launchConfetti();
}

function launchConfetti() {
  const colors = ['#6c63ff', '#ff6584', '#00e5a0', '#ffb347', '#fff'];
  const count  = 40;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    el.style.cssText = `
      left: ${Math.random() * 100}vw;
      top: ${Math.random() * 30 - 10}vh;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${4 + Math.random() * 8}px;
      height: ${4 + Math.random() * 8}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration: ${1.5 + Math.random() * 2}s;
      animation-delay: ${Math.random() * 0.5}s;
      transform-origin: center;
    `;
    document.body.appendChild(el);
    // Cleanup after animation
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

/* =====================================================================
   STATS UI
   ===================================================================== */

function updateStatsUI() {
  const d = state.data;
  setText('statTotalTime',  formatShortTime(d.totalSeconds  || 0));
  setText('statTodayTime',  formatShortTime(d.todaySeconds  || 0));
  setText('statPomCount',   d.pomCount   || 0);
  setText('statStreak',     d.streak     || 0);
  renderWeeklyChart();
  renderLogList();
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function renderWeeklyChart() {
  const barsEl   = $('weeklyBars');
  const labelsEl = $('weeklyLabels');
  if (!barsEl || !labelsEl) return;

  const today = new Date();
  const days  = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    days.push({ key, label: DAYS_JP[d.getDay()], isToday: i === 0 });
  }

  const weekly = state.data.weekly || {};
  const maxSecs = Math.max(1, ...days.map(d => weekly[d.key] || 0));
  const todayKey = todayStr();

  barsEl.innerHTML   = '';
  labelsEl.innerHTML = '';

  days.forEach(day => {
    const secs = weekly[day.key] || 0;
    const pct  = Math.min(100, (secs / maxSecs) * 100);

    const item = document.createElement('div');
    item.className = 'weekly-bar-item';

    const bar = document.createElement('div');
    bar.className = 'weekly-bar' + (day.key === todayKey ? ' today' : '');
    bar.style.height  = `${Math.max(4, pct)}%`;
    bar.title = formatShortTime(secs);
    item.appendChild(bar);
    barsEl.appendChild(item);

    const lbl = document.createElement('div');
    lbl.className = 'weekly-label' + (day.key === todayKey ? ' today' : '');
    lbl.textContent = day.label;
    labelsEl.appendChild(lbl);
  });
}

function renderLogList() {
  const listEl = $('logList');
  if (!listEl) return;
  const logs = state.data.logs || [];

  if (logs.length === 0) {
    listEl.innerHTML = '<div class="log-empty">ログがありません</div>';
    return;
  }

  listEl.innerHTML = '';
  logs.slice(0, 30).forEach(entry => {
    const item = document.createElement('div');
    item.className = 'log-item';

    const dateStr = entry.timestamp
      ? new Date(entry.timestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    item.innerHTML = `
      <div class="log-item-header">
        <span class="log-item-duration">${formatDuration(entry.duration)}</span>
        <span class="log-item-time">${dateStr}</span>
      </div>
      <div class="log-item-text">${escapeHtml(entry.text)}</div>
    `;
    listEl.appendChild(item);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function updateHeaderStats() {
  const d = state.data;
  setText('headerTodayTime', formatShortTime(d.todaySeconds || 0));
  setText('headerPomCount',  d.pomCount || 0);
}

/* =====================================================================
   TAB NAVIGATION
   ===================================================================== */

function switchTab(tabName) {
  if (state.activeTab === tabName) return;
  state.activeTab = tabName;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

  const tabEl  = $(`tab-${tabName}`);
  const navBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
  if (tabEl)  tabEl.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  if (tabName === 'stats') {
    updateStatsUI();
  }
}

/* =====================================================================
   INPUT SANITIZATION HELPERS
   ===================================================================== */

function clampInput(inputEl, min, max) {
  let val = parseInt(inputEl.value, 10);
  if (isNaN(val) || val < min) val = min;
  if (val > max) val = max;
  inputEl.value = val;
}

/* =====================================================================
   EVENT LISTENERS — attach once, cleanly
   ===================================================================== */

function attachEventListeners() {

  /* ---- Tab Navigation ---- */
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ---- Timer Controls ---- */
  timerEl.startBtn.addEventListener('click', () => {
    timerStart();
    // Unlock audio context on first interaction
    getAudioCtx();
  });

  timerEl.resetBtn.addEventListener('click', timerReset);

  timerEl.logBtn.addEventListener('click', () => {
    const elapsed = state.timer.running
      ? state.timer.total - Math.max(0, state.timer.remaining - Math.floor((Date.now() - state.timer.startEpoch) / 1000))
      : state.timer.total - state.timer.remaining;
    if (elapsed > 5) showLogModal(elapsed, false);
  });

  timerEl.inputMin.addEventListener('input', syncTimerDisplay);
  timerEl.inputSec.addEventListener('input', syncTimerDisplay);

  timerEl.inputMin.addEventListener('blur', () => {
    clampInput(timerEl.inputMin, 0, 99);
    syncTimerDisplay();
  });
  timerEl.inputSec.addEventListener('blur', () => {
    clampInput(timerEl.inputSec, 0, 59);
    syncTimerDisplay();
  });

  // Prevent invalid keypresses
  [timerEl.inputMin, timerEl.inputSec].forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { el.blur(); timerStart(); }
    });
  });

  /* ---- Preset Buttons ---- */
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.minutes, 10);
      if (isNaN(mins)) return;
      timerEl.inputMin.value = mins;
      timerEl.inputSec.value = 0;
      if (state.timer.running) timerReset();
      else syncTimerDisplay();
      state.timer.remaining = 0;
    });
  });

  /* ---- Pomodoro Controls ---- */
  pomEl.startBtn.addEventListener('click', pomStart);
  pomEl.resetBtn.addEventListener('click', pomReset);
  pomEl.skipBtn.addEventListener('click', pomSkip);

  pomEl.workMin.addEventListener('blur', () => {
    clampInput(pomEl.workMin, 1, 60);
    if (!state.pom.running && !state.pom.isBreak) {
      state.pom.remaining = 0;
      updatePomUI(getPomWorkSecs());
    }
  });
  pomEl.breakMin.addEventListener('blur', () => {
    clampInput(pomEl.breakMin, 1, 30);
  });

  /* ---- Pomodoro adjust buttons ---- */
  document.querySelectorAll('.pom-adj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const delta    = parseInt(btn.dataset.delta, 10);
      const inputEl  = $(targetId);
      if (!inputEl) return;
      let val = parseInt(inputEl.value, 10) || 0;
      val += delta;
      const isWork = targetId === 'pomWorkMin';
      val = Math.max(isWork ? 1 : 1, Math.min(isWork ? 60 : 30, val));
      inputEl.value = val;
      if (!state.pom.running && !state.pom.isBreak) {
        state.pom.remaining = 0;
        updatePomUI(getPomWorkSecs());
      }
    });
  });

  /* ---- Log Modal ---- */
  $('logSaveBtn').addEventListener('click', saveLog);
  $('logSkipBtn').addEventListener('click', hideLogModal);
  $('logModal').addEventListener('click', (e) => {
    if (e.target === $('logModal')) hideLogModal();
  });
  $('logInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveLog();
  });

  /* ---- Log clear ---- */
  $('logClearBtn').addEventListener('click', () => {
    if (confirm('全ログを削除しますか？')) {
      state.data.logs = [];
      saveData();
      renderLogList();
    }
  });

  /* ---- Achievement overlay click to dismiss ---- */
  $('achievementOverlay').addEventListener('click', () => {
    $('achievementOverlay').classList.remove('show');
    clearTimeout(_achievementTimeout);
  });

  /* ---- Keyboard shortcuts ---- */
  document.addEventListener('keydown', (e) => {
    // Space = toggle start/stop for active tab
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (state.activeTab === 'timer') timerStart();
      else if (state.activeTab === 'pomodoro') pomStart();
    }
    // 1/2/3 = tab switch
    if (e.key === '1') switchTab('timer');
    if (e.key === '2') switchTab('pomodoro');
    if (e.key === '3') switchTab('stats');
    // R = reset
    if (e.key === 'r' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (state.activeTab === 'timer')     timerReset();
      if (state.activeTab === 'pomodoro')  pomReset();
    }
    // Escape = close modal
    if (e.key === 'Escape') hideLogModal();
  });

  /* ---- Visibility change — recalibrate timer on tab focus ---- */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Timer is still running; the RAF will recalculate using epoch-based timing
      // Just ensure rain is running if it should be
      if ((state.timer.running || state.pom.running) && !rain.running) {
        startRain();
      }
    }
  });

  /* ---- Page unload — save state ---- */
  window.addEventListener('beforeunload', saveData);
}

/* =====================================================================
   INITIAL RENDER
   ===================================================================== */

function initUI() {
  // Timer
  const initSecs = getTimerInputSeconds();
  timerEl.display.textContent = formatTime(initSecs);
  updateRing(timerEl.ring, 1, 1);
  timerEl.ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  timerEl.ring.style.strokeDashoffset = 0;

  // Pomodoro ring init
  const pomRing = $('pomRing');
  if (pomRing) {
    pomRing.style.strokeDasharray = RING_CIRCUMFERENCE;
    pomRing.style.strokeDashoffset = 0;
  }
  updatePomUI(getPomWorkSecs());

  // Stats & header
  updateStatsUI();
  updateHeaderStats();
}

/* =====================================================================
   APP INIT
   ===================================================================== */

function init() {
  loadData();
  initCanvas();
  initUI();
  attachEventListeners();
  requestNotificationPermission();

  // First tab active
  switchTab('timer');
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
