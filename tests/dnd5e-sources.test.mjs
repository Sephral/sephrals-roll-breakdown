import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importStable, resetGlobals } from "./helpers/test-helpers.mjs";

// Term sources of dnd5e cards found in live tests with other modules: dialog bonuses, magic weapons and ammunition,
// healing, scaled and critical dice, Monk's TokenBar cards, effects of items, reasons for advantage, hit dice.

class OperatorTerm {
  constructor(operator) {
    this.operator = operator;
  }
}

class NumericTerm {
  constructor(value) {
    this.number = value;
    this.total = value;
  }
}

class DiceTerm {
  constructor(formula, total, extras = {}) {
    this.formula = formula;
    this.expression = formula;
    this.total = total;
    Object.assign(this, extras);
  }
}

class StringTerm {
  constructor(formula) {
    this.formula = formula;
  }
}

class FunctionTerm {
  constructor(formula, total) {
    this.formula = formula;
    this.total = total;
    this.dice = [{}];
  }
}

const lookup = (data, path) => path.split(".").reduce((value, key) => value?.[key], data);

function installRoll() {
  globalThis.foundry = { dice: { terms: { DiceTerm } } };
  globalThis.Roll = {
    create(expression) {
      const tokens = String(expression).replace(/\s+/g, "").match(/[+-]?[^+-]+/g) ?? [];
      return {
        _evaluated: false,
        isDeterministic: true,
        evaluateSync() {},
        terms: tokens.flatMap((token, index) => {
          const operator = token.startsWith("-") ? "-" : "+";
          const raw = token.replace(/^[+-]/, "");
          const prefix = index === 0 && !token.startsWith("-") ? [] : [new OperatorTerm(operator)];
          if (/^\d+d\d+$/i.test(raw)) {
            const [number, faces] = raw.toLowerCase().split("d").map(Number);
            return [...prefix, new DiceTerm(raw, number, { number, faces })];
          }
          if (/^\d+$/.test(raw)) return [...prefix, new NumericTerm(Number(raw))];
          return [...prefix, new StringTerm(raw)];
        })
      };
    },
    replaceFormulaData(text, data) {
      return String(text).replace(/@([\w.-]+)/g, (_, path) => String(lookup(data, path) ?? 0));
    }
  };
}

const terms = (...parts) => parts.flatMap((part, index) => {
  if (typeof part === "number") return [...(index ? [new OperatorTerm(part < 0 ? "-" : "+")] : []), new NumericTerm(Math.abs(part))];
  const negative = part.startsWith("-");
  const formula = part.replace(/^-/, "");
  const [number, faces] = formula.split("d").map(Number);
  return [...(index ? [new OperatorTerm(negative ? "-" : "+")] : []), new DiceTerm(formula, number * 2, { number, faces })];
});

const translations = {
  "DND5E.AbilitySTRAbbr": "STR",
  "DND5E.AbilityDEXAbbr": "DEX",
  "DND5E.AbilityWISAbbr": "WIS",
  "DND5E.AbilityCONAbbr": "CON",
  "DND5E.Proficiency": "Proficiency",
  "DND5E.ConPoisoned": "Poisoned",
  "SRB.Rule.AbilityModifierLabel": "{ability} modifier",
  "SRB.Rule.BaseDamageLabel": "Base damage",
  "SRB.Rule.BaseHealingLabel": "Base healing",
  "SRB.Rule.BaseBonusLabel": "Base bonus",
  "SRB.Rule.ItemDamageBonusLabel": "{item} damage bonus",
  "SRB.Rule.ItemAttackBonusLabel": "{item} attack bonus",
  "SRB.Rule.SituationalLabel": "Situational bonus",
  "SRB.Rule.HitDieLabel": "Hit die",
  "SRB.Rule.GlobalSaveBonus": "Global save bonus",
  "SRB.Rule.GlobalCheckBonus": "Global check bonus",
  "SRB.Rule.DeathSaveBonusLabel": "death save bonus",
  "SRB.Rule.SaveBonusLabel": "save bonus",
  "SRB.Rule.CheckBonusLabel": "check bonus",
  "SRB.Rule.ActorAttackBonusLabel": "Actor attack bonus",
  "SRB.Rule.ActorDamageBonusLabel": "Actor damage bonus"
};

async function setup() {
  resetGlobals();
  installRoll();
  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations });
  game.system.version = "6.0.6";
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return translations; } });
  globalThis.CONFIG = {
    DND5E: {
      abilities: { str: { label: "Strength", type: "physical" }, dex: { label: "Dexterity", type: "physical" }, wis: { label: "Wisdom", type: "mental" }, con: { label: "Constitution", type: "physical" } },
      skills: { ste: { label: "Stealth", ability: "dex" } },
      tools: {},
      conditionTypes: { poisoned: { name: "DND5E.ConPoisoned" } },
      conditionEffects: { abilityCheckDisadvantage: new Set(["poisoned"]), attackDisadvantage: new Set(["poisoned"]) }
    }
  };
  const { Dnd5eRollAdapter, rememberRollContext } = await importStable("scripts/adapters/dnd5e-adapter.js");
  return { adapter: new Dnd5eRollAdapter(), rememberRollContext, game };
}

