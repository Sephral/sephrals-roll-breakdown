import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importStable, resetGlobals } from "./helpers/test-helpers.mjs";

const MODULE_ID = "sephrals-roll-breakdown";

function roll(formula, total, results = []) {
  return { formula, total, dice: results.length ? [{ results: results.map((result) => ({ result, active: true })) }] : [] };
}

function breakdown(rollIndex, label, extra = {}) {
  return {
    adapterId: "dnd5e",
    rollIndex,
    formula: "1d20 + 2",
    rollTotal: 14,
    diceTerms: [{ expression: "1d20", total: 12, totalText: "12", faces: 20, number: 1, sourceLabel: null, sourceDetail: null, sourceType: null }],
    modifiers: [{ expression: "2", sourceLabel: label, sourceDetail: null, value: 2, valueText: "+2", kind: "static", confidence: "labeled", muted: false }],
    computedTerms: [],
    unresolvedTerms: [],
    totalStaticModifier: 2,
    sourceConfidence: "resolved",
    sourceSummary: { labeledTermCount: 1, derivedModifierCount: 0, computedTermCount: 0, unresolvedTermCount: 0 },
    hasVisibleContent: true,
    advantageContext: { state: "advantage", attributions: [] },
    ...extra
  };
}

async function setup({ userId = "user-1", isGM = false } = {}) {
  resetGlobals();
  const { game } = createGameStub({ systemId: "dnd5e", settingsValues: { uiLanguage: "en" } });
  game.user = { id: userId, isGM };
  globalThis.game = game;
  const stored = await importStable("scripts/stored-breakdown.js");
  return { game, stored };
}

function storingAdapter(build) {
  const calls = [];
  return {
    id: "dnd5e",
    storeBreakdowns: true,
    calls,
    getMessageRolls: (message) => message.rolls,
    supportsMessage: (message) => message.rolls.length > 0,
    async buildBreakdowns(message) {
      calls.push(message.id);
      return build(message);
    }
  };
}

function chatMessage(id, rolls, { author = "user-1", flags = {} } = {}) {
  const message = {
    id,
    rolls,
    flags,
    author: { id: author },
    updates: [],
    canUserModify: (user) => user.id === author || user.isGM,
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const [, scope, key] = path.split(".");
        this.flags[scope] = { ...(this.flags[scope] ?? {}), [key]: value };
      }
      return this;
    }
  };
  return message;
}

test("roll signatures follow formula, total and dice results", async () => {
  const { stored } = await setup();
  assert.equal(stored.rollSignature(roll("1d20 + 2", 14, [12])), stored.rollSignature(roll("1d20 + 2", 14, [12])));
  assert.notEqual(stored.rollSignature(roll("1d20 + 2", 14, [12])), stored.rollSignature(roll("1d20 + 2", 15, [13])));
  assert.notEqual(stored.rollSignature(roll("2d20kh + 2", 14, [12, 3])), stored.rollSignature(roll("2d20kh + 2", 14, [3, 12])));
  assert.match(stored.rollSignature({}), /^[0-9a-z]+$/);
});

test("the stored copy drops empty values and reads back as the same breakdown", async () => {
  const { stored } = await setup();
  const original = breakdown(0, "Bless");
  const compact = stored.compactBreakdown(original);
  assert.equal("adapterId" in compact, false);
  assert.equal("rollIndex" in compact, false);
  assert.equal("computedTerms" in compact, false);
  assert.equal("sourceLabel" in compact.diceTerms[0], false);
  assert.equal("muted" in compact.modifiers[0], false);
  assert.equal(compact.totalStaticModifier, 2);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(original).length);

  const restored = stored.restoreBreakdown(compact, 3, "dnd5e");
  assert.equal(restored.rollIndex, 3);
  assert.equal(restored.adapterId, "dnd5e");
  assert.equal(restored.stored, true);
  assert.equal(restored.hasVisibleContent, true);
  assert.deepEqual(restored.advantageContext, { state: "advantage", attributions: [] });
  assert.equal(restored.modifiers[0].sourceLabel, "Bless");
  assert.equal(restored.modifiers[0].valueText, "+2");
  // A restored copy is a clone, the panel may change it
  restored.modifiers[0].sourceLabel = "changed";
  assert.equal(compact.modifiers[0].sourceLabel, "Bless");

  const { normalizeBreakdown } = await importStable("scripts/adapter-registry.js");
  const normalized = normalizeBreakdown(restored);
  assert.deepEqual(normalized.computedTerms, []);
  assert.deepEqual(normalized.sections, []);
});

