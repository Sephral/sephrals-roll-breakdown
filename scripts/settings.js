import { registerDebugMenu } from "./debug-file.mjs";

export const MODULE_ID = "sephrals-roll-breakdown";

export const SETTINGS = {
  UI_LANGUAGE: "uiLanguage",
  ENABLED: "enabled",
  DEFAULT_EXPANDED: "defaultExpanded",
  VISIBILITY: "visibility",
  HIDE_NPC_ROLLS: "hideNpcRolls",
  SHOW_UNKNOWN: "showUnknown",
  DEBUG: "debug",
  ACKNOWLEDGED_VERSIONS: "acknowledgedVersions",
  // Replaced by VISIBILITY. Still registered (hidden) so stored values stay readable for the migration.
  PLAYERS_VISIBLE: "playersVisible",
  GM_ONLY: "gmOnly"
};

export const VISIBILITY_MODES = Object.freeze({
  GM: "gm",
  OWNERS: "owners",
  ALL: "all"
});

const SUPPORTED_UI_LANGUAGES = Object.freeze(["en", "de"]);
const DEFAULT_UI_LANGUAGE = "en";
const moduleTranslationLoads = new Map();
const moduleTranslationData = new Map();
const systemTranslationLoads = new Map();
const systemTranslationData = new Map();

async function fetchTranslations(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function getRegisteredSettingValue(settingKey, fallback) {
  const fullKey = `${MODULE_ID}.${settingKey}`;
  if (!game?.settings?.settings?.has(fullKey)) return fallback;

  try {
    return game.settings.get(MODULE_ID, settingKey);
  } catch {
    return fallback;
  }
}

export function normalizeUiLanguage(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_UI_LANGUAGE;
  if (SUPPORTED_UI_LANGUAGES.includes(normalized)) return normalized;

  const baseLanguage = normalized.split(/[-_.]/)[0];
  return SUPPORTED_UI_LANGUAGES.includes(baseLanguage) ? baseLanguage : DEFAULT_UI_LANGUAGE;
}

export function getPreferredLanguage() {
  return getRegisteredSettingValue(SETTINGS.UI_LANGUAGE, "default");
}

function getRequestedLanguage(preferredLanguage = getPreferredLanguage()) {
  if (SUPPORTED_UI_LANGUAGES.includes(preferredLanguage)) return preferredLanguage;
  return String(game.i18n?.lang ?? DEFAULT_UI_LANGUAGE).trim().toLowerCase() || DEFAULT_UI_LANGUAGE;
}

export function getModuleLanguage(preferredLanguage = getPreferredLanguage()) {
  if (SUPPORTED_UI_LANGUAGES.includes(preferredLanguage)) return preferredLanguage;
  return normalizeUiLanguage(game.i18n?.lang);
}

function getTranslationCacheKey(preferredLanguage = getPreferredLanguage()) {
  return getRequestedLanguage(preferredLanguage);
}

function getTranslationLanguages(preferredLanguage = getPreferredLanguage()) {
  const requestedLanguage = getRequestedLanguage(preferredLanguage);
  const normalizedLanguage = normalizeUiLanguage(requestedLanguage);

  return [...new Set(
    normalizedLanguage === "en"
      ? ["en", requestedLanguage]
      : ["en", requestedLanguage, normalizedLanguage]
  )];
}

export async function ensureModuleTranslationsLoaded(language = getModuleLanguage()) {
  const cacheKey = getTranslationCacheKey(language);
  if (moduleTranslationLoads.has(cacheKey)) return moduleTranslationLoads.get(cacheKey);

  const promise = (async () => {
    const translations = {};
    for (const currentLanguage of getTranslationLanguages(language)) {
      Object.assign(translations, await fetchTranslations(`modules/${MODULE_ID}/lang/${currentLanguage}.json`) ?? {});
    }

    moduleTranslationData.set(cacheKey, translations);
    return translations;
  })();

  moduleTranslationLoads.set(cacheKey, promise);
  return promise;
}

function getSystemTranslationLanguages() {
  return getTranslationLanguages();
}

export async function ensureSystemTranslationsLoaded() {
  const systemId = String(game.system?.id ?? "").trim();
  if (!systemId) return;

  const cacheKey = `${systemId}:${getTranslationCacheKey()}`;
  if (systemTranslationLoads.has(cacheKey)) return systemTranslationLoads.get(cacheKey);

  const promise = (async () => {
    const translations = {};
    for (const language of getSystemTranslationLanguages()) {
      Object.assign(translations, await fetchTranslations(`modules/${MODULE_ID}/lang/${systemId}_${language}.json`) ?? {});
    }

    systemTranslationData.set(cacheKey, translations);
    return translations;
  })();

  systemTranslationLoads.set(cacheKey, promise);
  return promise;
}

function formatSystemTranslation(template, data) {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = data[token];
    return value === undefined || value === null ? match : String(value);
  });
}

