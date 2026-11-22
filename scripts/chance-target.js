import { chanceOrBetter, chanceToReach, chanceToReachDuality, distribution, dualityModelFromRoll, formatPercent, modelFromRoll, NATURAL_RULES } from "./chance.js";
import { adversaryCriticalFrom, findDaggerheartTarget } from "./daggerheart-targets.js";
import { findTormenta20Target, t20RollKind } from "./tormenta20-targets.js";

// Which chance a roll gets: the chance to reach a known target number (DC of a save or check, armor class of one target)
// or, without one or when the player may not know it, the chance of this result or better. Pure over the message data and
// a small environment, so the visibility rules are testable without Foundry.

const DND5E_SKIPPED = new Set(["damage", "healing", "heal", "hitDie", "defaultDamage", "otherDamage", "bonusDamage"]);

function finite(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

// The target number of a roll the system knows, with whether the current user may see it.
// Returns { value, kind: "dc" | "ac", known, needs } or null. needs is the critical rule of the roll.
export function findTarget({ roll, message, systemId, env = {} }) {
  const isGM = Boolean(env.isGM);
  if (systemId === "daggerheart") {
    // Damage and healing have nothing to reach, the duality roll treats equal Hope and Fear dice as a critical success
    const kind = dhRollKind(roll);
    if (kind === "other") return { skip: true };
    const target = findDaggerheartTarget({ roll, message, env });
    if (!target) return null;
    if (kind === "duality") return { ...target, needs: null, duality: true };
    return { ...target, needs: NATURAL_RULES.attack(adversaryCriticalFrom(roll), 0) };
  }
  if (systemId === "tormenta20") {
    // Damage and healing have nothing to reach. The system names no automatic hit or miss, so the total has to reach the Defense.
    if (t20RollKind(roll, message) === "damage") return { skip: true };
    const target = findTormenta20Target({ roll, message, env });
    return target ? { ...target, needs: null } : null;
  }
  if (systemId === "dnd5e") {
    // dnd5e 5 keeps the roll type and the targets in flags, dnd5e 6 in the typed message (message.type and message.system)
    const flags = message?.flags?.dnd5e ?? {};
    const type = flags.roll?.type ?? roll?.options?.rollType ?? message?.type ?? null;
    if (DND5E_SKIPPED.has(type)) return { skip: true };
    const optionTarget = finite(roll?.options?.target);
    if (type === "attack") {
      const targets = Array.isArray(message?.system?.targets) ? message.system.targets : Array.isArray(flags.targets) ? flags.targets : [];
      const only = targets.length === 1 ? targets[0] : null;
      const ac = finite(only?.ac) ?? (targets.length <= 1 ? optionTarget : null);
      if (ac === null) return null;
      const critFrom = finite(roll?.options?.criticalSuccess) ?? 20;
      const fumble = finite(roll?.options?.criticalFailure) ?? 1;
      // The armor class of a player character is known at the table, the one of a monster is the GM's secret
      const uuid = only?.actor ?? only?.uuid ?? null;
      const owned = uuid ? Boolean(env.actorHasPlayerOwner?.(uuid)) : false;
      return { value: ac, kind: "ac", known: isGM || owned, needs: NATURAL_RULES.attack(critFrom, fumble) };
    }
    if (optionTarget !== null) {
      // dnd5e marks success and failure on the card only for rolls that are not private, so the number is no secret there
      const open = !message?.blind && !(Array.isArray(message?.whisper) && message.whisper.length > 0);
      return { value: optionTarget, kind: "dc", known: isGM || open, needs: null };
    }
    return null;
  }
  if (systemId === "pf2e" || systemId === "sf2e") {
    const context = message?.flags?.pf2e?.context;
    if (context?.type === "damage-roll") return { skip: true };
    const dc = context?.dc && typeof context.dc === "object" ? context.dc : null;
    const value = finite(dc?.value);
    if (value === null) return null;
    const known = isGM || dc.visible === true || env.pf2eShowsDcs === true;
    return { value, kind: "dc", known, needs: NATURAL_RULES.degree() };
  }
  return null;
}

// What kind of Daggerheart roll this is, by the class name the system registers: "duality", "adversary" (a plain d20 action
// roll) or "other" (damage, healing, fate dice and anything else, which get no chance).
function dhRollKind(roll) {
  let prototype = Object.getPrototypeOf(roll ?? {});
  const names = new Set();
  while (prototype && prototype !== Object.prototype) {
    names.add(prototype.constructor?.name);
    prototype = Object.getPrototypeOf(prototype);
  }
  if (names.has("DualityRoll")) return "duality";
  if (!names.has("DamageRoll") && !names.has("FateRoll") && (roll?.terms ?? []).some((term) => /^HopeDie$/.test(term?.constructor?.name ?? ""))) return "duality";
  if (names.has("FateRoll") || names.has("DamageRoll")) return "other";
  if (names.has("D20Roll")) return "adversary";
  return "other";
}

// The chance line of one roll: { kind: "success" | "better", probability, target?, targetKind? } or null.
export function resolveChance({ roll, message, systemId, env = {} }) {
  const duality = systemId === "daggerheart" && dhRollKind(roll) === "duality";
  const model = duality ? dualityModelFromRoll(roll) : modelFromRoll(roll);
  if (!model) return null;
  const total = finite(roll?.total);
  if (total === null) return null;
  const target = findTarget({ roll, message, systemId, env });
  if (target?.skip) return null;

  // The formula must be able to produce the rolled total, otherwise the model misses something (a module added a bonus)
  const combined = distribution(model);
  if (!combined) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const key of combined.total.keys()) {
    min = Math.min(min, key);
    max = Math.max(max, key);
  }
  if (total < min || total > max) return null;

  if (target?.known) {
    const probability = duality ? chanceToReachDuality(model, target.value) : chanceToReach(model, target.value, target.needs);
    if (probability === null) return null;
    return { kind: "success", probability, target: target.value, targetKind: target.kind, ...(duality ? { rule: "duality" } : {}) };
  }
  const probability = chanceOrBetter(model, total);
  if (probability === null) return null;
  return { kind: "better", probability };
}

// The texts of a chance. words: the translated templates { success, better, successHint, betterHint, dc, ac, percent, under, over }.
export function describeChance(chance, words = {}) {
  if (!chance) return null;
  const percent = formatPercent(chance.probability, words);
  if (!percent) return null;
  if (chance.kind === "success") {
    const kinds = { ac: words.ac ?? "AC", difficulty: words.difficulty ?? "Difficulty", evasion: words.evasion ?? "Evasion", defense: words.defense ?? "Defense" };
    const kind = kinds[chance.targetKind] ?? words.dc ?? "DC";
    const extra = chance.rule === "duality" && words.dualityHint ? ` ${words.dualityHint}` : "";
    return {
      text: String(words.success ?? "Chance of success: {percent}").replace("{percent}", percent),
      hint: String(words.successHint ?? "").replace("{kind}", kind).replace("{target}", chance.target) + extra,
      probability: chance.probability,
      kind: "success"
    };
  }
  return {
    text: String(words.better ?? "This result or better: {percent}").replace("{percent}", percent),
    hint: String(words.betterHint ?? ""),
    probability: chance.probability,
    kind: "better"
  };
}

export const __test__ = { finite };
