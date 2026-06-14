import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import { handler as uploadUrl } from '../handlers/uploadUrl.mjs';
import { handler as generate } from '../handlers/generate.mjs';
import { handler as select } from '../handlers/select.mjs';
import { handler as status } from '../handlers/status.mjs';
import { handler as scores } from '../handlers/scores.mjs';
import { handler as gallery } from '../handlers/gallery.mjs';

const ddbMock = mockClient(DynamoDBDocumentClient);
const fakeLambda = { calls: [], async send(c) { this.calls.push(c); return {}; } };

beforeEach(() => {
  ddbMock.reset();
  fakeLambda.calls = [];
});

function authed(body, sub = 'u1', extra = {}) {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub, email: 'a@b.c' } } }, http: { method: 'POST' } },
    body: body ? JSON.stringify(body) : undefined,
    ...extra,
  };
}
function anon(extra = {}) {
  return { requestContext: { http: { method: 'GET' } }, ...extra };
}
function condFail() {
  const e = new Error('cond');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

test('uploadUrl rejects unauthenticated', async () => {
  const res = await uploadUrl(anon());
  assert.equal(res.statusCode, 401);
});

test('uploadUrl rejects bad content type', async () => {
  const res = await uploadUrl(authed({ contentType: 'image/gif' }));
  assert.equal(res.statusCode, 415);
});

test('uploadUrl returns presigned url + namespaced key', async () => {
  const res = await uploadUrl(authed({ contentType: 'image/png' }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.key, /^uploads\/u1\//);
  assert.match(body.url, /^https:\/\//);
});

test('generate blocks when daily quota exceeded (429)', async () => {
  ddbMock.on(UpdateCommand).rejects(condFail()); // quota conditional fails
  const res = await generate(
    authed({ uploadKey: 'uploads/u1/x.png' }),
    { lambda: fakeLambda },
  );
  assert.equal(res.statusCode, 429);
  assert.equal(fakeLambda.calls.length, 0);
});

test('generate rejects an uploadKey owned by another user', async () => {
  const res = await generate(
    authed({ uploadKey: 'uploads/OTHER/x.png' }),
    { lambda: fakeLambda },
  );
  assert.equal(res.statusCode, 403);
});

test('generate creates record and async-invokes the worker (202)', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } }); // quota
  ddbMock.on(PutCommand).resolves({}); // createGeneration
  const res = await generate(
    authed({ uploadKey: 'uploads/u1/x.png', playerName: 'Ada', allowGallery: true }),
    { lambda: fakeLambda },
  );
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.ok(body.generationId);
  assert.equal(fakeLambda.calls.length, 1);
  assert.equal(fakeLambda.calls[0].input.InvocationType, 'Event');
});

test('select enforces single selection (409 on repeat)', async () => {
  const gen = {
    generationId: 'g1', ownerSub: 'u1', status: 'READY',
    variants: [{ variantId: 'neon' }],
  };
  ddbMock.on(GetCommand).resolves({ Item: gen });
  ddbMock.on(UpdateCommand).rejects(condFail()); // already selected
  const res = await select(authed({ generationId: 'g1', variantId: 'neon' }), { lambda: fakeLambda });
  assert.equal(res.statusCode, 409);
  assert.equal(fakeLambda.calls.length, 0);
});

test('select locks the choice and invokes assets phase (202)', async () => {
  const gen = {
    generationId: 'g1', ownerSub: 'u1', status: 'READY',
    variants: [{ variantId: 'neon' }],
  };
  ddbMock.on(GetCommand).resolves({ Item: gen });
  ddbMock.on(UpdateCommand).resolves({});
  const res = await select(authed({ generationId: 'g1', variantId: 'neon' }), { lambda: fakeLambda });
  assert.equal(res.statusCode, 202);
  assert.equal(fakeLambda.calls.length, 1);
  const payload = JSON.parse(Buffer.from(fakeLambda.calls[0].input.Payload).toString());
  assert.equal(payload.phase, 'assets');
});

test('status enforces owner-only access (403)', async () => {
  ddbMock.on(GetCommand).resolves({ Item: { generationId: 'g1', ownerSub: 'someoneElse' } });
  const res = await status({
    requestContext: { authorizer: { jwt: { claims: { sub: 'u1' } } } },
    pathParameters: { id: 'g1' },
  });
  assert.equal(res.statusCode, 403);
});

test('status returns steps + presigned variant previews', async () => {
  const gen = {
    generationId: 'g1', ownerSub: 'u1', status: 'READY',
    steps: [{ key: 'ready' }],
    variants: [{ variantId: 'neon', label: 'Neon', heroKey: 'assets/g1/neon/hero.png' }],
  };
  ddbMock.on(GetCommand).resolves({ Item: gen });
  const res = await status({
    requestContext: { authorizer: { jwt: { claims: { sub: 'u1' } } } },
    pathParameters: { id: 'g1' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.variants.length, 1);
  assert.match(body.variants[0].heroUrl, /^https:\/\//);
});

test('scores POST validates and stores (201)', async () => {
  ddbMock.on(PutCommand).resolves({});
  const res = await scores(authed({ playerName: 'Ada', score: 4321, style: 'neon' }));
  assert.equal(res.statusCode, 201);
});

test('scores POST rejects invalid score (422)', async () => {
  const res = await scores(authed({ playerName: 'Ada', score: -5 }));
  assert.equal(res.statusCode, 422);
});

test('scores GET returns top list publicly', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ playerName: 'Ada', score: 9 }] });
  const res = await scores(anon());
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).scores.length, 1);
});

test('gallery returns only opted-in creations with thumb urls', async () => {
  ddbMock.on(QueryCommand).resolves({
    Items: [{ generationId: 'g1', galleryPlayer: 'Ada', galleryStyle: 'neon', galleryThumb: 'assets/g1/neon/hero.png' }],
  });
  const res = await gallery(anon());
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.creations.length, 1);
  assert.match(body.creations[0].thumbUrl, /^https:\/\//);
});
