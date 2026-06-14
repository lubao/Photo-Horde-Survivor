// Thin API client over the HTTP API.
const API = (function () {
  const base = () => window.GAME_CONFIG.apiBase.replace(/\/$/, '');

  async function req(path, opts = {}) {
    const res = await fetch(base() + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    generate: (imageBase64, playerName, allowGallery) =>
      req('/generate', { method: 'POST', body: JSON.stringify({ imageBase64, playerName, allowGallery }) }),
    select: (generationId, variantId) =>
      req('/select', { method: 'POST', body: JSON.stringify({ generationId, variantId }) }),
    getScores: () => req('/scores'),
    submitScore: (payload) => req('/scores', { method: 'POST', body: JSON.stringify(payload) }),
    getGallery: () => req('/gallery'),
  };
})();
