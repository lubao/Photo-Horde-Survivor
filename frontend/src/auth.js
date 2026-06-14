// Cognito Hosted UI authentication (implicit grant). The ID token (aud = app
// client id) is sent as a Bearer token; the API Gateway JWT authorizer verifies
// it. Tokens are kept in sessionStorage and cleared on logout.
const TOKEN_KEY = 'phorde_id_token';
const EXP_KEY = 'phorde_id_exp';

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

// Parse #id_token=...&expires_in=... returned by the Hosted UI after login.
export function captureTokenFromHash() {
  if (!location.hash.includes('id_token')) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  const idToken = h.get('id_token');
  if (idToken) {
    const claims = decodeJwt(idToken);
    sessionStorage.setItem(TOKEN_KEY, idToken);
    if (claims?.exp) sessionStorage.setItem(EXP_KEY, String(claims.exp));
  }
  // Strip the token fragment from the URL.
  history.replaceState(null, '', location.pathname + location.search);
  return !!idToken;
}

export function getToken() {
  const exp = Number(sessionStorage.getItem(EXP_KEY) || '0');
  if (exp && Date.now() / 1000 > exp) {
    logoutLocal();
    return null;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

export function currentUser() {
  const t = getToken();
  if (!t) return null;
  const c = decodeJwt(t);
  return c ? { sub: c.sub, email: c.email, name: c['cognito:username'] || c.email } : null;
}

export function login(config) {
  const url =
    `https://${config.hostedUiDomain}/login?client_id=${encodeURIComponent(config.userPoolClientId)}` +
    `&response_type=token&scope=openid+email+profile` +
    `&redirect_uri=${encodeURIComponent(config.redirectUri)}`;
  location.assign(url);
}

export function logoutLocal() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXP_KEY);
}

export function logout(config) {
  logoutLocal();
  const url =
    `https://${config.hostedUiDomain}/logout?client_id=${encodeURIComponent(config.userPoolClientId)}` +
    `&logout_uri=${encodeURIComponent(config.redirectUri)}`;
  location.assign(url);
}
