// Preloaded via `node --import ./test/setup.mjs` so env vars are set before
// any handler/shared module captures them at import time.
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.UPLOADS_BUCKET = 'test-uploads';
process.env.ASSETS_BUCKET = 'test-assets';
process.env.GENERATIONS_TABLE = 'test-generations';
process.env.SCORES_TABLE = 'test-scores';
process.env.QUOTA_TABLE = 'test-quota';
process.env.WORKER_FUNCTION_NAME = 'test-worker';
process.env.NOVA_MODEL_ID = 'amazon.nova-canvas-v1:0';
process.env.DAILY_QUOTA = '3';
process.env.PRESIGN_TTL_SECONDS = '3600';
// Dummy creds so the AWS SDK can construct signed (presigned) URLs offline.
process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
process.env.AWS_SECRET_ACCESS_KEY = 'secrettest';
