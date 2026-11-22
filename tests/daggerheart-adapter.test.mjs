import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { Die, fromRollData, loadMessageFixture } from "./helpers/roll-data.mjs";

// Real chat messages from a live Daggerheart world (Foundryborne system 2.12.9 on Foundry 14.370), captured with the
// roll dialog skipped (shift for a normal roll, alt for advantage, ctrl for disadvantage) and sanitized. Aria Vale is a
// Warrior (Strength +2, Agility +1, two experiences worth +2), Mira Sol a Wizard, the Skeleton Warrior has Difficulty 10 and the Cult
// Adept attacks with advantage. Damage sits in message.system.damage, as in the system.
const VERSION = "2.12.9";
const DAMAGE_TYPES = { physical: { label: "Physical" }, magical: { label: "Magical" } };
const HEALING_TYPES = { hitPoints: { label: "Hit Points" }, stress: { label: "Stress" } };

function installDaggerheart({ isGM = true, hidesTargets = false } = {}) {
  resetGlobals();
  installDiceEnvironment();
  // The dice of the system extend the core Die, the fixture dice extend this one
  globalThis.foundry.dice.terms.DiceTerm = Die;
  installLangFetch();
  const game = installSystemGame("daggerheart", { isGM });
  game.settings.get = (moduleId, key) => (moduleId === "daggerheart" && key === "Metagaming" ? { hideObserverPermissionInChat: hidesTargets } : undefined);
  globalThis.CONFIG = { DH: { SETTINGS: { gameSettings: { Metagaming: "Metagaming" } }, GENERAL: { damageTypes: DAMAGE_TYPES, healingTypes: HEALING_TYPES } } };
  return game;
}

async function build(key, options = {}) {
  installDaggerheart(options);
  const { DaggerheartRollAdapter } = await importStable("scripts/adapters/daggerheart-adapter.js");
  const message = await loadMessageFixture("daggerheart", `${VERSION}-${key}`);
  const adapter = new DaggerheartRollAdapter();
  return { message, adapter, breakdowns: await adapter.buildBreakdowns(message) };
}

const pillTexts = (breakdown) => breakdown.pills.map((entry) => entry.text);
const modifierValues = (breakdown) => breakdown.modifiers.map((entry) => entry.value);
const modifierRows = (breakdown) => breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]);
const diceRows = (breakdown) => breakdown.diceTerms.map((term) => [term.sourceLabel, term.expression, term.total]);

test("daggerheart: a trait roll shows Hope, Fear, the trait and the side of the roll", async () => {
  const { message, breakdowns } = await build("trait");
  assert.equal(breakdowns.length, 1);
  const [breakdown] = breakdowns;
  assert.deepEqual(diceRows(breakdown), [["Hope die", "1d12", 3], ["Fear die", "1d12", 4]]);
  assert.deepEqual(modifierRows(breakdown), [["Strength", 2]]);
  assert.equal(breakdown.rollTotal, message.rolls[0].total);
  assert.equal(breakdown.rollTotal, 9);
  assert.deepEqual(pillTexts(breakdown), ["With Fear"]);
  assert.equal(breakdown.title, null);
  assert.equal(breakdown.diceTerms[0].lineSkip, true);
  assert.equal(breakdown.diceTerms[1].lineSkip, true);
});

test("daggerheart: hope, fear and equal dice name the outcome as the system defines it", async () => {
  assert.deepEqual(pillTexts((await build("hope")).breakdowns[0]), ["With Hope"]);
  assert.deepEqual(pillTexts((await build("fear")).breakdowns[0]), ["With Fear"]);
  const critical = (await build("critical")).breakdowns[0];
  assert.deepEqual(pillTexts(critical), ["Critical success"]);
  assert.equal(critical.pills[0].emphasis, true);
  assert.deepEqual(diceRows(critical).map((row) => row[2]), [3, 3]);
});

test("daggerheart: the advantage die is added and the disadvantage die is subtracted", async () => {
  const advantage = (await build("traitAdvantage")).breakdowns[0];
  assert.deepEqual(diceRows(advantage), [["Hope die", "1d12", 1], ["Fear die", "1d12", 5], ["Advantage", "1d6", 6]]);
  assert.equal(advantage.rollTotal, 13);
  assert.deepEqual(modifierValues(advantage), [1]);
  assert.equal(advantage.diceTerms[2].lineSkip, undefined);

  const disadvantage = (await build("traitDisadvantage")).breakdowns[0];
  assert.deepEqual(diceRows(disadvantage), [["Hope die", "1d12", 11], ["Fear die", "1d12", 8], ["Disadvantage", "-1d6", -5]]);
  assert.equal(disadvantage.rollTotal, 15);
  assert.deepEqual(pillTexts(disadvantage), ["With Hope"]);
});

