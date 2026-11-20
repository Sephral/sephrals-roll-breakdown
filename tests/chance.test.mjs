import test from "node:test";
import assert from "node:assert/strict";
import { chanceOrBetter, chanceToReach, diceTermDistribution, formatPercent, modelFromRoll, NATURAL_RULES, parseModifier } from "../scripts/chance.js";

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} vs ${expected}`);
const die = (number, faces, modifiers = [], sign = 1) => ({ kind: "die", number, faces, modifiers, sign });
const flat = (value) => ({ kind: "const", value });

test("1d20+5 against 15 succeeds on 10 or more", () => {
  near(chanceToReach([die(1, 20), flat(5)], 15), 11 / 20);
});

test("2d20kh: advantage", () => {
  near(chanceToReach([die(2, 20, ["kh"])], 20), 1 - (19 / 20) ** 2);
  near(chanceToReach([die(2, 20, ["kh"]), flat(5)], 15), 1 - (9 / 20) ** 2);
});

test("2d20kl: disadvantage", () => {
  near(chanceToReach([die(2, 20, ["kl"])], 20), (1 / 20) ** 2);
  near(chanceToReach([die(2, 20, ["kl"]), flat(0)], 11), (10 / 20) ** 2);
});

test("2d6+3: exact sum", () => {
  near(chanceToReach([die(2, 6), flat(3)], 10), 21 / 36);
  near(chanceOrBetter([die(2, 6), flat(3)], 10), 21 / 36);
  near(chanceOrBetter([die(2, 6), flat(3)], 5), 1);
  near(chanceOrBetter([die(2, 6), flat(3)], 16), 0);
});

test("dice with a minus sign and extra dice", () => {
  // 1d20 + 1d4 against 20
  const expected = (() => {
    let hits = 0;
    for (let a = 1; a <= 20; a++) for (let b = 1; b <= 4; b++) if (a + b >= 20) hits++;
    return hits / 80;
  })();
  near(chanceToReach([die(1, 20), die(1, 4)], 20), expected);
  near(chanceToReach([die(1, 20), die(1, 4, [], -1)], 10), (() => {
    let hits = 0;
    for (let a = 1; a <= 20; a++) for (let b = 1; b <= 4; b++) if (a - b >= 10) hits++;
    return hits / 80;
  })());
});

test("4d6dl keeps the best three", () => {
  const term = diceTermDistribution({ number: 4, faces: 6, modifiers: ["dl"] });
  let sum = 0;
  for (const [, probability] of term.dist) sum += probability;
  near(sum, 1);
  near(term.dist.get(18), 21 / 1296);
  near(term.dist.get(3), 1 / 1296);
});

test("critical rules for a 5e attack", () => {
  const rule = NATURAL_RULES.attack(20, 1);
  // 1d20+5 against AC 30: only the natural 20 hits
  near(chanceToReach([die(1, 20), flat(5)], 30, rule), 1 / 20);
  // against AC 1: everything but the natural 1 hits
  near(chanceToReach([die(1, 20), flat(5)], 1, rule), 19 / 20);
  // against AC 15: 10..20 hit, nothing special for the rest
  near(chanceToReach([die(1, 20), flat(5)], 15, rule), 11 / 20);
  // advantage against AC 30
  near(chanceToReach([die(2, 20, ["kh"]), flat(5)], 30, rule), 1 - (19 / 20) ** 2);
  // a wider critical range
  near(chanceToReach([die(1, 20), flat(0)], 30, NATURAL_RULES.attack(19, 1)), 2 / 20);
});

test("degrees of success in Pathfinder 2e", () => {
  const rule = NATURAL_RULES.degree();
  // +10 against DC 20: 10 or more succeeds, a natural 1 would need 30 and fails, nat 20 always at least a success
  near(chanceToReach([die(1, 20), flat(10)], 20, rule), 11 / 20);
  // a natural 20 lifts a failure to a success, but not a critical failure: +0 against DC 30 needs a total of 21
  near(chanceToReach([die(1, 20), flat(0)], 30, rule), 0);
  near(chanceToReach([die(1, 20), flat(0)], 25, rule), 1 / 20);
  // a natural 1 cannot spoil a critical success: +20 against DC 10, only the natural 1 fails
  near(chanceToReach([die(1, 20), flat(20)], 10, rule), 1);
});

test("rerolls and explosions", () => {
  // reroll 1s once: P(1) = 1/36 for 1d6
  const once = diceTermDistribution({ number: 1, faces: 6, modifiers: ["r1"] });
  near(once.dist.get(1), 1 / 36);
  near(once.dist.get(2), 1 / 6 + 1 / 36);
  const recursive = diceTermDistribution({ number: 1, faces: 6, modifiers: ["rr1"] });
  assert.equal(recursive.dist.has(1), false);
  near(recursive.dist.get(4), 1 / 5);
  // halfling luck written the way dnd5e does
  near(diceTermDistribution({ number: 1, faces: 20, modifiers: ["r1=1"] }).dist.get(1), 1 / 400);
  const exploding = diceTermDistribution({ number: 1, faces: 6, modifiers: ["x"] });
  let sum = 0;
  for (const [, probability] of exploding.dist) sum += probability;
  near(sum, 1);
  assert.ok(exploding.dist.get(7) > 0);
  const clamped = diceTermDistribution({ number: 1, faces: 6, modifiers: ["min3"] });
  near(clamped.dist.get(3), 3 / 6);
});

test("modifiers are parsed, unknown ones refuse", () => {
  assert.deepEqual(parseModifier("kh", 20), { type: "keep", kind: "kh", count: 1 });
  assert.equal(parseModifier("cs>5", 6), null);
  assert.equal(diceTermDistribution({ number: 3, faces: 6, modifiers: ["cs>5"] }), null);
});

test("too much work is skipped", () => {
  assert.equal(diceTermDistribution({ number: 20, faces: 20, modifiers: ["kh3"] }), null);
  assert.equal(chanceToReach([die(200, 6)], 100), null);
});

test("a model from Foundry style terms", () => {
  const terms = [
    { faces: 20, number: 2, modifiers: ["kh"] },
    { operator: "+" },
    { number: 5 },
    { operator: "-" },
    { faces: 4, number: 1, modifiers: [] }
  ];
  assert.deepEqual(modelFromRoll({ terms }), [
    { kind: "die", number: 2, faces: 20, modifiers: ["kh"], sign: 1 },
    { kind: "const", value: 5 },
    { kind: "die", number: 1, faces: 4, modifiers: [], sign: -1 }
  ]);
  assert.equal(modelFromRoll({ terms: [{ number: 5 }] }), null);
  assert.equal(modelFromRoll({ terms: [{ faces: 6, number: 1, modifiers: [] }, { operator: "*" }, { number: 2 }] }), null);
  assert.equal(modelFromRoll({ terms: [{ faces: 6, number: 1 }, { operator: "+" }, { dice: [{}], total: 4 }] }), null);
  assert.deepEqual(modelFromRoll({ terms: [{ faces: 6, number: 1 }, { operator: "+" }, { total: 4, isDeterministic: true }] }).at(1), { kind: "const", value: 4 });
});

test("an arithmetic expression is no operator", () => {
  const terms = [{ faces: 20, number: 1, modifiers: [] }, { operator: "+" }, { operator: "*", operands: [{ number: 2 }, { faces: 6, number: 1 }], dice: [{}], total: 7 }];
  assert.equal(modelFromRoll({ terms }), null);
});

test("percent text", () => {
  const words = { percent: "{value} %", under: "< 1 %", over: "> 99 %" };
  assert.equal(formatPercent(0.55, words), "55 %");
  assert.equal(formatPercent(0.004, words), "< 1 %");
  assert.equal(formatPercent(0.995, words), "> 99 %");
  assert.equal(formatPercent(1, words), "100 %");
  assert.equal(formatPercent(0, words), "0 %");
});
