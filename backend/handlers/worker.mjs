// Generation worker Lambda (async, Event-invoked).
//   phase 'hero'   (default) — generate 3 styled hero previews for selection.
//   phase 'assets'          — after selection, generate enemy/bullet/background
//                             for the chosen style and finalize the asset pack.
//
// Runs asynchronously because Bedrock image calls are slow and exceed the HTTP
// API Gateway 30s integration timeout. The frontend polls /status for progress.
//
// Future upgrade path: a Step Functions Express workflow with a Map state to
// fan the styles/assets out in parallel with declarative retries.
import {
  getGeneration,
  appendStep,
  setVariants,
  setFailed,
  finalizeAssets,
} from '../shared/data.mjs';
import { getUploadBase64, putAsset } from '../shared/storage.mjs';
import {
  STYLE_VARIANTS,
  getStyle,
  promptFor,
  generateVariation,
  removeBackground,
} from '../shared/nova.mjs';

const defaultDeps = () => ({
  data: { getGeneration, appendStep, setVariants, setFailed, finalizeAssets },
  storage: { getUploadBase64, putAsset },
  nova: { generateVariation, removeBackground },
});

// Generate one asset image (optionally background-removed) and store it.
async function makeAsset({ nova, storage }, { base64, kind, style, key }) {
  const [img] = await nova.generateVariation({
    images: [base64],
    text: promptFor(kind, style),
    numberOfImages: 1,
  });
  let out = img;
  if (kind !== 'background') {
    // Backgrounds stay full-frame; hero/enemy/bullet become clean sprites.
    try {
      out = await nova.removeBackground(img);
    } catch {
      out = img;
    }
  }
  await storage.putAsset(key, out);
  return key;
}

async function runHeroPhase(deps, gen) {
  const { data, storage, nova } = deps;
  const generationId = gen.generationId;

  await data.appendStep(
    generationId,
    { key: 'analyze', label: 'Analyzing your photo' },
    'RUNNING',
  );
  const { base64 } = await storage.getUploadBase64(gen.uploadKey);

  await data.appendStep(
    generationId,
    { key: 'hero', label: 'Generating hero variants (Neon / Pixel / Cartoon)' },
    'RUNNING',
  );

  const variants = [];
  for (const variant of STYLE_VARIANTS) {
    const heroKey = `assets/${generationId}/${variant.id}/hero.png`;
    await makeAsset(
      { nova, storage },
      { base64, kind: 'hero', style: variant.style, key: heroKey },
    );
    variants.push({
      variantId: variant.id,
      label: variant.label,
      style: variant.style,
      heroKey,
    });
  }

  await data.appendStep(
    generationId,
    { key: 'sprites', label: 'Cleaning up sprites' },
    'RUNNING',
  );
  await data.setVariants(generationId, variants);
  await data.appendStep(
    generationId,
    { key: 'ready', label: 'Variants ready — choose one' },
    'READY',
  );
  return { phase: 'hero', variants: variants.length };
}

async function runAssetsPhase(deps, gen) {
  const { data, storage, nova } = deps;
  const generationId = gen.generationId;
  const variant = (gen.variants || []).find(
    (v) => v.variantId === gen.selectedVariantId,
  );
  const style = variant?.style || getStyle(gen.selectedVariantId)?.style;
  if (!style) throw new Error('selected variant/style not found');

  const { base64 } = await storage.getUploadBase64(gen.uploadKey);

  const kinds = [
    { kind: 'enemy', label: 'Generating enemies' },
    { kind: 'bullet', label: 'Forging projectiles' },
    { kind: 'background', label: 'Painting the arena' },
  ];
  const assetPack = { heroKey: variant.heroKey };
  for (const { kind, label } of kinds) {
    await data.appendStep(generationId, { key: kind, label }, 'BUILDING');
    const key = `assets/${generationId}/${gen.selectedVariantId}/${kind}.png`;
    await makeAsset({ nova, storage }, { base64, kind, style, key });
    assetPack[`${kind}Key`] = key;
  }

  await data.finalizeAssets(generationId, {
    assetPack,
    allowGallery: gen.allowGallery,
    playerName: gen.playerName,
    styleId: gen.selectedVariantId,
    thumbKey: assetPack.heroKey,
  });
  await data.appendStep(
    generationId,
    { key: 'complete', label: 'Your world is ready — play!' },
    'COMPLETE',
  );
  return { phase: 'assets', complete: true };
}

export async function handler(event, deps = defaultDeps()) {
  const generationId = event.generationId;
  const phase = event.phase || 'hero';
  if (!generationId) throw new Error('generationId is required');

  const gen = await deps.data.getGeneration(generationId);
  if (!gen) throw new Error(`generation ${generationId} not found`);

  try {
    return phase === 'assets'
      ? await runAssetsPhase(deps, gen)
      : await runHeroPhase(deps, gen);
  } catch (err) {
    await deps.data.setFailed(generationId, err.message || String(err));
    throw err;
  }
}
