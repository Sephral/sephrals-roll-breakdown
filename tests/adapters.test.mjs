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

test("dnd5e adapter shows a roll without roll type only where its formula names the terms", async () => {
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

  // Typed in the chat or rolled in Dice Tray: no source can explain the 3, so no panel says "Unknown modifier"
  assert.equal(adapter.supportsMessage({ rolls: [{}] }), true);
  assert.equal(breakdowns.length, 0);

  const named = await adapter.buildBreakdowns({
    rolls: [{
      formula: "1d20 + 3[Strength]",
      total: 15,
      terms: [
        new DiceTerm("1d20", 12, { number: 1, faces: 20 }),
        new OperatorTerm("+"),
        new NumericTerm(3, { flavor: "Strength" })
      ]
    }]
  });
  assert.equal(named.length, 1);
  assert.equal(named[0].adapterId, "dnd5e");
  assert.equal(named[0].modifiers[0].sourceLabel, "Strength");

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
      // The own bonus of 1 and the 1d4 of the effect, as dnd5e prepares it
      bonuses: { mwak: { attack: "1 + 1d4" } }
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

test("dnd5e adapter reads the rolls Ready Set Roll keeps in its flags", async () => {
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
    system: { abilities: { str: { mod: 3 } }, attributes: { prof: 2 }, bonuses: {} },
    effects: [],
    items: []
  };
  const item = { name: "Longsword", type: "weapon", actor, system: { range: { value: 5 }, ammunition: { type: null }, source: { rules: "2024" } } };
  const activity = { type: "attack", attack: { ability: "str" }, damage: { parts: [{ number: 1, denomination: 8, bonus: "0" }] } };
  globalThis.fromUuid = async (uuid) => ({ "uuid:item": item, "uuid:activity": activity }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  // The card holds no rolls of its own: Ready Set Roll wrote them into flags.rsr5e.rolls.
  const message = {
    type: "usage",
    rolls: [],
    flags: {
      dnd5e: { activity: { uuid: "uuid:activity", type: "attack" }, item: { uuid: "uuid:item" } },
      rsr5e: {
        quickRoll: true,
        processed: true,
        rolls: [{
          formula: "1d20 + 3 + 2",
          total: 18,
          options: { rollType: "attack" },
          terms: [new DiceTerm("1d20", 13, { number: 1, faces: 20 }), new OperatorTerm("+"), new NumericTerm(3), new OperatorTerm("+"), new NumericTerm(2)]
        }, {
          formula: "1d8 + 3",
          total: 8,
          options: { rollType: "damage", type: "slashing" },
          terms: [new DiceTerm("1d8", 5, { number: 1, faces: 8 }), new OperatorTerm("+"), new NumericTerm(3)]
        }]
      }
    }
  };

  assert.equal(adapter.supportsMessage(message), true);
  assert.equal(adapter.supportsMessage({ ...message, flags: { dnd5e: message.flags.dnd5e } }), false);
  const breakdowns = await adapter.buildBreakdowns(message);
  assert.equal(breakdowns.length, 2);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "STR modifier"), true);
  assert.equal(breakdowns[0].modifiers.some((term) => term.sourceLabel === "Proficiency"), true);
  assert.equal(breakdowns[1].diceTerms.some((term) => term.sourceLabel === "Base damage"), true);
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
      bonuses: { rsak: { damage: "1 + 2" } }
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
      // As dnd5e prepares them: the own bonus plus what the effects add
      bonuses: { rwak: { attack: "10 + 2 - 1d4 + mystery" }, mwak: { damage: "throw" } }
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

test("dnd5e adapter reads the roll bonuses at their dnd5e 6 places without the deprecated paths", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = { abilities: { wis: { label: "Wisdom" }, str: { label: "Strength" } }, skills: {}, tools: {} };

  // dnd5e 6 answers the old paths through deprecation getters: reading them is a mistake here.
  const deprecated = [];
  const shim = (target, keys) => {
    for (const key of keys) Object.defineProperty(target, key, { get() { deprecated.push(key); return undefined; } });
    return target;
  };
  const wis = shim({ mod: 2, save: { prof: { hasProficiency: true, term: "2", multiplier: 1 }, roll: { bonus: "1" } } }, ["saveProf", "bonuses"]);
  // An unset bonus is missing at its new place (check.roll holds only min, max and mode).
  const str = shim({ mod: 3, check: { prof: { hasProficiency: false, term: "0", multiplier: 0 }, roll: { min: null, max: null, mode: 0 } } }, ["checkProf", "bonuses"]);
  const system = shim({
    abilities: { wis, str },
    attributes: { prof: 2, ac: { cover: 0 } },
    // The attack bonus holds its own 1 and the 1 of the effect, as dnd5e prepares it
    rolls: { ability: { save: { bonus: "1" } }, attack: { mwak: { bonus: "1 + 1" } }, damage: { mwak: { bonus: "" } } }
  }, ["bonuses"]);
  const actor = { system, items: [], effects: [{ name: "Blessed Blade", changes: [{ key: "system.rolls.attack.mwak.bonus", value: "1" }] }] };

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const [save] = await adapter.buildBreakdowns({
    flags: { dnd5e: { roll: { type: "save", ability: "wis" } } },
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 2 + 2 + 1 + 1", total: 14, terms: [new DiceTerm("1d20", 8, { number: 1, faces: 20 }), new OperatorTerm("+"), new NumericTerm(2),
      new OperatorTerm("+"), new NumericTerm(2), new OperatorTerm("+"), new NumericTerm(1), new OperatorTerm("+"), new NumericTerm(1)] }]
  });
  const labels = save.modifiers.map((term) => term.sourceLabel);
  assert.equal(labels.includes("WIS modifier"), true, labels.join(", "));
  assert.equal(labels.includes("Proficiency"), true, labels.join(", "));
  assert.equal(labels.some((label) => /save bonus/i.test(label ?? "")), true, labels.join(", "));

  const item = { name: "Longsword", type: "weapon", actor, system: { range: { value: 5 }, ammunition: { type: null }, source: { rules: "2024" } } };
  const activity = { type: "attack", attack: { ability: "str" }, damage: { parts: [{ number: 1, denomination: 8, bonus: "0" }] } };
  globalThis.fromUuid = async (uuid) => ({ "uuid:item": item, "uuid:activity": activity }[uuid] ?? null);
  const [attack] = await adapter.buildBreakdowns({
    flags: { dnd5e: { activity: { uuid: "uuid:activity", type: "attack" }, item: { uuid: "uuid:item" } } },
    rolls: [{ formula: "1d20 + 3 + 2 + 1 + 1", total: 20, options: { rollType: "attack" }, terms: [new DiceTerm("1d20", 13, { number: 1, faces: 20 }), new OperatorTerm("+"),
      new NumericTerm(3), new OperatorTerm("+"), new NumericTerm(2), new OperatorTerm("+"), new NumericTerm(1), new OperatorTerm("+"), new NumericTerm(1)] }]
  });
  const attackLabels = attack.modifiers.map((term) => term.sourceLabel);
  assert.equal(attackLabels.includes("Blessed Blade"), true, attackLabels.join(", "));
  assert.equal(attackLabels.includes("Actor attack bonus"), true, attackLabels.join(", "));

  // With the system version known, dnd5e 6 never falls back to the old paths, also where nothing is set.
  game.system.version = "6.0.6";
  const [check] = await adapter.buildBreakdowns({
    type: "check",
    system: { ability: "str" },
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 3", total: 12, options: { rollType: "check" }, terms: [new DiceTerm("1d20", 9, { number: 1, faces: 20 }), new OperatorTerm("+"), new NumericTerm(3)] }]
  });
  assert.equal(check.modifiers.map((term) => term.sourceLabel).includes("STR modifier"), true, check.modifiers.map((term) => term.sourceLabel).join(", "));
  assert.deepEqual(deprecated, []);
});

