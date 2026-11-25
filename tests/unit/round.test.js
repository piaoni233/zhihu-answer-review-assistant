import { describe, it, expect } from 'vitest';
import { roundHalfEvenInt, formatFixedHalfEven, formatPercent } from '../../src/core/round.js';

describe('core/round', () => {
  it('roundHalfEvenInt implements banker rounding for positive and negative ties', () => {
    expect(roundHalfEvenInt(0.5)).toBe(0);
    expect(roundHalfEvenInt(1.5)).toBe(2);
    expect(roundHalfEvenInt(2.5)).toBe(2);
    expect(roundHalfEvenInt(3.5)).toBe(4);
    expect(roundHalfEvenInt(12.5)).toBe(12);
    expect(roundHalfEvenInt(13.5)).toBe(14);
    expect(roundHalfEvenInt(-0.5)).toBe(0);
    expect(roundHalfEvenInt(-2.5)).toBe(-2);
    expect(roundHalfEvenInt(-3.5)).toBe(-4);
    expect(roundHalfEvenInt(2.49)).toBe(2);
    expect(roundHalfEvenInt(2.51)).toBe(3);
  });

  it('roundHalfEvenInt throws on non-finite values', () => {
    expect(() => roundHalfEvenInt(Number.NaN)).toThrow();
    expect(() => roundHalfEvenInt(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('formatFixedHalfEven matches Python exact-double half-even formatting', () => {
    // Classic counter-example where JS toFixed(2) gives 3.13 while Python gives 3.12
    expect(formatFixedHalfEven((1 / 32) * 100, 2)).toBe('3.12');
    expect(formatPercent((1 / 32) * 100)).toBe('3.12%');
    expect(formatFixedHalfEven(0, 2)).toBe('0.00');
    expect(formatFixedHalfEven(-3.125, 2)).toBe('-3.12');
    // -3.375 = -27/8 is exact in IEEE-754 double -> exact tie rounds to even -3.38
    expect(formatFixedHalfEven(-3.375, 2)).toBe('-3.38');
    // -3.135 in IEEE-754 double is -3.1349999999999997868... -> Python f"{-3.135:.2f}" == "-3.13"
    expect(formatFixedHalfEven(-3.135, 2)).toBe('-3.13');
    expect(formatFixedHalfEven(9.999, 2)).toBe('10.00');
    expect(formatFixedHalfEven(2.5, 0)).toBe('2');
    expect(formatFixedHalfEven(3.5, 0)).toBe('4');
  });

  it('handles null, undefined, non-finite, and huge numbers gracefully', () => {
    expect(formatFixedHalfEven(null)).toBe('—');
    expect(formatFixedHalfEven(undefined)).toBe('—');
    expect(formatFixedHalfEven(Number.NaN)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatFixedHalfEven(1e22, 2)).toBe((1e22).toFixed(2));
  });
});
