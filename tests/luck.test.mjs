import test from "node:test";
import assert from "node:assert/strict";
import { curvePoints, luckStats, naturalFromRoll, normalizeLuck, recordNaturals, runningAverages, SESSION_GAP_MS, sessionIsCurrent } from "../scripts/luck.js";

const hour = 60 * 60 * 1000;

test("the natural result is the kept d20", () => {
  const plain = { terms: [{ faces: 20, number: 1, results: [{ result: 13, active: true }] }, { operator: "+" }, { number: 5 }] };
  assert.equal(naturalFromRoll(plain), 13);
  const advantage = { terms: [{ faces: 20, number: 2, results: [{ result: 4, active: false, discarded: true }, { result: 17, active: true }] }] };
  assert.equal(naturalFromRoll(advantage), 17);
  const rerolled = { terms: [{ faces: 20, number: 1, results: [{ result: 1, active: false, rerolled: true }, { result: 9, active: true }] }] };
  assert.equal(naturalFromRoll(rerolled), 9);
  assert.equal(naturalFromRoll({ terms: [{ faces: 8, number: 1, results: [{ result: 5, active: true }] }] }), null);
  assert.equal(naturalFromRoll({ terms: [{ faces: 20, number: 2, results: [{ result: 4, active: true }, { result: 17, active: true }] }] }), null);
  assert.equal(naturalFromRoll({ terms: [{ number: 5 }] }), null);
  assert.equal(naturalFromRoll(null), null);
});

test("rolls are counted overall and tonight", () => {
  let data = recordNaturals(null, [20], { now: 1000, messageId: "a" });
  data = recordNaturals(data, [1], { now: 2000, messageId: "b" });
  data = recordNaturals(data, [11, 10], { now: 3000, messageId: "c" });
  assert.deepEqual(data.all, { n: 4, sum: 42, c20: 1, c1: 1 });
  assert.deepEqual(data.session.rolls, [20, 1, 11, 10]);
  const stats = luckStats(data.all);
  assert.equal(stats.average, 10.5);
  assert.equal(stats.difference, 0);
  assert.equal(stats.expected20, 0.2);
});

test("one message is counted once", () => {
  let data = recordNaturals(null, [12], { now: 1, messageId: "a" });
  data = recordNaturals(data, [12], { now: 2, messageId: "a" });
  assert.equal(data.all.n, 1);
});

test("a gap of eight hours or a new evening starts a new session, overall stays", () => {
  let data = recordNaturals(null, [10, 12], { now: 0 });
  data = recordNaturals(data, [14], { now: 7 * hour });
  assert.equal(data.session.n, 3);
  data = recordNaturals(data, [3], { now: 7 * hour + SESSION_GAP_MS + 1 });
  assert.equal(data.session.n, 1);
  assert.equal(data.all.n, 4);
  const evening = 7 * hour + SESSION_GAP_MS + 1000;
  assert.equal(sessionIsCurrent(data.session, 7 * hour + SESSION_GAP_MS + 2000, evening), false);
  data = recordNaturals(data, [8], { now: evening + 10, eveningStart: evening });
  assert.equal(data.session.n, 1);
  assert.equal(data.all.n, 5);
  assert.equal(sessionIsCurrent(data.session, evening + 20, evening), true);
});

test("stored data is cleaned", () => {
  const data = normalizeLuck({ all: { n: "3", sum: "x" }, session: { rolls: [1, "a", 20] }, ids: ["a", 5] });
  assert.equal(data.all.n, 3);
  assert.equal(data.all.sum, 0);
  assert.deepEqual(data.session.rolls, [1, 20]);
  assert.deepEqual(data.ids, ["a"]);
  assert.equal(luckStats(null).average, null);
});

test("the curve of running averages", () => {
  assert.deepEqual(runningAverages([10, 12, 20]), [10, 11, 14]);
  assert.equal(curvePoints([5]).points, "");
  const { points } = curvePoints([10, 11, 12]);
  assert.equal(points.split(" ").length, 3);
});
