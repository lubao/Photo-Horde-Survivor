// POST /api/generate — authenticated. Enforces the per-user daily quota,
// creates a Generations record and asynchronously invokes the worker Lambda.
// Body: { uploadKey, playerName?, allowGallery? } -> { generationId, status }
import { randomUUID } from 'node:crypto';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import {
  ok,
  fail,
  parseBody,
  getUser,
  lambdaClient,
  env,
} from '../shared/common.mjs';
import { createGeneration, incrementQuota } from '../shared/data.mjs';

export async function handler(event, { lambda = lambdaClient } = {}) {
  const user = getUser(event);
  if (!user) return fail('Unauthorized', 401);

  const { uploadKey, playerName, allowGallery } = parseBody(event);
  if (!uploadKey) return fail('uploadKey is required');
  // The upload key is namespaced by user sub; reject other users' uploads.
  if (!uploadKey.startsWith(`uploads/${user.sub}/`)) {
    return fail('uploadKey does not belong to caller', 403);
  }

  // Quota check (atomic increment, conditional on staying under limit).
  const quota = await incrementQuota(user.sub);
  if (!quota.allowed) {
    return fail(
      `Daily generation limit reached (${quota.limit}/day). Try again tomorrow.`,
      429,
      { limit: quota.limit },
    );
  }

  const generationId = randomUUID();
  await createGeneration({
    generationId,
    ownerSub: user.sub,
    playerName,
    allowGallery,
    uploadKey,
  });

  // Fire-and-forget async worker (Event invocation -> returns immediately).
  await lambda.send(
    new InvokeCommand({
      FunctionName: env.WORKER_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ generationId })),
    }),
  );

  return ok({ generationId, status: 'PENDING', quota }, 202);
}