const labels = (breakdown) => [...breakdown.diceTerms, ...breakdown.modifiers, ...breakdown.computedTerms].map((term) => term.sourceLabel);

function makeActor(system, { effects = [], statuses = [], items = [], rollData = {} } = {}) {
  items.get = (id) => items.find((item) => item.id === id) ?? null;
  return {
    uuid: "Actor.hero",
    system,
    effects,
    items,
    statuses: new Set(statuses),
    allApplicableEffects: function* allApplicableEffects() { yield* effects; },
    hasConditionEffect(key) { return [...(globalThis.CONFIG.DND5E.conditionEffects[key] ?? [])].some((status) => this.statuses.has(status)); },
    getRollData: () => rollData
  };
}

test("dnd5e situational bonuses of the roll dialog are kept in the roll options and named", async () => {
  const { adapter, rememberRollContext } = await setup();
  const roll = { data: { situational: "@prof + 1", prof: 2 }, options: {} };
  rememberRollContext([roll, { data: {}, options: {} }]);
  assert.equal(roll.options["sephrals-roll-breakdown"].situational, "2 + 1");

  const actor = makeActor({ abilities: { dex: { mod: 3, save: { prof: { hasProficiency: false } } } }, attributes: { prof: 2, ac: { cover: 0 } } });
  const [save] = await adapter.buildBreakdowns({
    type: "save", system: { ability: "dex", type: "ability" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 3 + 1d4 + 2", total: 15, options: { rollType: "save", "sephrals-roll-breakdown": { situational: "1d4 + 2" } }, terms: terms("1d20", 3, "1d4", 2) }]
  });
  assert.deepEqual(labels(save), [null, "Situational bonus", "DEX modifier", "Situational bonus"]);

  // dnd5e 5 does not name the ability of a skill check on the card: the one chosen in the dialog is remembered
  const skillRoll = { data: {}, options: {} };
  rememberRollContext([skillRoll], { skill: "ste", ability: "wis" });
  assert.equal(skillRoll.options["sephrals-roll-breakdown"].ability, "wis");
  const stealthy = makeActor({ abilities: { dex: { mod: 3 }, wis: { mod: 1 } }, skills: { ste: { ability: "dex", prof: { hasProficiency: false } } }, attributes: { prof: 2 } });
  const [skill] = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "skill", skillId: "ste" } } }, getAssociatedActor: () => stealthy,
    rolls: [{ formula: "1d20 + 1", total: 9, options: { ...skillRoll.options }, terms: terms("1d20", 1) }]
  });
  assert.deepEqual(skill.modifiers.map((term) => term.sourceLabel), ["WIS modifier"]);
});

test("dnd5e damage names magic weapons, magic ammunition, critical dice and versatile dice", async () => {
  const { adapter } = await setup();
  const arrow = { id: "arrow", name: "Arrow +1", system: { magicAvailable: true, magicalBonus: "1", damage: { base: { formula: "" } } } };
  const actor = makeActor({ abilities: { dex: { mod: 3 }, str: { mod: 2 } }, attributes: { prof: 2 } }, { items: [arrow] });
  const base = { number: 1, denomination: 8, steppedDenomination: () => 10, scaledFormula: () => "1d8", formula: "1d8" };
  const bow = { id: "bow", name: "Longbow +1", type: "weapon", actor, getFlag: (scope, key) => (key === "last.shoot.ammunition" ? "arrow" : null),
    system: { magicAvailable: true, magicalBonus: "1", range: { value: 150 }, ammunition: { type: "arrow" }, isVersatile: true, damage: { base, versatile: { number: null, denomination: null } } } };
  const activity = { id: "shoot", type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 3 }) };
  globalThis.fromUuid = async (uuid) => ({ "Item.bow": bow, "Item.bow.Activity.shoot": activity }[uuid] ?? null);
  const message = (formula, rollTerms, options = {}) => ({ type: "damage", system: { item: { uuid: "Item.bow" }, activity: { uuid: "Item.bow.Activity.shoot" } },
    rolls: [{ formula, total: 20, options: { rollType: "damage", ...options }, terms: rollTerms }] });

  const [critical] = await adapter.buildBreakdowns(message("2d8 + 3 + 1 + 1", terms("2d8", 3, 1, 1), { isCritical: true }));
  assert.deepEqual(labels(critical), ["Base damage", "DEX modifier", "Longbow +1 damage bonus", "Arrow +1"]);
  // Without a critical hit a die of the same size is no base damage (a smite added to the card, for example)
  const [smite] = await adapter.buildBreakdowns(message("1d8 + 3 + 2d8", terms("1d8", 3, "2d8")));
  assert.deepEqual(labels(smite), ["Base damage", null, "DEX modifier"]);
  const [twoHanded] = await adapter.buildBreakdowns(message("1d10 + 3", terms("1d10", 3)));
  assert.deepEqual(labels(twoHanded), ["Base damage", "DEX modifier"]);
});

