// Tormenta20: what a roll is and which Defense it was made against. Pure over the message data and a small environment,
// shared by the adapter (hit pills) and the chance line.
//
// Data shapes follow the Tormenta20 system source (1.6): every d20 roll of the system is a RollT20 with options.type "attack"
// (also for skill and attribute tests), damage and healing rolls have options.type "damage". Only the card of an item
// (weapon, spell, power) carries flags.tormenta20.itemData, the card of a test does not. The system works out no hit: it does
// not read the targets. The Defense of the single targeted creature is stored on the message by the client that makes the
// roll (flags.sephrals-roll-breakdown.t20Target), because the targets are gone when the card is read later.

export const T20_TARGET_FLAG = "t20Target";

// The Defense of a creature no player owns is the GM's secret and must not travel in a message flag (every client gets the
// flags). The GM's client keeps it here for its own session, by message id.
export const secretTargets = new Map();

function finite(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

// The system data of the item behind a card, or null for the card of a test.
export function t20ItemData(message) {
  const data = message?.flags?.tormenta20?.itemData;
  return data && typeof data === "object" ? data : null;
}

function firstD20(roll) {
  return (roll?.terms ?? []).find((term) => Number(term?.faces) === 20) ?? null;
}

// "damage", "attack" (the d20 of an item), "check" (the d20 of a skill or attribute test) or "other".
export function t20RollKind(roll, message) {
  if (roll?.options?.type === "damage") return "damage";
  if (firstD20(roll)) return t20ItemData(message) ? "attack" : "check";
  return "other";
}

// The threat range of an attack: the lowest natural result that threatens a critical hit. The system stores it on the d20.
export function t20ThreatFrom(roll, message) {
  const stored = finite(firstD20(roll)?.options?.critical);
  const fromItem = finite(t20ItemData(message)?.criticoM);
  const value = stored ?? fromItem ?? 20;
  return value >= 2 && value <= 20 ? value : 20;
}

export function t20Natural(roll) {
  const d20 = firstD20(roll);
  const kept = (d20?.results ?? []).filter((result) => result?.active !== false && !result?.discarded);
  if (kept.length) return finite(kept[0].result);
  return finite(d20?.total);
}

// The multiplier of a critical hit, 2 unless the weapon says otherwise.
export function t20CriticalMultiplier(message) {
  const value = finite(t20ItemData(message)?.criticoX);
  return value !== null && value >= 2 ? value : 2;
}

// Whether the attack roll of an item card threatens a critical hit. The system multiplies the damage dice of the same card
// for a threat, whether the attack hits or not.
export function t20Threatens(message) {
  const attack = (message?.rolls ?? []).find((roll) => t20RollKind(roll, message) === "attack");
  if (!attack) return false;
  const natural = t20Natural(attack);
  return natural !== null && natural >= t20ThreatFrom(attack, message);
}

// { value, kind: "defense", known, name } or null. The Defense of a monster is the GM's secret, the one of a player
// character is known at the table.
export function findTormenta20Target({ roll, message, env = {} }) {
  if (t20RollKind(roll, message) !== "attack") return null;
  const stored = message?.flags?.["sephrals-roll-breakdown"]?.[T20_TARGET_FLAG] ?? (env.isGM ? secretTargets.get(message?.id) : null);
  const value = finite(stored?.defense);
  if (value === null) return null;
  const owned = stored?.uuid ? Boolean(env.actorHasPlayerOwner?.(stored.uuid)) : false;
  return {
    value,
    kind: "defense",
    known: Boolean(env.isGM) || owned,
    name: typeof stored?.name === "string" && stored.name.trim() ? stored.name.trim() : null
  };
}

// What to store for the targets of the user who rolls: exactly one target with a Defense, otherwise nothing.
export function snapshotTormenta20Target(targets) {
  const list = Array.from(targets ?? []);
  if (list.length !== 1) return null;
  const token = list[0];
  const actor = token?.actor ?? token?.document?.actor ?? null;
  const defense = finite(actor?.system?.attributes?.defesa?.value);
  if (defense === null) return null;
  return {
    defense,
    uuid: actor?.uuid ?? null,
    name: token?.name ?? token?.document?.name ?? actor?.name ?? null
  };
}

// The save of a spell or power: { dc, text } or null. The text is what the item says about the resistance test. The
// difficulty comes from the item as the owner has it (10 + half the level + key attribute + bonus), a threat uses the
// difficulty of the creature.
export function t20SaveOf(message, actor = null) {
  const data = t20ItemData(message);
  const resist = data?.resistencia;
  const text = typeof resist?.txt === "string" && resist.txt.trim() ? resist.txt.trim() : null;
  if (!text) return null;
  let dc = null;
  const itemId = String(message?.content ?? "").match(/data-item-id="([^"]+)"/)?.[1] ?? null;
  const item = itemId ? actor?.items?.get?.(itemId) : null;
  dc = finite(item?.system?.resistencia?.cd);
  if (!dc && actor?.type === "npc") dc = finite(actor?.system?.attributes?.cd);
  return { dc: dc && dc > 0 ? dc : null, text };
}

export const __test__ = { finite, firstD20 };
