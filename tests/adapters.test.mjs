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
    "DND5E.AbilityDEXAbbr": "DEX",
    "DND5E.AbilityINTAbbr": "INT",
    "DND5E.Proficiency": "Proficiency",
    "DND5E.SkillArc": "Arcana",
    "SRB.Rule.Context.MWAK": "Melee weapon attack",
    "SRB.Rule.Context.RSAK": "Ranged spell attack",
    "SRB.Rule.Context.SPELL_SAVE": "Spell save",
    "SRB.Rule.ActiveEffectAttack": "Effect attack {context}",
    "SRB.Rule.ActorBonusAttack": "Actor attack {context}",
    "SRB.Rule.AttackAbility": "Ability {ability} {context}",
    "SRB.Rule.CheckAbility": "Check ability {ability}",
    "SRB.Rule.SaveAbility": "Save ability {ability}",
    "SRB.Rule.ConcentrationAbility": "Concentration ability {ability}",
    "SRB.Rule.DeathSaveAbility": "Death save ability {ability}",
    "SRB.Rule.SkillAbility": "Skill ability {ability}",
    "SRB.Rule.ToolAbility": "Tool ability {ability}",
    "SRB.Rule.Proficiency": "Proficiency {context}",
    "SRB.Rule.Expertise": "Expertise",
    "SRB.Rule.HalfProficiency": "Half Proficiency",
    "SRB.Rule.CheckBonusLabel": "check bonus",
    "SRB.Rule.SaveBonusLabel": "save bonus",
    "SRB.Rule.ConcentrationBonusLabel": "concentration bonus",
    "SRB.Rule.DeathSaveBonusLabel": "death save bonus",
    "SRB.Rule.SkillBonusLabel": "skill bonus",
    "SRB.Rule.ToolBonusLabel": "tool bonus",
    "SRB.Rule.SkillBonus": "Skill bonus {context}",
    "SRB.Rule.ToolBonus": "Tool bonus {context}",
    "SRB.Rule.GlobalCheckBonus": "Global check bonus",
    "SRB.Rule.GlobalSaveBonus": "Global save bonus",
    "SRB.Rule.GlobalSkillBonus": "Global skill bonus",
    "SRB.Rule.GlobalToolBonus": "Global tool bonus",
    "SRB.Rule.GlobalBonusContext": "Global bonus {context}",
    "SRB.Rule.Context.CHECK": "ability check",
    "SRB.Rule.Context.SAVE": "saving throw",
    "SRB.Rule.Context.CONCENTRATION": "concentration save",
    "SRB.Rule.Context.DEATH": "death save",
    "SRB.Rule.Context.SKILL": "skill check",
    "SRB.Rule.Context.SKILL_GENERIC": "skill check",
    "SRB.Rule.Context.TOOL": "tool check",
    "SRB.Rule.Context.TOOL_GENERIC": "tool check",
    "SRB.Rule.ConcentrationBonus": "Concentration bonus",
    "SRB.Rule.DeathSaveBonus": "Death save bonus",
    "SRB.Rule.Cover": "Cover",
    "SRB.Rule.CoverBonus": "Cover bonus",
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
      {
        formula: "1d20 + 3",
        total: 15,
        terms: [
          new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
          new OperatorTerm("+"),
          new NumericTerm(3)
        ]
      }
    ]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].adapterId, "generic");

  const diceOnlyBreakdowns = await adapter.buildBreakdowns({
    rolls: [{ formula: "1d20", total: 12, terms: [new DiceTerm("1d20", 12, { number: 1, faces: 20 })] }]
  });

  assert.equal(diceOnlyBreakdowns.length, 0);
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
    rolls: [{
      formula: "1d20 + 3",
      total: 15,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(3)
      ]
    }]
  });

  assert.equal(adapter.supportsMessage({ rolls: [{}] }), true);
  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].adapterId, "dnd5e");

  const diceOnlyBreakdowns = await adapter.buildBreakdowns({
    rolls: [{ formula: "1d20", total: 12, terms: [new DiceTerm("1d20", 12, { number: 1, faces: 20 })] }]
  });

  assert.equal(diceOnlyBreakdowns.length, 0);
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