test("dnd5e healing and custom damage formulas resolve @mod and @scale", async () => {
  const { adapter } = await setup();
  const actor = makeActor({ abilities: { wis: { mod: 4 }, dex: { mod: 4 } }, attributes: { prof: 3 } });
  const spell = { name: "Cure Wounds", type: "spell", actor, system: { range: { value: 5 } } };
  const heal = { id: "heal", type: "heal", ability: "wis", healing: { formula: "2d8 + @mod", scaledFormula: () => "2d8 + @mod" }, getRollData: () => ({ mod: 4 }) };
  const sneak = { name: "Sneak Attack", type: "feat", actor, system: {} };
  const sneakDamage = { id: "sa", type: "damage", ability: "dex", damage: { parts: [{ formula: "@scale.rogue.sneak-attack", scaledFormula: () => "@scale.rogue.sneak-attack" }] },
    getRollData: () => ({ mod: 4, scale: { rogue: { "sneak-attack": "3d6" } } }) };
  globalThis.fromUuid = async (uuid) => ({ "Item.cure": spell, "Item.cure.Activity.heal": heal, "Item.sneak": sneak, "Item.sneak.Activity.sa": sneakDamage }[uuid] ?? null);

  const [healing] = await adapter.buildBreakdowns({ type: "healing", system: { item: { uuid: "Item.cure" }, activity: { uuid: "Item.cure.Activity.heal" } },
    rolls: [{ formula: "2d8 + 4", total: 12, options: { rollType: "healing" }, terms: terms("2d8", 4) }] });
  assert.deepEqual(labels(healing), ["Base healing", "WIS modifier"]);

  const [damage] = await adapter.buildBreakdowns({ type: "damage", system: { item: { uuid: "Item.sneak" }, activity: { uuid: "Item.sneak.Activity.sa" } },
    rolls: [{ formula: "3d6", total: 10, options: { rollType: "damage" }, terms: terms("3d6") }] });
  assert.deepEqual(labels(damage), ["Base damage"]);
});

