import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/core/events';
import { Store } from '../src/core/store';
import { J2000_EPOCH_MS, dateToUniversalTime, formatUniversalTime, timeAgo, universalTimeToDate } from '../src/core/time';

describe('Emitter', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const e = new Emitter<{ ping: number }>();
    const fn = vi.fn();
    const off = e.on('ping', fn);
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });
});

describe('Store', () => {
  it('only notifies on actual change', () => {
    const state = { n: 1 };
    const s = new Store(state);
    const fn = vi.fn();
    s.subscribe(fn);
    s.set(state);
    expect(fn).not.toHaveBeenCalled();
    s.update((c) => ({ n: c.n + 1 }));
    expect(fn).toHaveBeenCalledWith({ n: 2 }, { n: 1 });
  });
});

describe('universal time', () => {
  it('UT 0 is J2000 noon UTC', () => {
    expect(universalTimeToDate(0).toISOString()).toBe('2000-01-01T12:00:00.000Z');
    expect(universalTimeToDate(0).getTime()).toBe(J2000_EPOCH_MS);
  });

  it('round-trips dates', () => {
    const d = new Date(Date.UTC(2031, 3, 2, 18, 30));
    expect(universalTimeToDate(dateToUniversalTime(d)).getTime()).toBe(d.getTime());
  });

  it('formats UT for display', () => {
    expect(formatUniversalTime(0)).toBe('2000-01-01 12:00 UTC');
    expect(formatUniversalTime(86400 * 366)).toBe('2001-01-01 12:00 UTC'); // 2000 was a leap year
    expect(formatUniversalTime(Number.NaN)).toBe('—');
  });

  it('describes elapsed real time', () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 5_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2 d ago');
  });
});