test("dnd5e adapter includes advantage attribution reasons from roll metadata", async () => {
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
      abilities: { str: { mod: 4 } },
      attributes: { prof: 3 },
      bonuses: { mwak: { attack: "1" } }
    },
    effects: [],
    items: []
  };
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
      ability: "str"
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
        activity: { uuid: "uuid:activity", type: "attack" },
        item: { uuid: "uuid:item" }
      }
    },
    rolls: [{
      formula: "1d20 + 4 + 3",
      total: 19,
      options: {
        rollType: "attack",
        advantageMode: 1,
        attributions: [
          { type: "ADV", source: "flanking", displayName: "Flanking" },
          { type: "NOADV", source: "condition", displayName: "Suppressed by condition" }
        ]
      },
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].advantageContext.state, "advantage");
  assert.deepEqual(breakdowns[0].advantageContext.attributions, [
    { type: "ADV", source: "flanking", displayName: "Flanking" },
    { type: "NOADV", source: "condition", displayName: "Suppressed by condition" }
  ]);
});

test("dnd5e adapter resolves mixed midi attack and damage rolls per roll type", async () => {
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
      abilities: { str: { mod: 3 } },
      attributes: { prof: 2 },
      bonuses: { mwak: { damage: "1" } }
    },
    effects: [],
    items: []
  };

  const item = {
    name: "Dagger",
    type: "weapon",
    actor,
    system: {
      range: { value: 5 },
      ammunition: { type: null },
      source: { rules: "2024" }
    }
  };
  const activity = {
    type: "attack",
    attack: { ability: "str" },
    damage: { parts: [{ number: 1, denomination: 4, bonus: "0" }] }
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
        activity: { uuid: "uuid:activity", type: "attack" },
        item: { uuid: "uuid:item" }
      },
      "midi-qol": {
        messageType: "attack"
      }
    },
    rolls: [{
      formula: "1d20 + 3 + 2",
      total: 18,
      options: { rollType: "attack" },
      terms: [
        new DiceTerm("1d20", 13, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(2)
      ]
    }, {
      formula: "1d4 + 3 + 1",
      total: 6,
      options: { rollType: "damage" },
      terms: [
        new DiceTerm("1d4", 2, { number: 1, faces: 4 }),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 2);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "STR modifier" && term.sourceDetail?.includes("Ability STR Melee weapon attack")), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].advantageContext, null);
  assert.equal(breakdowns[1].diceTerms.some((term) => term.sourceLabel === "Base damage"), true);
  assert.equal(breakdowns[1].modifiers.some((term) => term.sourceLabel === "STR modifier" && term.sourceDetail?.includes("Damage ability STR")), true);
  assert.equal(breakdowns[1].modifiers.some((term) => term.sourceLabel === "Actor damage bonus"), true);
  assert.equal(breakdowns[1].advantageContext, null);
});

test("dnd5e adapter keeps pure dice damage rolls visible in mixed messages", async () => {
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
      abilities: { int: { mod: 4 } },
      attributes: { prof: 3 },
      bonuses: { rsak: { damage: "" } }
    },
    effects: [],
    items: []
  };

  const item = {
    name: "Fire Bolt",
    type: "spell",
    actor,
    system: {
      range: { value: 120 },
      source: { rules: "2014" }
    }
  };
  const activity = {
    type: "attack",
    attack: { ability: "spellcasting" },
    availableAbilities: ["int"],
    damage: { parts: [{ number: 2, denomination: 10, bonus: "0" }] }
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
        activity: { uuid: "uuid:activity", type: "attack" },
        item: { uuid: "uuid:item" }
      },
      "midi-qol": {
        messageType: "attack"
      }
    },
    rolls: [{
      formula: "2d20kl + 4 + 3",
      total: 13,
      options: {
        rollType: "attack",
        advantageMode: -1,
        attributions: [{ type: "DIS", source: "nearbyFoe", displayName: "Nearby foe" }]
      },
      terms: [
        new DiceTerm("2d20kl", 6, { number: 2, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3)
      ]
    }, {
      formula: "2d10",
      total: 14,
      options: { rollType: "damage" },
      terms: [new DiceTerm("2d10", 14, { number: 2, faces: 10 })]
    }]
  });

  assert.equal(breakdowns.length, 2);
  assert.equal(breakdowns[0].advantageContext.attributions[0].displayName, "Nearby foe");
  assert.equal(breakdowns[1].diceTerms.length, 1);
  assert.equal(breakdowns[1].diceTerms[0].sourceLabel, "Base damage");
  assert.equal(breakdowns[1].modifiers.length, 0);
  assert.equal(breakdowns[1].advantageContext, null);
});