test("daggerheart: experiences and effects appear with the labels the system stored", async () => {
  const experience = (await build("traitExperience")).breakdowns[0];
  assert.deepEqual(modifierRows(experience), [["Strength", 2], ["Veteran of the Border Wars", 2]]);
  assert.equal(experience.modifiers[0].sourceDetail, null);
  assert.equal(experience.modifiers[1].sourceDetail, "Experience");
  assert.equal(experience.rollTotal, 21);

  // The effect "Blessing of Dawn" adds a value the system keeps as the text "2"
  const effect = (await build("effectBonus")).breakdowns[0];
  assert.deepEqual(modifierRows(effect), [["Agility", 1], ["Blessing of Dawn", 2]]);
  assert.equal(effect.totalStaticModifier, 3);
});

test("daggerheart: a reaction roll gives neither Hope nor Fear", async () => {
  const reaction = (await build("traitReaction")).breakdowns[0];
  assert.deepEqual(pillTexts(reaction), ["Reaction roll"]);
  assert.deepEqual(modifierRows(reaction), [["Agility", 1]]);
});

test("daggerheart: a spell roll without a trait still shows its dice", async () => {
  const spell = (await build("spellcast")).breakdowns[0];
  assert.equal(spell.diceTerms.length, 2);
  assert.equal(spell.modifiers.length, 0);
  assert.ok(pillTexts(spell).some((text) => /^(With Hope|With Fear|Critical success)$/.test(text)));
});

test("daggerheart: an attack against a target with a difficulty adds the result and margin, and the damage follows", async () => {
  const { message, adapter, breakdowns } = await build("attackTarget");
  assert.equal(breakdowns.length, 2);
  const [attack, damage] = breakdowns;
  assert.equal(attack.title, "Duality roll");
  assert.equal(damage.title, "Damage");
  assert.equal(attack.rollIndex, 0);
  assert.equal(damage.rollIndex, 1);
  // 6 + 2 + Agility 1 = 9 against Difficulty 10
  assert.equal(attack.rollTotal, 9);
  assert.deepEqual(pillTexts(attack), ["With Hope", "Difficulty 10", "Failure", "Margin -1"]);
  assert.equal(attack.pills[1].tooltip, "Skeleton Warrior");

  assert.deepEqual(diceRows(damage), [[null, "1d8", message.system.damage.main.terms[0].total]]);
  assert.deepEqual(modifierRows(damage), [["Combat Training", 1]]);
  assert.deepEqual(pillTexts(damage), ["Physical"]);
  assert.equal(damage.rollTotal, message.system.damage.main.total);
  // The adapter hands the renderer the same rolls the breakdown indexes refer to
  assert.deepEqual(adapter.getMessageRolls(message), [message.rolls[0], message.system.damage.main]);
});

test("daggerheart: players see the difficulty of a target unless the system hides its targets", async () => {
  const open = (await build("attackTarget", { isGM: false })).breakdowns[0];
  assert.ok(pillTexts(open).includes("Difficulty 10"));
  const hidden = (await build("attackTarget", { isGM: false, hidesTargets: true })).breakdowns[0];
  assert.ok(!pillTexts(hidden).some((text) => /Difficulty|Failure|Success|Margin/.test(text)));
  const gm = (await build("attackTarget", { isGM: true, hidesTargets: true })).breakdowns[0];
  assert.ok(pillTexts(gm).includes("Difficulty 10"));
});

test("daggerheart: a critical hit wins against any difficulty and doubles the damage dice", async () => {
  const { message, breakdowns } = await build("attackCritical");
  const [attack, damage] = breakdowns;
  // 8 + 8 + Agility 1 = 17 against Difficulty 10: a success anyway, here by the number as well as by the dice
  assert.deepEqual(pillTexts(attack).slice(0, 3), ["Critical success", "Difficulty 10", "Success"]);
  const main = message.system.damage.main;
  const die = main.terms[0].results[0].result;
  // DamageRoll#total adds the highest result of every die to the sum of the terms
  assert.deepEqual(modifierRows(damage), [["Combat Training", 1], ["Critical damage", 8]]);
  assert.equal(damage.rollTotal, die + 1 + 8);
  assert.deepEqual(pillTexts(damage), ["Critical", "Physical"]);
});

test("daggerheart: adversary attacks are d20 rolls against the evasion of the hero", async () => {
  const { message, breakdowns } = await build("adversaryAttack");
  const [attack, damage] = breakdowns;
  assert.equal(attack.title, "Attack");
  assert.deepEqual(diceRows(attack), [[null, "1d20", 13]]);
  assert.deepEqual(modifierRows(attack), [["Bonus to Hit", 0]]);
  assert.deepEqual(pillTexts(attack), ["Evasion 11", "Hit", "Margin +2"]);
  assert.equal(damage.title, "Damage");
  assert.deepEqual(modifierRows(damage), [["Base Modifier", 2]]);
  assert.equal(damage.diceTerms.length, 1);
  assert.equal(damage.diceTerms[0].expression, "1d6");
  assert.equal(damage.rollTotal, message.system.damage.main.total);
});

