import { GenericRollAdapter } from "./adapters/generic-adapter.js";
import { ChatCardRenderer } from "./chat-card-renderer.js";
import { RollBreakdownService } from "./roll-breakdown-service.js";
import { ensureSystemTranslationsLoaded, MODULE_ID, registerSettings } from "./settings.js";
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
  void ensureSystemTranslationsLoaded();
  if (typeof loadTemplates === "function") {
    void loadTemplates([`modules/${MODULE_ID}/templates/breakdown-panel.hbs`]);
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  void service.enhanceChatMessage(message, html);
});