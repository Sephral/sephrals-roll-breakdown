import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importStable, modulePath, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { Die, loadMessageFixture } from "./helpers/roll-data.mjs";
import { describeChance, resolveChance } from "../scripts/chance-target.js";
import {
  findTormenta20Target,
  snapshotTormenta20Target,
  t20CriticalMultiplier,
  t20RollKind,
  t20SaveOf,
  t20ThreatFrom,
  t20Threatens
} from "../scripts/tormenta20-targets.js";

// Real chat messages from a live Tormenta20 world (system 1.6.7 on Foundry 14.370), captured with the roll dialog skipped
// (shift) and sanitized: Ayla is a level 5 fighter (trained in Fight, Perception, Fortitude and Athletics, Strength 3), Bran a
// level 5 wizard, the wolf a threat. The cards name no skill and carry no targets, so the module reads the character and
// stores the Defense of the single target when the roll is made.
const VERSION = "1.6.7";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
const gm = { isGM: true, actorHasPlayerOwner: () => false };
const player = { isGM: false, actorHasPlayerOwner: () => false };
const playerKnowsHero = { isGM: false, actorHasPlayerOwner: (uuid) => uuid === "Actor.hero" };

let actors = null;
async function loadActors() {
  actors ??= JSON.parse(await readFile(modulePath("tests", "fixtures", "tormenta20", `${VERSION}-actors.json`), "utf8"));
  return actors;
}

function fakeActor(data) {
  const items = new Map(data.items.map((item) => [item.name, { system: { resistencia: { cd: item.cd } } }]));
  return {
    type: data.type,
    system: { attributes: { nivel: { value: data.nivel }, treino: data.treino, cd: data.cd }, atributos: Object.fromEntries(Object.entries(data.atributos).map(([key, value]) => [key, { value }])), pericias: data.pericias },
    items: { get: (id) => items.get(id) }
  };
}

function install({ isGM = true } = {}) {
  resetGlobals();
  installDiceEnvironment();
  globalThis.foundry.dice.terms.DiceTerm = Die;
  installLangFetch();
  return installSystemGame("tormenta20", { isGM });
}

async function load(key) {
  install();
  const known = await loadActors();
  const probe = JSON.parse(await readFile(modulePath("tests", "fixtures", "tormenta20", `${VERSION}-${key}.json`), "utf8"));
  const speakerActor = fakeActor(known[probe.actor]);
  return loadMessageFixture("tormenta20", `${VERSION}-${key}`, { speakerActor, content: probe.content });
}

async function build(key, options = {}) {
  install(options);
  const { Tormenta20RollAdapter } = await importStable("scripts/adapters/tormenta20-adapter.js");
  const message = await load(key);
  const adapter = new Tormenta20RollAdapter();
  return { message, adapter, breakdowns: await adapter.buildBreakdowns(message) };
}

const pillTexts = (breakdown) => breakdown.pills.map((entry) => entry.text);
const modifierRows = (breakdown) => breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]);
const diceRows = (breakdown) => breakdown.diceTerms.map((term) => [term.sourceLabel, term.expression, term.total]);

test("tormenta20: the adapter reads only Tormenta20 worlds", async () => {
  const { adapter, message } = await build("skill");
  assert.equal(adapter.id, "tormenta20");
  assert.equal(adapter.supportsMessage(message), true);
  install();
  globalThis.game.system.id = "dnd5e";
  assert.equal(adapter.supportsMessage(message), false);
});

test("tormenta20: a skill test names the skill and shows how its bonus comes together", async () => {
  const { message, breakdowns } = await build("skill");
  assert.equal(breakdowns.length, 1);
  const [breakdown] = breakdowns;
  assert.deepEqual(modifierRows(breakdown), [["Perception", 5]]);
  assert.equal(breakdown.modifiers[0].sourceDetail, "Half level +2, Wisdom +1, Training +2");
  assert.equal(breakdown.diceTerms.length, 1);
  assert.equal(breakdown.diceTerms[0].expression, "1d20");
  assert.equal(breakdown.rollTotal, message.rolls[0].total);
  assert.equal(breakdown.title, null);
  assert.equal(breakdown.hasVisibleContent, true);
  // The empty extra bonus the system adds to every test is no row
  assert.equal(breakdown.modifiers.length, 1);
});

