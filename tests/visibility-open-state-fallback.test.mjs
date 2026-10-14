import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, createHooksStub, importFresh, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

function installGame(settingsValues = {}, { isGM = false, isActiveGM = false } = {}) {
  const stub = createGameStub({ settingsValues });
  stub.game.user = { isGM, isActiveGM };
  globalThis.game = stub.game;
  return stub;
}

function npcActor() {
  return { hasPlayerOwner: false, isOwner: false };
}

function pcActor({ ownedByCurrentUser = false } = {}) {
  return { hasPlayerOwner: true, isOwner: ownedByCurrentUser };
}

const GM_USER = { isGM: true };
const PLAYER_USER = { isGM: false };

function createBreakdown() {
  return {
    formula: "1d20 + 2",
    sourceConfidence: "resolved",
    sourceSummary: { labeledTermCount: 0, derivedModifierCount: 0, computedTermCount: 0, unresolvedTermCount: 0 },
    diceTerms: [],
    modifiers: [],
    computedTerms: [],
    unresolvedTerms: [],
    totalStaticModifier: 2,
    rollTotal: 14
  };
}

// Minimal DOM: inserted panels are searchable by message id and accept a toggle listener.
function createPanelRoot() {
  const BaseElement = globalThis.HTMLElement;

  class FakeElement extends BaseElement {
    constructor() {
      super();
      this.panels = [];
    }

    querySelector(selector) {
      if (selector === ".message-content") return this.messageContent ?? null;
      const messageId = selector.match(/data-message-id="([^"]+)"/)?.[1];
      if (!messageId) return null;
      return [...this.panels, ...(this.messageContent?.panels ?? [])].find((panel) => panel.messageId === messageId) ?? null;
    }

    insertAdjacentHTML(_position, markup) {
      this.panels.push({
        messageId: markup.match(/data-message-id="([^"]+)"/)?.[1],
        open: / open/.test(markup),
        listeners: {},
        addEventListener(type, callback) {
          this.listeners[type] = callback;
        }
      });
    }
  }

  const root = new FakeElement();
  root.messageContent = new FakeElement();
  return root;
}

function installPanelTemplate() {
  const renders = [];
  globalThis.renderTemplate = async (_path, data) => {
    renders.push(data);
    return `<details class="srb-breakdown" data-message-id="${data.messageId}"${data.expanded ? " open" : ""}></details>`;
  };
  return renders;
}

test("visibility falls back to the old toggles until a GM migrates them once", async () => {
  resetGlobals();
  const { game, settingsValues, setCalls } = installGame({ gmOnly: true, playersVisible: true });
  const settings = await importStable("scripts/settings.js");
  settings.registerSettings();

  // Not migrated yet: a player connecting before the GM still gets the old behaviour.
  assert.equal(settings.getVisibilityMode(), "gm");
  assert.equal(settings.shouldRenderForCurrentUser(), false);

  // Only the active GM writes the new setting.
  assert.equal(await settings.migrateLegacyVisibility(), false);
  assert.deepEqual(setCalls, []);

  game.user = { isGM: true, isActiveGM: true };
  assert.equal(await settings.migrateLegacyVisibility(), true);
  assert.deepEqual(setCalls, [{ moduleId: settings.MODULE_ID, key: "visibility", value: "gm" }]);

  // Once stored, the new setting wins and the migration does not run again.
  settingsValues.gmOnly = false;
  assert.equal(settings.getVisibilityMode(), "gm");
  assert.equal(await settings.migrateLegacyVisibility(), false);
  assert.equal(setCalls.length, 1);

  settingsValues.visibility = "owners";
  assert.equal(settings.getVisibilityMode(), "owners");
  settingsValues.visibility = "something-else";
  assert.equal(settings.getVisibilityMode(), "all");
});

test("legacy toggles map to the new visibility modes", async () => {
  resetGlobals();
  const cases = [
    [{}, "all"],
    [{ playersVisible: true, gmOnly: false }, "all"],
    [{ playersVisible: false, gmOnly: false }, "gm"],
    [{ playersVisible: true, gmOnly: true }, "gm"],
    [{ playersVisible: false, gmOnly: true }, "gm"]
  ];

  const settings = await importStable("scripts/settings.js");
  for (const [legacyValues, expected] of cases) {
    const { setCalls } = installGame({ ...legacyValues }, { isGM: true, isActiveGM: true });
    settings.registerSettings();
    assert.equal(settings.getVisibilityMode(), expected, JSON.stringify(legacyValues));
    await settings.migrateLegacyVisibility();
    assert.deepEqual(setCalls.map((call) => call.value), [expected]);
  }
});