test("dnd5e names bonuses after the item effects behind them, also negative dice", async () => {
  const { adapter } = await setup();
  const ring = { name: "Protection", changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "1" }] };
  const bane = { name: "Bane", changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "-1d4" }] };
  const actor = makeActor({ abilities: { wis: { mod: 1, save: { prof: { hasProficiency: false } } } }, attributes: { prof: 2, ac: { cover: 0 } },
    rolls: { ability: { save: { bonus: "1 + 1 - 1d4" } } } }, { effects: [ring, bane] });
  const [save] = await adapter.buildBreakdowns({ type: "save", system: { ability: "wis", type: "ability" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 1 + 1 + 1 - 1d4", total: 12, options: { rollType: "save" }, terms: terms("1d20", 1, 1, 1, "-1d4") }] });
  assert.deepEqual(labels(save), [null, "Bane", "WIS modifier", "Protection", "Global save bonus"]);
});

test("dnd5e death saves add the global save bonus, hit dice name their computed term", async () => {
  const { adapter } = await setup();
  const actor = makeActor({ abilities: { con: { mod: 3 } }, attributes: { prof: 2, death: { roll: { bonus: "1" } } }, rolls: { ability: { save: { bonus: "2" } } } });
  const [death] = await adapter.buildBreakdowns({ type: "save", system: { type: "death" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 1 + 2", total: 13, options: { rollType: "save" }, terms: terms("1d20", 1, 2) }] });
  assert.deepEqual(labels(death).slice(1), ["death save bonus", "Global save bonus"]);

  const [hitDie] = await adapter.buildBreakdowns({ type: "hitDie", system: {}, getAssociatedActor: () => actor,
    rolls: [{ formula: "max(1, 1d10 + 3)", total: 8, options: { rollType: "hitDie" }, terms: [new FunctionTerm("max(1, 1d10 + 3)", 8)] }] });
  assert.deepEqual(labels(hitDie), ["Hit die"]);
});

test("dnd5e explains advantage with roll mode effects and conditions", async () => {
  const { adapter } = await setup();
  const rage = { name: "Rage", uuid: "Actor.hero.ActiveEffect.rage", changes: [{ key: "system.abilities.str.check.roll.mode", type: "add", value: "1" }] };
  const actor = makeActor({ abilities: { str: { mod: 3, check: { prof: { hasProficiency: false } } }, dex: { mod: 2, check: { prof: { hasProficiency: false } } } }, attributes: { prof: 2 } },
    { effects: [rage], statuses: ["poisoned"] });
  const [str] = await adapter.buildBreakdowns({ type: "check", system: { ability: "str" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "2d20kh + 3", total: 18, options: { rollType: "check", advantageMode: 1 }, terms: [new DiceTerm("2d20kh", 15, { number: 2, faces: 20 }), new OperatorTerm("+"), new NumericTerm(3)] }] });
  assert.deepEqual(str.advantageContext.attributions.map((entry) => `${entry.type}:${entry.displayName}`), ["ADV:Rage", "DIS:Poisoned"]);
  const [dex] = await adapter.buildBreakdowns({ type: "check", system: { ability: "dex" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "2d20kl + 2", total: 8, options: { rollType: "check", advantageMode: -1 }, terms: [new DiceTerm("2d20kl", 6, { number: 2, faces: 20 }), new OperatorTerm("+"), new NumericTerm(2)] }] });
  assert.deepEqual(dex.advantageContext.attributions.map((entry) => `${entry.type}:${entry.displayName}`), ["DIS:Poisoned"]);
});

test("dnd5e reads Monk's TokenBar cards per roll and names the roller of each roll", async () => {
  const { adapter } = await setup();
  const aria = makeActor({ abilities: { dex: { mod: 3, save: { prof: { hasProficiency: true, term: "2", multiplier: 1 } } } }, attributes: { prof: 2, ac: { cover: 0 } } });
  const bren = makeActor({ abilities: { dex: { mod: 0, save: { prof: { hasProficiency: false } } } }, attributes: { prof: 2, ac: { cover: 0 } }, rolls: { ability: { save: { bonus: "1" } } } });
  globalThis.fromUuidSync = (uuid) => ({ "Scene.s.Token.a": { documentName: "Token", actor: aria }, "Scene.s.Token.b": { documentName: "Token", actor: bren } }[uuid] ?? null);
  const rollA = { formula: "1d20 + 3 + 2", total: 15, options: { rollType: "save" }, terms: terms("1d20", 3, 2) };
  const rollB = { formula: "1d20 + 0 + 1", total: 9, options: { rollType: "save" }, terms: terms("1d20", 0, 1) };
  const message = {
    speaker: {}, getAssociatedActor: () => null, rolls: [rollA, rollB],
    flags: { "monks-tokenbar": {
      rollmode: "roll",
      tokena: { uuid: "Scene.s.Token.a", name: "Aria", request: { type: "save", key: "dex" }, roll: { formula: rollA.formula, total: rollA.total } },
      tokenb: { uuid: "Scene.s.Token.b", name: "Bren", request: { type: "save", key: "dex" }, roll: { formula: rollB.formula, total: rollB.total } }
    } }
  };
  const breakdowns = await adapter.buildBreakdowns(message);
  assert.deepEqual(breakdowns.map((breakdown) => breakdown.modifiers.map((term) => term.sourceLabel)), [["DEX modifier", "Proficiency"], ["DEX modifier", "Global save bonus"]]);
  assert.deepEqual(adapter.getRollActors(message), [aria, bren]);
  // Every roll carries the name of its roller, the panel shows it to the GM and to the owner of the roller only
  assert.deepEqual(breakdowns.map((breakdown) => [breakdown.title, breakdown.privateTitle]), [["Aria", true], ["Bren", true]]);
  const { __test__ } = await import("../scripts/roll-breakdown-service.js");
  const titlesFor = async () => __test__.applyTitleVisibility(message, await adapter.buildBreakdowns(message), adapter).map((breakdown) => breakdown.title ?? null);
  assert.deepEqual(await titlesFor(), [null, null]);
  globalThis.game.user.isGM = true;
  assert.deepEqual(await titlesFor(), ["Aria", "Bren"]);
  globalThis.game.user.isGM = false;
  aria.isOwner = true;
  assert.deepEqual(await titlesFor(), ["Aria", null]);
  assert.equal(adapter.getRollActors({ rolls: [rollA], flags: {} }), null);
});

test("dnd5e keeps the sign of dice: Bless and Bane in one bonus, in either order of the effects", async () => {
  const { adapter } = await setup();
  const bless = { name: "Bless", changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "1d4" }] };
  const bane = { name: "Bane", changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "-1d4" }] };
  const actor = makeActor({ abilities: { wis: { mod: 1, save: { prof: { hasProficiency: false } } } }, attributes: { prof: 2, ac: { cover: 0 } },
    rolls: { ability: { save: { bonus: "1d4 - 1d4" } } } }, { effects: [bane, bless] });
  const [save] = await adapter.buildBreakdowns({ type: "save", system: { ability: "wis", type: "ability" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 1 + 1d4 - 1d4", total: 12, options: { rollType: "save" }, terms: terms("1d20", 1, "1d4", "-1d4") }] });
  assert.deepEqual(save.diceTerms.map((term) => term.sourceLabel), [null, "Bless", "Bane"]);
});

test("dnd5e names conditions only when they apply: immunity and exhaustion levels", async () => {
  const { adapter } = await setup();
  globalThis.CONFIG.DND5E.conditionEffects.abilityCheckDisadvantage = new Set(["poisoned", "exhaustion-1"]);
  globalThis.dnd5e = { settings: { rulesVersion: "modern" } };
  const actor = makeActor({ abilities: { dex: { mod: 2, check: { prof: { hasProficiency: false } } } }, attributes: { prof: 2 }, conditions: { exhaustion: 1 },
    traits: { ci: { value: new Set() } } }, { statuses: ["poisoned", "exhaustion"] });
  const roll = { formula: "2d20kl + 2", total: 8, options: { rollType: "check", advantageMode: -1 }, terms: [new DiceTerm("2d20kl", 6, { number: 2, faces: 20 }), new OperatorTerm("+"), new NumericTerm(2)] };
  const [check] = await adapter.buildBreakdowns({ type: "check", system: { ability: "dex" }, getAssociatedActor: () => actor, rolls: [roll] });
  assert.deepEqual(check.advantageContext.attributions.map((entry) => entry.displayName), ["Poisoned"]);
  actor.system.traits.ci.value = new Set(["poisoned"]);
  const [immune] = await adapter.buildBreakdowns({ type: "check", system: { ability: "dex" }, getAssociatedActor: () => actor, rolls: [roll] });
  assert.equal(immune.advantageContext, null);
  delete globalThis.dnd5e;
});

test("dnd5e damage takes the ammunition of its own attack, midi-qol bonus damage gets no base damage", async () => {
  const { adapter } = await setup();
  const plain = { id: "plain", name: "Arrow", system: { magicAvailable: false } };
  const magic = { id: "magic", name: "Arrow +1", system: { magicAvailable: true, magicalBonus: "1" } };
  const actor = makeActor({ abilities: { dex: { mod: 3 } }, attributes: { prof: 2 } }, { items: [plain, magic] });
  const base = { number: 1, denomination: 8, scaledFormula: () => "1d8", formula: "1d8" };
  // The item used the magic arrows last, this older damage card belongs to an attack with plain arrows
  const bow = { id: "bow", name: "Longbow", type: "weapon", actor, getFlag: () => "magic", system: { range: { value: 150 }, ammunition: { type: "arrow" }, damage: { base } } };
  const activity = { id: "shoot", type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 3 }) };
  globalThis.fromUuid = async (uuid) => ({ "Item.bow": bow, "Item.bow.Activity.shoot": activity }[uuid] ?? null);
  const attack = { type: "attack", timestamp: 1, system: { ammunition: "plain" }, rolls: [] };
  const usage = { getAssociatedRolls: (type) => (type === "attack" ? [attack] : []) };
  const [damage] = await adapter.buildBreakdowns({ type: "damage", timestamp: 2, getOriginatingMessage: () => usage,
    system: { item: { uuid: "Item.bow" }, activity: { uuid: "Item.bow.Activity.shoot" } },
    rolls: [{ formula: "1d8 + 3 + 1", total: 9, options: { rollType: "damage" }, terms: terms("1d8", 3, 1) }] });
  assert.deepEqual(labels(damage), ["Base damage", "DEX modifier", null]);

  const [, bonus] = await adapter.buildBreakdowns({ type: "usage", system: { item: { uuid: "Item.bow" }, activity: { uuid: "Item.bow.Activity.shoot" } },
    rolls: [
      { formula: "1d8 + 3", total: 7, options: { rollType: "damage" }, terms: terms("1d8", 3) },
      { formula: "2d8", total: 9, options: { rollType: "damage", "midi-qol": { rollType: "bonusDamage" } }, terms: terms("2d8") }
    ] });
  assert.deepEqual(bonus.diceTerms.map((term) => term.sourceLabel), [null]);
});

