import { describe, expect, it } from 'vitest';
import { dAtan2, dCos, dHypot, dSin } from '../src/sim/math';

describe('device-independent math', () => {
  it('matches the built-in functions closely', () => {
    for (let a = -40; a < 40; a += 0.0137) {
      expect(Math.abs(dSin(a) - Math.sin(a))).toBeLessThan(2e-9);
      expect(Math.abs(dCos(a) - Math.cos(a))).toBeLessThan(2e-9);
    }
    for (let i = 0; i < 4000; i++) {
      const y = Math.sin(i * 12.9898) * 300;
      const x = Math.cos(i * 78.233) * 300;
      expect(Math.abs(dAtan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-9);
      expect(Math.abs(dHypot(x, y) - Math.hypot(x, y))).toBeLessThan(1e-9);
    }
    expect(dAtan2(0, 0)).toBe(0);
    expect(Math.abs(dAtan2(0, -1) - Math.PI)).toBeLessThan(1e-12);
    expect(Math.abs(dAtan2(1, 0) - Math.PI / 2)).toBeLessThan(1e-12);
  });
});