test("the flag keeps entries of unchanged rolls and only adds new rolls", async () => {
  const { stored } = await setup();
  const attack = roll("1d20 + 2", 14, [12]);
  const damage = roll("1d8 + 2", 7, [5]);
  const message = chatMessage("m1", [attack]);

  const first = stored.buildStoreFlag(message, [attack], [breakdown(0, "Bless")], { adapterId: "dnd5e", lang: "en" });
  assert.equal(first.v, stored.STORE_VERSION);
  assert.equal(first.lang, "en");
  assert.equal(first.rolls.length, 1);
  assert.equal(first.rolls[0].s, stored.rollSignature(attack));
  message.flags[MODULE_ID] = { breakdown: first };

  // Nothing new: no write, also when the live breakdown changed meanwhile (the effect expired)
  assert.equal(stored.buildStoreFlag(message, [attack], [breakdown(0, null)], { adapterId: "dnd5e", lang: "en" }), null);

  // A damage roll added to the card: the attack keeps its copy, the damage roll gets its own
  message.rolls = [attack, damage];
  const second = stored.buildStoreFlag(message, [attack, damage], [breakdown(0, null), breakdown(1, "Rage")], { adapterId: "dnd5e", lang: "en" });
  assert.equal(second.rolls[0], first.rolls[0]);
  assert.equal(second.rolls[1].b.modifiers[0].sourceLabel, "Rage");

  // A roll without a panel is stored as such, a message without any panel is not stored at all
  const plain = roll("1d6", 4, [4]);
  assert.equal(stored.buildStoreFlag(chatMessage("m2", [plain]), [plain], [], { adapterId: "dnd5e" }), null);
  message.flags[MODULE_ID] = { breakdown: second };
  const third = stored.buildStoreFlag(message, [attack, damage, plain], [], { adapterId: "dnd5e" });
  assert.deepEqual(third.rolls[2], { s: stored.rollSignature(plain) });

  // A reroll at the same index gets a new entry
  const rerolled = roll("1d20 + 2", 20, [18]);
  const fourth = stored.buildStoreFlag(message, [rerolled, damage], [breakdown(0, "Guidance")], { adapterId: "dnd5e" });
  assert.equal(fourth.rolls[0].b.modifiers[0].sourceLabel, "Guidance");

  // Copies that grow too large are not stored
  const huge = breakdown(0, "x".repeat(30000));
  assert.equal(stored.buildStoreFlag(chatMessage("m3", [attack]), [attack], [huge], { adapterId: "dnd5e" }), null);
});

test("stored entries win over live breakdowns, other adapters are not touched", async () => {
  const { stored } = await setup();
  const attack = roll("1d20 + 2", 14, [12]);
  const damage = roll("1d8 + 2", 7, [5]);
  const flag = { v: 1, adapter: "dnd5e", lang: "en", rolls: [{ s: stored.rollSignature(attack), b: stored.compactBreakdown(breakdown(0, "Bless")) }] };

  // Complete copy: no live build at all
  const adapter = storingAdapter(() => [breakdown(0, null)]);
  const complete = await stored.resolveBreakdowns(adapter, chatMessage("m1", [attack], { flags: { [MODULE_ID]: { breakdown: flag } } }));
  assert.deepEqual(complete.map((entry) => entry.modifiers[0].sourceLabel), ["Bless"]);
  assert.equal(adapter.calls.length, 0);

  // Partial copy: live breakdowns fill the new roll
  const partial = await stored.resolveBreakdowns(storingAdapter(() => [breakdown(0, null), breakdown(1, "Rage")]),
    chatMessage("m1", [attack, damage], { flags: { [MODULE_ID]: { breakdown: flag } } }));
  assert.deepEqual(partial.map((entry) => [entry.rollIndex, entry.modifiers[0].sourceLabel, Boolean(entry.stored)]), [[0, "Bless", true], [1, "Rage", false]]);

  // A copy of other rolls (rerolled) or an unknown version is ignored
  const rerolled = await stored.resolveBreakdowns(storingAdapter(() => [breakdown(0, "Live")]),
    chatMessage("m1", [roll("1d20 + 2", 9, [7])], { flags: { [MODULE_ID]: { breakdown: flag } } }));
  assert.equal(rerolled[0].modifiers[0].sourceLabel, "Live");
  const future = await stored.resolveBreakdowns(storingAdapter(() => [breakdown(0, "Live")]),
    chatMessage("m1", [attack], { flags: { [MODULE_ID]: { breakdown: { ...flag, v: 2 } } } }));
  assert.equal(future[0].modifiers[0].sourceLabel, "Live");

  // A stored "no panel" entry stays without panel
  const none = await stored.resolveBreakdowns(storingAdapter(() => [breakdown(0, "Live")]),
    chatMessage("m1", [attack], { flags: { [MODULE_ID]: { breakdown: { ...flag, rolls: [{ s: stored.rollSignature(attack) }] } } } }));
  assert.deepEqual(none, []);

  // Adapters without storeBreakdowns always build live
  const generic = { id: "generic", getMessageRolls: (message) => message.rolls, buildBreakdowns: async () => [breakdown(0, "Live")] };
  const live = await stored.resolveBreakdowns(generic, chatMessage("m1", [attack], { flags: { [MODULE_ID]: { breakdown: flag } } }));
  assert.equal(live[0].modifiers[0].sourceLabel, "Live");
});

