// POST /api/select
// Body: { generationId, variantId }
// Atomically locks the ONE allowed selection (conditional update), then
// generates the full asset pack (enemy, bullet, background) for the chosen style.
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  s3, bedrock, ddb, env, ok, fail, parseBody,
  STYLE_VARIANTS, promptFor,
} from '../shared/common.mjs';

const SIGN_TTL = 60 * 60 * 24;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
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
      numberOfImages: 1, height: 512, width: 512, cfgScale: 8.0, seed: seed >>> 0,
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
  return decoded.images?.[0];
}

async function putAsset(key, base64) {
  await s3.send(new PutObjectCommand({
    Bucket: env.ASSETS_BUCKET, Key: key,
    Body: Buffer.from(base64, 'base64'), ContentType: 'image/png',
  }));
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.ASSETS_BUCKET, Key: key }), { expiresIn: SIGN_TTL });
}

export const handler = async (event) => {
  try {
    const { generationId, variantId } = parseBody(event);
    if (!generationId || !variantId) return fail('generationId and variantId are required');

    const variant = STYLE_VARIANTS.find((v) => v.id === variantId);
    if (!variant) return fail('unknown variantId');

    // --- Single-selection lock: only succeeds while status is awaiting_selection ---
    try {
      await ddb.send(new UpdateCommand({
        TableName: env.GENERATIONS_TABLE,
        Key: { generationId },
        UpdateExpression: 'SET #s = :locked, selectedVariant = :v, selectedAt = :t',
        ConditionExpression: '#s = :await',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':locked': 'generating',
          ':await': 'awaiting_selection',
          ':v': variantId,
          ':t': new Date().toISOString(),
        },
      }));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        return fail('You have already chosen for this generation. Selection is final.', 409);
      }
      throw e;
    }

    // Load the record + original photo.
    const { Item } = await ddb.send(new GetCommand({
      TableName: env.GENERATIONS_TABLE, Key: { generationId },
    }));
    if (!Item) return fail('generation not found', 404);

    const obj = await s3.send(new GetObjectCommand({
      Bucket: env.UPLOADS_BUCKET, Key: `uploads/${generationId}.png`,
    }));
    const refB64 = (await streamToBuffer(obj.Body)).toString('base64');

    // Hero already produced during /generate.
    const heroKey = `assets/generations/${generationId}/${variantId}/hero.png`;
    const heroUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.ASSETS_BUCKET, Key: heroKey }), { expiresIn: SIGN_TTL });

    // Generate the rest of the pack for the chosen style.
    const pack = { hero: heroUrl };
    const kinds = ['enemy', 'bullet', 'background'];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const img = await novaVariation(promptFor(kind, variant.style), refB64, 2000 + i);
      if (!img) throw new Error(`No image for ${kind}`);
      pack[kind] = await putAsset(`assets/generations/${generationId}/${variantId}/${kind}.png`, img);
    }

    const galleryPublic = Item.allowGallery === true ? 'Y' : 'N';
    await ddb.send(new UpdateCommand({
      TableName: env.GENERATIONS_TABLE,
      Key: { generationId },
      UpdateExpression: 'SET #s = :done, galleryPublic = :gp REMOVE #ttl',
      ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':done': 'selected', ':gp': galleryPublic },
    }));

    return ok({
      generationId,
      selectedVariant: variantId,
      style: variant.label,
      assets: pack,
      message: `Locked in "${variant.label}". Your custom asset pack is ready — go mow them down!`,
    });
  } catch (err) {
    console.error('selectAsset error', err);
    return fail(err.message || 'selection failed', 500);
  }
};