test("a failed migration write keeps the fallback and reports the error", async () => {
  resetGlobals();
  const { game } = installGame({ playersVisible: false }, { isGM: true, isActiveGM: true });
  const settings = await importStable("scripts/settings.js");
  settings.registerSettings();
  game.settings.set = async () => {
    throw new Error("permission denied");
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(await settings.migrateLegacyVisibility(), false);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(settings.getVisibilityMode(), "gm");
});

test("players only see breakdowns allowed by the visibility mode and the NPC option", async () => {
  resetGlobals();
  const { game, settingsValues } = installGame({ visibility: "all", hideNpcRolls: true });
  const settings = await importStable("scripts/settings.js");
  settings.registerSettings();
  const { __test__ } = await importStable("scripts/roll-breakdown-service.js");
  const { canSeeBreakdown } = __test__;

  const npcAttack = { author: GM_USER, speakerActor: npcActor() };
  const gmPlainRoll = { author: GM_USER, speakerActor: null };
  const gmRollForPc = { author: GM_USER, speakerActor: pcActor() };
  const ownRoll = { author: PLAYER_USER, isAuthor: true, speakerActor: pcActor({ ownedByCurrentUser: true }) };
  const otherPlayerRoll = { author: PLAYER_USER, isAuthor: false, speakerActor: pcActor() };
  const otherPlayerPlainRoll = { author: PLAYER_USER, isAuthor: false, speakerActor: null };
  const gmRollForOwnPc = { author: GM_USER, isAuthor: false, speakerActor: pcActor({ ownedByCurrentUser: true }) };

  // Everyone, NPC and GM rolls hidden.
  assert.equal(canSeeBreakdown(npcAttack), false);
  assert.equal(canSeeBreakdown(gmPlainRoll), false);
  assert.equal(canSeeBreakdown(gmRollForPc), true);
  assert.equal(canSeeBreakdown(ownRoll), true);
  assert.equal(canSeeBreakdown(otherPlayerRoll), true);
  assert.equal(canSeeBreakdown(otherPlayerPlainRoll), true);

  // Everyone, NPC and GM rolls shown.
  settingsValues.hideNpcRolls = false;
  assert.equal(canSeeBreakdown(npcAttack), true);
  assert.equal(canSeeBreakdown(gmPlainRoll), true);

  // Owners and GM: only rolls the player made or whose speaker the player owns.
  settingsValues.visibility = "owners";
  assert.equal(canSeeBreakdown(ownRoll), true);
  assert.equal(canSeeBreakdown(gmRollForOwnPc), true);
  assert.equal(canSeeBreakdown(otherPlayerRoll), false);
  assert.equal(canSeeBreakdown(otherPlayerPlainRoll), false);
  assert.equal(canSeeBreakdown(npcAttack), false);

  // GM only is decided before the message is inspected.
  settingsValues.visibility = "gm";
  assert.equal(settings.shouldRenderForCurrentUser(), false);

  // GMs (and assistant GMs, which also report isGM) see every breakdown.
  game.user = { isGM: true, isActiveGM: false };
  settingsValues.hideNpcRolls = true;
  assert.equal(settings.shouldRenderForCurrentUser(), true);
  assert.equal(canSeeBreakdown(npcAttack), true);
  assert.equal(canSeeBreakdown(gmPlainRoll), true);
});

test("the service renders no panel for players on hidden NPC rolls", async () => {
  resetGlobals();
  installHTMLElement();
  installGame({ visibility: "all", hideNpcRolls: true });
  const settings = await importStable("scripts/settings.js");
  settings.registerSettings();
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");

  const rendered = [];
  const service = new RollBreakdownService({
    adapter: {
      supportsMessage: () => true,
      buildBreakdowns: async () => [createBreakdown()]
    },
    renderer: {
      async appendBreakdown(message) {
        rendered.push(message.id);
        return true;
      }
    }
  });

  await service.enhanceChatMessage({ id: "npc", author: GM_USER, speakerActor: npcActor() }, createPanelRoot());
  await service.enhanceChatMessage({ id: "pc", author: PLAYER_USER, speakerActor: pcActor() }, createPanelRoot());
  assert.deepEqual(rendered, ["pc"]);
});

test("the renderer restores the open state of a panel after a re-render", async () => {
  resetGlobals();
  installHTMLElement();
  installGame();
  const renders = installPanelTemplate();
  const { ChatCardRenderer } = await importStable("scripts/chat-card-renderer.js");
  const renderer = new ChatCardRenderer();
  const collapsed = { defaultExpanded: false, showUnknown: true };

  const firstRoot = createPanelRoot();
  assert.equal(await renderer.appendBreakdown({ id: "m1" }, firstRoot, [createBreakdown()], collapsed), true);
  const panel = firstRoot.messageContent.panels[0];
  assert.equal(panel.open, false);

  // The user opens the panel, then the card re-renders with a fresh element.
  panel.open = true;
  panel.listeners.toggle();
  const secondRoot = createPanelRoot();
  await renderer.appendBreakdown({ id: "m1" }, secondRoot, [createBreakdown()], collapsed);
  assert.equal(renders.at(-1).expanded, true);
  assert.equal(secondRoot.messageContent.panels[0].open, true);

  // Other messages keep the default.
  await renderer.appendBreakdown({ id: "m2" }, createPanelRoot(), [createBreakdown()], collapsed);
  assert.equal(renders.at(-1).expanded, false);

  // A panel closed while "Expanded by default" is on stays closed as well.
  const expanded = { defaultExpanded: true, showUnknown: true };
  const thirdRoot = createPanelRoot();
  await renderer.appendBreakdown({ id: "m3" }, thirdRoot, [createBreakdown()], expanded);
  const openPanel = thirdRoot.messageContent.panels[0];
  assert.equal(openPanel.open, true);
  openPanel.open = false;
  openPanel.listeners.toggle();
  await renderer.appendBreakdown({ id: "m3" }, createPanelRoot(), [createBreakdown()], expanded);
  assert.equal(renders.at(-1).expanded, false);
});

test("overlapping render passes for the same card insert only one panel", async () => {
  resetGlobals();
  installHTMLElement();
  installGame();

  const pending = [];
  globalThis.renderTemplate = (_path, data) => new Promise((resolve) => {
    pending.push(() => resolve(`<details class="srb-breakdown" data-message-id="${data.messageId}"></details>`));
  });

  const { ChatCardRenderer } = await importStable("scripts/chat-card-renderer.js");
  const renderer = new ChatCardRenderer();
  const root = createPanelRoot();
  const options = { defaultExpanded: false, showUnknown: true };

  const first = renderer.appendBreakdown({ id: "race" }, root, [createBreakdown()], options);
  const second = renderer.appendBreakdown({ id: "race" }, root, [createBreakdown()], options);
  assert.equal(pending.length, 2);
  pending.forEach((resolve) => resolve());

  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(root.messageContent.panels.length, 1);
});

async function loadSrbWithTimers(systemId) {
  resetGlobals();
  installHTMLElement();
  const { game } = createGameStub({ systemId });
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
  RollBreakdownService.prototype.enhanceChatMessage = async function(message, html) {
    calls.push({ messageId: message.id, html });
  };

  await importFresh("scripts/srb.js");
  await hooks.onceHandlers.get("init")();

  return {
    ...hooks,
    game,
    timers,
    calls,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      RollBreakdownService.prototype.enhanceChatMessage = originalEnhance;
    }
  };
}

