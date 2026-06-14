// Runtime configuration.
// When deployed behind CloudFront, the API is reachable at the same origin under /api.
// For local dev you can override with ?api=https://xxxx.execute-api.us-east-1.amazonaws.com
(function () {
  const params = new URLSearchParams(location.search);
  const override = params.get('api');
  window.GAME_CONFIG = {
    // Default: same-origin /api (works when served by the CloudFront distribution).
    apiBase: override || (window.__API_BASE__ || '/api'),
  };
})();
