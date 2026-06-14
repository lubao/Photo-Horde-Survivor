import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUpload, MAX_UPLOAD_BYTES } from '../shared/storage.mjs';

test('validateUpload accepts jpeg/png within size', () => {
  assert.equal(validateUpload({ contentType: 'image/png', sizeBytes: 1000 }).ok, true);
  assert.equal(validateUpload({ contentType: 'image/jpeg' }).ok, true);
});

test('validateUpload rejects unsupported types', () => {
  const r = validateUpload({ contentType: 'image/gif' });
  assert.equal(r.ok, false);
});

test('validateUpload rejects oversized files', () => {
  const r = validateUpload({ contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 });
  assert.equal(r.ok, false);
});
