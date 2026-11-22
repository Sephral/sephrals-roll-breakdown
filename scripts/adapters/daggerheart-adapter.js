import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermType, isDiceTerm, parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import { adversaryCriticalFrom, daggerheartHidesTargets, findDaggerheartTarget } from "../daggerheart-targets.js";
import {
  createDataModifier,
  createPill,
  finalizeBreakdown,
  formatSignedNumber,
  isCurrentUserGM,
  isInstanceOf,
  keepNamed,
  localizeLabel,
  systemText
} from "./system-adapter-utils.js";

// Data shapes follow the Daggerheart system source (Foundryborne, 2.12): a duality roll is a DualityRoll with a HopeDie,
// a FearDie and optionally an AdvantageDie or DisadvantageDie (a d6) as its first terms, followed by one numeric term per
// modifier. roll.options.roll.modifiers lists the modifiers with their labels (trait, experiences, effects), in the order
// they were added. Attacks against adversaries and the adversaries' own attacks are plain d20 rolls (D20Roll). Damage
// does not sit in message.rolls but in message.system.damage (main for hit points, resources for stress and the like).
const DIE_ROLES = [
  ["HopeDie", "hope"],
  ["FearDie", "fear"],
  ["AdvantageDie", "advantage"],
  ["DisadvantageDie", "disadvantage"]
];

export function dieRole(term) {
  for (const [name, role] of DIE_ROLES) {
    if (isInstanceOf(term, null, name)) return role;
  }
  return null;
}

function hasTerms(roll) {
  return Boolean(roll) && Array.isArray(roll.terms) && roll.terms.length > 0;
}

// "duality", "fate", "damage", "d20" (adversary and other action rolls) or "other"
export function rollKind(roll) {
  if (isInstanceOf(roll, null, "DualityRoll")) return "duality";
  if (isInstanceOf(roll, null, "FateRoll")) return "fate";
  if (isInstanceOf(roll, null, "DamageRoll")) return "damage";
  if (isInstanceOf(roll, null, "D20Roll")) return "d20";
  if ((roll?.terms ?? []).some((term) => dieRole(term) === "hope")) return "duality";
  return "other";
}

// Every roll of a message in one list: the rolls of the message, then the damage rolls the system keeps in its data.
// The index in this list is the rollIndex of the breakdown.
export function collectRolls(message) {
  const entries = [];
  for (const roll of Array.isArray(message?.rolls) ? message.rolls : []) {
    if (hasTerms(roll)) entries.push({ roll, source: "roll", key: null });
  }
  const damage = message?.system?.damage;
  if (damage && typeof damage === "object") {
    if (hasTerms(damage.main)) entries.push({ roll: damage.main, source: "main", key: "hitPoints" });
    for (const [key, roll] of Object.entries(damage.resources ?? {})) {
      if (hasTerms(roll)) entries.push({ roll, source: "resource", key });
    }
  }
  return entries;
}

// Splits the terms into signed groups, one per added part: [{ sign, terms }]. Null for formulas with other operators
// (a damage multiplier), which the generic parse handles.
function splitGroups(roll) {
  const groups = [];
  let sign = 1;
  let group = null;
  for (const term of roll?.terms ?? []) {
    if (getTermType(term) === "OperatorTerm") {
      if (term.operator !== "+" && term.operator !== "-") return null;
      sign = term.operator === "-" ? -1 : 1;
      group = null;
      continue;
    }
    if (!group) {
      group = { sign, terms: [] };
      groups.push(group);
    }
    group.terms.push(term);
  }
  return groups;
}

function termValue(term) {
  if (getTermType(term) === "NumericTerm") return toFiniteNumber(term.total ?? term.number);
  return toFiniteNumber(term?.total);
}

