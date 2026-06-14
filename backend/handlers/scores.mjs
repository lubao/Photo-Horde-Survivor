// /api/scores
//   GET  — public. Returns the top 20 leaderboard entries (highest first).
//   POST — authenticated. Submits a validated score.
import { randomUUID } from 'node:crypto';
import { ok, fail, parseBody, getUser } from '../shared/common.mjs';
import { putScore, topScores } from '../shared/data.mjs';

export const MAX_SCORE = 100_000_000;

function method(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || 'GET';
}

export function validateScore({ playerName, score }) {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { ok: false, reason: 'score must be a number' };
  }
  if (score < 0 || score > MAX_SCORE || !Number.isInteger(score)) {
    return { ok: false, reason: 'score out of range' };
  }
  if (playerName && String(playerName).length > 40) {
    return { ok: false, reason: 'playerName too long' };
  }
  return { ok: true };
}

export async function handler(event) {
  if (method(event) === 'POST') {
    const user = getUser(event);
    if (!user) return fail('Unauthorized', 401);

    const body = parseBody(event);
    const check = validateScore(body);
    if (!check.ok) return fail(check.reason, 422);

    const item = await putScore({
      scoreId: randomUUID(),
      playerName: body.playerName,
      score: body.score,
      style: body.style,
      generationId: body.generationId,
      ownerSub: user.sub,
    });
    return ok({ submitted: true, score: item.score }, 201);
  }

  const scores = await topScores(20);
  return ok({
    scores: scores.map((s) => ({
      playerName: s.playerName,
      score: s.score,
      style: s.style,
      createdAt: s.createdAt,
    })),
  });
}
