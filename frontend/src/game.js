// Horde-survivor ("割草") game engine.
// Usage: Game.start({ hero, enemy, bullet, background }, onGameOver)
const Game = (function () {
  const W = 900, H = 560;
  let canvas, ctx, raf = null;
  let assets = {};
  let imgs = {};
  let onGameOver = null;

  let state;
  const keys = {};
  let pointer = { active: false, x: W / 2, y: H / 2 };

  // ---- asset loading (with graceful fallback) ----
  function loadImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function preload(a) {
    const [hero, enemy, bullet, background] = await Promise.all([
      loadImage(a.hero), loadImage(a.enemy), loadImage(a.bullet), loadImage(a.background),
    ]);
    imgs = { hero, enemy, bullet, background };
  }

  function reset() {
    state = {
      t: 0,
      player: { x: W / 2, y: H / 2, r: 22, speed: 240, health: 100, hitCd: 0 },
      bullets: [],
      enemies: [],
      kills: 0,
      score: 0,
      fireCd: 0,
      fireInterval: 0.45,
      bulletSpeed: 460,
      spawnCd: 0,
      over: false,
    };
  }

  // ---- input ----
  function onKey(e, down) {
    const k = e.key.toLowerCase();
    keys[k] = down;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  }
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    pointer.x = (cx / rect.width) * W;
    pointer.y = (cy / rect.height) * H;
  }

  function bindInput() {
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
  }
  function unbindInput() {
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    canvas.removeEventListener('pointerdown', pd);
    canvas.removeEventListener('pointermove', pm);
    window.removeEventListener('pointerup', pu);
  }
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  const pd = (e) => { pointer.active = true; pointerPos(e); };
  const pm = (e) => { if (pointer.active) pointerPos(e); };
  const pu = () => { pointer.active = false; };

  // ---- helpers ----
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  function spawnEnemy() {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0) { x = -30; y = Math.random() * H; }
    else if (edge === 1) { x = W + 30; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = -30; }
    else { x = Math.random() * W; y = H + 30; }
    const diff = 1 + state.t / 40;
    state.enemies.push({
      x, y, r: 20,
      speed: 55 + Math.random() * 35 + diff * 8,
      hp: Math.ceil(diff),
      hpMax: Math.ceil(diff),
    });
  }

  function fire() {
    let nearest = null, best = Infinity;
    for (const en of state.enemies) {
      const d = dist2(state.player.x, state.player.y, en.x, en.y);
      if (d < best) { best = d; nearest = en; }
    }
    if (!nearest) return;
    const ang = Math.atan2(nearest.y - state.player.y, nearest.x - state.player.x);
    state.bullets.push({
      x: state.player.x, y: state.player.y, r: 9,
      vx: Math.cos(ang) * state.bulletSpeed,
      vy: Math.sin(ang) * state.bulletSpeed,
      life: 1.6, dmg: 1,
    });
  }

  // ---- update ----
  function update(dt) {
    const p = state.player;
    state.t += dt;

    // movement: keyboard
    let mx = 0, my = 0;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;

    if (mx === 0 && my === 0 && pointer.active) {
      // pointer follow
      const dx = pointer.x - p.x, dy = pointer.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) { mx = dx / len; my = dy / len; }
    } else if (mx || my) {
      const len = Math.hypot(mx, my); mx /= len; my /= len;
    }
    p.x = Math.max(p.r, Math.min(W - p.r, p.x + mx * p.speed * dt));
    p.y = Math.max(p.r, Math.min(H - p.r, p.y + my * p.speed * dt));

    // difficulty ramp
    state.fireInterval = Math.max(0.16, 0.45 - state.t * 0.004);
    const spawnInterval = Math.max(0.25, 1.1 - state.t * 0.012);

    // firing
    state.fireCd -= dt;
    if (state.fireCd <= 0) { fire(); state.fireCd = state.fireInterval; }

    // spawning
    state.spawnCd -= dt;
    if (state.spawnCd <= 0) { spawnEnemy(); state.spawnCd = spawnInterval; }

    // bullets
    for (const b of state.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }

    // enemies move toward player
    for (const en of state.enemies) {
      const ang = Math.atan2(p.y - en.y, p.x - en.x);
      en.x += Math.cos(ang) * en.speed * dt;
      en.y += Math.sin(ang) * en.speed * dt;
    }

    // bullet-enemy collisions
    for (const b of state.bullets) {
      if (b.life <= 0) continue;
      for (const en of state.enemies) {
        if (en.hp <= 0) continue;
        if (dist2(b.x, b.y, en.x, en.y) <= (b.r + en.r) ** 2) {
          en.hp -= b.dmg; b.life = 0;
          if (en.hp <= 0) { state.kills += 1; state.score += 10; }
          break;
        }
      }
    }

    // enemy-player contact damage
    p.hitCd -= dt;
    for (const en of state.enemies) {
      if (en.hp <= 0) continue;
      if (dist2(p.x, p.y, en.x, en.y) <= (p.r + en.r) ** 2) {
        if (p.hitCd <= 0) { p.health -= 8; p.hitCd = 0.5; }
      }
    }

    // cleanup
    state.bullets = state.bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < W + 40 && b.y > -40 && b.y < H + 40);
    state.enemies = state.enemies.filter((en) => en.hp > 0);

    state.score = state.kills * 10 + Math.floor(state.t);

    if (p.health <= 0 && !state.over) {
      p.health = 0;
      endGame();
    }
  }

  // ---- render ----
  function drawSprite(img, x, y, r, fallbackColor) {
    if (img) {
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = fallbackColor;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render() {
    // background
    if (imgs.background) {
      const pat = ctx.createPattern(imgs.background, 'repeat');
      ctx.fillStyle = pat || '#0a0e14';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    }

    for (const en of state.enemies) {
      drawSprite(imgs.enemy, en.x, en.y, en.r, '#ff5d5d');
      if (en.hpMax > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(en.x - en.r, en.y - en.r - 8, en.r * 2, 4);
        ctx.fillStyle = '#00e5a0'; ctx.fillRect(en.x - en.r, en.y - en.r - 8, en.r * 2 * (en.hp / en.hpMax), 4);
      }
    }
    for (const b of state.bullets) drawSprite(imgs.bullet, b.x, b.y, b.r, '#ffe14d');

    // player (flash when recently hit)
    const p = state.player;
    if (p.hitCd > 0.3) ctx.globalAlpha = 0.5;
    drawSprite(imgs.hero, p.x, p.y, p.r, '#7c4dff');
    ctx.globalAlpha = 1;
  }

  function syncHud() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('hudHealth', Math.max(0, Math.round(state.player.health)));
    set('hudTime', Math.floor(state.t));
    set('hudKills', state.kills);
    set('hudScore', state.score);
  }

  // ---- loop ----
  let last = 0;
  function loop(ts) {
    if (!state || state.over) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    update(dt);
    render();
    syncHud();
    raf = requestAnimationFrame(loop);
  }

  function endGame() {
    state.over = true;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    unbindInput();
    if (onGameOver) onGameOver({ score: state.score, kills: state.kills, time: Math.floor(state.t) });
  }

  // ---- public ----
  async function start(a, cb) {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    assets = a || {};
    onGameOver = cb;
    await preload(assets);
    reset();
    bindInput();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (state) state.over = true;
    unbindInput();
  }

  return { start, stop };
})();