function dieExpression(term, role) {
  // The marker modifiers (1d12h, 1d6a) are no part of what a player knows as the die
  const modifiers = (Array.isArray(term?.modifiers) ? term.modifiers : []).filter((modifier) => !(role && ["h", "f", "a", "d"].includes(String(modifier))));
  return `${term?.number ?? 1}d${term?.faces}${modifiers.join("")}`;
}

function diceActive(term) {
  return Array.isArray(term?.results) ? term.results.filter((result) => result?.active !== false && !result?.discarded) : [];
}

function createDie(term, sign, { label = null, detail = null, notes = [], lineSkip = false, role = null } = {}) {
  const total = toFiniteNumber(term?.total);
  const signed = total === null ? null : sign * total;
  return {
    expression: `${sign < 0 ? "-" : ""}${dieExpression(term, role)}`,
    total: signed,
    totalText: signed === null ? null : String(signed),
    faces: toFiniteNumber(term?.faces),
    number: toFiniteNumber(term?.number),
    sourceLabel: label,
    sourceDetail: detail,
    notes: notes.filter(Boolean),
    ...(lineSkip ? { lineSkip: true } : {}),
    confidence: "exact"
  };
}

function isRerolled(term) {
  return Array.isArray(term?.results) && term.results.some((result) => result?.rerolled);
}

function customLabel() {
  return systemText("Daggerheart.CustomModifier");
}

// The label pool of a roll: the modifiers the system added in order, or for damage the breakdown it stores on the roll.
function getLabelPool(roll) {
  const options = roll?.options ?? {};
  const fromRoll = Array.isArray(options.roll?.modifiers) ? options.roll.modifiers : null;
  const list = fromRoll ?? (Array.isArray(options.breakdown) ? options.breakdown : []);
  return list.filter((entry) => entry && typeof entry === "object").map((entry) => ({ label: entry.label, value: entry.value }));
}

function sameNumber(a, b) {
  const x = toFiniteNumber(a);
  const y = toFiniteNumber(b);
  return x !== null && y !== null && x === y;
}

// The next label whose value is the given number: the one in line first, else any later one.
function takeLabel(pool, cursor, value) {
  while (pool[cursor.index]?.used) cursor.index++;
  if (pool[cursor.index] && sameNumber(pool[cursor.index].value, value)) {
    pool[cursor.index].used = true;
    return pool[cursor.index++].label;
  }
  const found = pool.findIndex((entry, index) => index >= cursor.index && !entry.used && sameNumber(entry.value, value));
  if (found < 0) return null;
  pool[found].used = true;
  return pool[found].label;
}

function experienceNames(roll) {
  const options = roll?.options ?? {};
  const known = options.data?.experiences ?? roll?.data?.experiences ?? {};
  return (Array.isArray(options.experiences) ? options.experiences : [])
    .map((id) => known?.[id]?.name)
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
}

