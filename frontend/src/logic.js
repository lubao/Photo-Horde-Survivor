// Pure horde-survivor game logic — no DOM/canvas — so it can be unit tested.
export const WORLD = { W: 900, H: 560 };

export function dist2(ax, ay, bx, by) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

export function circlesCollide(ax, ay, ar, bx, by, br) {
  return dist2(ax, ay, bx, by) <= (ar + br) ** 2;
}

// Spawn position just outside one of the four edges.
export function spawnPosition(edge, rand = Math.random, world = WORLD) {
  switch (edge) {
    case 0: return { x: -30, y: rand() * world.H };
    case 1: return { x: world.W + 30, y: rand() * world.H };
    case 2: return { x: rand() * world.W, y: -30 };
    default: return { x: rand() * world.W, y: world.H + 30 };
  }
}

// Difficulty ramps with elapsed time t (seconds).
export function fireInterval(t) {
  return Math.max(0.16, 0.45 - t * 0.004);
}
export function spawnInterval(t) {
  return Math.max(0.25, 1.1 - t * 0.012);
}
export function enemyHp(t) {
  return Math.ceil(1 + t / 40);
}

// Score = kills*10 + whole seconds survived.
export function computeScore(kills, t) {
  return kills * 10 + Math.floor(t);
}

// Pick the nearest enemy to a point; returns the enemy or null.
export function nearestEnemy(x, y, enemies) {
  let best = Infinity;
  let pick = null;
  for (const en of enemies) {
    if (en.hp <= 0) continue;
    const d = dist2(x, y, en.x, en.y);
    if (d < best) {
      best = d;
      pick = en;
    }
  }
  return pick;
}

// Normalize a movement vector (returns {x,y} unit vector or zero).
export function normalize(mx, my) {
  const len = Math.hypot(mx, my);
  if (len === 0) return { x: 0, y: 0 };
  return { x: mx / len, y: my / len };
}

export function clampToWorld(x, y, r, world = WORLD) {
  return {
    x: Math.max(r, Math.min(world.W - r, x)),
    y: Math.max(r, Math.min(world.H - r, y)),
  };
}
