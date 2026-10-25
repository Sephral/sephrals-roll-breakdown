import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { loadMessageFixture } from "./helpers/roll-data.mjs";

// Real chat messages from live Pathfinder 2e worlds (PF2e 7.12.2 on Foundry 13.351 and 8.6.1 on 14.369), captured in
// test worlds and sanitized. Valeros strikes a goblin with a +1 striking flaming longsword
// while blessed, heroic, aided and frightened; Assurance, fortune and misfortune effects and a degree adjustment on
// Fortitude saves were set up as rule elements.
const VERSIONS = ["7.12.2", "8.6.1"];
const DAMAGE_TYPES = { slashing: "Slashing", piercing: "Piercing", bludgeoning: "Bludgeoning", fire: "Fire", electricity: "Electricity", cold: "Cold" };
const OUTCOMES = { criticalSuccess: "Critical success", success: "Success", failure: "Failure", criticalFailure: "Critical failure" };

function installPf2e({ isGM = true } = {}) {
  resetGlobals();
  installDiceEnvironment();
  installLangFetch();
  const game = installSystemGame("pf2e", { isGM });
  game.pf2e = { settings: { metagame: { breakdowns: false, dcs: false, results: true } } };
  globalThis.CONFIG = { PF2E: { damageTypes: DAMAGE_TYPES } };
  return game;
}

async function build(version, key, { isGM = true } = {}) {
  installPf2e({ isGM });
  const { Pf2eRollAdapter } = await importStable("scripts/adapters/pf2e-adapter.js");
  const message = await loadMessageFixture("pf2e", `${version}-${key}`);
  return { message, breakdowns: await new Pf2eRollAdapter().buildBreakdowns(message) };
}

const section = (breakdown, label) => breakdown.sections.find((entry) => entry.label === label) ?? null;
const pill = (breakdown, texts) => breakdown.pills.find((entry) => texts.includes(entry.text)) ?? null;