test("dnd5e damage rolls of one card share the item's damage: a module's extra roll gets no base damage", async () => {
  const { adapter } = await setup();
  const actor = makeActor({ abilities: { dex: { mod: 4 } }, attributes: { prof: 3 } });
  const base = { number: 1, denomination: 6, scaledFormula: () => "1d6", formula: "1d6" };
  const sword = { name: "Shortsword", type: "weapon", actor, system: { range: { value: 5 }, damage: { base } } };
  const activity = { id: "hit", type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 4 }) };
  globalThis.fromUuid = async (uuid) => ({ "Item.sword": sword, "Item.sword.Activity.hit": activity }[uuid] ?? null);
  // midi-qol card with the weapon damage and a Hunter's Mark die from a macro, both marked defaultDamage
  const [weapon, mark] = await adapter.buildBreakdowns({ type: "usage", system: { item: { uuid: "Item.sword" }, activity: { uuid: "Item.sword.Activity.hit" } },
    rolls: [
      { formula: "1d6 + 4", total: 8, options: { rollType: "damage", "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d6", 4) },
      { formula: "1d6", total: 3, options: { "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d6") }
    ] });
  assert.deepEqual(labels(weapon), ["Base damage", "DEX modifier"]);
  assert.deepEqual(labels(mark), [null]);
});

