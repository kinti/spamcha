// Thin middleware adapters: one for Express-style (req, res, next), one for
// Hono-style (context, next). Structural types only — no framework imports,
// zero dependencies. Next.js needs no adapter: call guard.review() in the
// route handler directly.
//
// Behavior on the two outcomes:
//   reject   → the adapter answers (403 + verdict JSON); the handler never runs
//   otherwise → verdict attached as `spamcha` (req.spamcha / c.get('spamcha'))

import type { Gatekeeper } from './guard.js';

interface ExpressLikeRequest {
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
}
interface ExpressLikeResponse {
  status(code: number): { json(body: unknown): unknown };
}
type ExpressNext = () => void;

function bodyToFields(body: unknown): Record<string, string> {
  if (typeof body === 'string') {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(body)) out[k] = v;
    return out;
  }
  if (body && typeof body === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return {};
}

export function middlewareExpress(guard: Gatekeeper) {
  return async (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressNext): Promise<void> => {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const verdict = await guard.review(bodyToFields(req.body), { ip });
    if (verdict.decision === 'reject') {
      res.status(403).json(verdict);
      return;
    }
    (req as Record<string, unknown>).spamcha = verdict;
    next();
  };
}

interface HonoLikeContext {
  req: {
    parseBody(): Promise<Record<string, unknown>>;
    header(name: string): string | undefined;
  };
  set(key: string, value: unknown): void;
  json(body: unknown, status?: number): unknown;
}

export function middlewareHono(guard: Gatekeeper) {
  return async (c: HonoLikeContext, next: () => Promise<void>): Promise<void> => {
    let fields: Record<string, string> = {};
    try {
      const raw = await c.req.parseBody();
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') fields[k] = v;
      }
    } catch {
      // no body: the gates will catch it (stamp:missing)
    }
    const ip = c.req.header('x-forwarded-for');
    const verdict = await guard.review(fields, { ip });
    if (verdict.decision === 'reject') {
      c.json(verdict, 403);
      return;
    }
    c.set('spamcha', verdict);
    await next();
  };
}
