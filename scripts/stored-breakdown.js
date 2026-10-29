import { getMessageRolls } from "./roll-actors.js";
import { getModuleLanguage, MODULE_ID } from "./settings.js";

// The breakdown as it was when the roll was made. Adapters that read the current state of actors, items and effects
// (dnd5e) set storeBreakdowns: the client that adds a roll to a message stores a compact copy of its breakdown in
// flags.sephrals-roll-breakdown.breakdown. Later renders use that copy, so an expired effect still shows up on the
// cards it affected. Each roll keeps its entry as long as the roll itself stays the same.
//
// Flag format (version 1):
// { v: 1, adapter: "dnd5e", lang: "en", rolls: [{ s: "<roll signature>", b: <breakdown> }, { s: "..." }] }
// One entry per roll of the message in the order of the rolls. An entry without b means "no panel for this roll".

export const STORE_KEY = "breakdown";
export const STORE_VERSION = 1;
// Chat messages load into every client at startup, so a copy that grows past this size is not stored.
const MAX_STORED_LENGTH = 24000;
// Kept on the breakdown itself, everything else of the adapter's object is stored as it is.
const DERIVED_KEYS = new Set(["adapterId", "rollIndex", "hasVisibleContent", "stored"]);

export function adapterStoresBreakdowns(adapter) {
  return adapter?.storeBreakdowns === true;
}