test("dnd5e names terms after the sheet modifier when nothing else explains them and they add up", async () => {
  const { adapter } = await setup();
  globalThis.CONFIG.DND5E.defaultAbilities = { initiative: "dex" };
  // The card of the Discord report: 1d20 + 2 + 2 + 3, the sheet shows +7, the actor data names only the DEX modifier
  const actor = makeActor({ abilities: { dex: { mod: 2, value: 14 } }, attributes: { prof: 2, init: { mod: 2, total: 7, prof: { hasProficiency: false } } } });
  const message = (total) => ({ type: "check", system: { ability: "dex", type: "initiative" }, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 2 + 2 + 3", total, options: { ability: "dex" }, terms: terms("1d20", 2, 2, 3) }] });
  const [report] = await adapter.buildBreakdowns(message(14));
  assert.deepEqual(report.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Sheet bonus", "Sheet bonus"]);
  // A total that does not match leaves the terms unknown
  actor.system.attributes.init.total = 5;
  const [other] = await adapter.buildBreakdowns(message(14));
  assert.deepEqual(other.modifiers.map((term) => term.sourceLabel), ["DEX modifier", null, null]);
});

test("dnd5e explains the summed damage of Mob Attack Tool: four hits in one roll without an item reference", async () => {
  const { adapter } = await setup();
  const base = { number: 1, denomination: 6, scaledFormula: () => "1d6", formula: "1d6" };
  const scimitar = { name: "Scimitar", type: "weapon", system: { range: { value: 5 }, damage: { base }, activities: [{ type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 2 }) }] } };
  const goblin = makeActor({ abilities: { dex: { mod: 2 } }, attributes: { prof: 2 } }, { items: [scimitar] });
  goblin.items.getName = (name) => goblin.items.find((entry) => entry.name === name) ?? null;
  scimitar.actor = goblin;
  const [damage] = await adapter.buildBreakdowns({ flavor: "Scimitar - Damage Roll (Slashing)", flags: { dnd5e: { roll: { type: "damage" } } }, getAssociatedActor: () => goblin,
    rolls: [{ formula: "4d6 + 8", total: 20, options: { type: "slashing" }, terms: terms("4d6", 8) }] });
  assert.deepEqual(labels(damage), ["Base damage", "DEX modifier ×4"]);

  // Without a speaker (as Mob Attack Tool posts it) and with a critical hit: the goblin is found among the actors
  globalThis.game.actors = { contents: [makeActor({ abilities: { dex: { mod: 1 } } }), goblin] };
  const [critical] = await adapter.buildBreakdowns({ flavor: "Scimitar - Damage Roll (Slashing) (Crit included)", flags: { dnd5e: { roll: { type: "damage" } } }, getAssociatedActor: () => null,
    rolls: [{ formula: "5d6 + 8", total: 25, options: { type: "slashing" }, terms: terms("5d6", 8) }] });
  assert.deepEqual(labels(critical), ["Base damage", "DEX modifier ×4"]);
  delete globalThis.game.actors;
});

test("dnd5e finds the weapon of a midi-qol damage only card through the name of its temporary item", async () => {
  const { adapter } = await setup();
  const base = { number: 1, denomination: 6, scaledFormula: () => "1d6", formula: "1d6" };
  const scimitar = { name: "Scimitar", type: "weapon", system: { range: { value: 5 }, damage: { base }, activities: [{ type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 2 }) }] } };
  const goblin = makeActor({ abilities: { dex: { mod: 2 } }, attributes: { prof: 2 } }, { items: [scimitar] });
  goblin.items.getName = (name) => goblin.items.find((entry) => entry.name === name) ?? null;
  scimitar.actor = goblin;
  globalThis.fromUuid = async () => null;
  const [damage] = await adapter.buildBreakdowns({ type: "usage", flavor: "", getAssociatedActor: () => goblin,
    system: { item: { id: "tmp", uuid: "Actor.g.Item.tmp", name: "Scimitar - Damage Roll (Slashing)" }, activity: { id: "a", uuid: "Actor.g.Item.tmp.Activity.a" } },
    rolls: [{ formula: "1d6 + 2", total: 6, options: { rollType: "damage", "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d6", 2) }] });
  assert.deepEqual(labels(damage), ["Base damage", "DEX modifier"]);
});