test("tormenta20: an untrained skill has no training in its parts, saves are skills", async () => {
  const stealth = (await build("skillUntrained")).breakdowns[0];
  assert.deepEqual(modifierRows(stealth), [["Stealth", 3]]);
  assert.equal(stealth.modifiers[0].sourceDetail, "Half level +2, Dexterity +1");
  const save = (await build("save")).breakdowns[0];
  assert.deepEqual(modifierRows(save), [["Fortitude", 6]]);
  assert.equal(save.modifiers[0].sourceDetail, "Half level +2, Constitution +2, Training +2");
});

test("tormenta20: an attribute test carries no name on its card, the value names it when one attribute has it", async () => {
  const strength = (await build("attribute")).breakdowns[0];
  assert.deepEqual(modifierRows(strength), [["Strength", 3]]);
  const intelligence = (await build("attributeAdvantage")).breakdowns[0];
  assert.deepEqual(modifierRows(intelligence), [["Intelligence", 4]]);
});

test("tormenta20: a negative attribute is matched by its signed value", async () => {
  const { message, adapter } = await build("attribute");
  const terms = message.rolls[0].terms;
  terms[1].operator = "-";
  terms[2].number = 1;
  const atributos = message.speakerActor.system.atributos;
  atributos.for.value = 1;
  atributos.des.value = -1;
  const row = modifierRows((await adapter.buildBreakdowns(message))[0]);
  assert.equal(row[0][0], "Dexterity");
  assert.equal(row[0][1], -1);
});

test("tormenta20: two dice keeping one are shown as the system rolled them", async () => {
  const advantage = (await build("attributeAdvantage")).breakdowns[0];
  assert.equal(advantage.diceTerms[0].expression, "2d20kh");
  assert.equal(advantage.rollTotal, advantage.diceTerms[0].total + 4);
  const disadvantage = (await build("skillDisadvantage")).breakdowns[0];
  assert.equal(disadvantage.diceTerms[0].expression, "2d20kl");
  assert.deepEqual(modifierRows(disadvantage), [["Athletics", 7]]);
});

test("tormenta20: a weapon card is one panel with the attack and the damage, damage types by name", async () => {
  const { message, breakdowns } = await build("attack");
  assert.equal(breakdowns.length, 2);
  const [attack, damage] = breakdowns;
  assert.equal(attack.title, "Attack");
  assert.deepEqual(modifierRows(attack), [["Fight", 7]]);
  assert.equal(attack.modifiers[0].sourceDetail, "Half level +2, Strength +3, Training +2");
  assert.equal(damage.title, "Damage");
  assert.deepEqual(diceRows(damage), [["Cutting", "1d8", damage.diceTerms[0].total]]);
  assert.deepEqual(modifierRows(damage), [["Strength", 3]]);
  assert.deepEqual(pillTexts(damage), ["Cutting"]);
  assert.equal(damage.rollTotal, message.rolls[1].total);
  assert.equal(attack.rollTotal, message.rolls[0].total);
});

test("tormenta20: a threat shows a pill and the damage dice the system multiplied", async () => {
  const { message, breakdowns } = await build("attackCritical");
  const [attack, damage] = breakdowns;
  assert.ok(pillTexts(attack).includes("Critical threat"));
  assert.equal(attack.pills[0].emphasis, true);
  assert.match(attack.pills[0].tooltip, /natural 20/);
  assert.match(attack.pills[0].tooltip, /19 to 20/);
  assert.equal(damage.diceTerms[0].expression, "2d8");
  assert.deepEqual(damage.diceTerms[0].notes, ["Multiplied by 2"]);
  assert.ok(pillTexts(damage).includes("Critical x2"));
  assert.equal(damage.rollTotal, message.rolls[1].total);
  // The plain attack has neither
  const plain = (await build("attack")).breakdowns;
  assert.ok(!pillTexts(plain[0]).includes("Critical threat"));
  assert.ok(!pillTexts(plain[1]).some((text) => text.startsWith("Critical")));
});

