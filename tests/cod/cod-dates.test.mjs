// Run with: node --test tests/cod/cod-dates.test.mjs
// The COD dashboard's date filter (app/utils/cod-dates.shared.js): days are the shop's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCodRange, localDate, localHour, startOfDayMs, addDays, dayCount, isYmd, rangeText, rangeDays, COD_RANGE_MAX_DAYS,
} from '../../app/utils/cod-dates.shared.js';

const IST = 'Asia/Kolkata';
// 24 Oct 2026, 01:30 in India = 23 Oct 2026, 20:00 UTC.
const now = new Date('2026-10-23T20:00:00Z');

test('days and hours are the shop\'s, not the server\'s', () => {
  assert.equal(localDate(now, IST), '2026-10-24');
  assert.equal(localDate(now, 'UTC'), '2026-10-23');
  assert.equal(localHour(now, IST), 1);
  assert.equal(localDate(now, 'Not/AZone'), '2026-10-23', 'an unknown zone falls back to UTC');
  assert.equal(new Date(startOfDayMs('2026-10-24', IST)).toISOString(), '2026-10-23T18:30:00.000Z');
  // A zone with daylight saving: the day after the clocks go forward starts at the new offset.
  assert.equal(new Date(startOfDayMs('2026-03-09', 'America/New_York')).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(new Date(startOfDayMs('2026-03-07', 'America/New_York')).toISOString(), '2026-03-07T05:00:00.000Z');
});

test('presets: today, yesterday, last N days (today included), this / last month', () => {
  const r = (range) => resolveCodRange({ range }, { now, timeZone: IST });
  assert.deepEqual([r('today').from, r('today').to, r('today').days], ['2026-10-24', '2026-10-24', 1]);
  assert.deepEqual([r('yesterday').from, r('yesterday').to], ['2026-10-23', '2026-10-23']);
  assert.deepEqual([r('last7').from, r('last7').to, r('last7').days], ['2026-10-18', '2026-10-24', 7]);
  assert.equal(r('last30').from, '2026-09-25');
  assert.equal(r('last90').days, 90);
  assert.deepEqual([r('thisMonth').from, r('thisMonth').to], ['2026-10-01', '2026-10-24']);
  assert.deepEqual([r('lastMonth').from, r('lastMonth').to], ['2026-09-01', '2026-09-30']);
  const jan = resolveCodRange({ range: 'lastMonth' }, { now: new Date('2027-01-10T06:00:00Z'), timeZone: IST });
  assert.deepEqual([jan.from, jan.to], ['2026-12-01', '2026-12-31']);
  // The instants a range covers: shop midnight to the next shop midnight after `to`.
  const today = r('today');
  assert.deepEqual([new Date(today.startMs).toISOString(), new Date(today.endMs).toISOString()], ['2026-10-23T18:30:00.000Z', '2026-10-24T18:30:00.000Z']);
  assert.equal(r('last7').label, 'Last 7 days');
});

test('default and bad input: last 30 days', () => {
  for (const q of [{}, { range: 'forever' }, { from: '2026-02-30', to: '2026-03-01' }, { from: 'x', to: 'y' }]) {
    const res = resolveCodRange(q, { now, timeZone: IST });
    assert.deepEqual([res.preset, res.from, res.to], ['last30', '2026-09-25', '2026-10-24'], JSON.stringify(q));
  }
});

test('custom days: swapped ends fixed, never past today, at most a year', () => {
  const r = (from, to) => resolveCodRange({ from, to }, { now, timeZone: IST });
  const one = r('2026-10-05', '2026-10-01');
  assert.deepEqual([one.preset, one.from, one.to, one.days, one.label], ['custom', '2026-10-01', '2026-10-05', 5, '1 Oct – 5 Oct 2026']);
  assert.equal(r('2026-10-20', '2026-12-31').to, '2026-10-24', 'the future is cut off');
  assert.equal(r('2026-12-01', '2026-12-31').from, '2026-10-24', 'all in the future = today');
  const long = r('2020-01-01', '2026-10-24');
  assert.equal(long.days, COD_RANGE_MAX_DAYS);
  assert.equal(long.to, '2026-10-24');
  assert.equal(r('2026-10-24', '2026-10-24').label, '24 Oct 2026');
  assert.equal(rangeText('2025-12-28', '2026-01-03'), '28 Dec 2025 – 3 Jan 2026', 'the year on both ends when they differ');
  assert.equal(resolveCodRange({ range: 'last7', from: '2026-10-01', to: '2026-10-02' }, { now, timeZone: IST }).preset, 'last7', 'a preset wins');
});

test('helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(dayCount('2026-10-01', '2026-10-31'), 31);
  assert.deepEqual(rangeDays('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(isYmd('2026-02-29'), false);
  assert.equal(isYmd('2028-02-29'), true);
  assert.equal(isYmd('26-1-1'), false);
});
