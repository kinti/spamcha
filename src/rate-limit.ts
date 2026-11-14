// Per-key rate limiter: sliding window in memory, zero dependencies.
// Enough for a site's own contact endpoint: the goal is that a bot can't
// hammer the judge thousands of times, not DDoS protection (that lives upstream).

export interface RateLimitOptions {
  /** Allowed events per window, per key. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RateLimiter {
  /** true = let it through; false = window exhausted for this key. */
  check(key: string, nowMs?: number): boolean;
  reset(key?: string): void;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, number[]>();

  return {
    check(key: string, nowMs?: number): boolean {
      const now = nowMs ?? options.now?.() ?? Date.now();
      const fresh = (buckets.get(key) ?? []).filter((t) => now - t < options.windowMs);
      if (fresh.length >= options.max) {
        buckets.set(key, fresh);
        return false;
      }
      fresh.push(now);
      buckets.set(key, fresh);
      return true;
    },

    reset(key?: string): void {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}
