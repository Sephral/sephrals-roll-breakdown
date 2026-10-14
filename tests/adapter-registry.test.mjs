import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, createHooksStub, importFresh, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

function createAdapter(id, breakdowns = []) {
  return {
    id,
    supportsMessage: () => true,
    async buildBreakdowns() {
      return breakdowns;
    }
  };
}

test("the adapter registry validates, replaces and resolves adapters per system", async () => {
  const { AdapterRegistry, isValidAdapter } = await importStable("scripts/adapter-registry.js");
  const registry = new AdapterRegistry();
  const fallback = createAdapter("fallback");

  assert.equal(isValidAdapter(createAdapter("ok")), true);
  assert.equal(isValidAdapter({ supportsMessage() {} }), false);
  assert.equal(isValidAdapter(null), false);
  assert.throws(() => registry.register("", createAdapter("x")), TypeError);
  assert.throws(() => registry.register("demo", { buildBreakdowns() {} }), TypeError);

  const first = registry.register(" demo ", createAdapter("first"));
  assert.equal(registry.get("demo"), first);
  assert.equal(registry.has("demo"), true);
  const second = registry.register("demo", createAdapter("second"));
  assert.equal(registry.resolve("demo", fallback), second);
  assert.equal(registry.resolve("other", fallback), fallback);
  assert.equal(registry.get(undefined), null);
});

test("breakdowns from other adapters get every field the panel needs", async () => {
  const { normalizeBreakdown } = await importStable("scripts/adapter-registry.js");

  const minimal = normalizeBreakdown({
    formula: " 2d6 + 1 ",
    title: "  Lockpicking ",
    modifiers: [{ sourceLabel: "Tools", value: 1, valueText: "+1" }, null],
    sections: [
      { label: "Why", placement: "top", items: [{ text: "Good light", tag: "Bonus", value: 1 }, { text: "" }] },
      { label: "Empty", items: [] },
      { label: "Notes", items: [{ text: "Second try", muted: 1 }] }
    ],
    pills: [{ text: "Target 8", emphasis: true }, { text: "" }],
    rollTotal: 9
  });

  assert.equal(minimal.formula, "2d6 + 1");
  assert.equal(minimal.title, "Lockpicking");
  assert.deepEqual(minimal.diceTerms, []);
  assert.equal(minimal.modifiers.length, 1);
  assert.deepEqual(minimal.sourceSummary, { labeledTermCount: 0, derivedModifierCount: 0, computedTermCount: 0, unresolvedTermCount: 0 });
  assert.deepEqual(minimal.sections.map((section) => [section.label, section.placement, section.items.length]), [["Why", "top", 1], ["Notes", "bottom", 1]]);
  assert.deepEqual(minimal.sections[0].items[0], { text: "Good light", tag: "Bonus", value: "1", tooltip: null, muted: false });
  assert.equal(minimal.sections[1].items[0].muted, true);
  assert.deepEqual(minimal.pills, [{ text: "Target 8", tooltip: null, emphasis: true }]);
  assert.equal(minimal.rollTotal, 9);
  assert.equal(normalizeBreakdown(null).rollTotal, null);
  assert.equal(normalizeBreakdown({ rollTotal: "x" }).rollTotal, null);
});

test("the renderer shows titles, sections, notes and pills", async () => {
  resetGlobals();
  installHTMLElement();
  const { game } = createGameStub({ translations: { "SRB.Chat.RollLabel": "Roll" } });
  globalThis.game = game;

  let templateData = null;
  globalThis.renderTemplate = async (_path, data) => {
    templateData = data;
    return `<div class="srb-breakdown" data-message-id="${data.messageId}"></div>`;
  };

  class Root extends globalThis.HTMLElement {
    querySelector(selector) {
      return selector === ".message-content" ? this : null;
    }

    insertAdjacentHTML() {}
  }

  const { ChatCardRenderer } = await importFresh("scripts/chat-card-renderer.js");
  await new ChatCardRenderer().appendBreakdown({ id: "r1" }, new Root(), [
    {
      title: "Goblin",
      diceTerms: [{ expression: "1d10", sourceLabel: "1 boon", notes: ["Aced", ""], muted: true }],
      sections: [
        { label: "Boons and banes", placement: "top", items: [{ text: "Flanked", tag: "Boon", value: "1" }] },
        { label: "Damage", items: [{ text: "Total", value: "9" }] }
      ],
      pills: [{ text: "Hit", emphasis: true }],
      rollTotal: 22
    },
    { diceTerms: [], rollTotal: 3 }
  ], { defaultExpanded: false, showUnknown: true });

  const [first, second] = templateData.breakdowns;
  assert.equal(first.rollLabel, "Goblin");
  assert.equal(second.rollLabel, "Roll 2");
  assert.deepEqual(first.diceTerms[0].notes, ["Aced"]);
  assert.equal(first.diceTerms[0].muted, true);
  assert.deepEqual(first.topSections.map((section) => section.label), ["Boons and banes"]);
  assert.deepEqual(first.bottomSections.map((section) => section.label), ["Damage"]);
  assert.deepEqual(first.pills, [{ text: "Hit", tooltip: null, emphasis: true }]);
  assert.equal(first.rollTotalText, "22");
  assert.deepEqual(second.topSections, []);
});

