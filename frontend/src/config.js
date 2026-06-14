// Runtime configuration loader.
// In production, CDK deploys /config.json alongside the site. For local dev you
// can override values via query params, e.g.
//   ?api=https://xxxx.execute-api.us-east-1.amazonaws.com&userPoolId=...&clientId=...&domain=...
let cached = null;

export async function loadConfig() {
  if (cached) return cached;
  const params = new URLSearchParams(location.search);
  let cfg = {};
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok) cfg = await res.json();
  } catch {
    /* local dev without config.json */
  }
  cached = {
    apiBase: (params.get('api') || cfg.apiBase || '/api').replace(/\/$/, ''),
    region: params.get('region') || cfg.region || 'us-east-1',
    userPoolId: params.get('userPoolId') || cfg.userPoolId || '',
    userPoolClientId: params.get('clientId') || cfg.userPoolClientId || '',
    hostedUiDomain: params.get('domain') || cfg.hostedUiDomain || '',
    redirectUri: params.get('redirect') || cfg.redirectUri || `${location.origin}/`,
  };
  return cached;
}
