import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/rate-limit.js';

describe('rate limiter', () => {
  it('lets through up to max per window, then blocks', () => {
    let ahora = 1_000_000;
    const rl = createRateLimiter({ max: 2, windowMs: 1_000, now: () => ahora });
    expect(rl.check('1.2.3.4')).toBe(true);
    expect(rl.check('1.2.3.4')).toBe(true);
    expect(rl.check('1.2.3.4')).toBe(false);
  });

  it('the window slides: old events stop counting', () => {
    let ahora = 1_000_000;
    const rl = createRateLimiter({ max: 2, windowMs: 1_000, now: () => ahora });
    rl.check('ip');
    rl.check('ip');
    expect(rl.check('ip')).toBe(false);
    ahora += 1_100;
    expect(rl.check('ip')).toBe(true);
  });

  it('each key has its own bucket', () => {
    let ahora = 1_000_000;
    const rl = createRateLimiter({ max: 1, windowMs: 1_000, now: () => ahora });
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    expect(rl.check('b')).toBe(true);
  });

  it('reset clears one key or everything', () => {
    let ahora = 1_000_000;
    const rl = createRateLimiter({ max: 1, windowMs: 1_000, now: () => ahora });
    rl.check('a');
    rl.check('b');
    rl.reset('a');
    expect(rl.check('a')).toBe(true);
    expect(rl.check('b')).toBe(false);
    rl.reset();
    expect(rl.check('b')).toBe(true);
  });
});
