import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { Die, NumericTerm, WildDie, installDiceEnvironment, installLangFetch, installSystemGame, joinTerms } from "./helpers/system-fixtures.mjs";

// Shapes follow the SWADE system source (gitlab.com/peginc/swade, develop as of 2026-10):
// src/module/dice/TraitRoll.ts, SwadeRoll.ts, WildDie.ts, DamageRoll.ts and SwadeActor#rollAttribute, which builds
// a kept highest PoolTerm of trait die and Wild Die and appends the modifiers as "value[label]" terms.
class PoolTerm {
  constructor(rolls, results) {
    this.rolls = rolls;
    this.results = results;
    this.modifiers = ["kh"];
    this.dice = rolls.flatMap((roll) => roll.dice);
    this.total = results.filter((result) => !result.discarded).reduce((sum, result) => sum + result.result, 0);
    this.expression = "{1d8x[Fighting],1d6x[Wild Die]}kh";
  }
}

function singleDieRoll(die) {
  return { dice: [die], terms: [die], total: die.total };
}

class TraitRoll {
  constructor({ trait, wild, modifiers = [], options = {} }) {
    const rolls = [singleDieRoll(trait), ...(wild ? [singleDieRoll(wild)] : [])];
    const keepIndex = rolls.reduce((best, roll, index) => (roll.total > rolls[best].total ? index : best), 0);
    const results = rolls.map((roll, index) => ({ result: roll.total, active: index === keepIndex, discarded: index !== keepIndex }));
    const pool = new PoolTerm(rolls, results);
    const applied = modifiers.filter((modifier) => !modifier.ignore);
    this.terms = joinTerms([pool, ...applied.map((modifier) => new NumericTerm(modifier.value, { flavor: modifier.label }))]);
    this.total = pool.total + applied.reduce((sum, modifier) => sum + modifier.value, 0);
    this.formula = `${pool.expression}${applied.map((modifier) => `${modifier.value < 0 ? "" : "+"}${modifier.value}[${modifier.label}]`).join("")}`;
    this.options = { rollType: "trait", modifiers, ...options };
  }
}

class DamageRoll {
  constructor({ dice, bonus, options = {} }) {
    this.terms = joinTerms([...dice, new NumericTerm(bonus, { flavor: "Strength" })]);
    this.dice = dice;
    this.total = dice.reduce((sum, die) => sum + die.total, 0) + bonus;
    this.formula = "1d8x+1d6x+1";
    this.options = { rollType: "damage", modifiers: [], ...options };
  }
}

function installSwade() {
  resetGlobals();
  installDiceEnvironment();
  installLangFetch();
  return installSystemGame("swade", { isGM: false });
}

async function loadAdapter() {
  const module = await importStable("scripts/adapters/swade-adapter.js");
  return { ...module, adapter: new module.SwadeRollAdapter() };
}

test("swade trait roll shows trait die and Wild Die, the kept die, aces, modifiers and raises", async () => {
  installSwade();
  const { adapter } = await loadAdapter();
  const roll = new TraitRoll({
    trait: new Die({ faces: 8, results: [8, 2], flavor: "Fighting" }),
    wild: new WildDie({ faces: 6, results: [3], flavor: "Wild Die" }),
    modifiers: [
      { label: "Gang Up", value: 2 },
      { label: "Wounds", value: -1 },
      { label: "Cover", value: -2, ignore: true }
    ]
  });
  const message = { id: "s1", rolls: [roll], flags: { swade: { messageMode: "publicroll", targets: [] } } };

  assert.equal(adapter.supportsMessage(message), true);
  const [breakdown] = await adapter.buildBreakdowns(message);
  assert.deepEqual(breakdown.diceTerms.map((term) => [term.expression, term.sourceLabel, term.totalText, term.notes, term.muted]), [
    ["1d8", "Fighting", "10", ["Aced"], false],
    ["1d6", "Wild Die", "3", ["Dropped"], true]
  ]);
  assert.deepEqual(breakdown.computedTerms, []);
  assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]), [["Gang Up", 2], ["Wounds", -1]]);

  const ignored = breakdown.sections.find((section) => section.label === "Not counted");
  assert.deepEqual(ignored.items.map((item) => [item.text, item.value, item.muted]), [["Cover", "-2", true]]);

  // 10 + 2 - 1 = 11 against TN 4: one raise.
  assert.deepEqual(breakdown.pills.map((pill) => pill.text), ["TN 4", "1 raise"]);
});

test("swade trait roll outcomes follow the system rules for target number and critical failure", async () => {
  installSwade();
  const { adapter, getTraitOutcome } = await loadAdapter();

  const snakeEyes = new TraitRoll({
    trait: new Die({ faces: 8, results: [1], flavor: "Shooting" }),
    wild: new WildDie({ faces: 6, results: [1], flavor: "Wild Die" }),
    modifiers: [{ label: "Aim", value: 2 }],
    options: { targetNumber: 6 }
  });
  const [critfail] = await adapter.buildBreakdowns({ id: "s2", rolls: [snakeEyes], flags: {} });
  assert.deepEqual(critfail.pills.map((pill) => pill.text), ["TN 6", "Critical failure"]);

  const dice = (totals, wildIndex = 1) => totals.map((total, index) => ({ total, wild: index === wildIndex }));
  assert.equal(getTraitOutcome(3, dice([3, 2]), 4).key, "Failure");
  assert.equal(getTraitOutcome(7, dice([7, 2]), 4).key, "Success");
  assert.deepEqual(getTraitOutcome(12, dice([12, 2]), 4), { key: "Raise", raises: 2 });
  // An extra without Wild Die fails critically on a single 1.
  assert.equal(getTraitOutcome(1, [{ total: 1, wild: false }], 4).key, "CriticalFailure");
  // The trait die shows 1 but the Wild Die does not: no critical failure.
  assert.equal(getTraitOutcome(5, dice([1, 5]), 4).key, "Success");
});

test("swade damage rolls mark aced dice and show armor piercing", async () => {
  installSwade();
  const { adapter } = await loadAdapter();
  const roll = new DamageRoll({
    dice: [new Die({ faces: 8, results: [8, 4] }), new Die({ faces: 6, results: [2] })],
    bonus: 1,
    options: { ap: 2, isHeavyWeapon: true }
  });
  const [breakdown] = await adapter.buildBreakdowns({ id: "s3", rolls: [roll], flags: {} });
  assert.deepEqual(breakdown.diceTerms.map((term) => term.notes ?? []), [["Aced"], []]);
  assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]), [["Strength", 1]]);
  assert.deepEqual(breakdown.pills.map((pill) => pill.text), ["AP 2", "Heavy weapon"]);

  globalThis.game.system.id = "crucible";
  assert.equal(adapter.supportsMessage({ rolls: [roll] }), false);
});
