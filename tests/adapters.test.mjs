import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importStable, resetGlobals } from "./helpers/test-helpers.mjs";

class OperatorTerm {
  constructor(operator) {
    this.operator = operator;
  }
}

class NumericTerm {
  constructor(value, extras = {}) {
    this.number = value;
    this.total = value;
    Object.assign(this, extras);
  }
}

class DiceTerm {
  constructor(formula, total, extras = {}) {
    this.formula = formula;
    this.total = total;
    Object.assign(this, extras);
  }
}

class StringTerm {
  constructor(formula, extras = {}) {
    this.formula = formula;
    Object.assign(this, extras);
  }
}

function createRollFactory() {
  return {
    create(expression) {
      const sanitized = String(expression).trim();
      if (sanitized === "throw") throw new Error("invalid formula");
      const normalized = sanitized.replace(/\s+/g, "");
      const tokens = normalized.match(/[+-]?[^+-]+/g) ?? [];
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

          if (/^\d+$/.test(raw)) {
            return [...prefix, new NumericTerm(Number(raw))];
          }

          return [...prefix, new StringTerm(raw)];
        })
      };
    }
  };
}

function createTranslations() {
  return {
    "DND5E.AbilitySTRAbbr": "STR",
    "DND5E.AbilityWISAbbr": "WIS",
    "DND5E.Proficiency": "Proficiency",
    "SRB.Rule.Context.MWAK": "Melee weapon attack",
    "SRB.Rule.Context.RSAK": "Ranged spell attack",
    "SRB.Rule.Context.SPELL_SAVE": "Spell save",
    "SRB.Rule.ActiveEffectAttack": "Effect attack {context}",
    "SRB.Rule.ActorBonusAttack": "Actor attack {context}",
    "SRB.Rule.AttackAbility": "Ability {ability} {context}",
    "SRB.Rule.Proficiency": "Proficiency {context}",
    "SRB.Rule.ItemAttackBonus": "Item attack {item}",
    "SRB.Rule.AmmunitionBonus": "Ammo {item}",
    "SRB.Rule.FormulaSegment": "Formula {formula}",
    "SRB.Rule.Known.BlessAttack.2014": "Bless 2014",
    "SRB.Rule.Known.BaneAttack": "Bane generic",
    "SRB.Rule.Ruleset.2014": "2014 rules",
    "SRB.Rule.Ruleset.2024": "2024 rules",
    "SRB.Rule.RulesetNote": "Ruleset {ruleset}",
    "SRB.Rule.BaseDamage": "Base damage",
    "SRB.Rule.BaseBonus": "Base bonus",
    "SRB.Rule.ActiveEffectDamage": "Effect damage {context}",
    "SRB.Rule.ActorBonusDamage": "Actor damage {context}",
    "SRB.Rule.DamageAbility": "Damage ability {ability}"
  };
}

function installRollEnvironment() {
  globalThis.foundry = { dice: { terms: { DiceTerm } } };
  globalThis.Roll = createRollFactory();
}

test("generic adapter supports roll messages and filters empty breakdowns", async () => {
  resetGlobals();
  installRollEnvironment();

  const { GenericRollAdapter } = await importStable("scripts/adapters/generic-adapter.js");
  const adapter = new GenericRollAdapter();

  assert.equal(adapter.supportsMessage({ rolls: [null, {}] }), true);
  assert.equal(adapter.supportsMessage({ rolls: [] }), false);

  const breakdowns = await adapter.buildBreakdowns({
    rolls: [
      null,
      { formula: "1d20", total: 12, terms: [new DiceTerm("1d20", 12, { number: 1, faces: 20 })] }
    ]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].adapterId, "generic");
});

test("dnd5e adapter falls back to the generic adapter when metadata is missing", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    rolls: [{ formula: "1d20", total: 12, terms: [new DiceTerm("1d20", 12, { number: 1, faces: 20 })] }]
  });

  assert.equal(adapter.supportsMessage({ rolls: [{}] }), true);
  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].adapterId, "dnd5e");
});

