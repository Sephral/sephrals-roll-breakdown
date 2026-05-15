import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importFresh, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

function createRoot({ hasBreakdown = false } = {}) {
  const BaseElement = globalThis.HTMLElement;

  class FakeElement extends BaseElement {
    constructor() {
      super();
      this.markup = [];
    }

    querySelector(selector) {
      if (selector === ".message-content") return this.messageContent ?? null;
      if (hasBreakdown && selector === ".srb-breakdown") return {};
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

test("settings load system translations, cache results, and honor render permissions", async () => {
  resetGlobals();

  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      async json() {
        if (String(url).endsWith("dnd5e_en.json")) {
          return {
            "SRB.Rule.Test": "EN {value}",
            "SRB.Rule.Shared": "Shared"
          };
        }

        return {
          "SRB.Rule.Test": "DE {value}"
        };
      }
    };
  };

  const translations = {
    "SRB.Settings.Enabled.Name": "Enabled name",
    "SRB.Settings.Enabled.Hint": "Enabled hint",
    "SRB.Settings.DefaultExpanded.Name": "Expanded name",
    "SRB.Settings.DefaultExpanded.Hint": "Expanded hint",
    "SRB.Settings.PlayersVisible.Name": "Visible name",
    "SRB.Settings.PlayersVisible.Hint": "Visible hint",
    "SRB.Settings.ShowUnknown.Name": "Unknown name",
    "SRB.Settings.ShowUnknown.Hint": "Unknown hint",
    "SRB.Settings.GmOnly.Name": "GM name",
    "SRB.Settings.GmOnly.Hint": "GM hint",
    "SRB.Settings.Debug.Name": "Debug name",
    "SRB.Settings.Debug.Hint": "Debug hint"
  };

  const { game, registrations, settingsValues } = createGameStub({
    lang: "de",
    systemId: "dnd5e",
    settingsValues: {
      enabled: true,
      defaultExpanded: true,
      playersVisible: false,
      showUnknown: false,
      gmOnly: true,
      debug: true
    },
    translations
  });

  globalThis.game = game;

  const settings = await importStable("scripts/settings.js");

  await settings.ensureSystemTranslationsLoaded();
  await settings.ensureSystemTranslationsLoaded();

  assert.equal(fetchCalls.length, 2);
  assert.equal(settings.localizeSystemTranslation("SRB.Rule.Test", { value: "hit" }), "DE hit");
  assert.equal(settings.localizeSystemTranslation("SRB.Rule.Shared"), "Shared");
  assert.equal(settings.localizeSystemTranslation("SRB.Rule.Missing"), "SRB.Rule.Missing");

  settings.registerSettings();
  assert.equal(registrations.length, 6);
  assert.equal(registrations.find((entry) => entry.key === settings.SETTINGS.PLAYERS_VISIBLE).data.scope, "world");
  assert.equal(registrations.find((entry) => entry.key === settings.SETTINGS.GM_ONLY).data.scope, "world");

  game.user.isGM = false;
  assert.equal(settings.shouldRenderForCurrentUser(), false);
  settingsValues.gmOnly = false;
  settingsValues.playersVisible = true;
  assert.equal(settings.shouldRenderForCurrentUser(), true);
  settingsValues.enabled = false;
  assert.equal(settings.shouldRenderForCurrentUser(), false);
  settingsValues.enabled = true;
  game.user.isGM = true;
  assert.equal(settings.shouldRenderForCurrentUser(), true);
  assert.deepEqual(settings.getRenderOptions(), { defaultExpanded: true, showUnknown: false });
  assert.equal(settings.isDebugEnabled(), true);
});

test("roll breakdown service skips hidden cases and renders supported messages", async () => {
  resetGlobals();
  installHTMLElement();

  const consoleCalls = [];
  const originalDebug = console.debug;
  console.debug = (...args) => consoleCalls.push(args);

  try {
    const { game, settingsValues } = createGameStub({
      settingsValues: {
        enabled: true,
        defaultExpanded: false,
        playersVisible: true,
        showUnknown: true,
        gmOnly: false,
        debug: true
      }
    });
    globalThis.game = game;

    const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");

    const adapterCalls = [];
    const rendererCalls = [];
    const service = new RollBreakdownService({
      adapter: {
        supportsMessage(message) {
          adapterCalls.push(["supports", message.id]);
          return message.id === "ok";
        },
        async buildBreakdowns(message) {
          adapterCalls.push(["build", message.id]);
          return message.id === "ok" ? [{ hasVisibleContent: true }] : [];
        }
      },
      renderer: {
        async appendBreakdown(message, html, breakdowns, options) {
          rendererCalls.push({ messageId: message.id, html, breakdowns, options });
          return true;
        }
      }
    });

    await service.enhanceChatMessage({ id: "hidden", visible: false }, createRoot());
    await service.enhanceChatMessage({ id: "duplicate" }, createRoot({ hasBreakdown: true }));

    settingsValues.enabled = false;
    await service.enhanceChatMessage({ id: "disabled" }, createRoot());
    settingsValues.enabled = true;

    await service.enhanceChatMessage({ id: "unsupported" }, createRoot());
    await service.enhanceChatMessage({ id: "ok" }, createRoot());

    assert.deepEqual(adapterCalls, [
      ["supports", "unsupported"],
      ["supports", "ok"],
      ["build", "ok"]
    ]);
    assert.equal(rendererCalls.length, 1);
    assert.deepEqual(rendererCalls[0].options, { defaultExpanded: false, showUnknown: true });
    assert.equal(consoleCalls.length, 5);
  } finally {
    console.debug = originalDebug;
  }
});

test("settings tolerate translation fetch failures and service handles array roots without output", async () => {
  resetGlobals();
  installHTMLElement();

  globalThis.fetch = async () => {
    throw new Error("network");
  };

  const { game, settingsValues } = createGameStub({
    settingsValues: {
      enabled: true,
      defaultExpanded: true,
      playersVisible: true,
      showUnknown: false,
      gmOnly: false,
      debug: false
    },
    translations: {
      "SRB.Chat.Toggle": "Toggle"
    }
  });
  globalThis.game = game;

  const settings = await importStable("scripts/settings.js");
  game.system.id = "pf2e";
  game.i18n.lang = "fr";
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return { ok: false, async json() { return {}; } };
    }

    throw new Error("network");
  };

  assert.deepEqual(await settings.ensureSystemTranslationsLoaded(), {});
  assert.equal(settings.localize("Chat.Toggle"), "Toggle");
  assert.equal(settings.getSetting(settings.SETTINGS.ENABLED), true);

  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const root = createRoot();
  const service = new RollBreakdownService({
    adapter: {
      supportsMessage() {
        return true;
      },
      async buildBreakdowns() {
        return [];
      }
    },
    renderer: {
      async appendBreakdown() {
        throw new Error("renderer should not run");
      }
    }
  });

  await service.enhanceChatMessage({ id: "array-root", isContentVisible: true }, [root]);
  await service.enhanceChatMessage({ id: "no-root" }, { not: "an element" });

  settingsValues.showUnknown = true;
  assert.deepEqual(settings.getRenderOptions(), { defaultExpanded: true, showUnknown: true });
});