test("tormenta20: a spell shows its damage type and the save DC of the caster", async () => {
  const { breakdowns } = await build("spell");
  assert.equal(breakdowns.length, 1);
  const [damage] = breakdowns;
  assert.equal(damage.title, "Damage");
  assert.deepEqual(diceRows(damage), [["Fire", "6d6", damage.diceTerms[0].total]]);
  assert.deepEqual(pillTexts(damage), ["Fire", "Save DC 16"]);
  assert.equal(damage.pills[1].tooltip, "Reflexos reduz à metade");
});

test("tormenta20: healing is told apart from damage", async () => {
  const { breakdowns } = await build("healing");
  const [heal] = breakdowns;
  assert.equal(heal.title, "Healing");
  assert.deepEqual(diceRows(heal)[0].slice(0, 2), ["Healing", "2d8"]);
  assert.ok(pillTexts(heal).includes("Healing"));
});

test("tormenta20: a threat attack of a creature does not list a made up skill breakdown", async () => {
  const { breakdowns } = await build("npcAttack");
  const [attack] = breakdowns;
  // A creature's skill value is set by hand: it shows as one number, with the parts only a character has
  assert.deepEqual(modifierRows(attack), [["Fight", 7]]);
  assert.equal(attack.modifiers[0].sourceDetail, null);
});

test("tormenta20: the Defense of a single target gives hit or miss with the margin, for numbers the viewer may know", async () => {
  install();
  const monster = await load("attackTargetMonster");
  const total = monster.rolls[0].total;
  const { Tormenta20RollAdapter } = await importStable("scripts/adapters/tormenta20-adapter.js");
  const adapter = new Tormenta20RollAdapter();
  const asGm = (await adapter.buildBreakdowns(monster))[0];
  assert.ok(pillTexts(asGm).includes("Defense 23"));
  assert.ok(pillTexts(asGm).includes(total >= 23 ? "Hit" : "Miss"));
  assert.ok(pillTexts(asGm).includes(`Margin ${total - 23 >= 0 ? "+" : ""}${total - 23}`));
  // The Defense of a monster is the GM's secret
  globalThis.game.user.isGM = false;
  const asPlayer = (await adapter.buildBreakdowns(monster))[0];
  assert.ok(!pillTexts(asPlayer).some((text) => /^Defense|^Hit$|^Miss$|^Margin/.test(text)));
});

test("tormenta20 targets: kinds of roll, threat range, multiplier and the save of an item", async () => {
  const sword = await load("attackCritical");
  assert.equal(t20RollKind(sword.rolls[0], sword), "attack");
  assert.equal(t20RollKind(sword.rolls[1], sword), "damage");
  assert.equal(t20ThreatFrom(sword.rolls[0], sword), 19);
  assert.equal(t20CriticalMultiplier(sword), 2);
  assert.equal(t20Threatens(sword), true);
  const skill = await load("skill");
  assert.equal(t20RollKind(skill.rolls[0], skill), "check");
  assert.equal(t20Threatens(skill), false);
  assert.equal(t20ThreatFrom(skill.rolls[0], skill), 20);
  const spell = await load("spell");
  assert.deepEqual(t20SaveOf(spell, spell.speakerActor), { dc: 16, text: "Reflexos reduz à metade" });
  assert.equal(t20SaveOf(sword, sword.speakerActor), null);
  // A creature uses its own difficulty when the item has none
  const npc = { type: "npc", system: { attributes: { cd: 14 } }, items: { get: () => ({ system: { resistencia: { cd: 0 } } }) } };
  assert.equal(t20SaveOf(spell, npc).dc, 14);
});

