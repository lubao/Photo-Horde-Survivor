// UI orchestration for Photo Horde Survivor.
import { loadConfig } from './config.js';
import { API, configureApi } from './api.js';
import {
  captureTokenFromHash,
  isAuthenticated,
  currentUser,
  login,
  logout,
} from './auth.js';
import { Game } from './game.js';
import { isReady, isComplete, isFailed, assetUrls, stepView } from './flow.js';

const $ = (id) => document.getElementById(id);
const screens = ['upload', 'generating', 'choose', 'game', 'over'];

let config = null;
let uploadFile = null; // resized Blob ready to upload
let currentGen = null; // { generationId }
let chosenAssets = null; // { hero, enemy, bullet, background }
let chosenStyle = null;
let lastResult = null;
let polling = false;

const playerName = () => ($('playerName').value || currentUser()?.name || 'Anonymous').slice(0, 24);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- auth UI ----------
function refreshAuthUI() {
  const authed = isAuthenticated();
  const u = currentUser();
  $('authStatus').textContent = authed ? `👤 ${u?.email || u?.name || 'signed in'}` : '';
  $('loginBtn').hidden = authed;
  $('logoutBtn').hidden = !authed;
  // Generate requires sign-in; play-with-defaults does not.
  $('generateBtn').disabled = !authed || !uploadFile;
  $('authNote').hidden = authed;
}

$('loginBtn').addEventListener('click', () => login(config));
$('logoutBtn').addEventListener('click', () => logout(config));

// ---------- view / screen switching ----------
function showView(view) {
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  ['play', 'leaderboard', 'gallery'].forEach((v) => $('view-' + v).classList.toggle('active', v === view));
  if (view === 'leaderboard') loadBoard();
  if (view === 'gallery') loadGallery();
}
function showScreen(name) {
  screens.forEach((s) => $('screen-' + s).classList.toggle('active', s === name));
}
document.querySelectorAll('.navbtn').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.view !== 'play') Game.stop();
    showView(b.dataset.view);
  }),
);