test("only updates that change more than the stored copy count as new rolls", async () => {
  const { stored } = await setup();
  assert.equal(stored.changesRolls({ _id: "m1", flags: { [MODULE_ID]: { breakdown: {} } } }), false);
  assert.equal(stored.changesRolls({ _id: "m1", [`flags.${MODULE_ID}.breakdown`]: {} }), false);
  assert.equal(stored.changesRolls({ _id: "m1" }), false);
  assert.equal(stored.changesRolls(null), false);
  assert.equal(stored.changesRolls({ _id: "m1", rolls: ["{}"] }), true);
  assert.equal(stored.changesRolls({ _id: "m1", flags: { rsr5e: { rolls: [] } } }), true);
  assert.equal(stored.changesRolls({ _id: "m1", content: "<div></div>" }), true);
});

test("the client that adds a roll stores the copy once, without update loops", async () => {
  const { stored, game } = await setup({ userId: "user-1" });
  const attack = roll("1d20 + 2", 14, [12]);
  const message = chatMessage("m1", [attack]);
  game.messages = { get: (id) => (id === "m1" ? message : null) };
  let label = "Bless";
  const adapter = storingAdapter(() => [breakdown(0, label)]);
  const store = new stored.BreakdownStore({ getAdapter: () => adapter });

  // Other users' messages are stored by their own client
  store.onCreate(message, {}, "user-2");
  assert.equal(store.running.size, 0);

  store.onCreate(message, {}, "user-1");
  await store.running.get("m1")?.promise;
  assert.equal(message.updates.length, 1);
  assert.equal(message.flags[MODULE_ID].breakdown.rolls[0].b.modifiers[0].sourceLabel, "Bless");

  // The update of the copy itself, and any later update without new rolls, writes nothing
  store.onUpdate(message, { _id: "m1", flags: { [MODULE_ID]: { breakdown: message.flags[MODULE_ID].breakdown } } }, {}, "user-1");
  assert.equal(store.running.size, 0);
  label = null;
  await store.schedule(message);
  assert.equal(message.updates.length, 1);
  assert.equal(message.flags[MODULE_ID].breakdown.rolls[0].b.modifiers[0].sourceLabel, "Bless");

  // A damage roll added by an update: one more write with both rolls
  label = "Rage";
  message.rolls = [attack, roll("1d8 + 2", 7, [5])];
  adapter.buildBreakdowns = async () => [breakdown(0, null), breakdown(1, "Rage")];
  store.onUpdate(message, { _id: "m1", rolls: [] }, {}, "user-1");
  // A second change during the run starts one more run after it, not a parallel one
  store.onUpdate(message, { _id: "m1", content: "x" }, {}, "user-1");
  await store.running.get("m1")?.promise;
  assert.equal(message.updates.length, 2);
  assert.deepEqual(message.flags[MODULE_ID].breakdown.rolls.map((entry) => entry.b.modifiers[0].sourceLabel), ["Bless", "Rage"]);

  // A client that may not change the message does not try
  const foreign = chatMessage("m2", [attack], { author: "user-2" });
  game.messages = { get: () => foreign };
  await store.schedule(foreign);
  assert.equal(foreign.updates.length, 0);

  // Roll table draws get no panel and no copy
  const table = chatMessage("m3", [attack], { flags: { "core.RollTable": "table" } });
  game.messages = { get: () => table };
  await store.schedule(table);
  assert.equal(table.updates.length, 0);

  // Adapters without storeBreakdowns never write
  const plain = new stored.BreakdownStore({ getAdapter: () => ({ ...adapter, storeBreakdowns: false }) });
  assert.equal(plain.schedule(message), null);
});

test("a failing adapter or update leaves the message alone", async () => {
  const { stored, game } = await setup({ userId: "user-1" });
  const message = chatMessage("m1", [roll("1d20", 3, [3])]);
  game.messages = { get: () => message };
  const logs = [];
  const failing = storingAdapter(() => {
    throw new Error("boom");
  });
  await new stored.BreakdownStore({ getAdapter: () => failing, log: (text) => logs.push(text) }).schedule(message);
  assert.equal(message.updates.length, 0);
  assert.match(logs[0], /adapter failed/);

  message.update = async () => {
    throw new Error("denied");
  };
  await new stored.BreakdownStore({ getAdapter: () => storingAdapter(() => [breakdown(0, "Bless")]), log: (text) => logs.push(text) }).schedule(message);
  assert.match(logs[1], /Could not store/);
});
