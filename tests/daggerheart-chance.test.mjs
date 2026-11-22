import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { Die, loadMessageFixture } from "./helpers/roll-data.mjs";
import { describeChance, resolveChance } from "../scripts/chance-target.js";
import { adversaryCriticalFrom, findDaggerheartTarget } from "../scripts/daggerheart-targets.js";
import { buildSummaryLine } from "../scripts/summary-line.js";

// The chance line for Daggerheart: the duality roll against a difficulty (equal Hope and Fear dice always succeed), the
// adversary d20 against an evasion, and this result or better without a number a player may know.
const VERSION = "2.12.9";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
const gm = { isGM: true };
const player = { isGM: false, daggerheartHidesTargets: false };
const hiding = { isGM: false, daggerheartHidesTargets: true };

function install() {
  resetGlobals();
  installDiceEnvironment();
  globalThis.foundry.dice.terms.DiceTerm = Die;
  installLangFetch();
  installSystemGame("daggerheart", { isGM: true });
  globalThis.CONFIG = { DH: { GENERAL: { damageTypes: {}, healingTypes: {} } } };
}

async function load(key) {
  install();
  return loadMessageFixture("daggerheart", `${VERSION}-${key}`);
}

// Brute force over every combination of the Hope die, the Fear die and an optional d6
function bruteForce({ extra = 0, sign = 1, modifier = 0, target }) {
  let wins = 0;
  let all = 0;
  for (let h = 1; h <= 12; h++) {
    for (let f = 1; f <= 12; f++) {
      for (let e = extra ? 1 : 0; e <= extra; e++) {
        all++;
        if (h === f || h + f + modifier + sign * e >= target) wins++;
      }
    }
  }
  return wins / all;
}

test("daggerheart chance: a duality roll against a difficulty counts equal dice as a success", async () => {
  const message = await load("attackTarget");
  const roll = message.rolls[0];
  // Hope + Fear + Agility 1 against Difficulty 10 of the single target
  const chance = resolveChance({ roll, message, systemId: "daggerheart", env: gm });
  assert.equal(chance.kind, "success");
  assert.equal(chance.target, 10);
  assert.equal(chance.targetKind, "difficulty");
  near(chance.probability, bruteForce({ modifier: 1, target: 10 }));
  const words = { success: "Chance of success: {percent}", successHint: "Against {kind} {target}.", difficulty: "Difficulty", dualityHint: "Equal dice succeed.", percent: "{value} %" };
  const text = describeChance(chance, words);
  assert.equal(text.text, `Chance of success: ${Math.round(chance.probability * 100)} %`);
  assert.equal(text.hint, "Against Difficulty 10. Equal dice succeed.");
});

test("daggerheart chance: advantage and disadvantage dice are part of the maths", async () => {
  const advantage = await load("traitAdvantage");
  // No target: this result or better, 13 with an advantage die and Agility 1
  const better = resolveChance({ roll: advantage.rolls[0], message: advantage, systemId: "daggerheart", env: gm });
  assert.equal(better.kind, "better");
  let sum = 0;
  let all = 0;
  for (let h = 1; h <= 12; h++) for (let f = 1; f <= 12; f++) for (let e = 1; e <= 6; e++) { all++; if (h + f + e + 1 >= 13) sum++; }
  near(better.probability, sum / all);

  // With a target the same dice give the success chance
  const withTarget = { ...advantage, system: { targets: [{ name: "Ogre", difficulty: 15 }] } };
  near(resolveChance({ roll: advantage.rolls[0], message: withTarget, systemId: "daggerheart", env: gm }).probability, bruteForce({ extra: 6, modifier: 1, target: 15 }));
  const disadvantage = await load("traitDisadvantage");
  const against = { ...disadvantage, system: { targets: [{ name: "Ogre", difficulty: 17 }] } };
  near(resolveChance({ roll: disadvantage.rolls[0], message: against, systemId: "daggerheart", env: gm }).probability, bruteForce({ extra: 6, sign: -1, modifier: 1, target: 17 }));
});