test("dnd5e names the bonuses that Chris's Premades adds in macros: Archery, Colossus Slayer, Hunter's Mark", async () => {
  const { adapter } = await setup();
  // The card of the second report: a heavy crossbow attack with +2 from Archery, then 1d8 and 1d6 as damage rolls of their own
  globalThis.chrisPremades = {
    macros: {
      archery: { name: "Archery", config: [{ value: "bonus", type: "text", default: "2" }], midi: { actor: [{ pass: "postAttackRoll" }] } },
      huntersMark: { name: "Hunter's Mark", config: [{ value: "formula", type: "text", default: "1d6" }, { value: "damageType", type: "select", default: "force" }], midi: { item: [{ pass: "rollFinished" }] } },
      // Runs when the actor is hit, adds nothing to its own damage
      wardingFlare: { name: "Warding", config: [{ value: "formula", type: "text", default: "2" }], midi: { actor: [{ pass: "targetApplyDamage" }] } }
    },
    legacyMacros: {
      colossusSlayer: { name: "Colossus Slayer", config: [{ value: "formula", type: "text", default: "1d8" }], midi: { actor: [{ pass: "damageRollComplete" }] } },
      huntersMarkSource: { name: "Hunter's Mark (source)", midi: { actor: [{ pass: "preAttackRollConfig" }, { pass: "damageRollComplete" }] } }
    }
  };
  const cpr = (identifier, extra = {}) => ({ "chris-premades": { info: { identifier }, ...extra } });
  const items = [
    { name: "Archery", type: "feat", documentName: "Item", flags: cpr("archery"), system: { source: { rules: "2024" } } },
    { name: "Colossus Slayer", type: "feat", documentName: "Item", flags: cpr("colossusSlayer"), system: { source: { rules: "2024" } } },
    { name: "Hunter's Mark", type: "spell", documentName: "Item", flags: cpr("huntersMark"), system: { source: { rules: "2024" } } },
    { name: "Warding", type: "feat", documentName: "Item", flags: cpr("wardingFlare"), system: { source: { rules: "2024" } } }
  ];
  const mark = { name: "Hunter's Mark", documentName: "ActiveEffect", changes: [],
    flags: cpr("huntersMark", { rules: "modern", huntersMark: { formula: "1d6" }, macros: { midi: { actor: ["huntersMarkSource"] } } }) };
  const actor = makeActor({ abilities: { dex: { mod: 4 } }, attributes: { prof: 3 } }, { items, effects: [mark] });
  actor.appliedEffects = [mark];
  const base = { number: 1, denomination: 10, scaledFormula: () => "1d10", formula: "1d10" };
  const crossbow = { name: "Heavy Crossbow", type: "weapon", actor, system: { range: { value: 100 }, ammunition: { type: "crossbowBolt" }, damage: { base } } };
  const activity = { id: "shoot", type: "attack", attack: { ability: "dex" }, damage: { parts: [base] }, getRollData: () => ({ mod: 4 }), getActionType: () => "rwak" };
  globalThis.fromUuid = async (uuid) => ({ "Item.bow": crossbow, "Item.bow.Activity.shoot": activity }[uuid] ?? null);
  const [attack, weapon, slayer, hunted, other] = await adapter.buildBreakdowns({ type: "usage", system: { item: { uuid: "Item.bow" }, activity: { uuid: "Item.bow.Activity.shoot" } },
    rolls: [
      { formula: "1d20 + 4 + 3 + 2", total: 20, options: { rollType: "attack", attackMode: "twoHanded" }, terms: terms("1d20", 4, 3, 2) },
      { formula: "1d10 + 4", total: 13, options: { rollType: "damage", "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d10", 4) },
      { formula: "1d8", total: 7, options: { "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d8") },
      { formula: "1d6", total: 2, options: { "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d6") },
      { formula: "1d4 + 2", total: 5, options: { "midi-qol": { rollType: "defaultDamage" } }, terms: terms("1d4", 2) }
    ] });
  assert.deepEqual(labels(attack), [null, "DEX modifier", "Proficiency", "Archery"]);
  assert.deepEqual(labels(other), [null, null]);
  assert.deepEqual(labels(weapon), ["Base damage", "DEX modifier"]);
  assert.deepEqual(labels(slayer), ["Colossus Slayer"]);
  assert.deepEqual(labels(hunted), ["Hunter's Mark"]);
  delete globalThis.chrisPremades;
});