test("tormenta20 targets: the Defense is stored for one target only, with the owner rule for players", async () => {
  const token = (defense, name = "Ogre") => ({ name, actor: { uuid: "Actor.x", system: { attributes: { defesa: { value: defense } } } } });
  assert.deepEqual(snapshotTormenta20Target(new Set([token(23)])), { defense: 23, uuid: "Actor.x", name: "Ogre" });
  assert.equal(snapshotTormenta20Target(new Set()), null);
  assert.equal(snapshotTormenta20Target(new Set([token(23), token(12)])), null);
  assert.equal(snapshotTormenta20Target(new Set([token(undefined)])), null);
  const hero = await load("attackTargetHero");
  assert.equal(findTormenta20Target({ roll: hero.rolls[0], message: hero, env: gm }).known, true);
  assert.equal(findTormenta20Target({ roll: hero.rolls[0], message: hero, env: player }).known, false);
  assert.equal(findTormenta20Target({ roll: hero.rolls[0], message: hero, env: playerKnowsHero }).known, true);
  assert.equal(findTormenta20Target({ roll: hero.rolls[1], message: hero, env: gm }), null);
  const skill = await load("skill");
  assert.equal(findTormenta20Target({ roll: skill.rolls[0], message: skill, env: gm }), null);
});

// Brute force: the d20 and its keep rule, a flat bonus
function chanceOf({ dice = 1, keep = null, modifier, target }) {
  let wins = 0;
  let all = 0;
  const faces = 20;
  const sides = Array.from({ length: faces }, (_, index) => index + 1);
  for (const a of sides) {
    for (const b of dice === 2 ? sides : [0]) {
      all++;
      const natural = dice === 1 ? a : keep === "kh" ? Math.max(a, b) : Math.min(a, b);
      if (natural + modifier >= target) wins++;
    }
  }
  return wins / all;
}

test("tormenta20 chance: an attack against a known Defense is the chance of the total reaching it", async () => {
  install();
  const monster = await load("attackTargetMonster");
  const chance = resolveChance({ roll: monster.rolls[0], message: monster, systemId: "tormenta20", env: gm });
  assert.equal(chance.kind, "success");
  assert.equal(chance.target, 23);
  assert.equal(chance.targetKind, "defense");
  near(chance.probability, chanceOf({ modifier: 7, target: 23 }));
  const described = describeChance(chance, { success: "Chance of success: {percent}", successHint: "Against {kind} {target}", defense: "Defense", percent: "{value} %" });
  assert.equal(described.text, "Chance of success: 25 %");
  assert.equal(described.hint, "Against Defense 23");
  const hero = await load("attackTargetHero");
  near(resolveChance({ roll: hero.rolls[0], message: hero, systemId: "tormenta20", env: gm }).probability, chanceOf({ modifier: 7, target: 11 }));
});

test("tormenta20 chance: without a Defense the player may know the line says this result or better", async () => {
  install();
  const monster = await load("attackTargetMonster");
  const chance = resolveChance({ roll: monster.rolls[0], message: monster, systemId: "tormenta20", env: player });
  assert.equal(chance.kind, "better");
  assert.ok(chance.probability > 0 && chance.probability <= 1);
  const skill = await load("skill");
  assert.equal(resolveChance({ roll: skill.rolls[0], message: skill, systemId: "tormenta20", env: gm }).kind, "better");
  // Damage and healing have nothing to reach
  assert.equal(resolveChance({ roll: monster.rolls[1], message: monster, systemId: "tormenta20", env: gm }), null);
});

test("tormenta20 chance: keeping the higher or lower of two d20 counts the dice", async () => {
  install();
  const advantage = await load("attributeAdvantage");
  const roll = advantage.rolls[0];
  const chance = resolveChance({ roll, message: advantage, systemId: "tormenta20", env: gm });
  const natural = roll.total - 4;
  // The chance of this result or better: the kept die at least as high as the one that came up
  near(chance.probability, 1 - Math.pow((natural - 1) / 20, 2));
  const disadvantage = await load("skillDisadvantage");
  const low = resolveChance({ roll: disadvantage.rolls[0], message: disadvantage, systemId: "tormenta20", env: gm });
  const keptLow = disadvantage.rolls[0].total - 7;
  near(low.probability, Math.pow((21 - keptLow) / 20, 2));
});