// Replaces the generic terms by the parts the roll data names. Hope, Fear, advantage and the other dice come with a label,
// numbers with the label the system stored for them, the experiences marked as such.
function rebuildTerms(breakdown, roll, { duality = false } = {}) {
  const groups = splitGroups(roll);
  if (!groups) return false;
  const pool = getLabelPool(roll);
  const cursor = { index: 0 };
  const experiences = experienceNames(roll);
  const diceOut = [];
  const modifiersOut = [];
  let seenNumber = false;

  for (const group of groups) {
    const dice = group.terms.filter((term) => isDiceTerm(term));
    if (dice.length) {
      for (const term of dice) {
        const role = dieRole(term);
        if (role === "hope" || role === "fear") {
          diceOut.push(createDie(term, group.sign, {
            label: systemText(role === "hope" ? "Daggerheart.Hope" : "Daggerheart.Fear"),
            detail: systemText(role === "hope" ? "Daggerheart.HopeHint" : "Daggerheart.FearHint"),
            notes: [isRerolled(term) ? systemText("Daggerheart.Rerolled") : null],
            lineSkip: true,
            role
          }));
        } else if (role === "advantage" || role === "disadvantage") {
          diceOut.push(createDie(term, group.sign, {
            label: systemText(role === "advantage" ? "Daggerheart.Advantage" : "Daggerheart.Disadvantage"),
            detail: systemText(role === "advantage" ? "Daggerheart.AdvantageHint" : "Daggerheart.DisadvantageHint"),
            notes: [diceActive(term).length < (toFiniteNumber(term.number) ?? 1) ? systemText("Daggerheart.Highest") : null],
            role
          }));
        } else {
          const flavor = typeof term?.flavor === "string" && term.flavor.trim() ? term.flavor.trim() : null;
          const expression = String(term?.expression ?? term?.formula ?? "").replace(/\[[^\]]*\]$/, "").replace(/\s+/g, "");
          const named = pool.findIndex((entry, index) => index >= cursor.index && !entry.used && typeof entry.value === "string" && entry.value.replace(/\s+/g, "") === expression);
          let label = flavor;
          if (named >= 0) {
            pool[named].used = true;
            label = pool[named].label;
          }
          // In a duality roll a die before the first number is the rally die of a Bard, a later one a bonus die
          if (duality) label ??= systemText(seenNumber ? "Daggerheart.BonusDie" : "Daggerheart.Rally");
          diceOut.push(createDie(term, group.sign, { label, notes: [isRerolled(term) ? systemText("Daggerheart.Rerolled") : null] }));
        }
      }
      continue;
    }

    const values = group.terms.map(termValue);
    if (values.some((value) => value === null)) return false;
    const value = group.sign * values.reduce((sum, entry) => sum + entry, 0);
    const label = localizeLabel(takeLabel(pool, cursor, value)) ?? customLabel();
    const experienceIndex = experiences.indexOf(label);
    if (experienceIndex >= 0) experiences.splice(experienceIndex, 1);
    modifiersOut.push(createDataModifier({
      label,
      value,
      detail: experienceIndex >= 0 ? systemText("Daggerheart.Experience") : null
    }));
    seenNumber = true;
  }

  breakdown.diceTerms = diceOut;
  breakdown.modifiers = modifiersOut;
  breakdown.computedTerms = [];
  breakdown.unresolvedTerms = [];
  breakdown.totalStaticModifier = modifiersOut.reduce((sum, entry) => sum + entry.value, 0);
  summarizeBreakdown(breakdown);
  return true;
}

function diceTotal(roll, role) {
  const term = (roll?.terms ?? []).find((entry) => dieRole(entry) === role);
  return term ? toFiniteNumber(term.total) : null;
}

// The outcome of a duality roll as the system defines it: equal dice are a critical success, otherwise the higher die names
// the side of the roll. Reaction rolls give neither Hope nor Fear.
export function getDualityOutcome(roll) {
  const hope = diceTotal(roll, "hope");
  const fear = diceTotal(roll, "fear");
  if (roll?.guaranteedCritical === true || roll?.options?.guaranteedCritical === true) return { key: "GuaranteedCritical", hope, fear };
  if (hope === null || fear === null) return null;
  if (hope === fear) return { key: "Critical", hope, fear };
  return { key: hope > fear ? "Hope" : "Fear", hope, fear };
}

function isReaction(roll) {
  return roll?.options?.actionType === "reaction";
}

function buildEnv() {
  return { isGM: isCurrentUserGM(), daggerheartHidesTargets: daggerheartHidesTargets() };
}

// Difficulty, result against it and margin, for numbers the current user may know.
function buildTargetPills(roll, message, critical, env) {
  const target = findDaggerheartTarget({ roll, message, env });
  if (!target?.known) return [];
  const total = toFiniteNumber(roll?.total);
  const pills = [createPill(systemText(target.kind === "evasion" ? "Daggerheart.Evasion" : "Daggerheart.Difficulty", { value: target.value }), { tooltip: target.name })];
  if (total === null) return pills;
  const success = critical || total >= target.value;
  const key = target.kind === "evasion" ? (success ? "Daggerheart.Hit" : "Daggerheart.Miss") : (success ? "Daggerheart.Success" : "Daggerheart.Failure");
  pills.push(createPill(systemText(key), { emphasis: true, tooltip: critical && total < target.value ? systemText("Daggerheart.CriticalHint") : null }));
  pills.push(createPill(systemText("Daggerheart.Margin", { margin: formatSignedNumber(total - target.value) })));
  return pills;
}