export function localizeSystemTranslation(key, data) {
  const systemId = String(game.system?.id ?? "").trim();
  const cacheKey = `${systemId}:${getTranslationCacheKey()}`;
  const translations = systemTranslationData.get(cacheKey);
  const template = translations?.[key];
  if (typeof template !== "string") return key;
  return formatSystemTranslation(template, data);
}

function formatModuleTranslation(template, data) {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = data[token];
    return value === undefined || value === null ? match : String(value);
  });
}

// Rendering the chat log does not redraw its messages, so messages that show a panel are rendered again.
function refreshLocalizedUi() {
  ui?.chat?.render?.(true);
  const panels = globalThis.document?.querySelectorAll?.(".srb-breakdown[data-message-id]") ?? [];
  const messageIds = new Set(Array.from(panels, (panel) => panel?.dataset?.messageId).filter(Boolean));
  for (const messageId of messageIds) {
    const message = game.messages?.get?.(messageId);
    if (message) void ui?.chat?.updateMessage?.(message);
  }
}

function registerBooleanSetting(key, nameKey, hintKey, defaultValue, scope = "client") {
  game.settings.register(MODULE_ID, key, {
    name: localize(nameKey),
    hint: localize(hintKey),
    scope,
    config: true,
    type: Boolean,
    default: defaultValue
  });
}

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.UI_LANGUAGE, {
    name: game.i18n.localize("SRB.Settings.Language.Name"),
    hint: game.i18n.localize("SRB.Settings.Language.Hint"),
    scope: "client",
    config: true,
    type: String,
    default: "default",
    choices: {
      default: game.i18n.localize("SRB.Language.Default"),
      de: game.i18n.localize("SRB.Language.De"),
      en: game.i18n.localize("SRB.Language.En")
    },
    onChange: () => {
      return Promise.all([ensureModuleTranslationsLoaded(), ensureSystemTranslationsLoaded()]).then(() => refreshLocalizedUi());
    }
  });

  registerBooleanSetting(SETTINGS.ENABLED, "Settings.Enabled.Name", "Settings.Enabled.Hint", true);
  registerBooleanSetting(SETTINGS.DEFAULT_EXPANDED, "Settings.DefaultExpanded.Name", "Settings.DefaultExpanded.Hint", false);
  game.settings.register(MODULE_ID, SETTINGS.VISIBILITY, {
    name: localize("Settings.Visibility.Name"),
    hint: localize("Settings.Visibility.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: VISIBILITY_MODES.ALL,
    choices: {
      [VISIBILITY_MODES.GM]: localize("Visibility.Gm"),
      [VISIBILITY_MODES.OWNERS]: localize("Visibility.Owners"),
      [VISIBILITY_MODES.ALL]: localize("Visibility.All")
    }
  });
  registerBooleanSetting(SETTINGS.HIDE_NPC_ROLLS, "Settings.HideNpcRolls.Name", "Settings.HideNpcRolls.Hint", true, "world");
  registerBooleanSetting(SETTINGS.SHOW_UNKNOWN, "Settings.ShowUnknown.Name", "Settings.ShowUnknown.Hint", true);
  registerBooleanSetting(SETTINGS.DEBUG, "Settings.Debug.Name", "Settings.Debug.Hint", false);

  for (const [key, defaultValue] of [[SETTINGS.PLAYERS_VISIBLE, true], [SETTINGS.GM_ONLY, false]]) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Boolean, default: defaultValue });
  }
  game.settings.register(MODULE_ID, SETTINGS.ACKNOWLEDGED_VERSIONS, { scope: "client", config: false, type: String, default: "" });

  // The unit tests register the settings without Foundry's application classes.
  if (!globalThis.foundry?.applications?.api || typeof game.settings.registerMenu !== "function") return;
  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: localize("SelfTest.Title"),
    label: localize("SelfTest.Run"),
    hint: localize("SelfTest.Hint"),
    icon: "fa-solid fa-stethoscope",
    type: class RollBreakdownSelfTestMenu extends foundry.applications.api.ApplicationV2 {
      async render() {
        if (game.user?.isGM) await game.modules.get(MODULE_ID)?.api?.runSelfTest();
        return this;
      }
    },
    restricted: true
  });
  registerDebugMenu(MODULE_ID, { name: localize("Debug.Title"), label: localize("Debug.Save"), hint: localize("Debug.Hint") });
}

