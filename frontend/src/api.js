// API client over the HTTP API. Protected calls send the Cognito ID token.
import { getToken } from './auth.js';

let API_BASE = '/api';
export function configureApi(cfg) {
  API_BASE = cfg.apiBase.replace(/\/$/, '');
}

async function req(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (!token) throw new Error('Not signed in');
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const API = {
  // 1. Get a presigned URL and upload the photo straight to S3.
  async uploadPhoto(file) {
    const { url, key } = await req('/upload-url', {
      method: 'POST',
      auth: true,
      body: { contentType: file.type, sizeBytes: file.size },
    });
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
    return key;
  },

  // 2. Kick off generation (async). Returns { generationId, status }.
  generate: (uploadKey, playerName, allowGallery) =>
    req('/generate', { method: 'POST', auth: true, body: { uploadKey, playerName, allowGallery } }),

  // 3. Poll generation status (steps, variants, assetPack).
  status: (generationId) =>
    req(`/generate/${encodeURIComponent(generationId)}/status`, { auth: true }),

  // 4. Lock in a variant (single selection, async asset build).
  select: (generationId, variantId) =>
    req('/select', { method: 'POST', auth: true, body: { generationId, variantId } }),

  getScores: () => req('/scores'),
  submitScore: (payload) => req('/scores', { method: 'POST', auth: true, body: payload }),
  getGallery: () => req('/gallery'),
};
