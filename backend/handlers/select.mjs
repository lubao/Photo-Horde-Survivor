// POST /api/select — authenticated, owner-only, single-selection.
// Atomically locks the chosen variant (409 if already chosen) and async-invokes
// the worker's 'assets' phase to generate enemy/bullet/background. The client
// continues polling /status until status === 'COMPLETE'.
// Body: { generationId, variantId } -> 202 { generationId, status: 'SELECTING' }
import { InvokeCommand } from '@aws-sdk/client-lambda';
import {
  ok,
  fail,
  parseBody,
  getUser,
  lambdaClient,
  env,
} from '../shared/common.mjs';
import { getGeneration, selectVariant } from '../shared/data.mjs';

export async function handler(event, { lambda = lambdaClient } = {}) {
  const user = getUser(event);
  if (!user) return fail('Unauthorized', 401);

  const { generationId, variantId } = parseBody(event);
  if (!generationId || !variantId) {
    return fail('generationId and variantId are required');
  }

  const gen = await getGeneration(generationId);
  if (!gen) return fail('Generation not found', 404);
  if (gen.ownerSub !== user.sub) return fail('Forbidden', 403);
  if (gen.status !== 'READY' && !gen.variants) {
    return fail('Generation is not ready for selection', 409);
  }
  const validVariant = (gen.variants || []).some((v) => v.variantId === variantId);
  if (!validVariant) return fail('Unknown variantId', 400);

  // Atomic single-selection lock.
  const locked = await selectVariant(generationId, user.sub, variantId);
  if (!locked) {
    return fail('A selection has already been made for this generation', 409, {
      selectedVariantId: gen.selectedVariantId,
    });
  }

  // Kick off async generation of the remaining assets for the chosen style.
  await lambda.send(
    new InvokeCommand({
      FunctionName: env.WORKER_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ generationId, phase: 'assets' })),
    }),
  );

  return ok({ generationId, selectedVariantId: variantId, status: 'SELECTING' }, 202);
}
