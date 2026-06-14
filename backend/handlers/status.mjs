// GET /api/generate/{id}/status — authenticated, owner-only.
// Returns status, narration steps, hero variant previews, and (once selected)
// the full asset pack — all as presigned GET URLs.
import { ok, fail, getUser } from '../shared/common.mjs';
import { getGeneration } from '../shared/data.mjs';
import { presignAssetGet } from '../shared/storage.mjs';

async function withUrls(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k]) out[k.replace(/Key$/, 'Url')] = await presignAssetGet(obj[k]);
  }
  return out;
}

export async function handler(event) {
  const user = getUser(event);
  if (!user) return fail('Unauthorized', 401);

  const generationId =
    event?.pathParameters?.id || event?.pathParameters?.generationId;
  if (!generationId) return fail('generationId is required');

  const gen = await getGeneration(generationId);
  if (!gen) return fail('Generation not found', 404);
  if (gen.ownerSub !== user.sub) return fail('Forbidden', 403);

  const variants = [];
  for (const v of gen.variants || []) {
    variants.push({
      variantId: v.variantId,
      label: v.label,
      ...(await withUrls(v, ['heroKey'])),
    });
  }

  let assetPack;
  if (gen.assetPack) {
    assetPack = await withUrls(gen.assetPack, [
      'heroKey',
      'enemyKey',
      'bulletKey',
      'backgroundKey',
    ]);
  }

  return ok({
    generationId,
    status: gen.status,
    steps: gen.steps || [],
    variants,
    selectedVariantId: gen.selectedVariantId || null,
    assetPack,
    errorMessage: gen.errorMessage,
  });
}
