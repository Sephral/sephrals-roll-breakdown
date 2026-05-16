import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, createHooksStub, importFresh, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

function createRendererRoot({ existingMarkup = false } = {}) {
  const BaseElement = globalThis.HTMLElement;

  class FakeElement extends BaseElement {
    constructor() {
      super();
      this.markup = [];
    }

    querySelector(selector) {
      if (selector === ".message-content") return this.messageContent ?? null;
      if (existingMarkup && selector.includes(".srb-breakdown")) return {};
      return null;
    }

    insertAdjacentHTML(position, markup) {
      this.markup.push({ position, markup });
    }
  }

  const root = new FakeElement();
  root.messageContent = new FakeElement();
  return root;
}

test("chat card renderer decorates template data and avoids duplicate markup", async () => {
  resetGlobals();
  installHTMLElement();

  const translations = {
    "SRB.Chat.Toggle": "Toggle",
    "SRB.Chat.RollLabel": "Roll",
    "SRB.Chat.Status": "Status",
    "SRB.Chat.Formula": "Formula",
    "SRB.Chat.Dice": "Dice",
    "SRB.Chat.Modifiers": "Modifiers",
    "SRB.Chat.ComputedTerms": "Computed",
    "SRB.Chat.Unresolved": "Unresolved",
    "SRB.Chat.StaticModifier": "Static",
    "SRB.Chat.RollTotal": "Total",
    "SRB.Chat.PossibleSources": "Possible",
    "SRB.Chat.UnknownModifier": "Unknown",
    "SRB.Chat.UnresolvedTerm": "Unknown term",
    "SRB.Chat.LabeledSource": "Labeled",
    "SRB.Chat.DerivedModifier": "Derived",
    "SRB.Chat.ComputedTerm": "Computed term",
    "SRB.Chat.StatusExact": "Exact",
    "SRB.Chat.StatusDerived": "Derived status",
    "SRB.Chat.StatusPartial": "Partial",
    "SRB.Chat.None": "None",
    "SRB.Chat.Advantage": "Advantage",
    "SRB.Chat.Disadvantage": "Disadvantage",
    "SRB.Chat.Normal": "Normal",
    "SRB.Chat.SuppressedAdvantage": "Suppressed advantage",
    "SRB.Chat.SuppressedDisadvantage": "Suppressed disadvantage"
  };

  const { game } = createGameStub({ translations });
  globalThis.game = game;

  let capturedTemplateData = null;
  globalThis.renderTemplate = async (_path, data) => {
    capturedTemplateData = data;
    return `<div class="srb-breakdown" data-message-id="${data.messageId}"></div>`;
  };

  const { ChatCardRenderer } = await importStable("scripts/chat-card-renderer.js");
  const renderer = new ChatCardRenderer();

  const root = createRendererRoot();
  const appended = await renderer.appendBreakdown({ id: "message-1" }, root, [{
    formula: "1d20 + 5",
    sourceConfidence: "derived",
    sourceSummary: {
      labeledTermCount: 1,
      derivedModifierCount: 1,
      computedTermCount: 1,
      unresolvedTermCount: 1
    },
    diceTerms: [{ sourceLabel: "External Module: Attack", sourceDetail: "d20" }],
    modifiers: [{ kind: "derived", value: 5, sourceLabel: null, sourceDetail: "bonus" }],
    computedTerms: [{ sourceLabel: null, sourceDetail: "computed detail" }],
    advantageContext: {
      state: "disadvantage",
      attributions: [{ type: "DIS", source: "nearbyFoe", displayName: "Nearby foe" }]
    },
    unresolvedTerms: [{ sourceLabel: null, sourceDetail: "unknown detail" }],
    totalStaticModifier: 5,
    rollTotal: 18
  }], { defaultExpanded: true, showUnknown: false });

  assert.equal(appended, true);
  assert.equal(root.messageContent.markup.length, 1);
  assert.equal(capturedTemplateData.messageId, "message-1");
  assert.equal(capturedTemplateData.breakdowns[0].confidenceLabel, "Derived status");
  assert.equal(capturedTemplateData.breakdowns[0].diceTerms[0].label, "Attack");
  assert.equal(capturedTemplateData.breakdowns[0].modifiers[0].label, "Derived");
  assert.equal(capturedTemplateData.breakdowns[0].computedTerms[0].label, "Computed term");
  assert.equal(capturedTemplateData.breakdowns[0].advantageContext.attributions[0].typeLabel, "Disadvantage");
  assert.equal(capturedTemplateData.breakdowns[0].unresolvedTerms.length, 0);
  assert.equal(capturedTemplateData.breakdowns[0].totalStaticModifierText, "+5");

  const duplicateRoot = createRendererRoot({ existingMarkup: true });
  assert.equal(await renderer.appendBreakdown({ id: "message-1" }, duplicateRoot, [], { defaultExpanded: false, showUnknown: true }), false);
  assert.equal(await renderer.appendBreakdown({ id: "missing-root" }, { invalid: true }, [], { defaultExpanded: false, showUnknown: true }), false);

  const arrayRoot = createRendererRoot();
  assert.equal(await renderer.appendBreakdown({ id: "message-2" }, [arrayRoot], [{
    formula: "1d6",
    sourceConfidence: "resolved",
    sourceSummary: { labeledTermCount: 0, derivedModifierCount: 0, computedTermCount: 0, unresolvedTermCount: 0 },
    diceTerms: [],
    modifiers: [],
    computedTerms: [],
    unresolvedTerms: [],
    totalStaticModifier: Number.NaN,
    rollTotal: null
  }], { defaultExpanded: false, showUnknown: true }), true);
});