test("dnd5e adapter reads the typed roll messages of dnd5e 6 (check, save, attack without flags)", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = { abilities: { int: { label: "Intelligence" }, str: { label: "Strength" } }, skills: { arc: { label: "Arcana" } }, tools: {} };

  const actor = {
    system: {
      abilities: { int: { mod: 3, check: { roll: { bonus: "" } } }, str: { mod: 3 } },
      skills: { arc: { ability: "int", roll: { bonus: "1" }, prof: { hasProficiency: true, term: "2", multiplier: 1 } } },
      attributes: { prof: 2, death: { roll: { bonus: "1" } } },
      rolls: { ability: { check: { bonus: "" }, skill: { bonus: "" } }, attack: { mwak: { bonus: "" } } }
    },
    items: [],
    effects: []
  };
  const d20 = (result, ...mods) => [new DiceTerm("1d20", result, { number: 1, faces: 20 }), ...mods.flatMap((m) => [new OperatorTerm("+"), new NumericTerm(m)])];

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  // A skill check is a "check" message, the roll only says "check"
  const [skill] = await adapter.buildBreakdowns({
    type: "check", system: { ability: "int", skill: "arc", tool: null, type: "ability" }, flags: {},
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 3 + 2 + 1", total: 18, options: { rollType: "check" }, terms: d20(12, 3, 2, 1) }]
  });
  const skillLabels = skill.modifiers.map((term) => term.sourceLabel);
  assert.deepEqual(["INT modifier", "Proficiency", "Arcana"].filter((label) => !skillLabels.includes(label)), [], skillLabels.join(", "));

  // A death save is a "save" message with system.type death
  const [death] = await adapter.buildBreakdowns({
    type: "save", system: { type: "death" }, flags: {},
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 1", total: 11, options: { rollType: "save" }, terms: d20(10, 1) }]
  });
  assert.equal(death.modifiers.some((term) => /death save bonus/i.test(term.sourceLabel ?? "")), true, death.modifiers.map((term) => term.sourceLabel).join(", "));

  // An attack names its item and activity in system data
  const item = { name: "Longsword", type: "weapon", actor, system: { range: { value: 5 }, ammunition: { type: null }, source: { rules: "2024" } } };
  const activity = { type: "attack", attack: { ability: "str" }, damage: { parts: [{ number: 1, denomination: 8, bonus: "0" }] } };
  globalThis.fromUuid = async (uuid) => ({ "Actor.a.Item.sword": item, "Actor.a.Item.sword.Activity.hit": activity }[uuid] ?? null);
  const [attack] = await adapter.buildBreakdowns({
    type: "attack", flags: {},
    system: { ability: "str", item: { id: "sword", uuid: "Actor.a.Item.sword", type: "weapon" }, activity: { id: "hit", uuid: "Actor.a.Item.sword.Activity.hit", type: "attack" } },
    rolls: [{ formula: "1d20 + 3 + 2", total: 18, options: { rollType: "attack" }, terms: d20(13, 3, 2) }]
  });
  const attackLabels = attack.modifiers.map((term) => term.sourceLabel);
  assert.equal(attackLabels.includes("STR modifier"), true, attackLabels.join(", "));
  assert.equal(attackLabels.includes("Proficiency"), true, attackLabels.join(", "));
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
test("dnd5e adapter source labels follow the module translations", async () => {
  resetGlobals();
  installRollEnvironment();

  const translations = {
    ...createTranslations(),
    "SRB.Rule.AbilityModifierLabel": "{ability}-Modifikator",
    "SRB.Rule.BaseDamageLabel": "Grundschaden",
    "SRB.Rule.ItemAttackBonusLabel": "Angriffsbonus von {item}",
    "SRB.Rule.ActorAttackBonusLabel": "Angriffsbonus des Akteurs",
    "SRB.Rule.ActorDamageBonusLabel": "Schadensbonus des Akteurs"
  };
  // Own language code: the system translations are cached per language
  const { game } = createGameStub({ lang: "qa-labels", systemId: "dnd5e", translations });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return translations; } });

  const actor = {
    system: { abilities: { str: { mod: 3 } }, attributes: { prof: 2 }, bonuses: { mwak: { attack: "1", damage: "1" } } },
    effects: [],
    items: []
  };
  const item = { name: "Dagger", type: "weapon", actor, system: { range: { value: 5 }, ammunition: { type: null }, magicalBonus: 1 } };
  const activity = { type: "attack", attack: { ability: "str", bonus: "" }, damage: { parts: [{ number: 1, denomination: 4, bonus: "0" }] } };
  globalThis.fromUuid = async (uuid) => ({ "uuid:item": item, "uuid:activity": activity }[uuid] ?? null);

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const breakdowns = await new Dnd5eRollAdapter().buildBreakdowns({
    flags: { dnd5e: { activity: { uuid: "uuid:activity", type: "attack" }, item: { uuid: "uuid:item" } } },
    rolls: [{
      formula: "1d20 + 3 + 1 + 1", total: 18, options: { rollType: "attack" },
      terms: [new DiceTerm("1d20", 13, { number: 1, faces: 20 }), new OperatorTerm("+"), new NumericTerm(3), new OperatorTerm("+"), new NumericTerm(1), new OperatorTerm("+"), new NumericTerm(1)]
    }, {
      formula: "1d4 + 3 + 1", total: 6, options: { rollType: "damage" },
      terms: [new DiceTerm("1d4", 2, { number: 1, faces: 4 }), new OperatorTerm("+"), new NumericTerm(3), new OperatorTerm("+"), new NumericTerm(1)]
    }]
  });

  const labels = breakdowns.flatMap((breakdown) => [...breakdown.diceTerms, ...breakdown.modifiers].map((term) => term.sourceLabel));
  assert.equal(labels.includes("STR-Modifikator"), true);
  assert.equal(labels.includes("Grundschaden"), true);
  assert.equal(labels.includes("Schadensbonus des Akteurs"), true);
  assert.equal(labels.some((label) => /^(Angriffsbonus des Akteurs|Angriffsbonus von Dagger)$/.test(label ?? "")), true);
  assert.equal(labels.some((label) => /modifier|Base damage|Actor .* bonus/.test(label ?? "")), false);
});

