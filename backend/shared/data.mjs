// DynamoDB data-access module. All functions accept an injectable `ddb`
// (DynamoDBDocumentClient) so handlers run in Lambda and tests run with fakes.
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb as defaultDdb, env } from './common.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const GALLERY_PARTITION = 'Y';
export const SCORE_BOARD = 'GLOBAL';

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Ordered narration steps surfaced to the frontend progress log.
export const STEP_SEQUENCE = [
  { key: 'analyze', label: 'Analyzing your photo' },
  { key: 'hero', label: 'Generating hero variants' },
  { key: 'sprites', label: 'Cleaning up sprites' },
  { key: 'ready', label: 'Variants ready — choose one' },
];

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export async function createGeneration(
  { generationId, ownerSub, playerName, allowGallery, uploadKey },
  { ddb = defaultDdb } = {},
) {
  const createdAt = nowIso();
  const item = {
    generationId,
    ownerSub,
    playerName: playerName || 'Player',
    allowGallery: !!allowGallery,
    uploadKey,
    status: 'PENDING',
    steps: [],
    createdAt,
    // 30-day TTL until a selection is finalized; lets abandoned gens expire.
    ttl: Math.floor((Date.now() + 30 * DAY_MS) / 1000),
  };
  await ddb.send(
    new PutCommand({ TableName: env.GENERATIONS_TABLE, Item: item }),
  );
  return item;
}

export async function getGeneration(generationId, { ddb = defaultDdb } = {}) {
  const res = await ddb.send(
    new GetCommand({ TableName: env.GENERATIONS_TABLE, Key: { generationId } }),
  );
  return res.Item || null;
}

/** Append a narration step and update the overall status atomically. */
export async function appendStep(
  generationId,
  step,
  status,
  { ddb = defaultDdb } = {},
) {
  const entry = { ...step, at: nowIso() };
  await ddb.send(
    new UpdateCommand({
      TableName: env.GENERATIONS_TABLE,
      Key: { generationId },
      UpdateExpression:
        'SET #steps = list_append(if_not_exists(#steps, :empty), :s), #status = :st, updatedAt = :now',
      ExpressionAttributeNames: { '#steps': 'steps', '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': [entry],
        ':empty': [],
        ':st': status,
        ':now': nowIso(),
      },
    }),
  );
}

/** Persist the 3 hero variant previews and mark the generation READY. */
export async function setVariants(
  generationId,
  variants,
  { ddb = defaultDdb } = {},
) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.GENERATIONS_TABLE,
      Key: { generationId },
      UpdateExpression: 'SET variants = :v, #status = :st, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':v': variants,
        ':st': 'READY',
        ':now': nowIso(),
      },
    }),
  );
}

export async function setFailed(generationId, message, { ddb = defaultDdb } = {}) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.GENERATIONS_TABLE,
      Key: { generationId },
      UpdateExpression: 'SET #status = :st, errorMessage = :m, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':st': 'FAILED', ':m': message, ':now': nowIso() },
    }),
  );
}

/**
 * Lock in a single variant selection. Succeeds only if the caller owns the
 * generation and no selection has been made yet. Returns true on success,
 * false if the selection was already made (single-selection guarantee).
 */
export async function selectVariant(
  generationId,
  ownerSub,
  variantId,
  { ddb = defaultDdb } = {},
) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.GENERATIONS_TABLE,
        Key: { generationId },
        UpdateExpression:
          'SET selectedVariantId = :vid, selectedAt = :now, #status = :st',
        ConditionExpression:
          'attribute_not_exists(selectedVariantId) AND ownerSub = :sub',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':vid': variantId,
          ':now': nowIso(),
          ':st': 'SELECTING',
          ':sub': ownerSub,
        },
      }),
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/** Store the final asset pack and (if opted-in) expose to the gallery. */
export async function finalizeAssets(
  generationId,
  { assetPack, allowGallery, playerName, styleId, thumbKey },
  { ddb = defaultDdb } = {},
) {
  const names = { '#status': 'status' };
  const values = {
    ':pack': assetPack,
    ':st': 'COMPLETE',
    ':now': nowIso(),
  };
  let expr =
    'SET assetPack = :pack, #status = :st, completedAt = :now REMOVE #ttl';
  names['#ttl'] = 'ttl';
  if (allowGallery) {
    // Set the GSI partition so the item appears in the gallery query.
    expr =
      'SET assetPack = :pack, #status = :st, completedAt = :now, galleryPublic = :g, galleryPlayer = :p, galleryStyle = :sty, galleryThumb = :thumb REMOVE #ttl';
    values[':g'] = GALLERY_PARTITION;
    values[':p'] = playerName || 'Player';
    values[':sty'] = styleId || '';
    values[':thumb'] = thumbKey || '';
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.GENERATIONS_TABLE,
      Key: { generationId },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** List opted-in gallery creations, newest first. */
export async function listGallery(limit = 30, { ddb = defaultDdb } = {}) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.GENERATIONS_TABLE,
      IndexName: 'gallery-index',
      KeyConditionExpression: 'galleryPublic = :g',
      ExpressionAttributeValues: { ':g': GALLERY_PARTITION },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return res.Items || [];
}

// ---------------------------------------------------------------------------
// Scores / leaderboard
// ---------------------------------------------------------------------------

export async function putScore(
  { scoreId, playerName, score, style, generationId, ownerSub },
  { ddb = defaultDdb } = {},
) {
  const item = {
    board: SCORE_BOARD,
    scoreId,
    playerName: playerName || 'Player',
    score,
    style: style || '',
    generationId: generationId || '',
    ownerSub: ownerSub || '',
    createdAt: nowIso(),
  };
  await ddb.send(new PutCommand({ TableName: env.SCORES_TABLE, Item: item }));
  return item;
}

export async function topScores(limit = 20, { ddb = defaultDdb } = {}) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.SCORES_TABLE,
      IndexName: 'score-index',
      KeyConditionExpression: 'board = :b',
      ExpressionAttributeValues: { ':b': SCORE_BOARD },
      ScanIndexForward: false, // highest score first
      Limit: limit,
    }),
  );
  return res.Items || [];
}

// ---------------------------------------------------------------------------
// Per-user daily generation quota
// ---------------------------------------------------------------------------

/**
 * Atomically increment a user's daily generation counter, enforcing `limit`.
 * Returns { allowed, count, limit }. When the limit is reached, allowed=false
 * and the counter is NOT incremented (conditional update fails cleanly).
 */
export async function incrementQuota(
  userSub,
  { limit = env.DAILY_QUOTA, ddb = defaultDdb, date = todayKey() } = {},
) {
  const pk = `${userSub}#${date}`;
  // Expire the counter ~2 days later so the table self-cleans.
  const ttl = Math.floor((Date.now() + 2 * DAY_MS) / 1000);
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.QUOTA_TABLE,
        Key: { pk },
        UpdateExpression:
          'SET #c = if_not_exists(#c, :zero) + :one, #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':limit': limit,
          ':ttl': ttl,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return { allowed: true, count: res.Attributes.count, limit };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return { allowed: false, count: limit, limit };
    }
    throw err;
  }
}