export function buildDualityBreakdown(roll, { rollIndex = 0, message = null, env = null, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "daggerheart", rollIndex });
  const rebuilt = rebuildTerms(breakdown, roll, { duality: true });
  const outcome = getDualityOutcome(roll);
  const reaction = isReaction(roll);
  const pills = [];

  if (outcome) {
    if (outcome.key === "GuaranteedCritical") {
      pills.push(createPill(systemText("Daggerheart.GuaranteedCritical"), { emphasis: true, tooltip: systemText("Daggerheart.GuaranteedCriticalHint") }));
    } else if (outcome.key === "Critical") {
      pills.push(createPill(systemText("Daggerheart.Critical"), { emphasis: true, tooltip: systemText("Daggerheart.CriticalHint") }));
    } else if (!reaction) {
      pills.push(createPill(systemText(outcome.key === "Hope" ? "Daggerheart.WithHope" : "Daggerheart.WithFear"), {
        emphasis: true,
        tooltip: systemText(outcome.key === "Hope" ? "Daggerheart.WithHopeHint" : "Daggerheart.WithFearHint", { hope: outcome.hope, fear: outcome.fear })
      }));
    }
  }
  if (reaction) pills.push(createPill(systemText("Daggerheart.Reaction"), { tooltip: systemText("Daggerheart.ReactionHint") }));

  const critical = outcome?.key === "Critical" || outcome?.key === "GuaranteedCritical";
  pills.push(...buildTargetPills(roll, message, critical, env ?? buildEnv()));

  return finalizeBreakdown(breakdown, {
    pills,
    title,
    forceVisible: rebuilt && breakdown.diceTerms.length > 0
  });
}

// An action roll with a single d20, as adversaries make them (and as characters make them when a table rolls d20).
export function buildD20Breakdown(roll, { rollIndex = 0, message = null, env = null, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "daggerheart", rollIndex });
  const rebuilt = rebuildTerms(breakdown, roll);
  if (rebuilt) {
    // Plain dice of the attack, the generic names are fine, the system marks no roles on them
    breakdown.diceTerms.forEach((term) => { term.notes = []; });
  }
  const d20 = (roll?.terms ?? []).find((term) => isDiceTerm(term) && toFiniteNumber(term.faces) === 20);
  const natural = d20 ? toFiniteNumber(d20.total) : null;
  const threshold = adversaryCriticalFrom(roll);
  const critical = natural !== null && natural >= threshold;
  const pills = [];
  if (critical) pills.push(createPill(systemText("Daggerheart.CriticalHit"), { emphasis: true, tooltip: systemText("Daggerheart.CriticalHitHint") }));
  pills.push(...buildTargetPills(roll, message, critical, env ?? buildEnv()));
  const advantage = Number(roll?.options?.roll?.advantage?.type ?? roll?.options?.roll?.advantage);
  if (advantage === 1) breakdown.lineInfo = { advantage: "advantage" };
  else if (advantage === -1) breakdown.lineInfo = { advantage: "disadvantage" };
  return finalizeBreakdown(breakdown, { pills, title, forceVisible: false });
}

function damageTypeLabel(type) {
  if (typeof type !== "string" || !type) return null;
  return localizeLabel(globalThis.CONFIG?.DH?.GENERAL?.damageTypes?.[type]?.label) ?? type;
}

function resourceLabel(key) {
  if (!key) return null;
  const label = globalThis.CONFIG?.DH?.GENERAL?.healingTypes?.[key]?.label;
  return localizeLabel(label) ?? key;
}