test("daggerheart: an adversary with advantage rolls two d20 and keeps the higher", async () => {
  const [attack] = (await build("adversaryAdvantage")).breakdowns;
  assert.equal(attack.diceTerms[0].expression, "2d20kh");
  assert.equal(attack.diceTerms[0].total, 17);
  assert.deepEqual(modifierRows(attack), [["Bonus to Hit", 2]]);
  assert.deepEqual(attack.lineInfo, { advantage: "advantage" });
  assert.deepEqual(pillTexts(attack), ["Evasion 11", "Hit", "Margin +8"]);
});

test("daggerheart: fate rolls and rolls of other systems stay quiet", async () => {
  const { breakdowns } = await build("fateRoll");
  assert.equal(breakdowns.length, 0);
});

test("daggerheart: the adapter supports only Daggerheart worlds and messages with rolls", async () => {
  const { adapter, message } = await build("trait");
  assert.equal(adapter.supportsMessage(message), true);
  assert.equal(adapter.supportsMessage({ rolls: [], system: {} }), false);
  // A damage only message keeps its roll in the system data and an empty roll in message.rolls
  assert.equal(adapter.supportsMessage({ rolls: [{ terms: [] }], system: { damage: { main: message.rolls[0], resources: {} } } }), true);
  installSystemGame("dnd5e");
  assert.equal(adapter.supportsMessage(message), false);
});

test("daggerheart: resources and healing rolls are named after what they restore", async () => {
  installDaggerheart();
  const { DaggerheartRollAdapter } = await importStable("scripts/adapters/daggerheart-adapter.js");
  const heal = (formula, faces, result) => fromRollData({
    class: "DamageRoll",
    options: { breakdown: [{ label: "Base Modifier", value: 1 }], damageTypes: [] },
    formula,
    terms: [
      { class: "BaseDie", options: {}, number: 1, faces, modifiers: [], results: [{ result, active: true }] },
      { class: "OperatorTerm", options: {}, operator: "+" },
      { class: "NumericTerm", options: {}, number: 1 }
    ],
    total: result + 1
  });
  const message = {
    id: "heal",
    rolls: [],
    system: { hasHealing: true, targets: [], damage: { main: heal("1d6 + 1", 6, 4), resources: { stress: heal("1d4 + 1", 4, 2) } } }
  };
  await loadMessageFixture("daggerheart", `${VERSION}-trait`);
  const adapter = new DaggerheartRollAdapter();
  const breakdowns = await adapter.buildBreakdowns(message);
  assert.deepEqual(breakdowns.map((entry) => entry.title), ["Healing", "Stress"]);
  assert.deepEqual(breakdowns.map((entry) => entry.rollTotal), [5, 3]);
});

test("daggerheart: a rally die and a bonus die are named, an unknown number is a custom modifier", async () => {
  installDaggerheart();
  const { buildDualityBreakdown } = await importStable("scripts/adapters/daggerheart-adapter.js");
  await loadMessageFixture("daggerheart", `${VERSION}-trait`);
  const die = (cls, faces, result, modifiers = []) => ({ class: cls, options: {}, number: 1, faces, modifiers, results: [{ result, active: true }] });
  const op = (operator) => ({ class: "OperatorTerm", options: {}, operator });
  const num = (number) => ({ class: "NumericTerm", options: {}, number });
  const roll = fromRollData({
    class: "DualityRoll",
    options: { roll: { type: "trait", trait: "agility", advantage: 0, modifiers: [{ label: "Agility", value: 1 }, { label: "Blessing", value: "1d4" }] } },
    formula: "1d12h + 1d12f + 1d8 + 1 + 1d4 + 3",
    terms: [die("HopeDie", 12, 5, ["h"]), op("+"), die("FearDie", 12, 9, ["f"]), op("+"), die("Die", 8, 6), op("+"), num(1), op("+"), die("Die", 4, 2), op("+"), num(3)],
    total: 26
  });
  const breakdown = buildDualityBreakdown(roll, { env: { isGM: true } });
  assert.deepEqual(diceRows(breakdown), [["Hope die", "1d12", 5], ["Fear die", "1d12", 9], ["Rally die", "1d8", 6], ["Blessing", "1d4", 2]]);
  assert.deepEqual(modifierRows(breakdown), [["Agility", 1], ["Custom modifier", 3]]);
});

test("daggerheart: a damage multiplier keeps the generic reading", async () => {
  installDaggerheart();
  const { buildDamageBreakdown } = await importStable("scripts/adapters/daggerheart-adapter.js");
  await loadMessageFixture("daggerheart", `${VERSION}-trait`);
  const roll = fromRollData({
    class: "DamageRoll",
    options: { breakdown: [], damageTypes: ["magical"] },
    formula: "(1d8 + 2) * 2",
    terms: [{ class: "NumericTerm", options: {}, number: 4 }, { class: "OperatorTerm", options: {}, operator: "*" }, { class: "NumericTerm", options: {}, number: 2 }],
    total: 8
  });
  const breakdown = buildDamageBreakdown(roll);
  assert.equal(breakdown.rollTotal, 8);
  assert.deepEqual(pillTexts(breakdown), ["Magical"]);
});