export function localize(key, data = null) {
  // Bundled translations only override Foundry's own when a language was picked explicitly,
  // so "Follow Foundry" keeps community translations from game.i18n.
  const explicitLanguage = SUPPORTED_UI_LANGUAGES.includes(getPreferredLanguage());
  const template = explicitLanguage ? moduleTranslationData.get(getTranslationCacheKey())?.[`SRB.${key}`] : undefined;
  if (typeof template === "string") return formatModuleTranslation(template, data);
  if (data) return game.i18n.format(`SRB.${key}`, data);
  return game.i18n.localize(`SRB.${key}`);
}

export function resetTranslationCaches() {
  moduleTranslationLoads.clear();
  moduleTranslationData.clear();
  systemTranslationLoads.clear();
  systemTranslationData.clear();
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function isDebugEnabled() {
  return Boolean(getSetting(SETTINGS.DEBUG));
}

function hasStoredWorldValue(settingKey) {
  try {
    return Boolean(game.settings.get(MODULE_ID, settingKey, { document: true })?._id);
  } catch {
    return false;
  }
}

// Both old world toggles hid the panel from players, so either one maps to "GM only".
function getLegacyVisibilityMode() {
  const gmOnly = getRegisteredSettingValue(SETTINGS.GM_ONLY, false);
  const playersVisible = getRegisteredSettingValue(SETTINGS.PLAYERS_VISIBLE, true);
  return gmOnly || !playersVisible ? VISIBILITY_MODES.GM : VISIBILITY_MODES.ALL;
}

export function getVisibilityMode() {
  // Until a GM has run the migration, the old toggles still decide.
  if (!hasStoredWorldValue(SETTINGS.VISIBILITY)) return getLegacyVisibilityMode();
  const mode = getRegisteredSettingValue(SETTINGS.VISIBILITY, VISIBILITY_MODES.ALL);
  return Object.values(VISIBILITY_MODES).includes(mode) ? mode : VISIBILITY_MODES.ALL;
}

export function shouldHideNpcRolls() {
  return Boolean(getRegisteredSettingValue(SETTINGS.HIDE_NPC_ROLLS, true));
}

export async function migrateLegacyVisibility() {
  if (!game.user?.isActiveGM || hasStoredWorldValue(SETTINGS.VISIBILITY)) return false;

  try {
    await game.settings.set(MODULE_ID, SETTINGS.VISIBILITY, getLegacyVisibilityMode());
    return true;
  } catch (error) {
    console.warn("[SRB] Could not migrate the visibility setting.", error);
    return false;
  }
}

export function shouldRenderForCurrentUser() {
  if (!getSetting(SETTINGS.ENABLED)) return false;
  if (game.user?.isGM) return true;
  return getVisibilityMode() !== VISIBILITY_MODES.GM;
}

export function getRenderOptions() {
  return {
    defaultExpanded: Boolean(getSetting(SETTINGS.DEFAULT_EXPANDED)),
    showUnknown: Boolean(getSetting(SETTINGS.SHOW_UNKNOWN))
  };
}

// Whether the current user finds settings of this module in the settings dialog.
export function hasOwnSettings() {
  if (game.user?.isGM) return true;
  return Array.from(game.settings.settings.values()).some((setting) => setting.namespace === MODULE_ID && setting.config && setting.scope !== "world");
}

// Opens Foundry's settings on the tab of this module.
export async function openModuleSettings() {
  const sheet = game.settings.sheet;
  await sheet.render({ force: true });
  try {
    sheet.changeTab(MODULE_ID, "categories");
  } catch (error) {
    console.warn(`${MODULE_ID} | The settings have no tab for this module`, error);
  }
  sheet.bringToFront?.();
}