test("a failing adapter is logged and leaves the chat card alone", async () => {
  resetGlobals();
  installHTMLElement();
  const { game } = createGameStub({ settingsValues: { enabled: true, debug: false } });
  game.user = { isGM: true };
  globalThis.game = game;

  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const rendered = [];
  const service = new RollBreakdownService({
    adapter: {
      id: "broken",
      supportsMessage: () => true,
      async buildBreakdowns() {
        throw new Error("boom");
      }
    },
    renderer: { async appendBreakdown(message) { rendered.push(message.id); return true; } }
  });

  class Root extends globalThis.HTMLElement {
    querySelector() {
      return null;
    }
  }

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await service.enhanceChatMessage({ id: "x1" }, new Root());
    service.adapter.supportsMessage = () => {
      throw new Error("boom");
    };
    await service.enhanceChatMessage({ id: "x2" }, new Root());
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(rendered, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0][0], /"broken" failed for message x1/);
});

async function loadSrb(systemId) {
  resetGlobals();
  installHTMLElement();
  const { game } = createGameStub({ systemId });
  const moduleEntry = {};
  game.modules = new Map([["sephrals-roll-breakdown", moduleEntry]]);
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: false, async json() { return {}; } });

  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };

  const hooks = createHooksStub();
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const originalEnhance = RollBreakdownService.prototype.enhanceChatMessage;
  const calls = [];
  RollBreakdownService.prototype.enhanceChatMessage = async function(message) {
    calls.push({ messageId: message.id, adapterId: this.adapter.id });
  };

  await importFresh("scripts/srb.js");
  await hooks.onceHandlers.get("init")();

  return {
    ...hooks,
    game,
    moduleEntry,
    timers,
    calls,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      RollBreakdownService.prototype.enhanceChatMessage = originalEnhance;
    }
  };
}

test("the public API registers adapters and the running system switches to them", async () => {
  const env = await loadSrb("worldbuilding");
  try {
    const { api } = env.moduleEntry;
    assert.equal(typeof api.registerAdapter, "function");
    assert.equal(typeof api.parseRoll, "function");
    assert.equal(api.getAdapter("dnd5e").id, "dnd5e");
    assert.equal(api.getAdapter("crucible").id, "crucible");
    assert.equal(api.getAdapter("pf2e").id, "pf2e");
    assert.equal(api.getAdapter("swade").id, "swade");

    const render = env.onHandlers.get("renderChatMessageHTML");
    render({ id: "before", rolls: [{}] }, { element: true });

    api.registerAdapter("other-system", createAdapter("other"));
    render({ id: "unchanged", rolls: [{}] }, { element: true });

    api.registerAdapter("worldbuilding", createAdapter("custom"));
    render({ id: "after", rolls: [{}] }, { element: true });

    assert.deepEqual(env.calls, [
      { messageId: "before", adapterId: "generic" },
      { messageId: "unchanged", adapterId: "generic" },
      { messageId: "after", adapterId: "custom" }
    ]);
    assert.throws(() => api.registerAdapter("worldbuilding", {}), TypeError);
    assert.deepEqual(api.parseRoll({ formula: "", terms: [] }).diceTerms, []);
  } finally {
    env.restore();
  }
});

test("in crucible worlds the panel waits until the system has finished its chat card", async () => {
  const env = await loadSrb("crucible");
  try {
    const render = env.onHandlers.get("renderChatMessageHTML");
    const card = { isConnected: false };
    render({ id: "action", rolls: [{}] }, card);
    assert.deepEqual(env.calls, []);
    assert.equal(env.timers.length, 1);

    // Still building: check again shortly.
    env.timers[0].callback();
    assert.deepEqual(env.calls, []);
    assert.equal(env.timers[1].delay, 50);

    // Crucible appended its sections and the chat log inserted the card.
    card.isConnected = true;
    env.timers[1].callback();
    assert.deepEqual(env.calls, [{ messageId: "action", adapterId: "crucible" }]);
  } finally {
    env.restore();
  }
});
