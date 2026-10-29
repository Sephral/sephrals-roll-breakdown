import { AdapterRegistry, createApi } from "./adapter-registry.js";
import { CrucibleRollAdapter } from "./adapters/crucible-adapter.js";
import { GenericRollAdapter } from "./adapters/generic-adapter.js";
import { Pf2eRollAdapter } from "./adapters/pf2e-adapter.js";
import { SwadeRollAdapter } from "./adapters/swade-adapter.js";
import { ChatCardRenderer } from "./chat-card-renderer.js";
import { debugTrace, registerDebug } from "./debug.js";
import { saveDebugFile } from "./debug-file.mjs";
import { applyGmRollPrivacy, isOwnHiddenGmRoll, PRIVACY_KINDS } from "./gm-roll-privacy.js";
import { RollBreakdownService } from "./roll-breakdown-service.js";
import { BreakdownStore } from "./stored-breakdown.js";
import {
  ensureModuleTranslationsLoaded,
  ensureSystemTranslationsLoaded,
  migrateLegacyVisibility,
  MODULE_ID,
  registerSettings,
  SETTINGS
} from "./settings.js";
import { Dnd5eRollAdapter, rememberRollContext } from "./adapters/dnd5e-adapter.js";
import { noticeNewVersions, runSelfTest } from "./selftest.js";
import { countFeature, registerUsage } from "./usage.mjs";

// How long the core hook waits for dnd5e's own render hook before it renders the panel itself.
// Systems such as Crucible finish their chat card after the render hook. The panel waits until the card is
// in the chat log, at most for this grace period.
const SYSTEM_HOOK_GRACE_MS = 1000;
const CARD_POLL_MS = 50;

const registry = new AdapterRegistry();
registry.register("dnd5e", new Dnd5eRollAdapter());
registry.register("crucible", new CrucibleRollAdapter());
registry.register("pf2e", new Pf2eRollAdapter());
registry.register("swade", new SwadeRollAdapter());

function createAdapter() {
  return registry.resolve(game.system?.id, new GenericRollAdapter());
}

const api = createApi({
  registry,
  onRegister(systemId, adapter) {
    // Adapters registered after init take over right away for the running system.
    if (systemId === game.system?.id) service.adapter = adapter;
  },
  runSelfTest: (options) => runSelfTest(service, options),
  saveDebugFile: (messageId) => saveDebugFile(messageId ?? null, { moduleId: MODULE_ID }),
  getBreakdown: (messageOrId) => {
    const message = typeof messageOrId === "string" ? game.messages?.get?.(messageOrId) : messageOrId;
    return service.getBreakdowns(message ?? null);
  }
});

function whenCardIsFinished(html, callback) {
  const root = html?.[0] ?? html;
  const startedAt = Date.now();
  const check = () => {
    if (root?.isConnected || Date.now() - startedAt >= SYSTEM_HOOK_GRACE_MS) {
      callback();
      return;
    }
    setTimeout(check, CARD_POLL_MS);
  };
  setTimeout(check, 0);
}

const service = new RollBreakdownService({
  adapter: new GenericRollAdapter(),
  renderer: new ChatCardRenderer(),
  trace: debugTrace
});

const store = new BreakdownStore({
  getAdapter: () => service.adapter,
  log: (message, extra) => service.log(message, extra)
});

// Chat elements that dnd5e.renderChatMessage has already handed to the service.
const systemHookElements = new WeakSet();

Hooks.once("init", () => {
  service.adapter = createAdapter();
  const module = game.modules?.get?.(MODULE_ID);
  if (module) module.api = api;
  registerSettings();
  registerDebug(service);
  registerUsage(MODULE_ID, {
    features: ["panelOpened", "panelSettings", "selfTestRun", "gmRollHidden"],
    settings: [SETTINGS.VISIBILITY, SETTINGS.DEFAULT_EXPANDED, SETTINGS.HIDE_NPC_ROLLS, SETTINGS.GM_ROLL_PRIVACY, SETTINGS.GM_ROLL_PUBLIC, SETTINGS.GM_ROLL_PRIVATE]
  });
  void ensureModuleTranslationsLoaded();
  void ensureSystemTranslationsLoaded();
  // The globals are deprecated since v13 and removed in v15.
  const preloadTemplates = globalThis.foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  if (typeof preloadTemplates === "function") {
    void preloadTemplates([`modules/${MODULE_ID}/templates/breakdown-panel.hbs`]);
  }
});

Hooks.once("ready", () => {
  void migrateLegacyVisibility();
  noticeNewVersions();
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  // Players see GM rolls without formula and dice, private GM rolls not at all
  if (applyGmRollPrivacy(message, html, service.adapter) === PRIVACY_KINDS.PRIVATE) return;

  if (game.system?.id !== "dnd5e") {
    if (service.adapter?.waitForCard && html && typeof html === "object") {
      whenCardIsFinished(html, () => void service.enhanceChatMessage(message, html));
      return;
    }
    void service.enhanceChatMessage(message, html);
    return;
  }

  // dnd5e rewrites the content of usage cards after this hook (e.g. Midi-QOL merged attack/damage cards),
  // which would drop the panel again. In dnd5e worlds the system hook below handles every message instead.
  // Safety net: if that hook does not fire for a roll message (e.g. renamed in a later dnd5e version),
  // render from here once dnd5e is done with the card.
  const rolls = service.adapter?.getMessageRolls?.(message) ?? message?.rolls ?? [];
  if (!rolls.length || !html || typeof html !== "object") return;
  setTimeout(() => {
    if (systemHookElements.has(html)) return;
    service.log("dnd5e.renderChatMessage did not fire, using the core render hook.", { messageId: message.id });
    void service.enhanceChatMessage(message, html);
  }, SYSTEM_HOOK_GRACE_MS);
});

// The situational bonus of the roll dialog and the chosen ability are not on the card, keep them in the roll options.
Hooks.on("dnd5e.postRollConfiguration", (rolls, config) => {
  if (game.system?.id === "dnd5e") rememberRollContext(rolls, config);
});

Hooks.on("dnd5e.renderChatMessage", (message, html) => {
  if (html && typeof html === "object") systemHookElements.add(html);
  void service.enhanceChatMessage(message, html);
});

// The client that adds rolls to a message stores their breakdown on it (adapters with storeBreakdowns).
Hooks.on("createChatMessage", (message, options, userId) => {
  store.onCreate(message, options, userId);
  if (game.user?.isGM && isOwnHiddenGmRoll(message, service.adapter)) countFeature(MODULE_ID, "gmRollHidden");
});

Hooks.on("updateChatMessage", (message, changes, options, userId) => {
  store.onUpdate(message, changes, options, userId);
});
