import { namesOwnTerms } from "../formula-parser.js";
import { localizeSystemTranslation } from "../settings.js";

export function formatSignedNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return value >= 0 ? `+${value}` : String(value);
}

// Texts from lang/<system>_<language>.json, e.g. systemText("Crucible.Boon").
export function systemText(key, data = null) {
  return localizeSystemTranslation(`SRB.${key}`, data);
}

export function countText(baseKey, count) {
  return systemText(`${baseKey}.${count === 1 ? "one" : "other"}`, { count });
}

// Labels stored in roll data are often localization keys of the game system.
export function localizeLabel(label) {
  if (typeof label !== "string") return null;
  const normalized = label.trim();
  if (!normalized) return null;
  const localized = globalThis.game?.i18n?.localize?.(normalized);
  return typeof localized === "string" && localized.trim() ? localized.trim() : normalized;
}

export function isCurrentUserGM() {
  return Boolean(globalThis.game?.user?.isGM);
}

// Matches a class by instanceof when the system exposes it, otherwise by constructor name along the prototype chain.
export function isInstanceOf(value, classRef, className) {
  if (!value || typeof value !== "object") return false;
  if (typeof classRef === "function" && value instanceof classRef) return true;

  let prototype = Object.getPrototypeOf(value);
  while (prototype && prototype !== Object.prototype) {
    if (prototype.constructor?.name === className) return true;
    prototype = Object.getPrototypeOf(prototype);
  }

  return false;
}

export function createItem({ text = null, tag = null, value = null, tooltip = null, muted = false } = {}) {
  return { text, tag, value, tooltip, muted };
}

export function createSection(label, items, { placement = "bottom" } = {}) {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return null;
  return { label, placement, items: filtered };
}

export function createPill(text, { tooltip = null, emphasis = false } = {}) {
  if (!text) return null;
  return { text, tooltip, emphasis };
}

// A modifier row whose label and value come straight from the roll data.
export function createDataModifier({ label, value, detail = null, sourceType = "system", confidence = "exact" }) {
  return {
    expression: formatSignedNumber(value),
    sourceLabel: label,
    sourceDetail: detail,
    sourceType,
    value,
    valueText: formatSignedNumber(value),
    kind: "static",
    confidence
  };
}

export function sumValues(entries) {
  return entries.reduce((total, entry) => total + (Number.isFinite(entry?.value) ? entry.value : 0), 0);
}

export function finalizeBreakdown(breakdown, { sections = [], pills = [], title = null, forceVisible = false } = {}) {
  breakdown.sections = sections.filter(Boolean);
  breakdown.pills = pills.filter(Boolean);
  breakdown.title = title || null;
  if (forceVisible || breakdown.sections.length || breakdown.pills.length) breakdown.hasVisibleContent = true;
  return breakdown;
}

// The breakdown of a roll the system adapter does not know, only when its formula names a term (see namesOwnTerms)
export function keepNamed(breakdown) {
  return namesOwnTerms(breakdown) ? breakdown : null;
}
