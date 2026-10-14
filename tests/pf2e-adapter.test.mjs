import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { Die, NumericTerm, installDiceEnvironment, installLangFetch, installSystemGame, joinTerms } from "./helpers/system-fixtures.mjs";

// Shapes follow the PF2e system source (github.com/foundryvtt/pf2e, master as of 2026-10):
// src/module/system/check/roll.ts (CheckRoll options), src/module/system/check/check.ts (flags.pf2e.context,
// flags.pf2e.modifiers), src/module/actor/modifiers.ts (RawModifier, RawDamageDice) and
// src/module/system/damage/roll.ts, damage.ts (DamageRoll, DamageInstance, flags.pf2e.dice).
class CheckRoll {
  constructor({ dice, totalModifier, options = {} }) {
    const parts = [...dice];
    if (totalModifier !== 0) parts.push(new NumericTerm(totalModifier));
    this.terms = joinTerms(parts);
    this.dice = dice;
    this.formula = `${dice.map((die) => die.formula).join(" + ")}${totalModifier ? ` ${totalModifier < 0 ? "-" : "+"} ${Math.abs(totalModifier)}` : ""}`;
    this.total = dice.reduce((sum, die) => sum + die.total, 0) + totalModifier;
    this.options = { type: "attack-roll", totalModifier, showBreakdown: true, rollerId: "user-1", damaging: true, ...options };
  }
}

class DamageInstance {
  constructor({ formula, type, persistent = false, dice, total }) {
    this.formula = formula;
    this.type = type;
    this.persistent = persistent;
    this.dice = dice;
    this.total = total;
    this.terms = dice;
  }
}

class InstancePool {
  constructor(rolls) {
    this.rolls = rolls;
    this.total = rolls.reduce((sum, roll) => sum + roll.total, 0);
    this.dice = rolls.flatMap((roll) => roll.dice);
  }
}

class DamageRoll {
  constructor(instances, options = {}) {
    this.terms = [new InstancePool(instances)];
    this.instances = instances;
    this.formula = instances.map((instance) => instance.formula).join(" + ");
    this.total = instances.reduce((sum, instance) => sum + instance.total, 0);
    this.options = { showBreakdown: true, ...options };
  }
}

function modifier(slug, label, value, type, extra = {}) {
  return {
    slug,
    label,
    modifier: value,
    type,
    ability: type === "ability" ? slug : null,
    adjustments: [],
    force: false,
    enabled: true,
    ignored: false,
    source: null,
    custom: false,
    damageType: null,
    damageCategory: null,
    predicate: [],
    critical: null,
    tags: [],
    hideIfDisabled: false,
    kind: value < 0 ? "penalty" : "bonus",
    domains: [],
    ...extra
  };
}

function strikeFlags(overrides = {}) {
  return {
    pf2e: {
      context: {
        type: "attack-roll",
        identifier: "abc.longsword.melee",
        action: "strike",
        actor: "actor-1",
        token: "token-1",
        domains: ["attack", "attack-roll", "strike-attack-roll"],
        options: [],
        notes: [],
        rollMode: "publicroll",
        rollTwice: false,
        title: "Strike: Longsword",
        traits: ["attack"],
        substitutions: [],
        dc: { slug: "ac", value: 18, label: "PF2E.Check.DC.Unspecific" },
        skipDialog: false,
        isReroll: false,
        outcome: "success",
        unadjustedOutcome: "success",
        ...overrides.context
      },
      modifierName: "longsword-strike",
      modifiers: overrides.modifiers ?? [
        modifier("str", "PF2E.AbilityStr", 4, "ability"),
        modifier("proficiency", "PF2E.ProficiencyLevel1", 5, "proficiency"),
        modifier("multiple-attack-penalty", "PF2E.MultipleAttackPenalty", -5, "untyped"),
        modifier("bless", "Spell Effect: Bless", 1, "status"),
        modifier("heroism", "Spell Effect: Heroism", 1, "status", { enabled: false }),
        modifier("hidden", "Hidden rule", 2, "circumstance", { enabled: false, hideIfDisabled: true })
      ],
      origin: { type: "weapon", uuid: "Actor.actor-1.Item.longsword" }
    }
  };
}

const PF2E_TRANSLATIONS = {
  "PF2E.AbilityStr": "Strength",
  "PF2E.ProficiencyLevel1": "Trained",
  "PF2E.MultipleAttackPenalty": "Multiple Attack Penalty",
  "PF2E.DamageTypeSlashing": "Slashing",
  "PF2E.DamageTypeFire": "Fire"
};