// ---------- photo selection + resize ----------
function resizeToBlob(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const scale = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((blob) => {
        blob.preview = c.toDataURL('image/png');
        resolve(blob);
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const blob = await resizeToBlob(file);
  uploadFile = blob;
  const prev = $('previewImg');
  prev.src = blob.preview; prev.hidden = false;
  $('dropHint').hidden = true;
  refreshAuthUI();
}

const dz = $('dropzone');
dz.addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hover'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('hover'); }));
dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

// ---------- narration log ----------
function renderSteps(steps, done) {
  const log = $('genLog');
  log.innerHTML = stepView(steps, done)
    .map((s) => `<li class="${s.done ? 'done' : ''}">${s.mark} ${escapeHtml(s.label)}</li>`)
    .join('');
}

// Poll status until predicate(resp) is true; renders narration each tick.
async function pollUntil(generationId, predicate) {
  polling = true;
  for (let i = 0; i < 150 && polling; i++) {
    const st = await API.status(generationId);
    renderSteps(st.steps, st.status === 'COMPLETE' || st.status === 'READY');
    if (isFailed(st)) throw new Error(st.errorMessage || 'Generation failed');
    if (predicate(st)) { polling = false; return st; }
    await sleep(2000);
  }
  polling = false;
  throw new Error('Timed out waiting for generation');
}

// ---------- generation flow ----------
$('generateBtn').addEventListener('click', async () => {
  if (!uploadFile || !isAuthenticated()) return;
  showScreen('generating');
  renderSteps([{ label: 'Uploading your photo' }], false);
  try {
    const key = await API.uploadPhoto(uploadFile);
    const res = await API.generate(key, playerName(), $('allowGallery').checked);
    currentGen = res;
    const ready = await pollUntil(res.generationId, (st) => isReady(st));
    renderChoices(ready.variants);
    showScreen('choose');
  } catch (err) {
    alert('生成失敗 Generation failed:\n' + err.message + '\n\n你可以改用「略過，用預設圖玩」。');
    showScreen('upload');
  }
});

$('skipBtn').addEventListener('click', () => {
  chosenAssets = {}; // empty -> engine uses fallback shapes
  chosenStyle = 'default';
  startGame();
});

// ---------- single selection ----------
function renderChoices(variants) {
  const box = $('choices');
  box.innerHTML = '';
  variants.forEach((v) => {
    const el = document.createElement('div');
    el.className = 'choice';
    el.innerHTML = `<img src="${v.heroUrl}" alt="${escapeHtml(v.label)}" /><h3>${escapeHtml(v.label)}</h3><button class="primary">選這個 Choose</button>`;
    el.querySelector('button').addEventListener('click', () => choose(v.variantId));
    box.appendChild(el);
  });
}

async function choose(variantId) {
  document.querySelectorAll('.choice button').forEach((b) => { b.disabled = true; b.textContent = '處理中… Locking'; });
  chosenStyle = variantId;
  try {
    await API.select(currentGen.generationId, variantId);
    showScreen('generating');
    renderSteps([{ label: `Building your ${variantId} world` }], false);
    const done = await pollUntil(currentGen.generationId, (st) => isComplete(st));
    chosenAssets = assetUrls(done.assetPack);
    startGame();
  } catch (err) {
    alert('選擇失敗 Selection failed:\n' + err.message);
    showScreen('choose');
    document.querySelectorAll('.choice button').forEach((b) => { b.disabled = false; b.textContent = '選這個 Choose'; });
  }
}

// ---------- game lifecycle ----------
function startGame() {
  showScreen('game');
  Game.start(chosenAssets || {}, onGameOver);
}
function onGameOver(result) {
  lastResult = result;
  $('finalScore').textContent = result.score;
  $('finalTime').textContent = result.time;
  $('finalKills').textContent = result.kills;
  $('submitMsg').textContent = '';
  $('submitScoreBtn').disabled = !isAuthenticated();
  $('submitScoreBtn').textContent = isAuthenticated() ? '提交分數 Submit score' : '登入後可提交 Sign in to submit';
  showScreen('over');
}
$('replayBtn').addEventListener('click', () => {
  if (chosenAssets) startGame();
  else showScreen('upload');
});
$('submitScoreBtn').addEventListener('click', async () => {
  if (!lastResult || !isAuthenticated()) return;
  $('submitScoreBtn').disabled = true;
  $('submitMsg').textContent = '提交中… Submitting';
  try {
    await API.submitScore({
      playerName: playerName(),
      score: lastResult.score,
      style: chosenStyle,
      generationId: currentGen ? currentGen.generationId : undefined,
    });
    $('submitMsg').textContent = '已提交！到排行榜看看 Submitted! Check the leaderboard.';
  } catch (err) {
    $('submitMsg').textContent = '提交失敗 Failed: ' + err.message;
    $('submitScoreBtn').disabled = false;
  }
});

// ---------- leaderboard ----------
async function loadBoard() {
  const body = $('boardBody');
  body.innerHTML = '<tr><td colspan="4" class="muted">載入中… Loading</td></tr>';
  try {
    const { scores } = await API.getScores();
    if (!scores.length) { body.innerHTML = '<tr><td colspan="4" class="muted">尚無紀錄 No scores yet</td></tr>'; return; }
    body.innerHTML = scores
      .map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.playerName)}</td><td>${escapeHtml(s.style || '-')}</td><td>${s.score}</td></tr>`)
      .join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="muted">載入失敗 ${escapeHtml(err.message)}</td></tr>`;
  }
}
$('refreshBoard').addEventListener('click', loadBoard);

// ---------- gallery ----------
async function loadGallery() {
  const grid = $('galleryGrid');
  grid.innerHTML = '<p class="muted">載入中… Loading</p>';
  try {
    const { creations } = await API.getGallery();
    if (!creations.length) { grid.innerHTML = '<p class="muted">尚無公開作品 No public creations yet</p>'; return; }
    grid.innerHTML = creations
      .map((it) => `<div class="gcard"><div class="gimg"><img src="${it.thumbUrl}" alt="hero" /></div><div class="gmeta"><div class="name">${escapeHtml(it.playerName)}</div><div class="muted">${escapeHtml(it.style || '')}</div></div></div>`)
      .join('');
  } catch (err) {
    grid.innerHTML = `<p class="muted">載入失敗 ${escapeHtml(err.message)}</p>`;
  }
}
$('refreshGallery').addEventListener('click', loadGallery);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- init ----------
(async function init() {
  config = await loadConfig();
  configureApi(config);
  captureTokenFromHash();
  refreshAuthUI();
  showView('play');
  showScreen('upload');
})();
