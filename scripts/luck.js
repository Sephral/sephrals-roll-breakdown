// Dice luck: how the natural d20 results of one player compare with the expected 10.5. Pure functions over the data a
// client keeps in its own user flag, so they are testable without Foundry.
//
// Data: { v: 1, all: bucket, session: bucket plus { start, last, rolls }, ids: [message ids] }
// A bucket counts { n, sum, c20, c1 }. The session is tonight. It restarts after a gap of eight hours without a roll
// and when the GM starts a new evening.

export const EXPECTED_AVERAGE = 10.5;
export const SESSION_GAP_MS = 8 * 60 * 60 * 1000;
export const MAX_SESSION_ROLLS = 60;
const MAX_IDS = 20;

export function emptyBucket() {
  return { n: 0, sum: 0, c20: 0, c1: 0 };
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function cleanBucket(bucket) {
  return { n: number(bucket?.n), sum: number(bucket?.sum), c20: number(bucket?.c20), c1: number(bucket?.c1) };
}

export function normalizeLuck(data) {
  const source = data && typeof data === "object" ? data : {};
  const session = source.session && typeof source.session === "object" ? source.session : null;
  return {
    v: 1,
    all: cleanBucket(source.all),
    session: session
      ? {
          ...cleanBucket(session),
          start: number(session.start),
          last: number(session.last),
          rolls: (Array.isArray(session.rolls) ? session.rolls : []).map(Number).filter(Number.isFinite)
        }
      : null,
    ids: Array.isArray(source.ids) ? source.ids.filter((id) => typeof id === "string") : []
  };
}

// The natural result of a d20 test: the leading d20 of the roll, the kept die when it was rolled twice. Null for every
// other roll, and when the result is not one number (two d20 without keeping one).
export function naturalFromRoll(roll) {
  const term = Array.isArray(roll?.terms) ? roll.terms[0] : null;
  if (!term || term.faces !== 20 || !Number.isInteger(term.number) || term.number < 1) return null;
  const results = (Array.isArray(term.results) ? term.results : []).filter((entry) => entry && entry.active !== false && !entry.discarded);
  if (results.length !== 1) return null;
  const value = Number(results[0].result);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : null;
}

function count(bucket, natural) {
  bucket.n += 1;
  bucket.sum += natural;
  if (natural === 20) bucket.c20 += 1;
  if (natural === 1) bucket.c1 += 1;
}

// Whether the stored session still is tonight's.
export function sessionIsCurrent(session, now, eveningStart = 0, gap = SESSION_GAP_MS) {
  if (!session || !session.n) return false;
  return now - session.last < gap && session.start >= eveningStart;
}

// Adds natural results to the data and returns the new data. messageId guards against counting one message twice.
export function recordNaturals(data, naturals, { now = Date.now(), eveningStart = 0, messageId = null, gap = SESSION_GAP_MS } = {}) {
  const luck = normalizeLuck(data);
  const list = (Array.isArray(naturals) ? naturals : []).filter((value) => Number.isInteger(value));
  if (!list.length) return luck;
  if (messageId && luck.ids.includes(messageId)) return luck;
  if (!sessionIsCurrent(luck.session, now, eveningStart, gap)) luck.session = { ...emptyBucket(), start: now, last: now, rolls: [] };
  for (const natural of list) {
    count(luck.all, natural);
    count(luck.session, natural);
    luck.session.rolls.push(natural);
  }
  luck.session.rolls = luck.session.rolls.slice(-MAX_SESSION_ROLLS);
  luck.session.last = now;
  if (messageId) luck.ids = [...luck.ids, messageId].slice(-MAX_IDS);
  return luck;
}

// The numbers to show for a bucket.
export function luckStats(bucket) {
  const { n, sum, c20, c1 } = cleanBucket(bucket);
  const average = n ? sum / n : null;
  return {
    n,
    average,
    difference: average === null ? null : average - EXPECTED_AVERAGE,
    c20,
    c1,
    expected20: n / 20,
    expected1: n / 20
  };
}

// The running average after each roll of the session, for the small curve.
export function runningAverages(rolls) {
  let sum = 0;
  return (Array.isArray(rolls) ? rolls : []).map((value, index) => {
    sum += Number(value);
    return sum / (index + 1);
  });
}

// Points for an SVG polyline in a box: the curve of running averages, the expected 10.5 runs through the middle.
export function curvePoints(rolls, width = 160, height = 44) {
  const averages = runningAverages(rolls);
  if (averages.length < 2) return { points: "", mid: height / 2 };
  const spread = Math.max(3, ...averages.map((value) => Math.abs(value - EXPECTED_AVERAGE)));
  const step = width / (averages.length - 1);
  const points = averages.map((value, index) => {
    const y = height / 2 - ((value - EXPECTED_AVERAGE) / spread) * (height / 2 - 2);
    return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
  });
  return { points: points.join(" "), mid: height / 2 };
}
