// POST /api/upload-url — authenticated. Returns a presigned S3 PUT URL the
// browser uses to upload the raw photo directly to the uploads bucket.
// Body: { contentType, sizeBytes? } -> { url, key }
import { randomUUID } from 'node:crypto';
import { ok, fail, parseBody, getUser } from '../shared/common.mjs';
import { validateUpload, presignUpload } from '../shared/storage.mjs';

export async function handler(event) {
  const user = getUser(event);
  if (!user) return fail('Unauthorized', 401);

  const { contentType, sizeBytes } = parseBody(event);
  if (!contentType) return fail('contentType is required');

  const check = validateUpload({ contentType, sizeBytes });
  if (!check.ok) return fail(check.reason, 415);

  const { url, key } = await presignUpload({
    ownerSub: user.sub,
    contentType,
    uploadId: randomUUID(),
  });

  return ok({ url, key });
}
