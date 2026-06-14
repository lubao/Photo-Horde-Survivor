import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneration,
  selectVariant,
  incrementQuota,
  putScore,
  topScores,
  listGallery,
  finalizeAssets,
  todayKey,
} from '../shared/data.mjs';

function fakeDdb(responder) {
  return {
    sent: [],
    async send(cmd) {
      this.sent.push(cmd);
      return responder ? await responder(cmd) : {};
    },
  };
}

function condFail() {
  const e = new Error('conditional');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

test('createGeneration writes a PENDING item with TTL', async () => {
  const ddb = fakeDdb();
  const item = await createGeneration(
    { generationId: 'g1', ownerSub: 'u1', playerName: 'Ada', allowGallery: true, uploadKey: 'uploads/u1/x.png' },
    { ddb },
  );
  assert.equal(item.status, 'PENDING');
  assert.equal(item.ownerSub, 'u1');
  assert.ok(item.ttl > Date.now() / 1000);
  const put = ddb.sent[0].input;
  assert.equal(put.TableName, 'test-generations');
  assert.equal(put.Item.generationId, 'g1');
});

test('selectVariant returns true on success, false on conditional failure', async () => {
  const okDdb = fakeDdb(async () => ({}));
  assert.equal(await selectVariant('g1', 'u1', 'neon', { ddb: okDdb }), true);

  const failDdb = fakeDdb(async () => {
    throw condFail();
  });
  assert.equal(await selectVariant('g1', 'u1', 'neon', { ddb: failDdb }), false);
});

test('incrementQuota allows under limit and blocks at limit', async () => {
  const okDdb = fakeDdb(async () => ({ Attributes: { count: 1 } }));
  const r1 = await incrementQuota('u1', { limit: 3, ddb: okDdb, date: '2026-06-14' });
  assert.deepEqual(r1, { allowed: true, count: 1, limit: 3 });
  // key is userSub#date
  assert.equal(okDdb.sent[0].input.Key.pk, 'u1#2026-06-14');

  const blockedDdb = fakeDdb(async () => {
    throw condFail();
  });
  const r2 = await incrementQuota('u1', { limit: 3, ddb: blockedDdb });
  assert.equal(r2.allowed, false);
  assert.equal(r2.count, 3);
});

test('putScore stores score on the GLOBAL board', async () => {
  const ddb = fakeDdb();
  const item = await putScore(
    { scoreId: 's1', playerName: 'Ada', score: 1234, style: 'neon' },
    { ddb },
  );
  assert.equal(item.board, 'GLOBAL');
  assert.equal(item.score, 1234);
});

test('topScores queries score-index descending', async () => {
  const ddb = fakeDdb(async () => ({ Items: [{ score: 9 }, { score: 5 }] }));
  const items = await topScores(20, { ddb });
  assert.equal(items.length, 2);
  const q = ddb.sent[0].input;
  assert.equal(q.IndexName, 'score-index');
  assert.equal(q.ScanIndexForward, false);
  assert.equal(q.Limit, 20);
});

test('listGallery queries gallery-index for opted-in items', async () => {
  const ddb = fakeDdb(async () => ({ Items: [{ generationId: 'g1' }] }));
  const items = await listGallery(30, { ddb });
  assert.equal(items.length, 1);
  const q = ddb.sent[0].input;
  assert.equal(q.IndexName, 'gallery-index');
  assert.equal(q.ExpressionAttributeValues[':g'], 'Y');
});

test('finalizeAssets sets gallery partition only when opted in', async () => {
  const ddbOptIn = fakeDdb();
  await finalizeAssets(
    'g1',
    { assetPack: { heroKey: 'h' }, allowGallery: true, playerName: 'Ada', styleId: 'neon', thumbKey: 'h' },
    { ddb: ddbOptIn },
  );
  assert.match(ddbOptIn.sent[0].input.UpdateExpression, /galleryPublic/);

  const ddbPrivate = fakeDdb();
  await finalizeAssets(
    'g2',
    { assetPack: { heroKey: 'h' }, allowGallery: false },
    { ddb: ddbPrivate },
  );
  assert.doesNotMatch(ddbPrivate.sent[0].input.UpdateExpression, /galleryPublic/);
});

test('todayKey returns YYYY-MM-DD', () => {
  assert.match(todayKey(new Date('2026-06-14T10:00:00Z')), /^2026-06-14$/);
});