// FNV-1a over formula, total and every die result: a reroll or another roll at the same index gets a new signature.
export function rollSignature(roll) {
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const results = dice.map((die) => (Array.isArray(die?.results) ? die.results : [])
    .map((result) => `${result?.result}${result?.active === false || result?.discarded ? "x" : ""}`).join(",")).join(";");
  const text = `${roll?.formula ?? ""}|${roll?.total ?? ""}|${results}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// Drops empty values: null, undefined, false, empty strings, arrays and objects. The panel fills them in again.
function compactValue(value) {
  if (Array.isArray(value)) {
    const list = value.map(compactValue).filter((entry) => entry !== undefined);
    return list.length ? list : undefined;
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const compacted = compactValue(entry);
      if (compacted !== undefined) result[key] = compacted;
    }
    return Object.keys(result).length ? result : undefined;
  }
  if (value === null || value === undefined || value === false || value === "") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return undefined;
  return value;
}

export function compactBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return null;
  const source = {};
  for (const [key, value] of Object.entries(breakdown)) {
    if (!DERIVED_KEYS.has(key)) source[key] = value;
  }
  return compactValue(source) ?? {};
}

export function restoreBreakdown(stored, rollIndex, adapterId = null) {
  const breakdown = structuredClone(stored ?? {});
  breakdown.rollIndex = rollIndex;
  breakdown.adapterId = adapterId;
  breakdown.hasVisibleContent = true;
  breakdown.stored = true;
  breakdown.totalStaticModifier ??= 0;
  if (breakdown.advantageContext && typeof breakdown.advantageContext === "object") {
    breakdown.advantageContext.attributions = Array.isArray(breakdown.advantageContext.attributions) ? breakdown.advantageContext.attributions : [];
    breakdown.advantageContext.state ??= "normal";
  }
  return breakdown;
}

export function readStoreFlag(message) {
  const data = message?.flags?.[MODULE_ID]?.[STORE_KEY];
  if (!data || typeof data !== "object" || data.v !== STORE_VERSION || !Array.isArray(data.rolls)) return null;
  return data;
}

// Per roll index: undefined (nothing stored for this roll as it is now), null (stored: no panel) or the breakdown.
export function readStoredBreakdowns(message, rolls) {
  const data = readStoreFlag(message);
  if (!data) return null;
  return rolls.map((roll, index) => {
    const entry = data.rolls[index];
    if (!entry || typeof entry !== "object" || entry.s !== rollSignature(roll)) return undefined;
    return entry.b && typeof entry.b === "object" ? restoreBreakdown(entry.b, index, data.adapter ?? null) : null;
  });
}

function isComplete(stored) {
  return Array.isArray(stored) && stored.every((entry) => entry !== undefined);
}

// Stored entries win, live breakdowns fill the rolls that have none.
export function mergeBreakdowns(stored, live) {
  if (!Array.isArray(stored)) return Array.isArray(live) ? live : [];
  const liveByIndex = new Map((Array.isArray(live) ? live : []).map((breakdown, position) => [
    Number.isInteger(breakdown?.rollIndex) ? breakdown.rollIndex : position,
    breakdown
  ]));
  return stored.map((entry, index) => (entry === undefined ? liveByIndex.get(index) ?? null : entry)).filter(Boolean);
}

// All breakdowns of a message: the stored copy where it matches the rolls, live breakdowns for the rest.
export async function resolveBreakdowns(adapter, message) {
  if (!adapterStoresBreakdowns(adapter)) return adapter.buildBreakdowns(message);
  const stored = readStoredBreakdowns(message, getMessageRolls(message, adapter));
  if (isComplete(stored)) return stored.filter(Boolean);
  const live = await adapter.buildBreakdowns(message);
  return stored ? mergeBreakdowns(stored, live) : live;
}

// The flag for the rolls of a message, or null when nothing changes or nothing is worth storing.
export function buildStoreFlag(message, rolls, live, { adapterId = null, lang = null } = {}) {
  const previous = readStoreFlag(message);
  const liveByIndex = new Map((Array.isArray(live) ? live : []).map((breakdown) => [breakdown?.rollIndex, breakdown]));
  let changed = !previous || previous.rolls.length !== rolls.length;
  const entries = rolls.map((roll, index) => {
    const signature = rollSignature(roll);
    const kept = previous?.rolls?.[index];
    if (kept?.s === signature) return kept;
    changed = true;
    const breakdown = liveByIndex.get(index);
    return breakdown ? { s: signature, b: compactBreakdown(breakdown) } : { s: signature };
  });
  if (!changed) return null;
  if (!previous && !entries.some((entry) => entry.b)) return null;
  const flag = { v: STORE_VERSION, adapter: adapterId, lang, rolls: entries };
  if (JSON.stringify(flag).length > MAX_STORED_LENGTH) return null;
  return flag;
}

function canUpdate(message) {
  if (typeof message?.canUserModify === "function") {
    try {
      return message.canUserModify(game.user, "update");
    } catch {
      return false;
    }
  }
  return Boolean(message?.isOwner ?? (message?.isAuthor || game.user?.isGM));
}

// An update that only wrote the stored copy (or nothing) gives no reason to store again.
export function changesRolls(changes) {
  if (!changes || typeof changes !== "object") return false;
  for (const [key, value] of Object.entries(changes)) {
    if (key === "_id" || key === "_stats") continue;
    if (key === "flags" && value && typeof value === "object") {
      if (Object.keys(value).some((scope) => scope !== MODULE_ID)) return true;
      continue;
    }
    if (key.startsWith(`flags.${MODULE_ID}`)) continue;
    return true;
  }
  return false;
}

// Stores the breakdowns of new rolls. Runs on the client that created or changed the message, one run per message
// at a time; a change during a run starts one more run after it.
export class BreakdownStore {
  constructor({ getAdapter, log = () => {} }) {
    this.getAdapter = getAdapter;
    this.log = log;
    this.running = new Map();
  }

  onCreate(message, options, userId) {
    if (userId !== game.user?.id) return;
    this.schedule(message);
  }

  onUpdate(message, changes, options, userId) {
    if (userId !== game.user?.id || !changesRolls(changes)) return;
    this.schedule(message);
  }

  schedule(message) {
    const adapter = this.getAdapter();
    if (!message?.id || !adapterStoresBreakdowns(adapter)) return null;
    const state = this.running.get(message.id);
    if (state) {
      state.again = true;
      return state.promise;
    }
    const entry = { again: false, promise: null };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          await this.store(message, adapter);
        } while (entry.again);
      } finally {
        this.running.delete(message.id);
      }
    })();
    this.running.set(message.id, entry);
    return entry.promise;
  }

  async store(message, adapter) {
    const current = globalThis.game?.messages?.get?.(message.id) ?? message;
    // Roll table draws get no panel, so nothing to store
    if (current.flags?.["core.RollTable"] || !canUpdate(current)) return false;
    const rolls = getMessageRolls(current, adapter);
    if (!rolls.length) return false;
    if (isComplete(readStoredBreakdowns(current, rolls))) return false;

    let live;
    try {
      if (!adapter.supportsMessage(current)) return false;
      live = await adapter.buildBreakdowns(current);
    } catch (error) {
      this.log("Could not store the breakdown, the adapter failed.", { messageId: current.id, error: String(error?.stack ?? error) });
      return false;
    }

    const flag = buildStoreFlag(current, rolls, live, { adapterId: adapter.id ?? null, lang: getModuleLanguage() });
    if (!flag) return false;
    try {
      await current.update({ [`flags.${MODULE_ID}.${STORE_KEY}`]: flag });
      this.log("Stored the breakdown on the message.", { messageId: current.id, rolls: flag.rolls.length });
      return true;
    } catch (error) {
      this.log("Could not store the breakdown on the message.", { messageId: current.id, error: String(error?.stack ?? error) });
      return false;
    }
  }
}

export const __test__ = { compactValue, isComplete, canUpdate };
