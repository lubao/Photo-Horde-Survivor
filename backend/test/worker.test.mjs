import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../handlers/worker.mjs';

function makeDeps(gen, { failBgRemoval = false } = {}) {
  const calls = { steps: [], assets: [], variants: null, finalized: null, failed: null };
  const data = {
    async getGeneration() {
      return gen;
    },
    async appendStep(id, step, status) {
      calls.steps.push({ key: step.key, status });
    },
    async setVariants(id, variants) {
      calls.variants = variants;
    },
    async finalizeAssets(id, payload) {
      calls.finalized = payload;
    },
    async setFailed(id, msg) {
      calls.failed = msg;
    },
  };
  const storage = {
    async getUploadBase64() {
      return { base64: 'BASE64', contentType: 'image/png' };
    },
    async putAsset(key) {
      calls.assets.push(key);
      return key;
    },
  };
  const nova = {
    async generateVariation() {
      return ['rawImage'];
    },
    async removeBackground() {
      if (failBgRemoval) throw new Error('moderation');
      return 'spriteImage';
    },
  };
  return { deps: { data, storage, nova }, calls };
}

test('hero phase generates 3 variants and writes narration steps', async () => {
  const gen = { generationId: 'g1', uploadKey: 'uploads/u1/x.png' };
  const { deps, calls } = makeDeps(gen);
  const res = await handler({ generationId: 'g1' }, deps);

  assert.equal(res.variants, 3);
  assert.equal(calls.variants.length, 3);
  assert.deepEqual(
    calls.variants.map((v) => v.variantId),
    ['neon', 'pixel', 'toon'],
  );
  // ordered narration includes analyze -> hero -> sprites -> ready
  const keys = calls.steps.map((s) => s.key);
  assert.deepEqual(keys, ['analyze', 'hero', 'sprites', 'ready']);
  assert.equal(calls.assets.length, 3); // one hero sprite per style
});

test('hero phase falls back to raw image when background removal fails', async () => {
  const gen = { generationId: 'g1', uploadKey: 'uploads/u1/x.png' };
  const { deps, calls } = makeDeps(gen, { failBgRemoval: true });
  const res = await handler({ generationId: 'g1' }, deps);
  assert.equal(res.variants, 3);
  assert.equal(calls.assets.length, 3);
});

test('assets phase finalizes a full pack for the selected variant', async () => {
  const gen = {
    generationId: 'g1',
    uploadKey: 'uploads/u1/x.png',
    selectedVariantId: 'neon',
    allowGallery: true,
    playerName: 'Ada',
    variants: [{ variantId: 'neon', label: 'Neon', style: 'neon', heroKey: 'assets/g1/neon/hero.png' }],
  };
  const { deps, calls } = makeDeps(gen);
  const res = await handler({ generationId: 'g1', phase: 'assets' }, deps);

  assert.equal(res.complete, true);
  assert.ok(calls.finalized);
  const pack = calls.finalized.assetPack;
  assert.deepEqual(Object.keys(pack).sort(), [
    'backgroundKey',
    'bulletKey',
    'enemyKey',
    'heroKey',
  ]);
  // enemy + bullet + background generated (hero reused) => 3 new assets
  assert.equal(calls.assets.length, 3);
  const stepKeys = calls.steps.map((s) => s.key);
  assert.deepEqual(stepKeys, ['enemy', 'bullet', 'background', 'complete']);
});

test('worker records failure and rethrows on error', async () => {
  const gen = { generationId: 'g1', uploadKey: 'uploads/u1/x.png' };
  const { deps, calls } = makeDeps(gen);
  deps.storage.getUploadBase64 = async () => {
    throw new Error('s3 down');
  };
  await assert.rejects(() => handler({ generationId: 'g1' }, deps), /s3 down/);
  assert.match(calls.failed, /s3 down/);
});
