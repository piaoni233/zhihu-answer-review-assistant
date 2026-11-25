import { describe, it, expect } from 'vitest';
import {
  parseWallDate,
  parseDateTimeLocalValue,
  localDateToWallUtcMs,
  diffDaysFloor,
  formatUtcMinute,
  formatUtcDateTimeLocal,
  formatUtcDate,
} from '../../src/core/date.js';

describe('core/date', () => {
  it('parses all 5 supported wall-clock date formats', () => {
    expect(parseWallDate('2026-11-16 12:00')).toEqual({
      utcMs: Date.UTC(2026, 10, 16, 12, 0, 0),
      dateStr: '2026-11-16',
      hasTime: true,
    });
    expect(parseWallDate('2026-11-16 12:00:30')).toEqual({
      utcMs: Date.UTC(2026, 10, 16, 12, 0, 30),
      dateStr: '2026-11-16',
      hasTime: true,
    });
    expect(parseWallDate('2026-11-16')).toEqual({
      utcMs: Date.UTC(2026, 10, 16, 0, 0, 0),
      dateStr: '2026-11-16',
      hasTime: false,
    });
    expect(parseWallDate('2026/11/16 08:30')).toEqual({
      utcMs: Date.UTC(2026, 10, 16, 8, 30, 0),
      dateStr: '2026-11-16',
      hasTime: true,
    });
    expect(parseWallDate('2026/1/5')).toEqual({
      utcMs: Date.UTC(2026, 0, 5, 0, 0, 0),
      dateStr: '2026-01-05',
      hasTime: false,
    });
  });

  it('validates leap years and rejects invalid calendar dates, yearless, and relative strings', () => {
    expect(parseWallDate('2024-02-29')).not.toBeNull();
    expect(parseWallDate('2026-02-29')).toBeNull();
    expect(parseWallDate('2026-02-30')).toBeNull();
    expect(parseWallDate('2026-13-01')).toBeNull();
    expect(parseWallDate('2026-11-16 25:00')).toBeNull();
    expect(parseWallDate('11-16')).toBeNull();
    expect(parseWallDate('昨天 12:00')).toBeNull();
    expect(parseWallDate('3 小时前')).toBeNull();
    expect(parseWallDate('')).toBeNull();
  });

  it('computes floor day differences deterministically in UTC (no DST drift)', () => {
    const d1 = parseWallDate('2026-11-16 12:00');
    const d2 = parseWallDate('2026-11-21 19:00');
    expect(diffDaysFloor(d1.utcMs, d2.utcMs)).toBe(5);

    // 5 days minus 1 minute -> 4 days
    const d3 = parseWallDate('2026-11-21 11:59');
    expect(diffDaysFloor(d1.utcMs, d3.utcMs)).toBe(4);

    // Across US DST spring-forward boundary
    const dst1 = parseWallDate('2026-03-07 12:00');
    const dst2 = parseWallDate('2026-03-09 12:00');
    expect(diffDaysFloor(dst1.utcMs, dst2.utcMs)).toBe(2);
  });

  it('formats and converts datetime-local helpers accurately', () => {
    const utcMs = Date.UTC(2026, 10, 25, 18, 5, 0);
    expect(formatUtcMinute(utcMs)).toBe('2026-11-25 18:05');
    expect(formatUtcDateTimeLocal(utcMs)).toBe('2026-11-25T18:05');
    expect(formatUtcDate(utcMs)).toBe('2026-11-25');
    expect(parseDateTimeLocalValue('2026-11-25T18:05')).toBe(utcMs);
    expect(parseDateTimeLocalValue('bad')).toBeNull();

    const localMs = localDateToWallUtcMs(new Date(2026, 10, 25, 18, 0, 0));
    expect(formatUtcMinute(localMs)).toBe('2026-11-25 18:00');
  });
});
