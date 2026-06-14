// S3 storage helpers: presigned upload/download URLs, object read/write, and
// content-type/size validation for user photo uploads.
import {
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 as defaultS3, env } from './common.mjs';

export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png'];
export const MAX_UPLOAD_BYTES = 3.75 * 1024 * 1024; // Nova Canvas input limit

export function validateUpload({ contentType, sizeBytes }) {
  if (!ALLOWED_UPLOAD_TYPES.includes(contentType)) {
    return { ok: false, reason: 'Only JPEG or PNG images are allowed' };
  }
  if (typeof sizeBytes === 'number' && sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'Image must be 3.75 MB or smaller' };
  }
  return { ok: true };
}

function extForType(contentType) {
  return contentType === 'image/png' ? 'png' : 'jpg';
}

/**
 * Build a presigned PUT URL into the uploads bucket, namespaced by user.
 * Returns { url, key }.
 */
export async function presignUpload(
  { ownerSub, contentType, uploadId },
  { s3 = defaultS3 } = {},
) {
  const key = `uploads/${ownerSub}/${uploadId}.${extForType(contentType)}`;
  const cmd = new PutObjectCommand({
    Bucket: env.UPLOADS_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(s3, cmd, { expiresIn: env.PRESIGN_TTL_SECONDS });
  return { url, key };
}

export async function presignAssetGet(key, { s3 = defaultS3 } = {}) {
  const cmd = new GetObjectCommand({ Bucket: env.ASSETS_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: env.PRESIGN_TTL_SECONDS });
}

/** Read an object from the uploads bucket and return base64 + contentType. */
export async function getUploadBase64(key, { s3 = defaultS3 } = {}) {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: env.UPLOADS_BUCKET, Key: key }),
  );
  const bytes = await res.Body.transformToByteArray();
  return {
    base64: Buffer.from(bytes).toString('base64'),
    contentType: res.ContentType || 'image/png',
  };
}

/** Store a base64 PNG asset and return its key. */
export async function putAsset(key, base64Png, { s3 = defaultS3 } = {}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.ASSETS_BUCKET,
      Key: key,
      Body: Buffer.from(base64Png, 'base64'),
      ContentType: 'image/png',
    }),
  );
  return key;
}