test("dnd5e adapter resolves attack roll sources including effects and ammunition", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({
    lang: "en",
    systemId: "dnd5e",
    translations: createTranslations()
  });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });

  const actorItems = [];
  actorItems.get = (id) => actorItems.find((item) => item.id === id) ?? null;
  const actor = {
    system: {
      abilities: { str: { mod: 4 } },
      attributes: { prof: 3 },
      bonuses: { mwak: { attack: "1" } }
    },
    effects: [{
      name: "Bless",
      changes: [{ key: "system.bonuses.mwak.attack", value: "1d4" }]
    }],
    items: actorItems
  };
  const ammunition = { id: "ammo-1", name: "Silver Arrow", system: { bonus: "1" } };
  actorItems.push(ammunition);

  const item = {
    name: "Longsword",
    type: "weapon",
    actor,
    system: {
      range: { value: 5 },
      ammunition: { type: null },
      source: { rules: "2014" }
    }
  };
  const activity = {
    attack: {
      ability: "str",
      bonus: "2"
    },
    type: "attack"
  };

  globalThis.fromUuid = async (uuid) => ({
    "uuid:item": item,
    "uuid:activity": activity
  }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:activity" },
        item: { uuid: "uuid:item" },
        roll: { type: "attack", ammunition: "ammo-1" }
      }
    },
    rolls: [{
      formula: "1d20 + 4 + 3 + 2 + 1d4 + 1 + 1",
      total: 25,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(2),
        new OperatorTerm("+"),
        new DiceTerm("1d4", 3, { number: 1, faces: 4 }),
        new OperatorTerm("+"),
        new NumericTerm(1),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].diceTerms.some((term) => term.sourceLabel === "Bless"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "STR modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Longsword attack bonus"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Actor attack bonus"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Silver Arrow"), true);
  assert.equal(breakdowns[0].diceTerms.find((term) => term.sourceLabel === "Bless").sourceDetail.includes("Bless 2014"), true);
});

test("dnd5e adapter resolves damage sources for save-based spells", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({
    lang: "en",
    systemId: "dnd5e",
    translations: createTranslations()
  });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });

  const actor = {
    system: {
      abilities: { wis: { mod: 5 } },
      bonuses: { rsak: { damage: "1" } }
    },
    effects: [{
      name: "Bane",
      changes: [{ key: "system.bonuses.rsak.damage", value: "2" }]
    }],
    items: []
  };

  const item = {
    name: "Sacred Flame",
    type: "spell",
    actor,
    system: {
      range: { value: 60 },
      source: { rules: "2024" }
    }
  };
  const activity = {
    ability: "wis",
    type: "save",
    damage: { parts: [{ number: 2, denomination: 6, bonus: "3" }] }
  };

  globalThis.fromUuid = async (uuid) => ({
    "uuid:item": item,
    "uuid:activity": activity
  }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:activity" },
        item: { uuid: "uuid:item" },
        roll: { type: "damage" }
      }
    },
    rolls: [{
      formula: "2d6 + 3 + 2 + 5 + 1",
      total: 18,
      terms: [
        new DiceTerm("2d6", 7, { number: 2, faces: 6 }),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(2),
        new OperatorTerm("+"),
        new NumericTerm(5),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].diceTerms.some((term) => term.sourceLabel === "Base damage"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Base bonus"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Bane"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "WIS modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Actor damage bonus"), true);
  assert.equal(breakdowns[0].modifiers.find((term) => term.sourceLabel === "Bane").sourceDetail.includes("Ruleset 2024 rules"), true);
});