// dnd5e 6 keeps rule effects in actor.appliedRules; its class collects them per category (attack, check and save also
// read d20) and filters them with the roll data. A small stand in with the same surface.
class StubAppliedRules {
  constructor(entries = []) {
    this.entries = entries;
  }

  static collect(rule, actor, item) {
    const [category, type] = rule.split(":");
    const categories = ["attack", "check", "save"].includes(category) ? [category, "d20"] : [category];
    const list = [actor, item].flatMap((doc) => doc?.appliedRules?.entries ?? [])
      .filter((entry) => categories.includes(entry.key) && entry.type === type);
    return StubAppliedRules.iterate(list);
  }

  static iterate(list) {
    return {
      filterWith: (data, { consumed } = {}) => StubAppliedRules.iterate(list.filter((entry) => {
        if (consumed?.has(entry)) return false;
        const ok = !entry.applies || entry.applies(data);
        if (ok) consumed?.add(entry);
        return ok;
      })),
      toArray: () => list
    };
  }
}

test("dnd5e adapter names the rule effects of dnd5e 6 and their reasons for advantage", async () => {
  resetGlobals();
  installRollEnvironment();
  globalThis.Roll.replaceFormulaData = (text, data) => text.replace(/@(\w+)/g, (_, key) => String(data?.[key] ?? 0));

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = { abilities: { str: { label: "Strength" }, con: { label: "Constitution" } }, skills: {}, tools: {}, itemProperties: {} };

  const blessing = { name: "Battle Blessing", uuid: "Actor.a.ActiveEffect.b" };
  const nimble = { name: "Nimble Charm", uuid: "Actor.a.ActiveEffect.n" };
  const actor = {
    system: { abilities: { str: { mod: 3 }, con: { mod: 2, save: { prof: { hasProficiency: false, multiplier: 0 } } } }, attributes: { prof: 2, ac: { cover: 0 } } },
    items: [],
    effects: [],
    getRollData: () => ({ prof: 2 })
  };
  actor.appliedRules = new StubAppliedRules([
    { key: "attack", type: "bonus", value: 2, effect: blessing },
    { key: "attack", type: "advantage", value: "+1", effect: blessing },
    // Only for Dexterity rolls: not part of a Strength attack
    { key: "d20", type: "bonus", value: 1, effect: nimble, applies: (data) => data?.roll?.ability === "dex" },
    { key: "save", type: "bonus", value: "@prof", effect: blessing },
    { key: "damage", type: "bonus", value: "1d4", effect: blessing }
  ]);
  const item = { name: "Longsword", type: "weapon", actor, system: { range: { value: 5 }, ammunition: { type: null }, source: { rules: "2024" } } };
  const activity = {
    type: "attack", attack: { ability: "str" }, damage: { parts: [{ number: 1, denomination: 8, bonus: "0" }] },
    getRollData: ({ roll } = {}) => ({ prof: 2, roll: { ability: roll?.ability ?? "str", type: "attack", attack: { mode: roll?.attackMode } } })
  };
  globalThis.fromUuid = async (uuid) => ({ "Actor.a.Item.sword": item, "Actor.a.Item.sword.Activity.hit": activity }[uuid] ?? null);
  const system = { ability: "str", mode: "oneHanded", item: { id: "sword", uuid: "Actor.a.Item.sword", type: "weapon" }, activity: { id: "hit", uuid: "Actor.a.Item.sword.Activity.hit", type: "attack" } };
  const d20 = (result, ...mods) => [new DiceTerm("2d20kh", result, { number: 2, faces: 20 }), ...mods.flatMap((m) => [new OperatorTerm("+"), new NumericTerm(m)])];

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  const [attack] = await adapter.buildBreakdowns({
    type: "attack", flags: {}, system,
    rolls: [{ formula: "2d20kh + 3 + 2 + 2", total: 22, options: { rollType: "attack", advantageMode: 1 }, terms: d20(15, 3, 2, 2) }]
  });
  const attackLabels = attack.modifiers.map((term) => term.sourceLabel);
  assert.deepEqual(attackLabels, ["STR modifier", "Proficiency", "Battle Blessing"]);
  assert.equal(attack.advantageContext.state, "advantage");
  assert.deepEqual(attack.advantageContext.attributions.map((entry) => [entry.type, entry.displayName]), [["ADV", "Battle Blessing"]]);

  // A save rule with a roll data reference: @prof is 2
  const [save] = await adapter.buildBreakdowns({
    type: "save", flags: {}, system: { ability: "con", type: "ability" },
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 2 + 2", total: 14, options: { rollType: "save" }, terms: [new DiceTerm("1d20", 10, { number: 1, faces: 20 }), new OperatorTerm("+"), new NumericTerm(2), new OperatorTerm("+"), new NumericTerm(2)] }]
  });
  assert.deepEqual(save.modifiers.map((term) => term.sourceLabel), ["CON modifier", "Battle Blessing"]);

  // A damage rule counts for the first damage part only
  const damage = await adapter.buildBreakdowns({
    type: "damage", flags: {}, system: { item: system.item, activity: system.activity },
    rolls: [
      { formula: "1d8 + 1d4 + 3", total: 9, options: { rollType: "damage", type: "slashing" }, terms: [new DiceTerm("1d8", 5, { number: 1, faces: 8 }), new OperatorTerm("+"), new DiceTerm("1d4", 1, { number: 1, faces: 4 }), new OperatorTerm("+"), new NumericTerm(3)] },
      { formula: "1d4", total: 2, options: { rollType: "damage", type: "fire" }, terms: [new DiceTerm("1d4", 2, { number: 1, faces: 4 })] }
    ]
  });
  const ruleDice = damage.map((breakdown) => breakdown.diceTerms.find((term) => term.expression === "1d4")?.sourceLabel ?? null);
  assert.deepEqual(ruleDice, ["Battle Blessing", null]);
});

