// Shared helpers for all Lambda handlers.
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION || 'us-east-1';

export const s3 = new S3Client({ region });
export const bedrock = new BedrockRuntimeClient({ region });
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

export const env = {
  UPLOADS_BUCKET: process.env.UPLOADS_BUCKET,
  ASSETS_BUCKET: process.env.ASSETS_BUCKET,
  GENERATIONS_TABLE: process.env.GENERATIONS_TABLE,
  LEADERBOARD_TABLE: process.env.LEADERBOARD_TABLE,
  NOVA_MODEL_ID: process.env.NOVA_MODEL_ID || 'amazon.nova-canvas-v1:0',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

export function ok(body, statusCode = 200) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export function fail(message, statusCode = 400, extra = {}) {
  return {
    statusCode,
    headers: CORS,
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

// The four asset "kinds" the game needs from a single user photo.
export const ASSET_KINDS = ['hero', 'enemy', 'bullet', 'background'];

// Prompt templates per asset kind. Three style variants give the player choice.
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

export function promptFor(kind, style) {
  switch (kind) {
    case 'hero':
      return `Heroic top-down game character based on the reference subject, full body, centered, ${style}, game asset, transparent-friendly plain background`;
    case 'enemy':
      return `Menacing monster enemy creature inspired by the reference subject, top-down game sprite, ${style}, game asset, plain background`;
    case 'bullet':
      return `Single glowing energy projectile / bullet icon themed after the reference subject, small centered game sprite, ${style}, plain dark background`;
    case 'background':
      return `Seamless top-down battle arena ground texture themed after the reference subject, no characters, ${style}, tileable game background`;
    default:
      return `Top-down game asset, ${style}`;
  }
}
