// Pure helpers for the generation polling / selection state machine, kept
// DOM-free so they can be unit tested.

export function isReady(st) {
  return st && st.status === 'READY' && Array.isArray(st.variants) && st.variants.length > 0;
}

export function isComplete(st) {
  return st && st.status === 'COMPLETE' && !!st.assetPack;
}

export function isFailed(st) {
  return st && st.status === 'FAILED';
}

// Map a presigned asset pack to the engine's asset url shape.
export function assetUrls(pack) {
  if (!pack) return {};
  return {
    hero: pack.heroUrl,
    enemy: pack.enemyUrl,
    bullet: pack.bulletUrl,
    background: pack.backgroundUrl,
  };
}

// Build the narration list view: every step but the last is "done"; the last is
// "active" unless the whole generation reached a terminal-ready state.
export function stepView(steps, done) {
  return (steps || []).map((s, i, arr) => {
    const isLast = i === arr.length - 1;
    const finished = done || !isLast;
    return { mark: finished ? '✓' : '…', label: s.label, done: finished };
  });
}