// A critical hit adds the highest possible result of every die rolled (DamageRoll#total in the system).
function criticalDamageBonus(roll) {
  return (roll?.terms ?? []).filter((term) => isDiceTerm(term)).reduce((sum, term) => {
    const faces = toFiniteNumber(term.faces);
    return faces === null ? sum : sum + faces * diceActive(term).length;
  }, 0);
}

export function buildDamageBreakdown(roll, { rollIndex = 0, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "daggerheart", rollIndex });
  const rebuilt = rebuildTerms(breakdown, roll);
  const options = roll?.options ?? {};
  const critical = options.isCritical === true;
  const pills = [];

  if (rebuilt && critical) {
    const bonus = criticalDamageBonus(roll);
    if (bonus > 0) {
      breakdown.modifiers.push(createDataModifier({ label: systemText("Daggerheart.CriticalDamage"), value: bonus, detail: systemText("Daggerheart.CriticalDamageHint") }));
      breakdown.totalStaticModifier += bonus;
      // DamageRoll#total adds the bonus to the sum of the terms, the bonus is one of the modifiers by now
      const base = breakdown.diceTerms.reduce((sum, term) => sum + (term.total ?? 0), 0) + breakdown.modifiers.reduce((sum, entry) => sum + entry.value, 0);
      breakdown.rollTotal = base;
      summarizeBreakdown(breakdown);
    }
    pills.push(createPill(systemText("Daggerheart.CriticalHit"), { emphasis: true, tooltip: systemText("Daggerheart.CriticalDamageHint") }));
  }

  const types = (Array.isArray(options.damageTypes) ? options.damageTypes : []).map(damageTypeLabel).filter(Boolean);
  if (types.length) pills.push(createPill(types.join(", ")));
  if (options.fullRestore === true) pills.push(createPill(systemText("Daggerheart.FullRestore")));

  return finalizeBreakdown(breakdown, {
    pills,
    title,
    forceVisible: rebuilt && breakdown.diceTerms.length > 0 && (breakdown.modifiers.length > 0 || breakdown.diceTerms.length > 1 || pills.length > 0)
  });
}

export class DaggerheartRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "daggerheart";
    this.waitForCard = true;
  }

  getMessageRolls(message) {
    return collectRolls(message).map((entry) => entry.roll);
  }

  supportsMessage(message) {
    return globalThis.game?.system?.id === "daggerheart" && this.getMessageRolls(message).length > 0;
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();
    const entries = collectRolls(message);
    const several = entries.length > 1;
    const env = buildEnv();
    const hasHealing = message?.system?.hasHealing === true;

    return entries
      .map(({ roll, source, key }, index) => {
        const kind = source === "roll" ? rollKind(roll) : "damage";
        if (kind === "duality") {
          const title = several ? systemText(isReaction(roll) ? "Daggerheart.ReactionRoll" : "Daggerheart.DualityRoll") : null;
          return buildDualityBreakdown(roll, { rollIndex: index, message, env, title });
        }
        if (kind === "d20") return buildD20Breakdown(roll, { rollIndex: index, message, env, title: several ? systemText(roll?.options?.roll?.type === "attack" ? "Daggerheart.Attack" : "Daggerheart.D20Roll") : null });
        if (kind === "damage") {
          const named = source === "main" ? systemText(hasHealing ? "Daggerheart.Healing" : "Daggerheart.Damage") : resourceLabel(key);
          return buildDamageBreakdown(roll, { rollIndex: index, title: several || source === "resource" ? named : null });
        }
        if (kind === "fate") {
          const breakdown = parseRoll(roll, { adapterId: this.id, rollIndex: index });
          return rebuildTerms(breakdown, roll) && breakdown.modifiers.length ? finalizeBreakdown(breakdown, { forceVisible: true }) : null;
        }
        return keepNamed(parseRoll(roll, { adapterId: this.id, rollIndex: index }));
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
