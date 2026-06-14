// GET  /api/scores            -> top 20 scores
// POST /api/scores            -> submit a score { playerName, score, generationId?, style? }
import { randomUUID } from 'crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, ok, fail, parseBody } from '../shared/common.mjs';

const BOARD = 'global';

// Zero-pad so descending lexicographic sort == descending score.
function scoreKey(score) {
  const pad = String(Math.min(score, 999999999)).padStart(9, '0');
  return `${pad}#${Date.now()}#${randomUUID().slice(0, 8)}`;
}

async function listTop(limit = 20) {
  const res = await ddb.send(new QueryCommand({
    TableName: env.LEADERBOARD_TABLE,
    KeyConditionExpression: 'board = :b',
    ExpressionAttributeValues: { ':b': BOARD },
    ScanIndexForward: false, // descending -> highest scores first
    Limit: limit,
  }));
  return (res.Items || []).map((it, idx) => ({
    rank: idx + 1,
    playerName: it.playerName,
    score: it.score,
    style: it.style || null,
    createdAt: it.createdAt,
  }));
}

export const handler = async (event) => {
  try {
    const method = event?.requestContext?.http?.method || 'GET';

    if (method === 'GET') {
      return ok({ board: BOARD, scores: await listTop(20) });
    }

    if (method === 'POST') {
      const body = parseBody(event);
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0) return fail('valid score is required');
      const playerName = (body.playerName || 'Anonymous').toString().slice(0, 24);

      await ddb.send(new PutCommand({
        TableName: env.LEADERBOARD_TABLE,
        Item: {
          board: BOARD,
          scoreId: scoreKey(Math.floor(score)),
          playerName,
          score: Math.floor(score),
          style: body.style ? String(body.style).slice(0, 32) : undefined,
          generationId: body.generationId,
          createdAt: new Date().toISOString(),
        },
      }));

      return ok({ submitted: true, scores: await listTop(20) });
    }

    return fail('method not allowed', 405);
  } catch (err) {
    console.error('scores error', err);
    return fail(err.message || 'scores failed', 500);
  }
};
