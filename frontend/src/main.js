// UI wiring for Photo Horde Survivor.
(function () {
  const $ = (id) => document.getElementById(id);
  const screens = ['upload', 'generating', 'choose', 'game', 'over'];

  let photoBase64 = null;       // resized base64 (no data: prefix)
  let currentGen = null;        // { generationId, variants }
  let chosenAssets = null;      // { hero, enemy, bullet, background }
  let chosenStyle = null;
  let lastResult = null;        // { score, kills, time }
  const defaultPlayer = () => ($('playerName').value || 'Anonymous').slice(0, 24);

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

  // ---------- photo upload + resize ----------
  function resizeToBase64(file, max = 768) {
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
        const dataUrl = c.toDataURL('image/png');
        resolve({ base64: dataUrl.split(',')[1], dataUrl });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const { base64, dataUrl } = await resizeToBase64(file);
    photoBase64 = base64;
    const prev = $('previewImg');
    prev.src = dataUrl; prev.hidden = false;
    $('dropHint').hidden = true;
    $('generateBtn').disabled = false;
  }

  const dz = $('dropzone');
  dz.addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hover'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('hover'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  // ---------- generation ----------
  function logLine(text, done) {
    const li = document.createElement('li');
    li.textContent = (done ? '✓ ' : '… ') + text;
    if (done) li.className = 'done';
    $('genLog').appendChild(li);
  }

  $('generateBtn').addEventListener('click', async () => {
    if (!photoBase64) return;
    showScreen('generating');
    $('genLog').innerHTML = '';
    logLine('上傳照片到後端 Uploading photo');
    logLine('呼叫 Bedrock Nova Canvas 生成主角風格 (x3) Generating 3 hero styles');
    try {
      const res = await API.generate(photoBase64, defaultPlayer(), $('allowGallery').checked);
      currentGen = res;
      logLine('生成完成 Generation complete', true);
      renderChoices(res.variants);
      showScreen('choose');
    } catch (err) {
      logLine('失敗 Failed: ' + err.message, false);
      alert('生成失敗 Generation failed:\n' + err.message + '\n\n你可以改用「略過，用預設圖玩」。');
      showScreen('upload');
    }
  });

  $('skipBtn').addEventListener('click', () => {
    chosenAssets = {};      // empty -> engine uses fallback shapes
    chosenStyle = 'default';
    startGame();
  });

  // ---------- choose (single selection) ----------
  function renderChoices(variants) {
    const box = $('choices');
    box.innerHTML = '';
    variants.forEach((v) => {
      const el = document.createElement('div');
      el.className = 'choice';
      el.innerHTML = `
        <img src="${v.heroUrl}" alt="${v.label}" />
        <h3>${v.label}</h3>
        <button class="primary">選這個 Choose</button>`;
      el.querySelector('button').addEventListener('click', () => choose(v.id));
      box.appendChild(el);
    });
  }

  async function choose(variantId) {
    document.querySelectorAll('.choice button').forEach((b) => { b.disabled = true; b.textContent = '處理中… Locking'; });
    try {
      const res = await API.select(currentGen.generationId, variantId);
      chosenAssets = res.assets;     // { hero, enemy, bullet, background }
      chosenStyle = res.style || variantId;
      startGame();
    } catch (err) {
      alert('選擇失敗 Selection failed:\n' + err.message);
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
    $('submitScoreBtn').disabled = false;
    showScreen('over');
  }

  $('replayBtn').addEventListener('click', () => {
    // Replays reuse the already-chosen assets (selection is final / once only).
    if (chosenAssets) startGame();
    else showScreen('upload');
  });

  $('submitScoreBtn').addEventListener('click', async () => {
    if (!lastResult) return;
    $('submitScoreBtn').disabled = true;
    $('submitMsg').textContent = '提交中… Submitting';
    try {
      await API.submitScore({
        playerName: defaultPlayer(),
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
      body.innerHTML = scores.map((s) =>
        `<tr><td>${s.rank}</td><td>${escapeHtml(s.playerName)}</td><td>${escapeHtml(s.style || '-')}</td><td>${s.score}</td></tr>`,
      ).join('');
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
      const { items } = await API.getGallery();
      if (!items.length) { grid.innerHTML = '<p class="muted">尚無公開作品 No public creations yet</p>'; return; }
      grid.innerHTML = items.map((it) => `
        <div class="gcard">
          <div class="gimg"><img src="${it.heroUrl}" alt="hero" /></div>
          <div class="gmeta"><div class="name">${escapeHtml(it.playerName)}</div><div class="muted">${escapeHtml(it.style || '')}</div></div>
        </div>`).join('');
    } catch (err) {
      grid.innerHTML = `<p class="muted">載入失敗 ${escapeHtml(err.message)}</p>`;
    }
  }
  $('refreshGallery').addEventListener('click', loadGallery);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // init
  showView('play');
  showScreen('upload');
})();