test("daggerheart chance: a difficulty on the roll is printed on the card, a target number follows the metagaming setting", async () => {
  const message = await load("attackTarget");
  const roll = message.rolls[0];
  assert.equal(resolveChance({ roll, message, systemId: "daggerheart", env: player }).kind, "success");
  assert.equal(resolveChance({ roll, message, systemId: "daggerheart", env: hiding }).kind, "better");
  assert.equal(resolveChance({ roll, message, systemId: "daggerheart", env: gm }).kind, "success");

  roll.options.roll.difficulty = 12;
  const open = resolveChance({ roll, message, systemId: "daggerheart", env: hiding });
  assert.equal(open.kind, "success");
  assert.equal(open.target, 12);
});

test("daggerheart chance: several targets give no single number", async () => {
  const message = await load("attackTarget");
  const two = { ...message, system: { ...message.system, targets: [{ difficulty: 10 }, { difficulty: 14 }] } };
  assert.equal(resolveChance({ roll: message.rolls[0], message: two, systemId: "daggerheart", env: gm }).kind, "better");
});

test("daggerheart chance: an adversary attack uses the evasion and a natural critical", async () => {
  const message = await load("adversaryAttack");
  const chance = resolveChance({ roll: message.rolls[0], message, systemId: "daggerheart", env: gm });
  assert.equal(chance.kind, "success");
  assert.equal(chance.targetKind, "evasion");
  assert.equal(chance.target, 11);
  // d20 + 0 against Evasion 11: 11 to 20 hit
  near(chance.probability, 10 / 20);
  // The evasion of a hero is no secret
  near(resolveChance({ roll: message.rolls[0], message, systemId: "daggerheart", env: player }).probability, 10 / 20);

  const advantage = await load("adversaryAdvantage");
  const withAdvantage = resolveChance({ roll: advantage.rolls[0], message: advantage, systemId: "daggerheart", env: gm });
  // 2d20 keep highest + 2 against Evasion 11: the higher die needs 9 or more
  near(withAdvantage.probability, 1 - Math.pow(8 / 20, 2));
});

test("daggerheart chance: damage and fate rolls have none", async () => {
  const message = await load("attackTarget");
  assert.equal(resolveChance({ roll: message.system.damage.main, message, systemId: "daggerheart", env: gm }), null);
  const fate = await load("fateRoll");
  assert.equal(resolveChance({ roll: fate.rolls[0], message: fate, systemId: "daggerheart", env: gm }), null);
});

test("daggerheart chance: the helpers read the difficulty and the critical threshold", () => {
  assert.deepEqual(findDaggerheartTarget({ roll: { options: { roll: { difficulty: 14 } } }, message: {}, env: { isGM: false } }), { value: 14, kind: "difficulty", known: true, name: null });
  assert.equal(findDaggerheartTarget({ roll: { options: { roll: { difficulty: null } } }, message: { system: { targets: [] } }, env: gm }), null);
  assert.equal(adversaryCriticalFrom({ options: { data: { criticalThreshold: 19 } } }), 19);
  assert.equal(adversaryCriticalFrom({ options: { data: { criticalThreshold: 1 } } }), 20);
  assert.equal(adversaryCriticalFrom({}), 20);
});

test("daggerheart line: the short line lists modifiers and the advantage die, not Hope and Fear", async () => {
  install();
  const { DaggerheartRollAdapter } = await importStable("scripts/adapters/daggerheart-adapter.js");
  const adapter = new DaggerheartRollAdapter();
  const words = { advantage: "advantage", disadvantage: "disadvantage", from: "from", other: "other", more: "+{count} more", roll: "Roll", trims: [] };
  const lineOf = async (key) => buildSummaryLine(await adapter.buildBreakdowns(await loadMessageFixture("daggerheart", `${VERSION}-${key}`)), words)?.text;

  assert.equal(await lineOf("traitExperience"), "+2 Strength, +2 Veteran of the Border…");
  assert.equal(await lineOf("traitAdvantage"), "+1 Agility, +1d6 Advantage");
  assert.equal(await lineOf("traitDisadvantage"), "+1 Instinct, -1d6 Disadvantage");
  assert.equal(await lineOf("adversaryAdvantage"), "Attack: +2 Bonus to Hit, advantage · Damage: +3 Base Modifier");
});
