export const MODULE_ID = "sephrals-roll-breakdown";

export const SETTINGS = {
  UI_LANGUAGE: "uiLanguage",
  ENABLED: "enabled",
  DEFAULT_EXPANDED: "defaultExpanded",
  PLAYERS_VISIBLE: "playersVisible",
  SHOW_UNKNOWN: "showUnknown",
  GM_ONLY: "gmOnly",
  DEBUG: "debug"
};

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

function refreshLocalizedUi() {
  ui?.chat?.render?.(true);
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
  registerBooleanSetting(SETTINGS.PLAYERS_VISIBLE, "Settings.PlayersVisible.Name", "Settings.PlayersVisible.Hint", true, "world");
  registerBooleanSetting(SETTINGS.SHOW_UNKNOWN, "Settings.ShowUnknown.Name", "Settings.ShowUnknown.Hint", true);
  registerBooleanSetting(SETTINGS.GM_ONLY, "Settings.GmOnly.Name", "Settings.GmOnly.Hint", false, "world");
  registerBooleanSetting(SETTINGS.DEBUG, "Settings.Debug.Name", "Settings.Debug.Hint", false);
}

export function localize(key, data = null) {
  const template = moduleTranslationData.get(getTranslationCacheKey())?.[`SRB.${key}`];
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

export function shouldRenderForCurrentUser() {
  if (!getSetting(SETTINGS.ENABLED)) return false;
  if (game.user?.isGM) return true;
  if (getSetting(SETTINGS.GM_ONLY)) return false;
  return Boolean(getSetting(SETTINGS.PLAYERS_VISIBLE));
}

export function getRenderOptions() {
  return {
    defaultExpanded: Boolean(getSetting(SETTINGS.DEFAULT_EXPANDED)),
    showUnknown: Boolean(getSetting(SETTINGS.SHOW_UNKNOWN))
  };
}