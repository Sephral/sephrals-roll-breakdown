import { chanceOrBetter, chanceToReach, distribution, formatPercent, modelFromRoll, NATURAL_RULES } from "./chance.js";

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

// The chance line of one roll: { kind: "success" | "better", probability, target?, targetKind? } or null.
export function resolveChance({ roll, message, systemId, env = {} }) {
  const model = modelFromRoll(roll);
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
    const probability = chanceToReach(model, target.value, target.needs);
    if (probability === null) return null;
    return { kind: "success", probability, target: target.value, targetKind: target.kind };
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
    const kind = chance.targetKind === "ac" ? words.ac ?? "AC" : words.dc ?? "DC";
    return {
      text: String(words.success ?? "Chance of success: {percent}").replace("{percent}", percent),
      hint: String(words.successHint ?? "").replace("{kind}", kind).replace("{target}", chance.target),
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
