import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dist2,
  circlesCollide,
  spawnPosition,
  fireInterval,
  spawnInterval,
  enemyHp,
  computeScore,
  nearestEnemy,
  normalize,
  clampToWorld,
  WORLD,
} from '../src/logic.js';
import { isReady, isComplete, isFailed, assetUrls, stepView } from '../src/flow.js';

// ---- game logic ----
test('circlesCollide detects overlap and separation', () => {
  assert.equal(circlesCollide(0, 0, 5, 8, 0, 5), true); // distance 8 <= 10
  assert.equal(circlesCollide(0, 0, 5, 20, 0, 5), false);
});

test('spawnPosition places enemies outside each edge', () => {
  assert.deepEqual(spawnPosition(0, () => 0.5), { x: -30, y: WORLD.H * 0.5 });
  assert.equal(spawnPosition(1, () => 0).x, WORLD.W + 30);
  assert.equal(spawnPosition(2, () => 0).y, -30);
  assert.equal(spawnPosition(3, () => 0).y, WORLD.H + 30);
});

test('difficulty ramps but stays clamped', () => {
  assert.equal(fireInterval(0), 0.45);
  assert.equal(fireInterval(10000), 0.16); // clamped floor
  assert.equal(spawnInterval(10000), 0.25);
  assert.ok(enemyHp(0) >= 1);
  assert.ok(enemyHp(400) > enemyHp(0));
});

test('computeScore = kills*10 + seconds', () => {
  assert.equal(computeScore(3, 12.9), 42);
});

test('nearestEnemy ignores dead enemies and picks closest', () => {
  const enemies = [
    { x: 100, y: 0, hp: 1 },
    { x: 10, y: 0, hp: 0 }, // dead -> ignored
    { x: 30, y: 0, hp: 2 },
  ];
  assert.equal(nearestEnemy(0, 0, enemies).x, 30);
  assert.equal(nearestEnemy(0, 0, []), null);
});

test('normalize returns unit vector or zero', () => {
  const n = normalize(3, 4);
  assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  assert.deepEqual(normalize(0, 0), { x: 0, y: 0 });
});

test('clampToWorld keeps the player inside bounds', () => {
  assert.deepEqual(clampToWorld(-50, -50, 10), { x: 10, y: 10 });
  const c = clampToWorld(99999, 99999, 10);
  assert.equal(c.x, WORLD.W - 10);
  assert.equal(c.y, WORLD.H - 10);
});

test('dist2 squared distance', () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
});

// ---- polling / selection state machine ----
test('isReady true only with READY + variants', () => {
  assert.equal(isReady({ status: 'READY', variants: [{ variantId: 'neon' }] }), true);
  assert.equal(isReady({ status: 'READY', variants: [] }), false);
  assert.equal(isReady({ status: 'RUNNING', variants: [{}] }), false);
});

test('isComplete true only with COMPLETE + assetPack', () => {
  assert.equal(isComplete({ status: 'COMPLETE', assetPack: { heroUrl: 'x' } }), true);
  assert.equal(isComplete({ status: 'COMPLETE' }), false);
  assert.equal(isComplete({ status: 'SELECTING', assetPack: { heroUrl: 'x' } }), false);
});

test('isFailed detects FAILED', () => {
  assert.equal(isFailed({ status: 'FAILED' }), true);
  assert.equal(isFailed({ status: 'READY' }), false);
});

test('assetUrls maps presigned pack to engine asset shape', () => {
  const out = assetUrls({ heroUrl: 'h', enemyUrl: 'e', bulletUrl: 'b', backgroundUrl: 'g' });
  assert.deepEqual(out, { hero: 'h', enemy: 'e', bullet: 'b', background: 'g' });
  assert.deepEqual(assetUrls(null), {});
});

test('stepView marks all done when finished, last active otherwise', () => {
  const steps = [{ label: 'a' }, { label: 'b' }];
  const active = stepView(steps, false);
  assert.equal(active[0].done, true);
  assert.equal(active[1].done, false);
  assert.equal(active[1].mark, '…');
  const done = stepView(steps, true);
  assert.ok(done.every((s) => s.done));
});
