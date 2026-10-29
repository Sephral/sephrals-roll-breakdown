import { parseRoll, summarizeBreakdown, toFiniteNumber } from "./formula-parser.js";

function normalizeSystemId(systemId) {
  return typeof systemId === "string" ? systemId.trim() : "";
}

export function isValidAdapter(adapter) {
  return Boolean(adapter)
    && typeof adapter === "object"
    && typeof adapter.supportsMessage === "function"
    && typeof adapter.buildBreakdowns === "function";
}

// Adapters per game system. Built-in adapters and adapters from other modules share this map,
// a later registration for the same system replaces the earlier one.
export class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(systemId, adapter) {
    const id = normalizeSystemId(systemId);
    if (!id) throw new TypeError("Roll Breakdown: registerAdapter needs a system id.");
    if (!isValidAdapter(adapter)) {
      throw new TypeError("Roll Breakdown: an adapter needs the functions supportsMessage(message) and buildBreakdowns(message).");
    }

    this.adapters.set(id, adapter);
    return adapter;
  }

  get(systemId) {
    return this.adapters.get(normalizeSystemId(systemId)) ?? null;
  }

  has(systemId) {
    return this.adapters.has(normalizeSystemId(systemId));
  }

  resolve(systemId, fallback) {
    return this.get(systemId) ?? fallback;
  }
}

function toText(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function toObjectList(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : [];
}

function normalizeItem(item) {
  return {
    text: toText(item.text),
    tag: toText(item.tag),
    value: toText(item.value),
    tooltip: toText(item.tooltip),
    muted: Boolean(item.muted)
  };
}

function normalizeSection(section) {
  return {
    label: toText(section.label),
    placement: section.placement === "top" ? "top" : "bottom",
    items: toObjectList(section.items).map(normalizeItem).filter((item) => item.text || item.tag || item.value)
  };
}

function normalizePill(pill) {
  return {
    text: toText(pill.text),
    tooltip: toText(pill.tooltip),
    emphasis: Boolean(pill.emphasis)
  };
}

const EMPTY_SUMMARY = Object.freeze({
  labeledTermCount: 0,
  derivedModifierCount: 0,
  computedTermCount: 0,
  unresolvedTermCount: 0
});

// Fills the fields the panel needs, so adapters from other modules only have to provide what they know.
export function normalizeBreakdown(breakdown) {
  const source = breakdown && typeof breakdown === "object" ? breakdown : {};
  const rollTotal = toFiniteNumber(source.rollTotal);
  return {
    ...source,
    formula: String(source.formula ?? "").trim(),
    title: toText(source.title),
    diceTerms: toObjectList(source.diceTerms),
    modifiers: toObjectList(source.modifiers),
    computedTerms: toObjectList(source.computedTerms),
    unresolvedTerms: toObjectList(source.unresolvedTerms),
    sourceSummary: source.sourceSummary && typeof source.sourceSummary === "object"
      ? { ...EMPTY_SUMMARY, ...source.sourceSummary }
      : { ...EMPTY_SUMMARY },
    advantageContext: source.advantageContext ?? null,
    sections: toObjectList(source.sections).map(normalizeSection).filter((section) => section.items.length > 0),
    pills: toObjectList(source.pills).map(normalizePill).filter((pill) => pill.text),
    rollTotal: source.rollTotal === null || source.rollTotal === undefined ? null : rollTotal
  };
}

// Public API on game.modules.get("sephrals-roll-breakdown").api
export function createApi({ registry, onRegister, runSelfTest, saveDebugFile, getBreakdown }) {
  return Object.freeze({
    registerAdapter(systemId, adapter) {
      const registered = registry.register(systemId, adapter);
      onRegister?.(normalizeSystemId(systemId), registered);
      return registered;
    },
    getAdapter(systemId) {
      return registry.get(systemId);
    },
    parseRoll(roll, options = {}) {
      return parseRoll(roll, options);
    },
    summarizeBreakdown(breakdown) {
      return summarizeBreakdown(breakdown);
    },
    runSelfTest(options) {
      return runSelfTest?.(options);
    },
    // One file for all of Sephral's modules, without a message id about their latest picture
    saveDebugFile(messageId) {
      return saveDebugFile?.(messageId);
    },
    // Every breakdown of a chat message (or its id), as stored when the roll was made where a copy exists
    async getBreakdown(messageOrId) {
      return (await getBreakdown?.(messageOrId)) ?? [];
    }
  });
}