function installPf2e({ isGM = true, metagame = { breakdowns: false, dcs: false, results: true } } = {}) {
  resetGlobals();
  installDiceEnvironment();
  installLangFetch();
  const game = installSystemGame("pf2e", { isGM, translations: PF2E_TRANSLATIONS });
  game.pf2e = { settings: { metagame } };
  globalThis.CONFIG = { PF2E: { damageTypes: { slashing: "PF2E.DamageTypeSlashing", fire: "PF2E.DamageTypeFire" } } };
  return game;
}

function cleanup() {
  delete globalThis.CONFIG;
}

async function loadAdapter() {
  const module = await importStable("scripts/adapters/pf2e-adapter.js");
  return new module.Pf2eRollAdapter();
}

test("pf2e strike splits the summed modifier into the listed modifiers and shows the degree of success", async () => {
  installPf2e({ isGM: true });
  try {
    const adapter = await loadAdapter();
    const roll = new CheckRoll({ dice: [new Die({ faces: 20, results: [14] })], totalModifier: 5, options: { degreeOfSuccess: 2 } });
    const message = { id: "p1", rolls: [roll], flags: strikeFlags() };

    assert.equal(adapter.supportsMessage(message), true);
    const [breakdown] = await adapter.buildBreakdowns(message);
    assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value, entry.sourceDetail]), [
      ["Strength", 4, "Attribute"],
      ["Trained", 5, "Proficiency"],
      ["Multiple Attack Penalty", -5, "Untyped"],
      ["Spell Effect: Bless", 1, "Status"]
    ]);
    assert.equal(breakdown.totalStaticModifier, 5);

    const notCounted = breakdown.sections.find((section) => section.label === "Not counted");
    assert.deepEqual(notCounted.items.map((item) => [item.text, item.tag, item.value, item.muted]), [["Spell Effect: Heroism", "Status", "+1", true]]);

    // 14 + 5 = 19 against AC 18.
    assert.deepEqual(breakdown.pills.map((pill) => pill.text), ["DC 18", "Success", "Margin +1"]);
  } finally {
    cleanup();
  }
});

test("pf2e respects hidden breakdowns, hidden DCs and hidden results for players", async () => {
  installPf2e({ isGM: false, metagame: { breakdowns: false, dcs: false, results: false } });
  try {
    const adapter = await loadAdapter();
    const npcRoll = new CheckRoll({ dice: [new Die({ faces: 20, results: [14] })], totalModifier: 5, options: { showBreakdown: false } });
    assert.deepEqual(await adapter.buildBreakdowns({ id: "p2", rolls: [npcRoll], flags: strikeFlags() }), []);

    const pcRoll = new CheckRoll({ dice: [new Die({ faces: 20, results: [14] })], totalModifier: 5 });
    const [hidden] = await adapter.buildBreakdowns({ id: "p3", rolls: [pcRoll], flags: strikeFlags() });
    assert.deepEqual(hidden.pills, []);

    // The DC was marked visible for this check, results stay hidden.
    const [visibleDc] = await adapter.buildBreakdowns({
      id: "p4",
      rolls: [pcRoll],
      flags: strikeFlags({ context: { dc: { slug: "ac", value: 18, visible: true } } })
    });
    assert.deepEqual(visibleDc.pills.map((pill) => pill.text), ["DC 18", "Margin +1"]);
  } finally {
    cleanup();
  }

  installPf2e({ isGM: false, metagame: { breakdowns: true, dcs: false, results: true } });
  try {
    const adapter = await loadAdapter();
    const pcRoll = new CheckRoll({ dice: [new Die({ faces: 20, results: [3] })], totalModifier: 5 });
    const [breakdown] = await adapter.buildBreakdowns({
      id: "p5",
      rolls: [pcRoll],
      flags: strikeFlags({ context: { outcome: "failure", unadjustedOutcome: "criticalFailure" } })
    });
    assert.deepEqual(breakdown.pills.map((pill) => [pill.text, pill.tooltip]), [["Failure", "Adjusted from Critical failure"]]);
  } finally {
    cleanup();
  }
});

test("pf2e keeps the summed number unlabeled when the listed modifiers do not add up", async () => {
  installPf2e({ isGM: true });
  try {
    const adapter = await loadAdapter();
    const roll = new CheckRoll({ dice: [new Die({ faces: 20, results: [10] })], totalModifier: 7 });
    const [breakdown] = await adapter.buildBreakdowns({ id: "p6", rolls: [roll], flags: strikeFlags() });
    assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel ?? null, entry.value]), [[null, 7]]);
  } finally {
    cleanup();
  }
});

