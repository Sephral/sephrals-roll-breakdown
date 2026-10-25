import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { loadMessageFixture } from "./helpers/roll-data.mjs";

// Real chat messages from live Savage Worlds worlds (SWADE 5.2.6 on Foundry 13.351 and 6.0.4 on 14.369), rolled
// through the system's roll dialog and captured in test worlds. "Red" is a Wild Card,
// "Thug" an Extra. Fixtures named acedRaise, wildDieWins, critfail*, extraCritfail* and damageAced used fixed dice.
const VERSIONS = ["5.2.6", "6.0.4"];
const OUTCOME = /^(Critical failure|Possible critical failure|Failure|Success|\d+ raises?)$/;

async function build(version, key) {
  resetGlobals();
  installDiceEnvironment();
  installLangFetch();
  installSystemGame("swade", { isGM: false });
  const { SwadeRollAdapter } = await importStable("scripts/adapters/swade-adapter.js");
  const message = await loadMessageFixture("swade", `${version}-${key}`);
  message.speakerActor = { isWildcard: message.fixture.speaker.isWildcard };
  return { message, breakdowns: await new SwadeRollAdapter().buildBreakdowns(message) };
}

const outcomeOf = (breakdown) => breakdown.pills.find((pill) => pill.emphasis && OUTCOME.test(pill.text))?.text ?? null;

// Signed modifier terms after the trait pool, as SWADE appends them ("+ 2[Gang Up] - 2[Multi-Action Penalty]")
function signedModifiers(roll, from) {
  const list = [];
  let operator = "+";
  for (const term of roll.terms.slice(from)) {
    if (term.constructor.name === "OperatorTerm") {
      operator = term.operator;
      continue;
    }
    if (term.constructor.name === "NumericTerm") list.push([term.flavor, operator === "-" ? -term.number : term.number]);
    operator = "+";
  }
  return list;
}