test("dnd5e adapter resolves save activity messages by embedded damage roll type", async () => {
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
      abilities: { wis: { mod: 4 } },
      bonuses: { rsak: { damage: "1" } }
    },
    effects: [],
    items: []
  };

  const item = {
    name: "Burning Hands",
    type: "spell",
    actor,
    system: {
      range: { value: 15 },
      source: { rules: "2024" }
    }
  };
  const activity = {
    type: "save",
    ability: "wis",
    damage: { parts: [{ number: 3, denomination: 6, bonus: "0" }] }
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
        activity: { uuid: "uuid:activity", type: "save" },
        item: { uuid: "uuid:item" }
      },
      "midi-qol": {
        messageType: "attack"
      }
    },
    rolls: [{
      formula: "3d6 + 4 + 1",
      total: 15,
      options: { rollType: "damage", "midi-qol": { rollType: "defaultDamage" } },
      terms: [
        new DiceTerm("3d6", 10, { number: 3, faces: 6 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].diceTerms.some((term) => term.sourceLabel === "Base damage"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "WIS modifier" && term.sourceDetail?.includes("Damage ability WIS")), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Actor damage bonus"), true);
});

test("dnd5e adapter resolves damage activities without dnd5e roll metadata", async () => {
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
      abilities: { wis: { mod: 4 } },
      bonuses: { rsak: { damage: "1" } }
    },
    effects: [],
    items: []
  };

  const item = {
    name: "Magic Missile",
    type: "spell",
    actor,
    system: {
      range: { value: 120 },
      source: { rules: "2024" }
    }
  };
  const activity = {
    type: "damage",
    damage: { parts: [{ number: 0, denomination: null, bonus: "2" }] }
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
        activity: { uuid: "uuid:activity", type: "damage" },
        item: { uuid: "uuid:item" }
      },
      "midi-qol": {
        messageType: "attack"
      }
    },
    rolls: [{
      formula: "2 + 1",
      total: 3,
      options: { rollType: "damage", "midi-qol": { rollType: "defaultDamage" } },
      terms: [
        new NumericTerm(2),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Base bonus"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Actor damage bonus"), true);
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

test("dnd5e adapter resolves item and activity from ids and cause when uuids are missing", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({
    lang: "en",
    systemId: "dnd5e",
    translations: createTranslations()
  });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });

  const activity = {
    id: "attack-1",
    type: "attack",
    attack: {
      ability: "cha",
      bonus: "1"
    }
  };

  const activities = new Map([[activity.id, activity]]);
  activities.get = Map.prototype.get.bind(activities);

  const items = [];
  items.get = (id) => items.find((item) => item.id === id) ?? null;

  const actor = {
    system: {
      abilities: { cha: { mod: 4 } },
      attributes: { prof: 3 },
      bonuses: { rsak: { attack: "0" } }
    },
    effects: [],
    items
  };

  const item = {
    id: "item-1",
    uuid: "uuid:item",
    name: "Eldritch Blast",
    type: "spell",
    actor,
    system: {
      range: { value: 120 },
      activities,
      source: { rules: "2024" }
    }
  };
  items.push(item);

  globalThis.fromUuid = async (uuid, options = {}) => {
    if (uuid === ".Item.item-1.Activity.attack-1" && options.relative === actor) return activity;
    return ({ "uuid:item": item }[uuid] ?? null);
  };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    getAssociatedActor() {
      return actor;
    },
    system: {
      cause: ".Item.item-1.Activity.attack-1"
    },
    flags: {
      dnd5e: {
        activity: { id: "attack-1", type: "attack" },
        item: { id: "item-1", type: "spell" }
      }
    },
    rolls: [{
      formula: "1d20 + 4 + 3 + 1",
      total: 19,
      options: { rollType: "attack" },
      terms: [
        new DiceTerm("1d20", 11, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "CHA modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Eldritch Blast attack bonus"), true);
});

test("dnd5e adapter resolves item-based attack bonuses from item data and item effects", async () => {
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
      attributes: { prof: 3 },
      bonuses: { rsak: { attack: "" } }
    },
    effects: [],
    items: []
  };

  const item = {
    id: "item-1",
    name: "Eldritch Blast",
    type: "spell",
    actor,
    effects: [{
      name: "Arcane Focus",
      changes: [{ key: "system.attack.bonus", value: "1" }]
    }],
    system: {
      range: { value: 120 },
      attack: { bonus: "" },
      magicAvailable: true,
      magicalBonus: "1",
      source: { rules: "2024" }
    }
  };
  const activity = {
    id: "attack-1",
    type: "attack",
    attack: {
      ability: "cha",
      bonus: ""
    }
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
        roll: { type: "attack" }
      }
    },
    rolls: [{
      formula: "1d20 + 4 + 3 + 1",
      total: 18,
      terms: [
        new DiceTerm("1d20", 10, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "CHA modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(
    breakdowns[0].modifiers.some((term) => term.sourceLabel === "Eldritch Blast attack bonus" || term.sourceLabel === "Arcane Focus"),
    true
  );
});

test("dnd5e adapter resolves saving throw sources without item or activity context", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = {
    abilities: {
      wis: { label: "Wisdom" }
    },
    skills: {},
    tools: {}
  };

  const actor = {
    system: {
      abilities: {
        wis: {
          mod: 2,
          saveProf: { hasProficiency: false, term: "0", multiplier: 0 },
          bonuses: { save: "" }
        }
      },
      bonuses: { abilities: { save: "" } },
      attributes: { ac: { cover: 0 } }
    }
  };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "save", ability: "wis" } } },
    getAssociatedActor() { return actor; },
    rolls: [{
      formula: "1d20 + 2",
      total: 10,
      terms: [
        new DiceTerm("1d20", 8, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(2)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "WIS modifier"), true);
});