test("dnd5e adapter covers attack fallbacks, unresolved matches, and generic rule fallbacks", async () => {
  resetGlobals();
  installRollEnvironment();

  const translations = {
    ...createTranslations(),
    "DND5E.AbilityCHAAbbr": "DND5E.AbilityCHAAbbr",
    "DND5E.AbilityCHA": "Charisma",
    "DND5E.AbilityINTAbbr": "DND5E.AbilityINTAbbr",
    "DND5E.AbilityINT": "DND5E.AbilityINT",
    "SRB.Rule.Ruleset.custom": "Custom rules"
  };

  const { game } = createGameStub({ lang: "qa", systemId: "dnd5e", translations });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return translations; } });

  const actorItems = [{
    name: "Bane",
    system: {
      identifier: "bane",
      source: { rules: "custom" }
    }
  }];
  actorItems.get = () => null;

  const actor = {
    system: {
      abilities: {
        cha: { mod: 2 },
        int: { mod: 1 }
      },
      attributes: { prof: 2 },
      bonuses: { rwak: { attack: "10 + 2" }, mwak: { damage: "throw" } }
    },
    effects: [
      { name: "Bane", changes: [{ key: "system.bonuses.rwak.attack", value: "-1d4" }] },
      { name: "Mystery", changes: [{ key: "system.bonuses.rwak.attack", value: "mystery" }] },
      { name: "Broken", changes: [{ key: "system.bonuses.mwak.damage", value: "throw" }] }
    ],
    items: actorItems
  };

  const attackItem = {
    name: "Longbow",
    type: "weapon",
    actor,
    system: {
      range: { value: 120 },
      ammunition: { type: "arrow" },
      source: { rules: "custom" }
    }
  };
  const attackActivity = {
    attack: {
      ability: "cha",
      bonus: "1"
    },
    type: "attack"
  };

  const damageItem = {
    name: "Staff",
    type: "weapon",
    actor,
    system: {
      range: { value: 5 },
      ammunition: { type: null },
      source: { rules: "custom" }
    }
  };
  const damageActivity = {
    ability: "int",
    type: "attack",
    damage: { parts: [{ number: 1, denomination: 8, bonus: "0" }] }
  };

  globalThis.fromUuid = async (uuid) => ({
    "uuid:attack-item": attackItem,
    "uuid:attack-activity": attackActivity,
    "uuid:damage-item": damageItem,
    "uuid:damage-activity": damageActivity
  }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  assert.equal(adapter.supportsMessage({ rolls: [{}] }), true);
  game.system.id = "other-system";
  assert.equal(adapter.supportsMessage({ rolls: [{}] }), false);
  game.system.id = "dnd5e";

  const attackBreakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:attack-activity" },
        item: { uuid: "uuid:attack-item" },
        roll: { type: "attack" }
      }
    },
    rolls: [{
      formula: "1d20 + bonus 2 + 1 - 1d4 + mystery",
      total: 14,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(2, { formula: "bonus 2" }),
        new OperatorTerm("+"),
        new NumericTerm(1),
        new OperatorTerm("-"),
        new DiceTerm("1d4", 2, { number: 1, faces: 4 }),
        new OperatorTerm("+"),
        new StringTerm("mystery")
      ]
    }]
  });

  assert.equal(attackBreakdowns[0].modifiers.some((term) => term.sourceLabel === "Charisma modifier"), true);
  assert.equal(attackBreakdowns[0].modifiers.some((term) => term.sourceLabel === "Longbow attack bonus"), true);
  assert.equal(attackBreakdowns[0].diceTerms.find((term) => term.sourceLabel === "Bane").sourceDetail.includes("Bane generic"), true);
  assert.equal(attackBreakdowns[0].unresolvedTerms.find((term) => term.sourceLabel === "Mystery").sourceDetail.includes("Custom rules"), true);

  const damageBreakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:damage-activity" },
        item: { uuid: "uuid:damage-item" },
        roll: { type: "damage" }
      }
    },
    rolls: [{
      formula: "1d8 + 1",
      total: 5,
      terms: [
        new DiceTerm("1d8", 4, { number: 1, faces: 8 }),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(damageBreakdowns[0].modifiers.some((term) => term.sourceLabel === "INT modifier"), true);
});

test("dnd5e adapter resolves modern attack fields and spellcasting fallback abilities", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({
    lang: "en",
    systemId: "dnd5e",
    translations: createTranslations()
  });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });

  const actor = {
    system: {
      abilities: { cha: { mod: 4 } },
      attributes: { prof: 3, spellcasting: "cha" },
      bonuses: { rsak: { attack: "1", damage: "0" } }
    },
    effects: [],
    items: []
  };

  const item = {
    name: "Eldritch Blast",
    type: "spell",
    actor,
    system: {
      range: { value: 120 },
      availableAbilities: new Set(["cha"]),
      source: { rules: "2024" }
    }
  };
  const activity = {
    type: "attack",
    attack: {
      ability: "spellcasting",
      bonus: "1"
    },
    damage: { parts: [{ number: 1, denomination: 10, bonus: "0" }] },
    availableAbilities: new Set(["cha"])
  };

  globalThis.fromUuid = async (uuid) => ({
    "uuid:item": item,
    "uuid:activity": activity
  }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();

  const attackBreakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:activity" },
        item: { uuid: "uuid:item" },
        roll: { type: "attack" }
      }
    },
    rolls: [{
      formula: "1d20 + 4 + 3 + 1",
      total: 17,
      terms: [
        new DiceTerm("1d20", 9, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(attackBreakdowns[0].modifiers.some((term) => term.sourceLabel === "CHA modifier"), true);
  assert.equal(attackBreakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(attackBreakdowns[0].modifiers.some((term) => term.sourceLabel === "Eldritch Blast attack bonus"), true);

  const damageBreakdowns = await adapter.buildBreakdowns({
    flags: {
      dnd5e: {
        activity: { uuid: "uuid:activity" },
        item: { uuid: "uuid:item" },
        roll: { type: "damage" }
      }
    },
    rolls: [{
      formula: "1d10 + 4",
      total: 12,
      terms: [
        new DiceTerm("1d10", 8, { number: 1, faces: 10 }),
        new OperatorTerm("+"),
        new NumericTerm(4)
      ]
    }]
  });

  assert.equal(damageBreakdowns[0].modifiers.some((term) => term.sourceLabel === "CHA modifier"), true);
});