for (const version of VERSIONS) {
  test(`swade ${version}: trait rolls show each die of the pool and the modifiers of the roll`, async () => {
    for (const key of ["fightingMods", "woundsFatigue", "acedRaise", "wildDieWins", "critfailWild", "extraGroup", "soak"]) {
      const { message, breakdowns } = await build(version, key);
      const [breakdown] = breakdowns;
      const roll = message.rolls[0];
      const pool = roll.terms[0];
      assert.equal(breakdowns.length, 1, key);
      assert.deepEqual(breakdown.diceTerms.map((term) => [term.expression, term.total, term.muted]),
        pool.rolls.map((poolRoll, index) => [`1d${poolRoll.dice[0].faces}`, poolRoll.total, Boolean(pool.results[index].discarded)]), key);
      breakdown.diceTerms.forEach((term, index) => {
        const die = pool.rolls[index].dice[0];
        assert.equal(term.sourceLabel, die.flavor, key);
        assert.equal(term.notes.includes("Aced"), die.results.some((result) => result.exploded), key);
      });
      assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]), signedModifiers(roll, 1), key);
      assert.equal(breakdown.rollTotal, roll.total, key);
      assert.ok(breakdown.pills.some((pill) => pill.text === "TN 4"), key);
      assert.ok(outcomeOf(breakdown), key);
    }
  });

  test(`swade ${version}: modifiers switched off in the dialog, wounds and fatigue`, async () => {
    const mods = (await build(version, "fightingMods")).breakdowns[0];
    assert.deepEqual(mods.sections.find((entry) => entry.label === "Not counted").items.map((item) => [item.text, item.value, item.muted]), [["SRB Cover", "-2", true]]);
    assert.deepEqual(mods.modifiers.map((entry) => [entry.sourceLabel, entry.value]), [["SRB Gang Up", 2], ["Multi-Action Penalty", -2]]);

    const hurt = (await build(version, "woundsFatigue")).breakdowns[0];
    const labels = Object.fromEntries(hurt.modifiers.map((entry) => [entry.sourceLabel, entry.value]));
    assert.equal(labels.Wounds, -2);
    assert.equal(labels.Fatigue, -1);
  });

  test(`swade ${version}: aces, the Wild Die and raises`, async () => {
    // 8 + 8 + 3 = 19 on the d8, +1: 20 against TN 4 is four raises.
    const aced = (await build(version, "acedRaise")).breakdowns[0];
    assert.deepEqual(aced.diceTerms.map((term) => [term.totalText, term.notes]), [["19", ["Aced"]], ["2", ["Dropped"]]]);
    assert.equal(outcomeOf(aced), "4 raises");

    const wild = (await build(version, "wildDieWins")).breakdowns[0];
    assert.deepEqual(wild.diceTerms.map((term) => [term.sourceLabel, term.totalText, term.muted]), [["Athletics", "1", true], ["Wild Die", "10", false]]);
    assert.equal(outcomeOf(wild), "1 raise");
  });

  test(`swade ${version}: critical failures follow the Wild Card and Extra rules of SWADE`, async () => {
    assert.equal(outcomeOf((await build(version, "critfailWild")).breakdowns[0]), "Critical failure");

    // An Extra's single 1 is only possible until the confirmation die is rolled, the confirmation die gets no panel.
    const possible = (await build(version, "extraCritfail")).breakdowns[0];
    const pill = possible.pills.find((entry) => entry.text === "Possible critical failure");
    assert.match(pill.tooltip, /confirmation die/);
    const confirmed = await build(version, "extraCritfailConfirmed");
    assert.equal(confirmed.breakdowns.length, 1);
    assert.equal(outcomeOf(confirmed.breakdowns[0]), "Critical failure");
    const unconfirmed = await build(version, "extraCritfailUnconfirmed");
    assert.equal(unconfirmed.breakdowns.length, 1);
    assert.equal(outcomeOf(unconfirmed.breakdowns[0]), "Failure");
  });

  test(`swade ${version}: with a rate of fire of 3 every kept die is a result of its own`, async () => {
    const { message, breakdowns } = await build(version, "rof3");
    const [breakdown] = breakdowns;
    const roll = message.rolls[0];
    const pool = roll.terms[0];
    const kept = pool.rolls.filter((poolRoll, index) => !pool.results[index].discarded);
    const results = breakdown.sections.find((entry) => entry.label === "Results").items;
    assert.deepEqual(results.map((item) => item.value), kept.map((poolRoll) => String(poolRoll.total)));
    results.forEach((item) => assert.match(item.tag, OUTCOME));
    // The sum of three hits is no result in SWADE.
    assert.equal(breakdown.rollTotal, null);
    assert.equal(outcomeOf(breakdown), null);
  });

  test(`swade ${version}: damage shows Strength and weapon dice, aces, armor piercing and heavy weapons`, async () => {
    for (const key of ["damage", "damageAced", "damageAp", "damageHeavy", "damageRaise"]) {
      const { message, breakdowns } = await build(version, key);
      const roll = message.rolls[0];
      assert.equal(breakdowns.length, 1, key);
      const [breakdown] = breakdowns;
      const dice = roll.terms.filter((term) => term.constructor.name === "Die");
      assert.deepEqual(breakdown.diceTerms.map((term) => [term.expression, term.sourceLabel, term.total]), dice.map((die) => [die.expression, die.flavor, die.total]), key);
      breakdown.diceTerms.forEach((term, index) => assert.equal(Boolean(term.notes?.includes("Aced")), dice[index].results.some((result) => result.exploded), key));
      assert.equal(breakdown.rollTotal, roll.total, key);
    }
    // Strength d8 rolled 8 and 5, the weapon die 3.
    const aced = (await build(version, "damageAced")).breakdowns[0];
    assert.deepEqual(aced.diceTerms.map((term) => [term.expression, term.sourceLabel, term.totalText, term.notes ?? []]), [["1d8x", "Strength", "13", ["Aced"]], ["1d8x", "Base Damage", "3", []]]);

    assert.deepEqual((await build(version, "damageAp")).breakdowns[0].pills.map((pill) => pill.text), ["AP 2"]);
    const heavy = (await build(version, "damageHeavy")).breakdowns[0];
    assert.deepEqual(heavy.pills.map((pill) => pill.text), ["AP 10", "Heavy weapon"]);
    assert.deepEqual(heavy.modifiers.map((entry) => [entry.sourceLabel, entry.value]), [["SRB Called Shot", 4]]);
    assert.deepEqual((await build(version, "damageRaise")).breakdowns[0].diceTerms.map((term) => term.sourceLabel), ["Strength", "Base Damage", "Bonus Damage"]);
  });
}
