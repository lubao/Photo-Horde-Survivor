// POST /api/generate
// Body: { imageBase64, playerName?, allowGallery? }
// Uses Bedrock Nova Canvas IMAGE_VARIATION to create 3 styled hero previews
// from the user's photo. The player will later pick exactly one (see selectAsset).
import { randomUUID } from 'crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  s3, bedrock, ddb, env, ok, fail, parseBody,
  STYLE_VARIANTS, promptFor,
} from '../shared/common.mjs';

const SIGN_TTL = 60 * 60 * 24; // 24h

// Strip optional data URL prefix and return raw base64.
function rawBase64(input) {
  if (!input) return null;
  const m = String(input).match(/^data:image\/[a-zA-Z+]+;base64,(.*)$/);
  return m ? m[1] : input;
}

async function novaVariation(prompt, refImageB64, seed) {
  const payload = {
    taskType: 'IMAGE_VARIATION',
    imageVariationParams: {
      text: prompt,
      negativeText: 'blurry, low quality, text, watermark, deformed',
      images: [refImageB64],
      similarityStrength: 0.6,
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      height: 512,
      width: 512,
      cfgScale: 8.0,
      seed: seed >>> 0,
    },
  };
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: env.NOVA_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    }),
  );
  const decoded = JSON.parse(Buffer.from(res.body).toString('utf8'));
  if (decoded.error) throw new Error(`Nova error: ${decoded.error}`);
  return decoded.images?.[0]; // base64 png
}

async function putAsset(key, base64) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.ASSETS_BUCKET,
      Key: key,
      Body: Buffer.from(base64, 'base64'),
      ContentType: 'image/png',
    }),
  );
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.ASSETS_BUCKET, Key: key }),
    { expiresIn: SIGN_TTL },
  );
}

export const handler = async (event) => {
  try {
    const body = parseBody(event);
    const ref = rawBase64(body.imageBase64);
    if (!ref) return fail('imageBase64 is required');

    const playerName = (body.playerName || 'Anonymous').toString().slice(0, 24);
    const allowGallery = body.allowGallery === true;
    const generationId = randomUUID();

    // Persist the original upload (private, expires via lifecycle).
    await s3.send(
      new PutObjectCommand({
        Bucket: env.UPLOADS_BUCKET,
        Key: `uploads/${generationId}.png`,
        Body: Buffer.from(ref, 'base64'),
        ContentType: 'image/png',
      }),
    );

    // Generate one hero preview per style variant (3 choices).
    const variants = [];
    for (let i = 0; i < STYLE_VARIANTS.length; i++) {
      const v = STYLE_VARIANTS[i];
      const prompt = promptFor('hero', v.style);
      const img = await novaVariation(prompt, ref, 1000 + i);
      if (!img) throw new Error(`No image returned for variant ${v.id}`);
      const key = `assets/generations/${generationId}/${v.id}/hero.png`;
      const url = await putAsset(key, img);
      variants.push({ id: v.id, label: v.label, heroUrl: url, heroKey: key });
    }

    const now = new Date().toISOString();
    await ddb.send(
      new PutCommand({
        TableName: env.GENERATIONS_TABLE,
        Item: {
          generationId,
          status: 'awaiting_selection',
          playerName,
          allowGallery,
          createdAt: now,
          variants,
          // TTL: clean up abandoned generations after 30 days.
          ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        },
      }),
    );

    return ok({
      generationId,
      message: 'Generated 3 hero styles from your photo. Pick one — you can only choose once!',
      variants: variants.map(({ id, label, heroUrl }) => ({ id, label, heroUrl })),
    });
  } catch (err) {
    console.error('generateAssets error', err);
    return fail(err.message || 'generation failed', 500);
  }
};
