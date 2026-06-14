import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVariationBody,
  buildBackgroundRemovalBody,
  parseModelResponse,
  promptFor,
  generateVariation,
  removeBackground,
  STYLE_VARIANTS,
  NEGATIVE_TEXT,
} from '../shared/nova.mjs';

function fakeClient(payload) {
  return {
    sent: [],
    async send(cmd) {
      this.sent.push(cmd);
      return { body: Buffer.from(JSON.stringify(payload), 'utf8') };
    },
  };
}

test('buildVariationBody clamps similarityStrength and sets task type', () => {
  const body = buildVariationBody({
    images: ['aaaa'],
    text: 'hero',
    similarityStrength: 5,
  });
  assert.equal(body.taskType, 'IMAGE_VARIATION');
  assert.equal(body.imageVariationParams.similarityStrength, 1.0);
  assert.equal(body.imageVariationParams.negativeText, NEGATIVE_TEXT);
  assert.equal(body.imageGenerationConfig.numberOfImages, 1);
});

test('buildVariationBody rejects bad image count and prompt length', () => {
  assert.throws(() => buildVariationBody({ images: [], text: 'x' }));
  assert.throws(() =>
    buildVariationBody({ images: ['a'], text: '' }),
  );
});

test('promptFor produces distinct prompts per kind', () => {
  const hero = promptFor('hero', 'neon');
  const bg = promptFor('background', 'neon');
  assert.match(hero, /character/);
  assert.match(bg, /background/);
  assert.notEqual(hero, bg);
});

test('three style variants exist with stable ids', () => {
  assert.deepEqual(
    STYLE_VARIANTS.map((s) => s.variantId ?? s.id),
    ['neon', 'pixel', 'toon'],
  );
});

test('parseModelResponse handles Buffer and empty image lists', () => {
  const r1 = parseModelResponse(Buffer.from(JSON.stringify({ images: ['x'] })));
  assert.deepEqual(r1.images, ['x']);
  const r2 = parseModelResponse(JSON.stringify({ error: 'blocked' }));
  assert.deepEqual(r2.images, []);
  assert.equal(r2.error, 'blocked');
});

test('generateVariation returns images from the model', async () => {
  const client = fakeClient({ images: ['img1'] });
  const imgs = await generateVariation(
    { images: ['ref'], text: 'hero' },
    { client },
  );
  assert.deepEqual(imgs, ['img1']);
  assert.equal(client.sent.length, 1);
});

test('generateVariation throws when moderation removes all images', async () => {
  const client = fakeClient({ images: [], error: 'content moderated' });
  await assert.rejects(
    () => generateVariation({ images: ['ref'], text: 'hero' }, { client }),
    /content moderated/,
  );
});

test('removeBackground returns first transparent image', async () => {
  const client = fakeClient({ images: ['transparent'] });
  const out = await removeBackground('img', { client });
  assert.equal(out, 'transparent');
  assert.equal(client.sent[0].input.body.includes('BACKGROUND_REMOVAL'), true);
});

test('buildBackgroundRemovalBody shape', () => {
  const b = buildBackgroundRemovalBody('abc');
  assert.equal(b.taskType, 'BACKGROUND_REMOVAL');
  assert.equal(b.backgroundRemovalParams.image, 'abc');
});
