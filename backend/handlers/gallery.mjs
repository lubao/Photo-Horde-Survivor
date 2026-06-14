// GET /api/gallery — public. Returns only creations where the player opted in
// (allowGallery === true, surfaced via the gallery GSI). Never exposes the
// user's raw photo — only the generated hero sprite thumbnail.
import { ok } from '../shared/common.mjs';
import { listGallery } from '../shared/data.mjs';
import { presignAssetGet } from '../shared/storage.mjs';

export async function handler() {
  const items = await listGallery(30);
  const creations = [];
  for (const it of items) {
    const thumbKey = it.galleryThumb || it.assetPack?.heroKey;
    creations.push({
      generationId: it.generationId,
      playerName: it.galleryPlayer || it.playerName || 'Player',
      style: it.galleryStyle || it.selectedVariantId || '',
      createdAt: it.completedAt || it.createdAt,
      thumbUrl: thumbKey ? await presignAssetGet(thumbKey) : null,
    });
  }
  return ok({ creations });
}
