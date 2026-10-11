import { GenericRollAdapter } from "./adapters/generic-adapter.js";
import { ChatCardRenderer } from "./chat-card-renderer.js";
import { RollBreakdownService } from "./roll-breakdown-service.js";
import { ensureModuleTranslationsLoaded, ensureSystemTranslationsLoaded, MODULE_ID, registerSettings } from "./settings.js";
import { Dnd5eRollAdapter } from "./adapters/dnd5e-adapter.js";

function createAdapter() {
  if (game.system?.id === "dnd5e") return new Dnd5eRollAdapter();
  return new GenericRollAdapter();
}

const service = new RollBreakdownService({
  adapter: new GenericRollAdapter(),
  renderer: new ChatCardRenderer()
});

Hooks.once("init", () => {
  service.adapter = createAdapter();
  registerSettings();
  void ensureModuleTranslationsLoaded();
  void ensureSystemTranslationsLoaded();
  // The globals are deprecated since v13 and removed in v15.
  const preloadTemplates = globalThis.foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  if (typeof preloadTemplates === "function") {
    void preloadTemplates([`modules/${MODULE_ID}/templates/breakdown-panel.hbs`]);
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  // dnd5e rewrites the content of usage cards after this hook (e.g. Midi-QOL merged attack/damage cards),
  // which would drop the panel again. In dnd5e worlds the system hook below handles every message instead.
  if (game.system?.id === "dnd5e") return;
  void service.enhanceChatMessage(message, html);
});

Hooks.on("dnd5e.renderChatMessage", (message, html) => {
  void service.enhanceChatMessage(message, html);
});