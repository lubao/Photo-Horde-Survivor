// Shared helpers for all Lambda handlers: AWS clients, HTTP/CORS responses,
// request parsing and Cognito JWT claim extraction.
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';

const region = process.env.AWS_REGION || 'us-east-1';

// Bedrock image generation can be slow; bump the read timeout well past the
// 60s SDK default (recommendation: >= 300s). See plan / Nova Canvas docs.
export const s3 = new S3Client({ region });
export const bedrock = new BedrockRuntimeClient({
  region,
  requestHandler: { requestTimeout: 300_000 },
});
export const lambdaClient = new LambdaClient({ region });
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

export const env = {
  UPLOADS_BUCKET: process.env.UPLOADS_BUCKET,
  ASSETS_BUCKET: process.env.ASSETS_BUCKET,
  GENERATIONS_TABLE: process.env.GENERATIONS_TABLE,
  SCORES_TABLE: process.env.SCORES_TABLE,
  QUOTA_TABLE: process.env.QUOTA_TABLE,
  WORKER_FUNCTION_NAME: process.env.WORKER_FUNCTION_NAME,
  NOVA_MODEL_ID: process.env.NOVA_MODEL_ID || 'amazon.nova-canvas-v1:0',
  DAILY_QUOTA: Number(process.env.DAILY_QUOTA || '10'),
  PRESIGN_TTL_SECONDS: Number(process.env.PRESIGN_TTL_SECONDS || '3600'),
};

// CORS is managed by API Gateway's HTTP API CORS configuration (restricted to
// the allowed origins). Handlers only set Content-Type so there is no duplicate
// or wildcard Access-Control-Allow-Origin header on responses.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function ok(body, statusCode = 200) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function fail(message, statusCode = 400, extra = {}) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: message, ...extra }),
  };
}

export function parseBody(event) {
  if (!event?.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Extract the authenticated Cognito user from an HTTP API (payload v2) event.
 * The JWT authorizer places verified claims at
 * event.requestContext.authorizer.jwt.claims.
 * Returns { sub, email, username } or null when unauthenticated.
 */
export function getUser(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !claims.sub) return null;
  return {
    sub: claims.sub,
    email: claims.email,
    username: claims['cognito:username'] || claims.username || claims.email,
  };
}