test("dnd5e adapter names the terms of initiative rolls in dnd5e 6 and dnd5e 5", async () => {
  resetGlobals();
  installRollEnvironment();

  const translations = {
    ...createTranslations(),
    "SRB.Rule.Context.INITIATIVE": "initiative roll",
    "SRB.Rule.InitiativeAbility": "Initiative ability {ability}",
    "SRB.Rule.InitiativeBonusLabel": "Initiative bonus",
    "SRB.Rule.InitiativeBonus": "Initiative bonus detail",
    "SRB.Rule.ConditionReduction": "{condition} penalty",
    "DND5E.ConExhaustion": "Exhaustion"
  };
  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: true, async json() { return translations; } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = { abilities: { dex: { label: "Dexterity" } }, skills: {}, tools: {}, defaultAbilities: { initiative: "dex" }, conditionTypes: { exhaustion: { name: "DND5E.ConExhaustion" } } };

  // Jack of All Trades: half proficiency, an initiative bonus of 2, two levels of exhaustion (dnd5e 6 getter)
  const actor = {
    system: {
      abilities: { dex: { mod: 3, value: 16, check: { roll: { bonus: "" } } } },
      attributes: { prof: 2, init: { ability: "", mod: 3, prof: { hasProficiency: true, term: "1", multiplier: 0.5 }, roll: { bonus: "2" } } },
      rolls: { ability: { check: { bonus: "" } } }
    },
    conditionRollReductions: { exhaustion: -4 },
    items: [],
    effects: []
  };
  const d20 = (result, ...mods) => [new DiceTerm("1d20", result, { number: 1, faces: 20 }), ...mods.flatMap((m) => [new OperatorTerm(m < 0 ? "-" : "+"), new NumericTerm(Math.abs(m))])];

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();
  game.system.version = "6.0.6";
  const [modern] = await adapter.buildBreakdowns({
    type: "check", flags: { core: { initiativeRoll: true } }, system: { ability: "dex", type: "initiative", skill: null, tool: null },
    getAssociatedActor() { return actor; },
    rolls: [{ formula: "1d20 + 3 + 1 + 2 - 4", total: 12, options: { ability: "dex" }, terms: d20(10, 3, 1, 2, -4) }]
  });
  assert.deepEqual(modern.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Half Proficiency", "Initiative bonus", "Exhaustion"]);

  // dnd5e 5 posts initiative without roll flags and keeps the bonus at attributes.init.bonus
  game.system.version = "5.3.3";
  const legacyActor = {
    system: {
      abilities: { dex: { mod: 2, value: 14, bonuses: { check: "1" } } },
      attributes: { prof: 2, init: { ability: "", mod: 2, prof: { hasProficiency: false, term: "0", multiplier: 0 }, bonus: "3" } },
      bonuses: { abilities: { check: "" } }
    },
    items: [],
    effects: []
  };
  const [legacy] = await adapter.buildBreakdowns({
    flags: { core: { initiativeRoll: true } },
    getAssociatedActor() { return legacyActor; },
    rolls: [{ formula: "1d20 + 2 + 3 + 1", total: 15, options: {}, terms: d20(9, 2, 3, 1) }]
  });
  assert.deepEqual(legacy.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Initiative bonus", "DEX check bonus"]);

  // An effect adds @prof to the initiative bonus of 3 and to the DEX check bonus: dnd5e resolves @prof when it rolls
  game.system.version = "6.0.6";
  globalThis.Roll.replaceFormulaData = (text, data) => text.replace(/@(\w+)/g, (_, key) => String(data?.[key] ?? 0));
  const effectActor = {
    uuid: "Actor.tobin",
    system: {
      abilities: { dex: { mod: 2, value: 14, check: { roll: { bonus: "@prof" } } } },
      attributes: { prof: 3, init: { ability: "", mod: 2, prof: { hasProficiency: false, term: "0", multiplier: 0 }, roll: { bonus: "3 + @prof" } } },
      rolls: { ability: { check: { bonus: "" } } }
    },
    getRollData: () => ({ prof: 3 }),
    items: [],
    effects: []
  };
  const effectMessage = {
    type: "check", flags: { core: { initiativeRoll: true } }, system: { ability: "dex", type: "initiative", skill: null, tool: null },
    getAssociatedActor() { return effectActor; },
    rolls: [{ formula: "1d20 + 2 + 3 + 3 + 3", total: 21, options: { ability: "dex" }, terms: d20(10, 2, 3, 3, 3) }]
  };
  const [withEffect] = await adapter.buildBreakdowns(effectMessage);
  assert.deepEqual(withEffect.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Initiative bonus", "Initiative bonus", "DEX check bonus"]);

  // The debug file lists the sources the adapter read for each roll
  const debug = await adapter.debugInfo(effectMessage);
  assert.equal(debug.rolls[0].actor, "Actor.tobin");
  assert.deepEqual(debug.rolls[0].sources.map((source) => `${source.label} ${source.value}`), ["DEX modifier 2", "Initiative bonus 3", "Initiative bonus 3", "DEX check bonus 3"]);
});

test("dnd5e adapter names save terms after the roller, also on cards of the caster", async () => {
  resetGlobals();
  installRollEnvironment();

  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", translations: createTranslations() });
  globalThis.game = game;
  game.system.version = "6.0.6";
  globalThis.fetch = async () => ({ ok: true, async json() { return createTranslations(); } });
  globalThis.CONFIG ??= {};
  globalThis.CONFIG.DND5E = { abilities: { dex: { label: "Dexterity" }, wis: { label: "Wisdom" } }, skills: {}, tools: {}, itemProperties: {} };

  const caster = { id: "caster", system: { abilities: { dex: { mod: 3, save: { prof: { hasProficiency: false, multiplier: 0 } } }, wis: { mod: 4 } }, attributes: { prof: 3, ac: { cover: 0 } } }, items: [], effects: [] };
  const target = {
    id: "target",
    system: { abilities: { dex: { mod: 0, save: { prof: { hasProficiency: true, term: "4", multiplier: 1 }, roll: { bonus: "5" } } } }, attributes: { prof: 4, ac: { cover: 0 } } },
    items: [],
    effects: []
  };
  const item = { name: "Sacred Flame", type: "spell", actor: caster, system: { range: { value: 60 }, source: { rules: "2024" } } };
  const activity = { type: "save", save: { ability: new Set(["dex"]) }, damage: { parts: [{ number: 1, denomination: 8, bonus: "" }] } };
  const token = { documentName: "Token", id: "tok", actor: target };
  globalThis.fromUuid = async (uuid) => ({
    "Actor.caster.Item.flame": item,
    "Actor.caster.Item.flame.Activity.save": activity,
    "Scene.s.Token.tok": token
  }[uuid] ?? null);
  const references = { item: { id: "flame", uuid: "Actor.caster.Item.flame", type: "spell" }, activity: { id: "save", uuid: "Actor.caster.Item.flame.Activity.save", type: "save" } };
  const saveTerms = () => [new DiceTerm("2d20kh", 12, { number: 2, faces: 20 }), new OperatorTerm("+"), new NumericTerm(0), new OperatorTerm("+"), new NumericTerm(4),
    new OperatorTerm("+"), new NumericTerm(5), new OperatorTerm("+"), new NumericTerm(0)];

  const { Dnd5eRollAdapter } = await importStable("scripts/adapters/dnd5e-adapter.js");
  const adapter = new Dnd5eRollAdapter();

  // dnd5e 6 save button: the save message names the caster's item, the speaker rolled
  const saveMessage = {
    id: "save1", type: "save", flags: {}, speaker: { token: "tok", actor: "target" },
    system: { ability: "dex", type: "ability", ...references },
    getAssociatedActor() { return target; },
    rolls: [{ formula: "2d20kh + 0 + 4 + 5 + 0", total: 21, options: { rollType: "save", advantageMode: 1, originatingMessage: "card1" }, terms: saveTerms() }]
  };
  const [save] = await adapter.buildBreakdowns(saveMessage);
  assert.deepEqual(save.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Proficiency", "DEX save bonus", "Cover"]);

  // midi-qol puts the target's save on its card next to the damage roll
  game.messages = { contents: [saveMessage] };
  const [damage, cardSave] = await adapter.buildBreakdowns({
    id: "card1", type: "usage", flags: { "midi-qol": { messageType: "attack" } }, speaker: { actor: "caster" },
    system: references,
    getAssociatedActor() { return caster; },
    rolls: [
      { formula: "1d8", total: 2, options: { rollType: "damage", type: "radiant" }, terms: [new DiceTerm("1d8", 2, { number: 1, faces: 8 })] },
      { formula: "2d20kh + 0 + 4 + 5 + 0", total: 21, options: { rollType: "save", advantageMode: 1, originatingMessage: "card1", "midi-qol": { rollType: "save", targetUuid: "Scene.s.Token.tok" } }, terms: saveTerms() }
    ]
  });
  assert.equal(damage.diceTerms[0].sourceLabel, "Base damage");
  assert.deepEqual(cardSave.modifiers.map((term) => term.sourceLabel), ["DEX modifier", "Proficiency", "DEX save bonus", "Cover"]);
});