test("in dnd5e worlds the core hook only steps in when the system hook stays silent", async () => {
  const env = await loadSrbWithTimers("dnd5e");
  try {
    const coreHook = env.onHandlers.get("renderChatMessageHTML");
    const systemHook = env.onHandlers.get("dnd5e.renderChatMessage");

    // Normal case: dnd5e fires its hook with the same element, the fallback timer does nothing.
    const handledElement = { element: "handled" };
    coreHook({ id: "normal", rolls: [{}] }, handledElement);
    systemHook({ id: "normal", rolls: [{}] }, handledElement);
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].delay, 1000);
    env.timers[0].callback();
    assert.deepEqual(env.calls.map((call) => call.messageId), ["normal"]);

    // The system hook never fires (e.g. renamed): the core hook renders after the grace period.
    const orphanElement = { element: "orphan" };
    coreHook({ id: "orphan", rolls: [{}] }, orphanElement);
    assert.deepEqual(env.calls.map((call) => call.messageId), ["normal"]);
    env.timers[1].callback();
    assert.deepEqual(env.calls.map((call) => call.messageId), ["normal", "orphan"]);
    assert.equal(env.calls[1].html, orphanElement);

    // Messages without rolls never schedule a fallback.
    coreHook({ id: "plain", rolls: [] }, { element: "plain" });
    assert.equal(env.timers.length, 2);
  } finally {
    env.restore();
  }
});

test("outside dnd5e the core hook renders right away and ready runs the migration", async () => {
  const env = await loadSrbWithTimers("worldbuilding");
  try {
    env.onHandlers.get("renderChatMessageHTML")({ id: "generic", rolls: [{}] }, { element: "generic" });
    assert.deepEqual(env.calls.map((call) => call.messageId), ["generic"]);
    assert.equal(env.timers.length, 0);

    const setCalls = [];
    env.game.user = { isGM: true, isActiveGM: true };
    env.game.settings.set = async (moduleId, key, value) => {
      setCalls.push({ key, value });
      return value;
    };
    env.onceHandlers.get("ready")();
    await Promise.resolve();
    assert.deepEqual(setCalls, [{ key: "visibility", value: "all" }]);
  } finally {
    env.restore();
  }
});
