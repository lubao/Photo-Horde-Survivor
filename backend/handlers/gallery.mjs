// GET /api/gallery -> public AIGC creations (only those the player opted in to share)
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { s3, ddb, env, ok, fail } from '../shared/common.mjs';

const SIGN_TTL = 60 * 60 * 6;

function signKey(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.ASSETS_BUCKET, Key: key }), { expiresIn: SIGN_TTL });
}

export const handler = async () => {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: env.GENERATIONS_TABLE,
      IndexName: 'gallery-index',
      KeyConditionExpression: 'galleryPublic = :y',
      ExpressionAttributeValues: { ':y': 'Y' },
      ScanIndexForward: false, // newest first
      Limit: 30,
    }));

    const items = await Promise.all((res.Items || []).map(async (it) => {
      const base = `assets/generations/${it.generationId}/${it.selectedVariant}`;
      const [hero, background] = await Promise.all([
        signKey(`${base}/hero.png`),
        signKey(`${base}/background.png`).catch(() => null),
      ]);
      return {
        generationId: it.generationId,
        playerName: it.playerName,
        style: it.selectedVariant,
        createdAt: it.createdAt,
        heroUrl: hero,
        backgroundUrl: background,
      };
    }));

    return ok({ items });
  } catch (err) {
    console.error('gallery error', err);
    return fail(err.message || 'gallery failed', 500);
  }
};