for (const version of VERSIONS) {
  test(`pf2e ${version}: checks split the summed modifier into the modifiers PF2e applied and match the result`, async () => {
    for (const key of ["strike", "strikeMap", "strikeNat20", "saveAdjusted", "saveReflex", "perception", "rerollKeepHigher", "npcStrike"]) {
      const { message, breakdowns } = await build(version, key);
      const [breakdown] = breakdowns;
      const roll = message.rolls[0];
      const { context, modifiers } = message.flags.pf2e;
      const applied = modifiers.filter((modifier) => modifier.enabled !== false && modifier.ignored !== true);

      assert.equal(breakdowns.length, 1, key);
      assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]), applied.map((modifier) => [modifier.label, modifier.modifier]), key);
      const diceTotal = breakdown.diceTerms.reduce((sum, term) => sum + term.total, 0);
      assert.equal(diceTotal + breakdown.totalStaticModifier, roll.total, key);
      assert.equal(breakdown.rollTotal, roll.total, key);
      assert.equal(breakdown.diceTerms.some((term) => /\[/.test(term.expression)), false, key);

      const notCounted = section(breakdown, "Not counted")?.items ?? [];
      assert.deepEqual(notCounted.map((item) => item.text), modifiers.filter((modifier) => !applied.includes(modifier) && !modifier.hideIfDisabled).map((modifier) => modifier.label), key);

      if (context.dc) {
        assert.ok(pill(breakdown, [`DC ${context.dc.value}`]), key);
        const margin = roll.total - context.dc.value;
        assert.ok(pill(breakdown, [`Margin ${margin >= 0 ? "+" : ""}${margin}`]), key);
      }
      if (context.outcome) assert.equal(pill(breakdown, Object.values(OUTCOMES))?.text, OUTCOMES[context.outcome], key);
    }
  });

  test(`pf2e ${version}: typed bonuses, stacking, degree adjustments, fortune and natural 20`, async () => {
    const strike = (await build(version, "strike")).breakdowns[0];
    assert.deepEqual(strike.modifiers.map((entry) => [entry.sourceLabel, entry.sourceDetail]), [
      ["Strength", "Attribute"],
      ["Expert", "Proficiency"],
      ["Weapon Potency", "Item"],
      ["SRB Heroism", "Status"],
      ["SRB Aid", "Circumstance"],
      ["Frightened 1", "Status"]
    ]);
    // Bless is a status bonus as well, the higher or equal one of the same type counts.
    assert.ok(section(strike, "Not counted").items.some((item) => item.text === "SRB Bless" && item.muted));

    const map = (await build(version, "strikeMap")).breakdowns[0];
    assert.deepEqual(map.modifiers.at(-1).sourceLabel, "Multiple Attack Penalty");
    assert.equal(map.modifiers.at(-1).value, -5);

    const nat20 = (await build(version, "strikeNat20")).breakdowns[0];
    assert.equal(nat20.diceTerms[0].totalText, "20");
    assert.equal(pill(nat20, Object.values(OUTCOMES)).text, "Critical success");

    // 12 + 7 = 19 against DC 16 is a success, which the rule element turns into a critical success.
    const adjusted = (await build(version, "saveAdjusted")).breakdowns[0];
    const outcome = pill(adjusted, Object.values(OUTCOMES));
    assert.deepEqual([outcome.text, outcome.tooltip], ["Critical success", "Adjusted from Success"]);

    const misfortune = (await build(version, "saveReflex")).breakdowns[0];
    assert.equal(misfortune.diceTerms[0].expression, "2d20kl");
    assert.deepEqual(misfortune.sections.find((entry) => entry.placement === "top").items.map((item) => item.text), ["Misfortune"]);
    const fortune = (await build(version, "perception")).breakdowns[0];
    assert.equal(fortune.diceTerms[0].expression, "2d20kh");
    assert.deepEqual(fortune.sections.find((entry) => entry.placement === "top").items.map((item) => item.text), ["Fortune"]);
  });

  test(`pf2e ${version}: a roll substitution replaces the d20 with its value`, async () => {
    const { message, breakdowns } = await build(version, "skill");
    const [breakdown] = breakdowns;
    assert.deepEqual(breakdown.diceTerms.map((term) => [term.expression, term.sourceLabel, term.sourceDetail]), [["10", "SRB Assurance", "Fortune"]]);
    assert.equal(breakdown.modifiers.some((entry) => !entry.sourceLabel), false);
    assert.equal(10 + breakdown.totalStaticModifier, message.rolls[0].total);
  });

  test(`pf2e ${version}: a reroll names no degree adjustment the kept roll did not have`, async () => {
    const { message, breakdowns } = await build(version, "rerollKeepHigher");
    assert.equal(message.flags.pf2e.context.isReroll, true);
    const outcome = pill(breakdowns[0], Object.values(OUTCOMES));
    assert.equal(outcome.text, OUTCOMES[message.flags.pf2e.context.outcome]);
    assert.equal(outcome.tooltip, null);
  });

  test(`pf2e ${version}: NPC breakdowns follow PF2e for players, DCs stay hidden`, async () => {
    assert.deepEqual((await build(version, "npcStrike", { isGM: false })).breakdowns, []);
    assert.deepEqual((await build(version, "npcDamage", { isGM: false })).breakdowns, []);
    const [own] = (await build(version, "strike", { isGM: false })).breakdowns;
    assert.equal(own.pills.some((entry) => entry.text.startsWith("DC ")), false);
    assert.equal(own.pills.some((entry) => entry.text.startsWith("Margin ")), false);
    assert.ok(pill(own, Object.values(OUTCOMES)));
  });

  test(`pf2e ${version}: damage lists dice and parts per damage type without raw flavors`, async () => {
    for (const key of ["damage", "critical", "bowCritical", "persistentEndTurn", "npcDamage", "spellDamage"]) {
      const { message, breakdowns } = await build(version, key);
      const [breakdown] = breakdowns;
      const roll = message.rolls[0];
      assert.equal(breakdowns.length, 1, key);
      assert.equal(breakdown.rollTotal, roll.total, key);
      assert.equal(breakdown.diceTerms.some((term) => /\[/.test(term.expression)), false, key);
      const parts = section(breakdown, "Damage parts").items;
      assert.equal(parts.length, roll.instances.length, key);
      parts.forEach((item, index) => {
        const instance = roll.instances[index];
        assert.equal(/\[/.test(item.text), false, key);
        assert.equal(item.text.toLowerCase().includes(instance.type), false, `${key}: ${item.text}`);
        assert.ok(item.tag.startsWith(DAMAGE_TYPES[instance.type]), key);
      });
    }
  });

  test(`pf2e ${version}: critical hits, extra dice and persistent damage`, async () => {
    const hit = (await build(version, "damage")).breakdowns[0];
    // The persistent fire die of the flaming rune only counts on a critical hit.
    assert.deepEqual(section(hit, "Extra dice").items.map((item) => [item.text, item.tag, item.value]), [["Flaming", "Fire", "1d6"]]);
    assert.equal(hit.pills.some((entry) => entry.text === "Critical hit"), false);

    const crit = (await build(version, "critical")).breakdowns[0];
    assert.deepEqual(section(crit, "Extra dice").items.map((item) => [item.text, item.tag, item.value]), [["Flaming", "Fire", "1d6"], ["Flaming", "Fire, Persistent", "1d10"]]);
    assert.deepEqual(crit.pills.find((entry) => entry.text === "Critical hit").tooltip, "Damage is doubled");
    const persistentDie = crit.diceTerms.at(-1);
    assert.deepEqual([persistentDie.expression, persistentDie.totalText, persistentDie.muted], ["1d10", null, true]);
    const persistentPart = section(crit, "Damage parts").items.at(-1);
    assert.deepEqual([persistentPart.text, persistentPart.tag, persistentPart.value, persistentPart.muted], ["1d10", "Fire, Persistent", null, true]);

    const deadly = (await build(version, "bowCritical")).breakdowns[0];
    assert.deepEqual(section(deadly, "Extra dice").items.map((item) => [item.text, item.value]), [["Deadly d10", "1d10"]]);

    // At the end of the turn PF2e rolls the persistent damage for real.
    const { message, breakdowns } = await build(version, "persistentEndTurn");
    const [endTurn] = breakdowns;
    assert.equal(endTurn.diceTerms[0].muted, false);
    assert.equal(endTurn.diceTerms[0].totalText, String(message.rolls[0].total));
    assert.equal(section(endTurn, "Damage parts").items[0].value, String(message.rolls[0].total));
  });
}

test.after(() => {
  delete globalThis.CONFIG;
});
