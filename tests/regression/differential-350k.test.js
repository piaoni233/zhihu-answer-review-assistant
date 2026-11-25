import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { calcRate } from '../../src/core/calculator.js';
import { formatPercent } from '../../src/core/round.js';
import { parseZhihuNumber } from '../../src/core/parser.js';

const SNAPSHOT_PATH = path.resolve(process.cwd(), 'tests/fixtures/differential-350k.json.gz');

describe('Differential regression against Python oracle (347,030 cases)', () => {
  const compressed = fs.readFileSync(SNAPSHOT_PATH);
  /** @type {{rates: Array<[number, number, string]>, nums: Array<[string, number|null]>}} */
  const snapshot = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

  it('matches all 247,030 rate formatting cases with 0 differences', () => {
    expect(snapshot.rates.length).toBe(247030);
    let mismatches = 0;
    const samples = [];

    for (let i = 0; i < snapshot.rates.length; i += 1) {
      const [part, whole, expectedPct] = snapshot.rates[i];
      const actualPct = formatPercent(calcRate(part, whole));
      if (actualPct !== expectedPct) {
        mismatches += 1;
        if (samples.length < 5) {
          samples.push({ part, whole, expectedPct, actualPct });
        }
      }
    }

    expect(samples).toEqual([]);
    expect(mismatches).toBe(0);
  });

  it('matches all 100,000 number parsing cases with 0 differences', () => {
    expect(snapshot.nums.length).toBe(100000);
    let mismatches = 0;
    const samples = [];

    for (let i = 0; i < snapshot.nums.length; i += 1) {
      const [input, expectedVal] = snapshot.nums[i];
      let actualVal = null;
      try {
        actualVal = parseZhihuNumber(input);
      } catch {
        actualVal = null;
      }
      if (actualVal !== expectedVal) {
        mismatches += 1;
        if (samples.length < 5) {
          samples.push({ input, expectedVal, actualVal });
        }
      }
    }

    expect(samples).toEqual([]);
    expect(mismatches).toBe(0);
  });
});