test("srb registers hooks, initializes the correct adapter, and forwards render events", async () => {
  resetGlobals();
  installHTMLElement();

  const { game, registrations } = createGameStub({
    lang: "en",
    systemId: "dnd5e"
  });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: false, async json() { return {}; } });

  const templateLoads = [];
  globalThis.loadTemplates = async (paths) => {
    templateLoads.push(paths);
  };

  const { onceHandlers, onHandlers } = createHooksStub();
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");

  const calls = [];
  const originalEnhance = RollBreakdownService.prototype.enhanceChatMessage;
  RollBreakdownService.prototype.enhanceChatMessage = async function(message, html) {
    calls.push({ messageId: message.id, html, adapterId: this.adapter.id });
  };

  try {
    await importStable("scripts/srb.js");

    assert.equal(typeof onceHandlers.get("init"), "function");
    assert.equal(typeof onHandlers.get("renderChatMessageHTML"), "function");

    await onceHandlers.get("init")();
    assert.equal(registrations.length, 7);
    assert.deepEqual(templateLoads, [["modules/sephrals-roll-breakdown/templates/breakdown-panel.hbs"]]);

    await onHandlers.get("renderChatMessageHTML")({ id: "chat-1" }, { html: true });
    assert.deepEqual(calls, [{ messageId: "chat-1", html: { html: true }, adapterId: "dnd5e" }]);
  } finally {
    RollBreakdownService.prototype.enhanceChatMessage = originalEnhance;
  }
});

test("srb falls back to the generic adapter when the current system is not dnd5e", async () => {
  resetGlobals();
  installHTMLElement();

  const { game } = createGameStub({ systemId: "pf2e" });
  globalThis.game = game;
  globalThis.fetch = async () => ({ ok: false, async json() { return {}; } });

  const { onceHandlers, onHandlers } = createHooksStub();
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const originalEnhance = RollBreakdownService.prototype.enhanceChatMessage;
  const calls = [];
  RollBreakdownService.prototype.enhanceChatMessage = async function(message) {
    calls.push({ messageId: message.id, adapterId: this.adapter.id });
  };

  try {
    delete globalThis.loadTemplates;
    await importFresh("scripts/srb.js");
    await onceHandlers.get("init")();
    await onHandlers.get("renderChatMessageHTML")({ id: "chat-generic" }, {});
    assert.deepEqual(calls, [{ messageId: "chat-generic", adapterId: "generic" }]);
  } finally {
    RollBreakdownService.prototype.enhanceChatMessage = originalEnhance;
  }
});