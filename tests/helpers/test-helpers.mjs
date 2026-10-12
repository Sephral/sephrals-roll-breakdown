import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(TEST_HELPERS_DIR, "..", "..");

export function modulePath(...segments) {
  return path.join(MODULE_ROOT, ...segments);
}

export async function importFresh(relativePath) {
  const href = pathToFileURL(modulePath(relativePath)).href;
  return import(`${href}?test=${Date.now()}-${Math.random()}`);
}

export async function importStable(relativePath) {
  return import(pathToFileURL(modulePath(relativePath)).href);
}

export function resetGlobals() {
  for (const key of [
    "game",
    "ui",
    "foundry",
    "Hooks",
    "loadTemplates",
    "renderTemplate",
    "fetch",
    "Roll",
    "fromUuid",
    "HTMLElement",
    "document",
    "window"
  ]) {
    delete globalThis[key];
  }
}

export function formatText(template, data = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => {
    const value = data[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function createGameStub({
  lang = "en",
  systemId = "generic",
  settingsValues = {},
  translations = {}
} = {}) {
  const registrations = [];
  const chatRenderCalls = [];
  const setCalls = [];
  const settings = {
    register(moduleId, key, data) {
      this.settings.set(`${moduleId}.${key}`, data);
      registrations.push({ moduleId, key, data });
    },
    // Values in settingsValues count as stored, everything else falls back to the registered default.
    get(moduleId, key, { document = false } = {}) {
      const stored = Object.hasOwn(settingsValues, key);
      const value = stored ? settingsValues[key] : this.settings.get(`${moduleId}.${key}`)?.default;
      if (document) return { _id: stored ? `setting-${key}` : null, key: `${moduleId}.${key}`, value };
      return value;
    },
    async set(moduleId, key, value) {
      setCalls.push({ moduleId, key, value });
      settingsValues[key] = value;
      return value;
    },
    settings: new Map(),
    menus: new Map()
  };

  const ui = {
    chat: {
      render(force) {
        chatRenderCalls.push(force);
      }
    }
  };

  const game = {
    system: { id: systemId },
    i18n: {
      lang,
      localize(key) {
        return translations[key] ?? key;
      },
      format(key, data) {
        return formatText(translations[key] ?? key, data);
      }
    },
    settings,
    user: { isGM: false, isActiveGM: false }
  };

  return { game, settings, settingsValues, registrations, setCalls, ui, chatRenderCalls };
}

export function installHTMLElement() {
  class TestHTMLElement {}
  globalThis.HTMLElement = TestHTMLElement;
  return TestHTMLElement;
}

export function createHooksStub() {
  const onceHandlers = new Map();
  const onHandlers = new Map();
  globalThis.Hooks = {
    once(event, callback) {
      onceHandlers.set(event, callback);
    },
    on(event, callback) {
      onHandlers.set(event, callback);
    }
  };
  return { onceHandlers, onHandlers };
}