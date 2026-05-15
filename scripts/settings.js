export const MODULE_ID = "sephrals-roll-breakdown";

export const SETTINGS = {
  ENABLED: "enabled",
  DEFAULT_EXPANDED: "defaultExpanded",
  PLAYERS_VISIBLE: "playersVisible",
  SHOW_UNKNOWN: "showUnknown",
  GM_ONLY: "gmOnly",
  DEBUG: "debug"
};

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

function getSystemTranslationLanguages() {
  const activeLanguage = String(game.i18n?.lang ?? "en").trim() || "en";
  return [...new Set(activeLanguage === "en" ? ["en"] : ["en", activeLanguage])];
}

export async function ensureSystemTranslationsLoaded() {
  const systemId = String(game.system?.id ?? "").trim();
  if (!systemId) return;

  const cacheKey = `${systemId}:${String(game.i18n?.lang ?? "en").trim() || "en"}`;
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
  const cacheKey = `${systemId}:${String(game.i18n?.lang ?? "en").trim() || "en"}`;
  const translations = systemTranslationData.get(cacheKey);
  const template = translations?.[key];
  if (typeof template !== "string") return key;
  return formatSystemTranslation(template, data);
}

function registerBooleanSetting(key, nameKey, hintKey, defaultValue, scope = "client") {
  game.settings.register(MODULE_ID, key, {
    name: game.i18n.localize(`SRB.${nameKey}`),
    hint: game.i18n.localize(`SRB.${hintKey}`),
    scope,
    config: true,
    type: Boolean,
    default: defaultValue
  });
}

export function registerSettings() {
  registerBooleanSetting(SETTINGS.ENABLED, "Settings.Enabled.Name", "Settings.Enabled.Hint", true);
  registerBooleanSetting(SETTINGS.DEFAULT_EXPANDED, "Settings.DefaultExpanded.Name", "Settings.DefaultExpanded.Hint", false);
  registerBooleanSetting(SETTINGS.PLAYERS_VISIBLE, "Settings.PlayersVisible.Name", "Settings.PlayersVisible.Hint", true, "world");
  registerBooleanSetting(SETTINGS.SHOW_UNKNOWN, "Settings.ShowUnknown.Name", "Settings.ShowUnknown.Hint", true);
  registerBooleanSetting(SETTINGS.GM_ONLY, "Settings.GmOnly.Name", "Settings.GmOnly.Hint", false, "world");
  registerBooleanSetting(SETTINGS.DEBUG, "Settings.Debug.Name", "Settings.Debug.Hint", false);
}

export function localize(key) {
  return game.i18n.localize(`SRB.${key}`);
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