test("dnd5e adapter resolves skill check sources without item or activity context", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = {
    abilities: {
      int: { label: "Intelligence" }
    },
    skills: {
      arc: { label: "Arcana" }
    },
    tools: {}
  };

  const actor = {
    system: {
      abilities: {
        int: {
          mod: 3,
          bonuses: { check: "" }
        }
      },
      skills: {
        arc: {
          ability: "int",
          bonuses: { check: "1" },
          prof: { hasProficiency: true, term: "2", multiplier: 1 }
        }
      },
      bonuses: { abilities: { check: "", skill: "" } }
    }
  };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "skill", skillId: "arc" } } },
    getAssociatedActor() { return actor; },
    rolls: [{
      formula: "1d20 + 3 + 2 + 1",
      total: 18,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(2),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "INT modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Arcana"), true);
});

test("dnd5e adapter resolves concentration save sources without item or activity context", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = {
    abilities: {
      con: { label: "Constitution" }
    },
    defaultAbilities: { concentration: "con" },
    skills: {},
    tools: {}
  };

  const actor = {
    system: {
      abilities: {
        con: {
          mod: 3,
          saveProf: { hasProficiency: true, term: "3", multiplier: 1 },
          bonuses: { save: "" }
        }
      },
      bonuses: { abilities: { save: "" } },
      attributes: {
        concentration: {
          ability: "con",
          bonuses: { save: "2" }
        },
        ac: { cover: 0 }
      }
    }
  };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "concentration", ability: "con" } } },
    getAssociatedActor() { return actor; },
    rolls: [{
      formula: "1d20 + 3 + 3 + 2",
      total: 19,
      terms: [
        new DiceTerm("1d20", 11, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(3),
        new OperatorTerm("+"),
        new NumericTerm(2)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "CON modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "concentration bonus"), true);
});

test("dnd5e adapter resolves death save sources without item or activity context", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = {
    abilities: {},
    skills: {},
    tools: {}
  };

  const actor = {
    flags: { dnd5e: { diamondSoul: true } },
    system: {
      attributes: {
        prof: 4,
        death: {
          bonuses: { save: "1" }
        }
      }
    }
  };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const breakdowns = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "death" } } },
    getAssociatedActor() { return actor; },
    rolls: [{
      formula: "1d20 + 4 + 1",
      total: 17,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(4),
        new OperatorTerm("+"),
        new NumericTerm(1)
      ]
    }]
  });

  assert.equal(breakdowns.length, 1);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "death save bonus"), true);
});