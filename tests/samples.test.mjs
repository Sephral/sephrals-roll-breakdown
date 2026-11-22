import test from "node:test";
import assert from "node:assert/strict";
import { sampleCards, sampleLuckRows } from "../scripts/sample-data.js";
import { buildSummaryLine } from "../scripts/summary-line.js";
import { modelFromRoll, distribution } from "../scripts/chance.js";
import { naturalFromRoll } from "../scripts/luck.js";

const WORDS = { advantage: "advantage", disadvantage: "disadvantage", from: "from", other: "other", more: "+{count} more", cancelled: "cancel", crit: "crit {range}", nat20: "natural 20", trims: [" modifier"] };

test("every card has rolls whose total is the sum of its kept dice and numbers", () => {
  for (const card of sampleCards()) {
    assert.ok(card.rolls.length >= 1, card.id);
    for (const { data, breakdown } of card.rolls) {
      const kept = data.terms.filter((term) => term.faces).reduce((sum, term) => sum + term.results.filter((entry) => entry.active).reduce((s, entry) => s + entry.result, 0), 0);
      const numbers = data.terms.filter((term) => term.class === "NumericTerm").reduce((sum, term) => sum + term.number, 0);
      assert.equal(data.total, kept + numbers, card.id);
      assert.equal(breakdown.rollTotal, data.total);
      assert.equal(breakdown.hasVisibleContent, true);
      assert.equal(breakdown.totalStaticModifier, numbers);
    }
  }
});

test("the chance model can produce every sample total", () => {
  for (const card of sampleCards()) {
    for (const { data } of card.rolls) {
      const roll = { terms: data.terms.map((term) => (term.class === "OperatorTerm" ? { operator: term.operator } : { ...term, total: 0 })) };
      const model = modelFromRoll(roll);
      assert.ok(model, card.id);
      const combined = distribution(model);
      assert.ok(combined.total.has(data.total), `${card.id} ${data.total}`);
    }
  }
});

test("the d20 results are natural results the dice luck counts", () => {
  const attack = sampleCards().find((card) => card.id === "attack").rolls[0].data;
  assert.equal(naturalFromRoll({ terms: attack.terms }), 17);
  const crit = sampleCards().find((card) => card.id === "crit").rolls[0].data;
  assert.equal(naturalFromRoll({ terms: crit.terms }), 20);
});

test("the short line names bonuses, advantage and the critical range", () => {
  const cards = new Map(sampleCards().map((card) => [card.id, card]));
  const attack = buildSummaryLine([cards.get("attack").rolls[0].breakdown], WORDS);
  assert.match(attack.text, /Strength/);
  assert.match(attack.text, /advantage from Help/);
  assert.match(attack.text, /\+1d4 Bless/);
  assert.match(buildSummaryLine([cards.get("crit").rolls[0].breakdown], WORDS).text, /crit 19–20.*natural 20/);
  assert.match(buildSummaryLine([cards.get("check").rolls[0].breakdown], WORDS).text, /cancel/);
  assert.match(buildSummaryLine([cards.get("save").rolls[0].breakdown], WORDS).text, /disadvantage from/);
});

test("a card with two rolls and a GM card exist", () => {
  const cards = sampleCards();
  assert.equal(cards.find((card) => card.id === "two").rolls.length, 2);
  assert.equal(cards.find((card) => card.id === "gm").gm, true);
});

test("the luck rows tell the four evenings apart", () => {
  const now = Date.parse("2026-11-22T20:00:00Z");
  const above = sampleLuckRows("above", "Lena", now);
  assert.equal(above.length, 4);
  assert.ok(above[0].isSelf && above[0].session.difference > 0.5);
  assert.ok(sampleLuckRows("below", "Lena", now)[0].session.difference < -0.5);
  assert.ok(Math.abs(sampleLuckRows("even", "Lena", now)[0].session.difference) < 0.5);
  assert.ok(sampleLuckRows("few", "Lena", now)[0].session.n < 5);
  assert.equal(above[3].session.n, 0);
  assert.ok(above[0].all.n > above[0].session.n);
});
