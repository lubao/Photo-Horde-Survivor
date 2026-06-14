// GET /api/health — public health check (no auth required).
import { ok } from '../shared/common.mjs';

export async function handler() {
  return ok({
    status: 'ok',
    service: 'photo-horde-survivor',
    time: new Date().toISOString(),
  });
}
