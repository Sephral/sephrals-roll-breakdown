import assert from "node:assert/strict";
import test from "node:test";

import { importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";
import { Die, NumericTerm, installDiceEnvironment, installLangFetch, installSystemGame, joinTerms } from "./helpers/system-fixtures.mjs";

// Roll classes as Crucible 0.11.1 restores them from chat messages (dice/standard-check.mjs, attack-roll.mjs,
// initiative-check.mjs). Only the constructor name and the evaluated fields are needed.
class StandardCheck {
  constructor(data, diceResults, { total } = {}) {
    this.data = data;
    const faces = poolFaces(data.totalBoons ?? 0, data.totalBanes ?? 0);
    const dice = faces.map((face, index) => new Die({ faces: face, results: [diceResults[index]] }));
    const parts = [...dice, new NumericTerm(data.ability), new NumericTerm(data.skill)];
    if (data.enchantment !== 0) parts.push(new NumericTerm(data.enchantment));
    this.terms = joinTerms(parts);
    this.dice = dice;
    this.formula = [...faces.map((face) => `1d${face}`), data.ability, data.skill, ...(data.enchantment ? [data.enchantment] : [])].join(" + ");
    this.total = total ?? dice.reduce((sum, die) => sum + die.total, 0) + data.ability + data.skill + data.enchantment;
    this._evaluated = true;
  }
}

class AttackRoll extends StandardCheck {}
class InitiativeCheck extends StandardCheck {}

// Independent copy of StandardCheck.parse for the fixtures.
function poolFaces(boons, banes) {
  const pool = [8, 8, 8];
  let d = 0;
  for (let i = 0; i < boons; i++) {
    pool[d] += 2;
    if (pool[d] === 12) d++;
  }
  d = 2;
  for (let i = 0; i < banes; i++) {
    pool[d] -= 2;
    if (pool[d] === 4) d--;
  }
  return pool;
}

// Data as built by CrucibleActor#getSkillCheck and prepared by StandardCheck#_prepareData.
function skillCheckData(overrides = {}) {
  return {
    actorId: "actor-hero",
    ability: 4,
    banes: {},
    boons: { special: { id: "special", label: "Special", number: 1 } },
    dc: 15,
    enchantment: 0,
    skill: 6,
    type: "athletics",
    criticalSuccessThreshold: undefined,
    criticalFailureThreshold: undefined,
    messageMode: undefined,
    passive: false,
    totalBoons: 1,
    totalBanes: 0,
    ...overrides
  };
}

// Data as built by CrucibleActor#weaponAttack and resolved by AttackRoll#resolveDamage.
function weaponAttackData(overrides = {}) {
  return {
    actorId: "actor-hero",
    itemId: "item-sword",
    target: "Actor.goblin",
    ability: 3,
    skill: 4,
    enchantment: 1,
    boons: { flanked: { id: "flanked", label: "Flanked", number: 1 } },
    banes: { prone: { id: "prone", label: "Prone", number: 1 } },
    defenseType: "physical",
    dc: 14,
    criticalSuccessThreshold: 6,
    criticalFailureThreshold: 6,
    resource: "health",
    damageType: "slashing",
    damageBonus: 0,
    multiplier: 1,
    restoration: false,
    flanked: 1,
    result: 7,
    damage: { overflow: 5, multiplier: 1, base: 6, bonus: 0, resistance: 2, resource: "health", type: "slashing", restoration: false, total: 9 },
    index: 0,
    newTarget: false,
    type: "general",
    totalBoons: 1,
    totalBanes: 1,
    ...overrides
  };
}

const CRUCIBLE_TRANSLATIONS = {
  "TRAINING.LABELS.athletics": "Athletics",
  "ABILITIES.Strength": "Strength",
  "ABILITIES.Dexterity": "Dexterity",
  "ABILITIES.Intellect": "Intellect",
  "DEFENSES.Physical": "Physical",
  "DEFENSES.Fortitude": "Fortitude",
  "DAMAGE.Slashing": "Slashing",
  "RESOURCES.Health": "Health"
};

function installCrucible({ isGM = true, combat = null } = {}) {
  resetGlobals();
  installDiceEnvironment();
  installLangFetch();
  const game = installSystemGame("crucible", { isGM, translations: CRUCIBLE_TRANSLATIONS });
  const sword = { id: "item-sword", name: "Arming Sword", system: { scaling: "strength.dexterity" } };
  const hero = { id: "actor-hero", name: "Hero", isOwner: isGM, items: { get: (id) => (id === sword.id ? sword : null) } };
  const npc = { id: "actor-npc", name: "Bandit", isOwner: isGM, items: { get: () => null } };
  game.actors = { get: (id) => ({ [hero.id]: hero, [npc.id]: npc })[id] ?? null };
  game.combat = combat;
  game.combats = { contents: combat ? [combat] : [] };
  globalThis.SYSTEM = {
    SKILLS: { athletics: { label: "TRAINING.LABELS.athletics", abilities: ["strength", "dexterity"] } },
    ABILITIES: {
      strength: { label: "ABILITIES.Strength" },
      dexterity: { label: "ABILITIES.Dexterity" },
      intellect: { label: "ABILITIES.Intellect" }
    },
    DEFENSES: { physical: { label: "DEFENSES.Physical" }, fortitude: { label: "DEFENSES.Fortitude" } },
    DAMAGE_TYPES: { slashing: { label: "DAMAGE.Slashing" } },
    RESOURCES: { health: { label: "RESOURCES.Health" } }
  };
  globalThis.fromUuidSync = (uuid) => (uuid === "Actor.goblin" ? { name: "Goblin" } : null);
  return game;
}

function cleanupCrucible() {
  delete globalThis.SYSTEM;
  delete globalThis.crucible;
  delete globalThis.fromUuidSync;
}

async function loadAdapter() {
  const module = await importStable("scripts/adapters/crucible-adapter.js");
  return { ...module, adapter: new module.CrucibleRollAdapter() };
}

function pillTexts(breakdown) {
  return breakdown.pills.map((pill) => pill.text);
}

test("crucible dice pool follows the boon and bane rules of the system", async () => {
  const { computeDicePool } = await importStable("scripts/adapters/crucible-adapter.js");
  const faces = (boons, banes) => computeDicePool(boons, banes).map((die) => die.faces);

  assert.deepEqual(faces(0, 0), [8, 8, 8]);
  assert.deepEqual(faces(1, 0), [10, 8, 8]);
  assert.deepEqual(faces(3, 0), [12, 10, 8]);
  assert.deepEqual(faces(0, 3), [8, 6, 4]);
  assert.deepEqual(faces(6, 6), [12, 8, 4]);
  assert.deepEqual(faces(1, 1), [10, 8, 6]);
  for (const [boons, banes] of [[2, 5], [4, 1], [6, 0], [0, 6], [5, 5]]) {
    assert.deepEqual(faces(boons, banes), poolFaces(boons, banes));
  }

  const mixed = computeDicePool(6, 6);
  assert.deepEqual(mixed.map((die) => [die.boons, die.banes]), [[2, 0], [2, 2], [2, 4]]);
});

test("crucible skill check shows changed dice, labeled bonuses, boon sources and the outcome for the GM", async () => {
  installCrucible({ isGM: true });
  try {
    const { adapter } = await loadAdapter();
    const roll = new StandardCheck(skillCheckData(), [7, 5, 2]);
    const message = { id: "m1", rolls: [roll], flags: { crucible: { skill: "athletics" } } };

    assert.equal(adapter.supportsMessage(message), true);
    assert.equal(adapter.waitForCard, true);
    const [breakdown] = await adapter.buildBreakdowns(message);

    assert.equal(breakdown.adapterId, "crucible");
    assert.deepEqual(breakdown.diceTerms.map((term) => term.expression), ["1d10", "1d8", "1d8"]);
    assert.equal(breakdown.diceTerms[0].sourceLabel, "1 boon");
    assert.equal(breakdown.diceTerms[0].sourceDetail, "Raised from d8 to d10");
    assert.equal(breakdown.diceTerms[1].sourceLabel, null);

    assert.deepEqual(breakdown.modifiers.map((modifier) => [modifier.sourceLabel, modifier.value]), [["Ability bonus", 4], ["Skill bonus", 6]]);
    assert.equal(breakdown.modifiers[0].sourceDetail, "From Strength, Dexterity");
    assert.equal(breakdown.modifiers[1].sourceDetail, "Athletics");
    assert.equal(breakdown.totalStaticModifier, 10);
    assert.equal(breakdown.sourceConfidence, "resolved");

    const boonSection = breakdown.sections.find((section) => section.placement === "top");
    assert.equal(boonSection.label, "Boons and banes");
    assert.deepEqual(boonSection.items.map((item) => [item.text, item.tag, item.value]), [["Special", "Boon", "1"]]);

    // Total 24 against DC 15: success, critical only above 21.
    assert.deepEqual(pillTexts(breakdown), ["DC 15", "Critical success", "Margin +9"]);
    assert.equal(breakdown.pills[1].tooltip, "Critical success above 21, critical failure at 9 or below");
  } finally {
    cleanupCrucible();
  }
});

test("crucible keeps the DC and margin from players and shows no outcome without a DC", async () => {
  installCrucible({ isGM: false });
  try {
    const { adapter } = await loadAdapter();
    const withDc = new StandardCheck(skillCheckData({ dc: 20 }), [3, 4, 2]);
    const [breakdown] = await adapter.buildBreakdowns({ id: "m2", rolls: [withDc], flags: {} });
    assert.deepEqual(pillTexts(breakdown), ["Failure"]);
    assert.equal(breakdown.pills[0].tooltip, null);

    // Players roll without a DC (getSkillCheck only defaults the DC for GMs).
    const withoutDc = new StandardCheck(skillCheckData({ dc: null }), [3, 4, 2]);
    const [noDc] = await adapter.buildBreakdowns({ id: "m3", rolls: [withoutDc], flags: {} });
    assert.deepEqual(noDc.pills, []);
    assert.equal(noDc.hasVisibleContent, true);
  } finally {
    cleanupCrucible();
  }
});

test("crucible weapon attack shows target, defense, result and the damage parts", async () => {
  installCrucible({ isGM: true });
  try {
    const { adapter } = await loadAdapter();
    // 1 boon and 1 bane: d10, d8, d6. Total 6 + 5 + 3 + 3 + 4 + 1 = 22 against Physical 14 (critical above 20).
    const roll = new AttackRoll(weaponAttackData(), [6, 5, 3]);
    const message = {
      id: "m4",
      rolls: [roll],
      flags: { crucible: { action: { id: "strike" }, sections: [{ uuid: "Actor.goblin", name: "Goblin Scout", rollIndices: [0] }] } }
    };

    const [breakdown] = await adapter.buildBreakdowns(message);
    assert.equal(breakdown.title, "Goblin Scout");
    assert.deepEqual(breakdown.diceTerms.map((term) => term.sourceLabel), ["1 boon", null, "1 bane"]);
    assert.equal(breakdown.diceTerms[2].sourceDetail, "Lowered from d8 to d6");
    assert.deepEqual(breakdown.modifiers.map((modifier) => [modifier.sourceLabel, modifier.value]), [
      ["Ability bonus", 3],
      ["Skill bonus", 4],
      ["Enchantment", 1]
    ]);
    assert.equal(breakdown.modifiers[0].sourceDetail, "From Strength, Dexterity");
    assert.equal(breakdown.modifiers[2].sourceDetail, "From Arming Sword");
    assert.deepEqual(pillTexts(breakdown), ["Physical 14", "Critical hit", "Margin +8"]);

    const top = breakdown.sections.find((section) => section.placement === "top");
    assert.deepEqual(top.items.map((item) => [item.text, item.tag]), [["Flanked", "Boon"], ["Prone", "Bane"]]);

    const damage = breakdown.sections.find((section) => section.label === "Damage");
    assert.deepEqual(damage.items.map((item) => [item.text, item.value]), [
      ["Overflow", "5"],
      ["Base", "6"],
      ["Action bonus", "0"],
      ["Resistance", "2"],
      ["Total", "9"]
    ]);
    assert.equal(damage.items[4].tag, "Slashing");
  } finally {
    cleanupCrucible();
  }
});

test("crucible attack results without damage and the player view of an attack", async () => {
  installCrucible({ isGM: false });
  try {
    const { adapter } = await loadAdapter();
    // Parry: no damage section; resistance is clamped the way the system reports it.
    const parried = new AttackRoll(weaponAttackData({
      result: 2,
      dc: 30,
      damage: { overflow: -8, multiplier: 1, base: 6, bonus: 0, resistance: 0, resource: "health", type: "slashing", restoration: false, total: 0 }
    }), [6, 5, 3]);
    const [miss] = await adapter.buildBreakdowns({ id: "m5", rolls: [parried], flags: {} });
    assert.deepEqual(pillTexts(miss), ["Physical", "Parry"]);
    assert.equal(miss.sections.some((section) => section.label === "Damage"), false);
    assert.equal(miss.title, "Goblin");

    // Vulnerability (negative resistance) appears as the applied amount, capped at the damage before mitigation.
    const vulnerable = new AttackRoll(weaponAttackData({
      damage: { overflow: 1, multiplier: 2, base: 2, bonus: 0, resistance: -10, resource: "health", type: "slashing", restoration: false, total: 8 }
    }), [6, 5, 3]);
    const [hit] = await adapter.buildBreakdowns({ id: "m6", rolls: [vulnerable], flags: {} });
    const damage = hit.sections.find((section) => section.label === "Damage");
    assert.deepEqual(damage.items.map((item) => [item.text, item.tag, item.value]), [
      ["Overflow", "x2", "1"],
      ["Base", null, "2"],
      ["Action bonus", null, "0"],
      ["Vulnerability", null, "4"],
      ["Total", "Slashing", "8"]
    ]);
  } finally {
    cleanupCrucible();
  }
});

test("crucible labels nothing it cannot confirm from the roll data", async () => {
  installCrucible({ isGM: true });
  try {
    const { adapter } = await loadAdapter();
    // A module changed the total after the roll: the bonuses no longer add up, so the parsed numbers stay unlabeled.
    const changedTotal = new StandardCheck(skillCheckData(), [7, 5, 2], { total: 30 });
    const [breakdown] = await adapter.buildBreakdowns({ id: "m7", rolls: [changedTotal], flags: {} });
    assert.deepEqual(breakdown.modifiers.map((modifier) => modifier.sourceLabel ?? null), [null, null]);

    // The dice do not match the boons in the data: no die gets a reason.
    const changedDice = new StandardCheck(skillCheckData(), [7, 5, 2]);
    changedDice.data.totalBoons = 3;
    const [noReasons] = await adapter.buildBreakdowns({ id: "m8", rolls: [changedDice], flags: {} });
    assert.deepEqual(noReasons.diceTerms.map((term) => term.sourceLabel ?? null), [null, null, null]);

    // Plain rolls in a Crucible world use the generic breakdown.
    const plain = {
      formula: "1d6 + 2",
      total: 5,
      terms: joinTerms([new Die({ faces: 6, results: [3] }), new NumericTerm(2)])
    };
    const [generic] = await adapter.buildBreakdowns({ id: "m9", rolls: [plain], flags: {} });
    assert.equal(generic.pills, undefined);
    assert.equal(generic.modifiers[0].value, 2);

    globalThis.game.system.id = "dnd5e";
    assert.equal(adapter.supportsMessage({ rolls: [plain] }), false);
  } finally {
    cleanupCrucible();
  }
});

test("crucible initiative reports name each combatant and hide hidden combatants from players", async () => {
  const combat = {
    combatants: [
      { actorId: "actor-hero", name: "Hero", hidden: false },
      { actorId: "actor-npc", name: "Bandit Captain", hidden: true }
    ]
  };
  combat.combatants.find = Array.prototype.find.bind(combat.combatants);

  // InitiativeCheck data from CrucibleCombatant#getInitiativeRoll.
  const initiativeData = (actorId, extra = {}) => ({
    actorId,
    ability: 3,
    skill: 0,
    enchantment: 0,
    boons: { action: { id: "action", label: "Reserved Action", number: 2 } },
    banes: {},
    dc: 15,
    type: "initiative",
    incapacitated: false,
    unaware: false,
    totalBoons: 2,
    totalBanes: 0,
    ...extra
  });
  const message = (rolls) => ({ id: "init", rolls, flags: { crucible: { isInitiativeReport: true }, core: { initiativeRoll: true } } });

  installCrucible({ isGM: true, combat });
  try {
    const { adapter } = await loadAdapter();
    const rolls = [new InitiativeCheck(initiativeData("actor-hero"), [9, 4, 6]), new InitiativeCheck(initiativeData("actor-npc"), [2, 3, 1])];
    const gmView = await adapter.buildBreakdowns(message(rolls));
    assert.deepEqual(gmView.map((breakdown) => breakdown.title), ["Hero", "Bandit Captain"]);
    assert.equal(gmView[0].diceTerms[0].sourceLabel, "2 boons");
    assert.equal(gmView[0].modifiers[0].sourceDetail, "From Dexterity, Intellect");
  } finally {
    cleanupCrucible();
  }

  installCrucible({ isGM: false, combat });
  try {
    const { adapter } = await loadAdapter();
    const rolls = [new InitiativeCheck(initiativeData("actor-hero"), [9, 4, 6]), new InitiativeCheck(initiativeData("actor-npc"), [2, 3, 1])];
    const playerView = await adapter.buildBreakdowns(message(rolls));
    assert.deepEqual(playerView.map((breakdown) => breakdown.title), ["Hero"]);
  } finally {
    cleanupCrucible();
  }
});

test("players see the panel on a check the GM posted for their hero without a speaker", async () => {
  const game = installCrucible({ isGM: false });
  installHTMLElement();
  const settingsValues = { enabled: true, debug: false, defaultExpanded: false, showUnknown: true };
  const originalGet = game.settings.get.bind(game.settings);
  game.settings.get = (moduleId, key, options) => (key in settingsValues && !options?.document ? settingsValues[key] : originalGet(moduleId, key, options));
  try {
    const hero = game.actors.get("actor-hero");
    hero.hasPlayerOwner = true;
    hero.isOwner = true;
    const npc = game.actors.get("actor-npc");
    npc.hasPlayerOwner = false;

    const { adapter } = await loadAdapter();
    const { RollBreakdownService, __test__ } = await importStable("scripts/roll-breakdown-service.js");

    // CrucibleActor#rollSkill(..., {chatMessage: true}) as the GM: Roll#toMessage sets no speaker, and the GM has
    // no assigned character, so core's speakerActor is null.
    const gmPosted = (actorId) => ({
      id: `gm-${actorId}`,
      author: { isGM: true },
      isAuthor: false,
      speaker: { scene: null, actor: null, token: null, alias: "" },
      speakerActor: null,
      rolls: [new StandardCheck(skillCheckData({ actorId }), [1, 8, 1])],
      flags: { crucible: { skill: "athletics" } }
    });

    assert.equal(__test__.canSeeBreakdown(gmPosted("actor-hero")), false);
    assert.equal(__test__.canSeeBreakdown(gmPosted("actor-hero"), adapter), true);
    assert.equal(__test__.canSeeBreakdown(gmPosted("actor-npc"), adapter), false);

    // A real speaker still decides, and reports with several actors stay GM rolls.
    assert.equal(adapter.getMessageActor({ ...gmPosted("actor-hero"), speaker: { actor: "actor-npc" } }), null);
    const report = gmPosted("actor-hero");
    report.rolls.push(new StandardCheck(skillCheckData({ actorId: "actor-npc" }), [2, 2, 2]));
    assert.equal(adapter.getMessageActor(report), null);

    const rendered = [];
    const service = new RollBreakdownService({
      adapter,
      renderer: { async appendBreakdown(message, _html, breakdowns) { rendered.push(breakdowns); return true; } }
    });
    class Root extends globalThis.HTMLElement {
      querySelector() {
        return null;
      }
    }
    await service.enhanceChatMessage(gmPosted("actor-hero"), new Root());
    assert.equal(rendered.length, 1);
    // 1 + 8 + 1 + 4 + 6 = 20 against DC 15, outcome only for the player.
    assert.deepEqual(pillTexts(rendered[0][0]), ["Success"]);
  } finally {
    cleanupCrucible();
  }
});

// InitiativeCheck data from CrucibleCombatant#getInitiativeRoll
function initiativeCheckData(actorId, extra = {}) {
  return {
    actorId, ability: 3, skill: 0, enchantment: 0, boons: {}, banes: {}, dc: 15, type: "initiative",
    incapacitated: false, unaware: false, totalBoons: 0, totalBanes: 0, ...extra
  };
}

// An unaware or incapacitated combatant: InitiativeCheck.parse returns the fixed formula "1" or "0" without dice
function fixedInitiativeCheck(actorId, value) {
  const roll = Object.create(InitiativeCheck.prototype);
  roll.data = initiativeCheckData(actorId, value === 0 ? { incapacitated: true } : { unaware: true });
  roll.terms = [new NumericTerm(value)];
  roll.dice = [];
  roll.formula = String(value);
  roll.total = value;
  roll._evaluated = true;
  return roll;
}

test("crucible initiative rolls show no DC, outcome or margin", async () => {
  for (const isGM of [true, false]) {
    const game = installCrucible({ isGM });
    game.actors.get("actor-hero").isOwner = true;
    try {
      const { adapter } = await loadAdapter();
      const [breakdown] = await adapter.buildBreakdowns({ id: "init", rolls: [new InitiativeCheck(initiativeCheckData("actor-hero"), [8, 8, 8])], flags: { crucible: { isInitiativeReport: true } } });
      assert.deepEqual(pillTexts(breakdown), []);
      assert.equal(breakdown.rollTotal, 27);
    } finally {
      cleanupCrucible();
    }
  }
});

test("crucible unaware and incapacitated initiative shows the fixed value without an unknown row", async () => {
  installCrucible({ isGM: true });
  try {
    const { adapter } = await loadAdapter();
    const message = { id: "init", rolls: [fixedInitiativeCheck("actor-hero", 1), fixedInitiativeCheck("actor-npc", 0)], flags: { crucible: { isInitiativeReport: true } } };
    const [unaware, incapacitated] = await adapter.buildBreakdowns(message);
    for (const [breakdown, value, state, hint] of [[unaware, 1, "Unaware", "Initiative is 1"], [incapacitated, 0, "Incapacitated", "Initiative is 0"]]) {
      assert.deepEqual(breakdown.modifiers.map((modifier) => [modifier.sourceLabel, modifier.value, modifier.sourceDetail]), [["Fixed initiative", value, hint]]);
      assert.deepEqual(breakdown.unresolvedTerms, []);
      assert.equal(breakdown.diceTerms.length, 0);
      assert.equal(breakdown.sections[0].items[0].text, state);
      assert.deepEqual(pillTexts(breakdown), []);
    }
  } finally {
    cleanupCrucible();
  }
});

// A player client with "hide NPC rolls" on or off and the service around the Crucible adapter
async function playerReportView(message, { hideNpcRolls = true, visibility = "all", combat = null } = {}) {
  const game = installCrucible({ isGM: false, combat });
  installHTMLElement();
  const hero = game.actors.get("actor-hero");
  Object.assign(hero, { hasPlayerOwner: true, isOwner: true });
  Object.assign(game.actors.get("actor-npc"), { hasPlayerOwner: false, isOwner: false });
  const ally = { id: "actor-ally", name: "Ally", hasPlayerOwner: true, isOwner: false, items: { get: () => null } };
  const actorsGet = game.actors.get;
  game.actors.get = (id) => (id === ally.id ? ally : actorsGet(id));
  const values = { enabled: true, debug: false, defaultExpanded: false, showUnknown: true, hideNpcRolls, visibility };
  for (const key of ["hideNpcRolls", "visibility"]) game.settings.settings.set(`sephrals-roll-breakdown.${key}`, {});
  const originalGet = game.settings.get.bind(game.settings);
  game.settings.get = (moduleId, key, options) => {
    if (options?.document) return key in values ? { _id: `setting-${key}` } : originalGet(moduleId, key, options);
    return key in values ? values[key] : originalGet(moduleId, key, options);
  };
  try {
    const { adapter } = await loadAdapter();
    const { RollBreakdownService, __test__ } = await importStable("scripts/roll-breakdown-service.js");
    const rendered = [];
    const service = new RollBreakdownService({
      adapter,
      renderer: { async appendBreakdown(_message, _html, breakdowns) { rendered.push(breakdowns); return true; } }
    });
    class Root extends globalThis.HTMLElement {
      querySelector() {
        return null;
      }
    }
    await service.enhanceChatMessage({ author: { isGM: true }, isAuthor: false, speaker: { actor: null, token: null }, speakerActor: null, ...message }, new Root());
    return { titles: rendered.length ? rendered[0].map((breakdown) => breakdown.title) : null, canSee: __test__.canSeeBreakdown(message, adapter) };
  } finally {
    cleanupCrucible();
  }
}

test("players see their heroes on a GM initiative report while NPCs and hidden combatants stay hidden", async () => {
  const combat = {
    combatants: [
      { actorId: "actor-hero", name: "Hero", hidden: false },
      { actorId: "actor-npc", name: "Bandit", hidden: false },
      { actorId: "actor-ally", name: "Ally", hidden: true }
    ]
  };
  combat.combatants.find = Array.prototype.find.bind(combat.combatants);
  const report = () => ({
    id: "init-report",
    rolls: [
      new InitiativeCheck(initiativeCheckData("actor-hero"), [5, 5, 5]),
      new InitiativeCheck(initiativeCheckData("actor-npc"), [2, 3, 1]),
      new InitiativeCheck(initiativeCheckData("actor-ally"), [4, 4, 4]),
      fixedInitiativeCheck("actor-hero", 1)
    ],
    flags: { crucible: { isInitiativeReport: true }, core: { initiativeRoll: true } }
  });

  // Default: NPC rows hidden, the hidden ally hidden, both hero rolls shown
  assert.deepEqual((await playerReportView(report(), { combat })).titles, ["Hero", "Hero"]);
  // Without "hide NPC rolls" the visible NPC shows up, the hidden combatant still does not
  assert.deepEqual((await playerReportView(report(), { combat, hideNpcRolls: false })).titles, ["Hero", "Bandit", "Hero"]);
  // "Owners and GM" keeps only the player's own hero
  assert.deepEqual((await playerReportView(report(), { combat, hideNpcRolls: false, visibility: "owners" })).titles, ["Hero", "Hero"]);
  // "GM only" shows nothing
  assert.equal((await playerReportView(report(), { combat, visibility: "gm" })).titles, null);
});

test("players see their heroes on a group check the GM posted, NPC rolls stay hidden", async () => {
  const groupCheck = (actorIds, speaker = { actor: null, token: null }) => ({
    id: "group",
    speaker,
    rolls: actorIds.map((actorId) => new StandardCheck(skillCheckData({ actorId }), [4, 4, 4])),
    flags: { crucible: { groupCheck: { checkId: "c1", actors: {} } } }
  });

  assert.deepEqual((await playerReportView(groupCheck(["actor-hero", "actor-npc", "actor-ally"]))).titles, ["Hero", "Ally"]);
  assert.deepEqual((await playerReportView(groupCheck(["actor-hero", "actor-npc"]), { hideNpcRolls: false })).titles, ["Hero", "Bandit"]);
  // A group check with only NPCs gives the player no panel
  assert.equal((await playerReportView(groupCheck(["actor-npc"]))).titles, null);
  // The GM's selected NPC token as speaker does not hide the heroes of a group check
  assert.deepEqual((await playerReportView(groupCheck(["actor-hero", "actor-npc"], { actor: "actor-npc", token: "token-npc" }))).titles, ["Hero"]);
});