test("dnd5e names the terms of a utility formula after their references", async () => {
  const { adapter } = await setup();
  // Deflect Attacks of the second report: 1d10 + @abilities.dex.mod + @classes.monk.levels rolled as 1d10 + 4 + 5
  const actor = makeActor({ abilities: { dex: { mod: 4 } }, attributes: { prof: 3 } });
  actor.classes = { monk: { name: "Monk" } };
  const feature = { name: "Deflect Attacks", type: "feat", actor, system: {} };
  const activity = { id: "use", type: "utility", roll: { formula: "1d10 + @abilities.dex.mod + @classes.monk.levels" },
    getRollData: () => ({ abilities: { dex: { mod: 4 } }, classes: { monk: { levels: 5 } } }) };
  globalThis.fromUuid = async (uuid) => ({ "Item.deflect": feature, "Item.deflect.Activity.use": activity }[uuid] ?? null);
  const [roll] = await adapter.buildBreakdowns({ type: "usage", system: { item: { uuid: "Item.deflect" }, activity: { uuid: "Item.deflect.Activity.use" } },
    rolls: [{ formula: "1d10 + 4 + 5", total: 17, options: { rollType: "generic", "midi-qol": { rollType: "utility" } }, terms: terms("1d10", 4, 5) }] });
  assert.deepEqual(labels(roll), ["Deflect Attacks", "DEX modifier", "Monk level"]);
});

test("dnd5e picks the actor bonus of a thrown weapon by its attack mode", async () => {
  const { adapter } = await setup();
  // A spear has a range (thrown 20/60) but a melee attack uses the melee bonus, as dnd5e does (Dueling +2)
  const actor = makeActor({ abilities: { str: { mod: 3 } }, attributes: { prof: 2 }, rolls: { damage: { mwak: { bonus: "2" } } } });
  const base = { number: 1, denomination: 6, scaledFormula: () => "1d6", formula: "1d6" };
  const spear = { name: "Spear", type: "weapon", actor, system: { range: { value: 20, long: 60 }, damage: { base } } };
  const activity = { id: "stab", type: "attack", attack: { ability: "str" }, damage: { parts: [base] }, getRollData: () => ({ mod: 3 }),
    getActionType: (mode) => (mode?.startsWith("thrown") ? "rwak" : "mwak") };
  globalThis.fromUuid = async (uuid) => ({ "Item.spear": spear, "Item.spear.Activity.stab": activity }[uuid] ?? null);
  const card = (attackMode) => ({ type: "usage", system: { item: { uuid: "Item.spear" }, activity: { uuid: "Item.spear.Activity.stab" } },
    rolls: [
      { formula: "1d20 + 3 + 2", total: 15, options: { rollType: "attack", attackMode }, terms: terms("1d20", 3, 2) },
      { formula: "1d6 + 3 + 2", total: 9, options: { rollType: "damage" }, terms: terms("1d6", 3, 2) }
    ] });
  const [, melee] = await adapter.buildBreakdowns(card("oneHanded"));
  assert.deepEqual(labels(melee), ["Base damage", "STR modifier", "Actor damage bonus"]);
  const [, thrown] = await adapter.buildBreakdowns(card("thrownOneHanded"));
  assert.deepEqual(labels(thrown), ["Base damage", "STR modifier", null]);
});

test("dnd5e cards keep the sources of the moment they were rolled after an effect expired", async () => {
  const { adapter } = await setup();
  const stored = await importStable("scripts/stored-breakdown.js");
  assert.equal(adapter.storeBreakdowns, true);
  const bless = { name: "Bless", changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "1d4" }] };
  const actor = makeActor({ abilities: { wis: { mod: 1, save: { prof: { hasProficiency: false } } } }, attributes: { prof: 2, ac: { cover: 0 } },
    rolls: { ability: { save: { bonus: "1d4" } } } }, { effects: [bless] });
  const message = { id: "save", type: "save", system: { ability: "wis", type: "ability" }, flags: {}, getAssociatedActor: () => actor,
    rolls: [{ formula: "1d20 + 1 + 1d4", total: 14, options: { rollType: "save" }, terms: terms("1d20", 1, "1d4") }] };
  const atRoll = await adapter.buildBreakdowns(message);
  assert.deepEqual(atRoll[0].diceTerms.map((term) => term.sourceLabel), [null, "Bless"]);
  message.flags["sephrals-roll-breakdown"] = { breakdown: stored.buildStoreFlag(message, message.rolls, atRoll, { adapterId: adapter.id, lang: "en" }) };

  // Bless ends: the card rendered from the actor as it is now lost the source, the stored copy keeps it
  actor.effects.length = 0;
  actor.system.rolls.ability.save.bonus = "";
  assert.notDeepEqual((await adapter.buildBreakdowns(message))[0]?.diceTerms.map((term) => term.sourceLabel), [null, "Bless"]);
  const [restored] = await stored.resolveBreakdowns(adapter, message);
  assert.deepEqual(restored.diceTerms.map((term) => term.sourceLabel ?? null), [null, "Bless"]);
  assert.equal(restored.stored, true);
  assert.equal(restored.rollIndex, 0);
});