test("pf2e shows fortune, misfortune and roll substitutions", async () => {
  installPf2e({ isGM: true });
  try {
    const adapter = await loadAdapter();
    const fortune = new CheckRoll({
      dice: [new Die({ number: 2, faces: 20, results: [{ result: 4, active: false, discarded: true }, { result: 17, active: true }] })],
      totalModifier: 7,
      options: { type: "skill-check" }
    });
    const flags = strikeFlags({
      context: { type: "skill-check", rollTwice: "keep-higher", dc: null, outcome: null, unadjustedOutcome: null },
      modifiers: [modifier("dex", "Dexterity", 3, "ability"), modifier("proficiency", "Expert", 4, "proficiency")]
    });
    const [breakdown] = await adapter.buildBreakdowns({ id: "p7", rolls: [fortune], flags });
    const top = breakdown.sections.find((section) => section.placement === "top");
    assert.deepEqual(top.items.map((item) => [item.text, item.tooltip]), [["Fortune", "Rolled twice, the higher result counts"]]);
    assert.equal(breakdown.diceTerms[0].expression, "2d20");
    assert.deepEqual(breakdown.pills, []);

    const substituted = new CheckRoll({ dice: [], totalModifier: 7, options: { type: "skill-check" } });
    substituted.terms = joinTerms([new NumericTerm(10), new NumericTerm(7)]);
    const [assurance] = await adapter.buildBreakdowns({
      id: "p8",
      rolls: [substituted],
      flags: strikeFlags({
        context: {
          type: "skill-check",
          rollTwice: "keep-lower",
          dc: null,
          outcome: null,
          substitutions: [{ slug: "assurance", label: "Assurance", value: 10, required: false, selected: true, effectType: "fortune" }]
        },
        modifiers: [modifier("proficiency", "Expert", 7, "proficiency")]
      })
    });
    const items = assurance.sections.find((section) => section.placement === "top").items;
    assert.deepEqual(items.map((item) => [item.text, item.tag ?? null, item.value ?? null]), [
      ["Misfortune", null, null],
      ["Assurance", "Fortune", "10"],
      ["Fortune and misfortune cancel out", null, null]
    ]);
    assert.deepEqual(assurance.modifiers.map((entry) => [entry.sourceLabel ?? null, entry.value]), [[null, 10], ["Expert", 7]]);
  } finally {
    cleanup();
  }
});

test("pf2e damage rolls list dice per damage type, the instances and the listed damage modifiers", async () => {
  installPf2e({ isGM: true });
  try {
    const adapter = await loadAdapter();
    const slashing = new DamageInstance({ formula: "(1d8 + 4)", type: "slashing", dice: [new Die({ faces: 8, results: [5] })], total: 18 });
    const fire = new DamageInstance({ formula: "1d6", type: "fire", persistent: true, dice: [new Die({ faces: 6, results: [3] })], total: 3 });
    const roll = new DamageRoll([slashing, fire], { degreeOfSuccess: 3, critRule: "double-damage", damage: {} });
    const message = {
      id: "p9",
      rolls: [roll],
      flags: {
        pf2e: {
          context: { type: "damage-roll", outcome: "criticalSuccess", domains: ["damage"], options: [], notes: [] },
          modifiers: [modifier("str", "PF2E.AbilityStr", 4, "ability")],
          dice: [{ selector: "damage", slug: "flaming", label: "Flaming", diceNumber: 1, dieSize: "d6", critical: null, category: "persistent", damageType: "fire", tags: [], override: null, ignored: false, enabled: true, hideIfDisabled: false, predicate: [], alterations: [] }],
          origin: { type: "weapon", uuid: "Actor.actor-1.Item.longsword" },
          preformatted: "both"
        }
      }
    };

    const [breakdown] = await adapter.buildBreakdowns(message);
    assert.deepEqual(breakdown.diceTerms.map((term) => [term.expression, term.sourceLabel, term.totalText]), [["1d8", "Slashing", "5"], ["1d6", "Fire", "3"]]);
    assert.equal(breakdown.diceTerms[1].sourceDetail, "Persistent");
    assert.deepEqual(breakdown.computedTerms, []);
    assert.deepEqual(breakdown.modifiers.map((entry) => [entry.sourceLabel, entry.value]), [["Strength", 4]]);

    const parts = breakdown.sections.find((section) => section.label === "Damage parts");
    assert.deepEqual(parts.items.map((item) => [item.text, item.tag, item.value]), [["(1d8 + 4)", "Slashing", "18"], ["1d6", "Fire, Persistent", "3"]]);
    const extra = breakdown.sections.find((section) => section.label === "Extra dice");
    assert.deepEqual(extra.items.map((item) => [item.text, item.tag, item.value]), [["Flaming", "Fire", "1d6"]]);
    assert.deepEqual(breakdown.pills.map((pill) => [pill.text, pill.tooltip]), [["Critical hit", "Damage is doubled"]]);

    globalThis.game.system.id = "dnd5e";
    assert.equal(adapter.supportsMessage(message), false);
  } finally {
    cleanup();
  }
});
