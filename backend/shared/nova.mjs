// Bedrock Nova Canvas wrapper: prompt building + IMAGE_VARIATION and
// BACKGROUND_REMOVAL task invocations. Pure helpers are exported for unit
// testing; the invoking functions accept an injectable bedrock client.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrock as defaultBedrock, env } from './common.mjs';

// The four asset "kinds" the game needs from a single user photo.
export const ASSET_KINDS = ['hero', 'enemy', 'bullet', 'background'];

// Three style variants give the player a choice (they pick exactly one).
export const STYLE_VARIANTS = [
  {
    id: 'neon',
    label: 'Neon Arcade',
    style: 'vibrant neon cyberpunk arcade art, glowing rim light, dark background',
  },
  {
    id: 'pixel',
    label: 'Retro Pixel',
    style: '16-bit retro pixel-art sprite, crisp pixels, limited palette',
  },
  {
    id: 'toon',
    label: 'Bold Cartoon',
    style: 'bold cartoon vector style, thick outlines, flat cel shading, playful',
  },
];

export function getStyle(styleId) {
  return STYLE_VARIANTS.find((s) => s.id === styleId);
}

// Build the positive prompt for a given asset kind + style.
// Note: avoid negation words here (Nova guidance) -> use negativeText instead.
export function promptFor(kind, style) {
  switch (kind) {
    case 'hero':
      return `Heroic top-down game character based on the reference subject, full body, centered, ${style}, clean game asset on plain solid background`;
    case 'enemy':
      return `Menacing monster enemy creature inspired by the reference subject, top-down game sprite, ${style}, clean game asset on plain solid background`;
    case 'bullet':
      return `Single glowing energy projectile bullet icon themed after the reference subject, small centered game sprite, ${style}, plain dark background`;
    case 'background':
      return `Seamless top-down battle arena ground texture themed after the reference subject, empty scenery, ${style}, tileable game background`;
    default:
      return `Top-down game asset, ${style}`;
  }
}

export const NEGATIVE_TEXT =
  'text, watermark, signature, blurry, low quality, deformed, extra limbs, frame, border';

// Default generation config tuned per plan/Nova docs.
export const DEFAULT_CONFIG = {
  width: 512,
  height: 512,
  cfgScale: 6.5,
  similarityStrength: 0.6,
};

/**
 * Build an IMAGE_VARIATION request body.
 * @param {object} p
 * @param {string[]} p.images - base64 PNG/JPEG reference images (1-5)
 * @param {string} p.text - positive prompt (1-1024 chars)
 */
export function buildVariationBody({
  images,
  text,
  negativeText = NEGATIVE_TEXT,
  numberOfImages = 1,
  width = DEFAULT_CONFIG.width,
  height = DEFAULT_CONFIG.height,
  cfgScale = DEFAULT_CONFIG.cfgScale,
  similarityStrength = DEFAULT_CONFIG.similarityStrength,
  seed,
}) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 5) {
    throw new Error('IMAGE_VARIATION requires 1-5 reference images');
  }
  if (!text || text.length < 1 || text.length > 1024) {
    throw new Error('prompt text must be 1-1024 characters');
  }
  const clampedSim = Math.min(1.0, Math.max(0.2, similarityStrength));
  return {
    taskType: 'IMAGE_VARIATION',
    imageVariationParams: {
      images,
      similarityStrength: clampedSim,
      text,
      negativeText,
    },
    imageGenerationConfig: {
      width,
      height,
      cfgScale,
      numberOfImages: Math.min(5, Math.max(1, numberOfImages)),
      ...(seed !== undefined ? { seed } : {}),
    },
  };
}

export function buildBackgroundRemovalBody(imageBase64) {
  return {
    taskType: 'BACKGROUND_REMOVAL',
    backgroundRemovalParams: { image: imageBase64 },
  };
}

/**
 * Parse a Nova Canvas response body (Uint8Array/Buffer/string) into
 * { images: string[], error?: string }. RAI moderation may drop images, so the
 * returned list can be shorter than requested (or empty).
 */
export function parseModelResponse(rawBody) {
  let text;
  if (rawBody instanceof Uint8Array) {
    text = Buffer.from(rawBody).toString('utf8');
  } else if (Buffer.isBuffer(rawBody)) {
    text = rawBody.toString('utf8');
  } else {
    text = String(rawBody);
  }
  const parsed = JSON.parse(text);
  return { images: Array.isArray(parsed.images) ? parsed.images : [], error: parsed.error };
}

async function invoke(body, client) {
  const cmd = new InvokeModelCommand({
    modelId: env.NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });
  const res = await client.send(cmd);
  return parseModelResponse(res.body);
}

/**
 * Generate one or more variations of the reference image(s).
 * Returns array of base64 PNG strings (may be shorter than numberOfImages
 * if RAI moderation removed some). Throws if the model returned an error and
 * produced no images.
 */
export async function generateVariation(params, { client = defaultBedrock } = {}) {
  const body = buildVariationBody(params);
  const { images, error } = await invoke(body, client);
  if (images.length === 0) {
    throw new Error(error || 'Nova Canvas returned no images (content moderation?)');
  }
  return images;
}

/** Remove the background of a base64 image, returning a transparent PNG (base64). */
export async function removeBackground(imageBase64, { client = defaultBedrock } = {}) {
  const body = buildBackgroundRemovalBody(imageBase64);
  const { images, error } = await invoke(body, client);
  if (images.length === 0) {
    throw new Error(error || 'Background removal returned no image');
  }
  return images[0];
}
