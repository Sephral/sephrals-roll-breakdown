import { GenericRollAdapter } from "./generic-adapter.js";
import { isDiceTerm, parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import {
  createDataModifier,
  createItem,
  createPill,
  createSection,
  finalizeBreakdown,
  formatSignedNumber,
  isCurrentUserGM,
  isInstanceOf,
  keepNamed,
  localizeLabel,
  sumValues,
  systemText
} from "./system-adapter-utils.js";

// Data shapes follow the PF2e system source: CheckRoll and DamageRoll options, and the message flags
// flags.pf2e.context, flags.pf2e.modifiers (RawModifier[]) and flags.pf2e.dice (RawDamageDice[]).
const OUTCOME_KEYS = {
  criticalSuccess: "CriticalSuccess",
  success: "Success",
  failure: "Failure",
  criticalFailure: "CriticalFailure"
};
const NON_CHECK_CONTEXTS = new Set(["damage-roll", "spell-cast", "self-effect", "damage-taken"]);
const MODIFIER_TYPES = new Set(["ability", "circumstance", "item", "potency", "proficiency", "status", "untyped"]);

function getMetagameSettings() {
  return globalThis.game?.pf2e?.settings?.metagame ?? {};
}

function isCheckRoll(roll, context) {
  // Foundry restores rolls by class name, so the PF2e class names are stable.
  if (isInstanceOf(roll, null, "CheckRoll")) return true;
  if (Number.isFinite(roll?.options?.totalModifier)) return true;
  return Boolean(context?.type && !NON_CHECK_CONTEXTS.has(context.type) && roll?.options?.type);
}

function isDamageRoll(roll, context) {
  if (isInstanceOf(roll, null, "DamageRoll")) return true;
  return context?.type === "damage-roll";
}

function modifierTypeLabel(type) {
  return MODIFIER_TYPES.has(type) ? systemText(`Pf2e.Type.${type}`) : null;
}

function getRawModifiers(flags) {
  return Array.isArray(flags?.modifiers)
    ? flags.modifiers.filter((modifier) => modifier && typeof modifier === "object" && Number.isFinite(modifier.modifier))
    : [];
}

function isEnabled(modifier) {
  return modifier.enabled !== false && modifier.ignored !== true;
}

function toModifierRow(modifier) {
  return createDataModifier({
    label: localizeLabel(modifier.label) ?? modifier.slug ?? "?",
    value: modifier.modifier,
    detail: modifierTypeLabel(modifier.type)
  });
}

function buildNotCountedSection(modifiers) {
  const items = modifiers
    .filter((modifier) => !isEnabled(modifier) && !modifier.hideIfDisabled)
    .map((modifier) => createItem({
      text: localizeLabel(modifier.label) ?? modifier.slug,
      tag: modifierTypeLabel(modifier.type),
      value: formatSignedNumber(modifier.modifier),
      tooltip: systemText("Pf2e.NotCountedHint"),
      muted: true
    }));
  return createSection(systemText("Pf2e.NotCounted"), items);
}

function getSelectedSubstitution(context) {
  return Array.isArray(context?.substitutions) ? context.substitutions.find((entry) => entry?.selected) ?? null : null;
}

function effectLabel(effectType) {
  return systemText(effectType === "misfortune" ? "Pf2e.Misfortune" : "Pf2e.Fortune");
}

// A roll substitution (e.g. Assurance) replaces the d20 with a fixed number, the first term of the formula.
function moveSubstitutionToDice(breakdown, substitution) {
  const value = toFiniteNumber(substitution?.value);
  const first = breakdown.modifiers[0];
  if (value === null || !first || first.sourceLabel || first.value !== value) return;
  breakdown.modifiers.shift();
  breakdown.totalStaticModifier -= value;
  breakdown.diceTerms.unshift({
    expression: String(value),
    total: value,
    totalText: String(value),
    faces: null,
    number: null,
    sourceLabel: localizeLabel(substitution.label) ?? substitution.slug ?? null,
    sourceDetail: effectLabel(substitution.effectType),
    confidence: "exact"
  });
}

function buildFortuneSection(context) {
  const effects = new Set();
  const items = [];
  if (context?.rollTwice === "keep-higher") effects.add("fortune");
  if (context?.rollTwice === "keep-lower") effects.add("misfortune");
  for (const effect of effects) {
    items.push(createItem({
      text: systemText(effect === "fortune" ? "Pf2e.Fortune" : "Pf2e.Misfortune"),
      tooltip: systemText(effect === "fortune" ? "Pf2e.FortuneHint" : "Pf2e.MisfortuneHint")
    }));
  }

  const substitution = getSelectedSubstitution(context);
  if (substitution) {
    effects.add(substitution.effectType);
    items.push(createItem({
      text: localizeLabel(substitution.label) ?? substitution.slug,
      tag: effectLabel(substitution.effectType),
      value: substitution.value === undefined ? null : String(substitution.value)
    }));
  }

  if (effects.has("fortune") && effects.has("misfortune")) {
    items.push(createItem({ text: systemText("Pf2e.Cancelled"), muted: true }));
  }
  return createSection(null, items, { placement: "top" });
}

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

// DegreeOfSuccess#unadjusted: the degree of the total against the DC, one step better on a natural 20 and one step
// worse on a natural 1, before rule elements adjust it.
function calculateUnadjustedOutcome(roll, dcValue) {
  const total = toFiniteNumber(roll?.total);
  if (total === null || dcValue === null) return null;
  const d20 = (roll?.dice ?? []).find((die) => toFiniteNumber(die?.faces) === 20);
  const dieResult = toFiniteNumber(d20?.total);
  let degree = total - dcValue >= 10 ? 3 : dcValue - total >= 10 ? 0 : total >= dcValue ? 2 : 1;
  if (dieResult === 20) degree = Math.min(degree + 1, 3);
  else if (dieResult === 1) degree = Math.max(degree - 1, 0);
  return DEGREES[degree];
}

function getUnadjustedOutcome(roll, context, dcValue) {
  // A reroll updates the outcome but keeps the unadjusted outcome of the first roll.
  if (context?.isReroll) return calculateUnadjustedOutcome(roll, dcValue);
  return context?.unadjustedOutcome ?? null;
}

function buildCheckPills(roll, context, isGM) {
  const metagame = getMetagameSettings();
  const dc = context?.dc && typeof context.dc === "object" ? context.dc : null;
  const dcValue = toFiniteNumber(dc?.value);
  const showDc = dcValue !== null && dc?.value !== null && (isGM || dc.visible === true || metagame.dcs === true);
  const showOutcome = isGM || metagame.results === true;
  const total = toFiniteNumber(roll?.total);
  const pills = [];

  if (showDc) {
    const label = localizeLabel(dc.label);
    pills.push(createPill(systemText("Pf2e.Dc", { dc: dcValue }), { tooltip: label && !label.includes("{") ? label : null }));
  }

  const outcomeKey = OUTCOME_KEYS[context?.outcome];
  if (outcomeKey && showOutcome) {
    const unadjusted = OUTCOME_KEYS[getUnadjustedOutcome(roll, context, dcValue)];
    pills.push(createPill(systemText(`Pf2e.Outcome.${outcomeKey}`), {
      emphasis: true,
      tooltip: unadjusted && unadjusted !== outcomeKey
        ? systemText("Pf2e.AdjustedFrom", { outcome: systemText(`Pf2e.Outcome.${unadjusted}`) })
        : null
    }));
  }

  if (showDc && total !== null) pills.push(createPill(systemText("Pf2e.Margin", { margin: formatSignedNumber(total - dcValue) })));
  return pills;
}

export function buildPf2eCheckBreakdown(roll, flags, { rollIndex = 0, isGM = false } = {}) {
  const context = flags?.context ?? {};
  const breakdown = parseRoll(roll, { adapterId: "pf2e", rollIndex });
  const rawModifiers = getRawModifiers(flags);
  const enabled = rawModifiers.filter(isEnabled);
  const totalModifier = toFiniteNumber(roll?.options?.totalModifier);

  // The formula holds one summed number (d20 + totalModifier). It is split into the listed modifiers
  // only when they add up to that number.
  if (enabled.length && totalModifier !== null && sumValues(enabled.map((m) => ({ value: m.modifier }))) === totalModifier) {
    const rows = enabled.map(toModifierRow);
    const index = breakdown.modifiers.findLastIndex((modifier) => modifier.value === totalModifier);
    if (index >= 0) {
      breakdown.totalStaticModifier += totalModifier - breakdown.modifiers[index].value;
      breakdown.modifiers.splice(index, 1, ...rows);
    } else if (totalModifier === 0) {
      breakdown.modifiers.push(...rows);
    }
    summarizeBreakdown(breakdown);
  }

  if (!breakdown.diceTerms.length) {
    moveSubstitutionToDice(breakdown, getSelectedSubstitution(context));
    summarizeBreakdown(breakdown);
  }

  return finalizeBreakdown(breakdown, {
    sections: [buildFortuneSection(context), buildNotCountedSection(rawModifiers)],
    pills: buildCheckPills(roll, context, isGM),
    forceVisible: breakdown.diceTerms.length > 0 && breakdown.modifiers.length > 0
  });
}

function getDamageInstances(roll) {
  if (Array.isArray(roll?.instances)) return roll.instances;
  const pool = roll?.terms?.[0];
  return Array.isArray(pool?.rolls) ? pool.rolls : [];
}

function damageTypeLabel(type) {
  if (typeof type !== "string" || !type) return null;
  return localizeLabel(globalThis.CONFIG?.PF2E?.damageTypes?.[type]) ?? type;
}

function collectDice(instance) {
  if (Array.isArray(instance?.dice)) return instance.dice;
  return (instance?.terms ?? []).filter((term) => isDiceTerm(term));
}

// The die without its flavor: PF2e flavors dice with the damage type, e.g. "1d6[fire]".
function dieExpression(die) {
  if (typeof die?.expression === "string" && die.expression) return die.expression;
  return String(die?.formula ?? `${die?.number}d${die?.faces}`).replace(/\[[^\]]*\]$/, "");
}

// The formula of a damage part without the damage type PF2e appends to it ("(1d8 + 4) slashing").
function instanceExpression(instance) {
  const head = instance?.head;
  if (typeof head?.expression === "string" && head.expression) return head.expression;
  return String(instance?.formula ?? "");
}

// PF2e rolls persistent damage with the hit but neither counts nor shows it until the end of the turn.
function isDeferredPersistent(instance) {
  return Boolean(instance?.persistent) && !instance?.options?.evaluatePersistent;
}

// Critical-only dice and modifiers (critical: true) count only on a critical hit, critical: false only without one.
function appliesToDegree(entry, isCritical) {
  if (entry?.critical === true) return isCritical;
  if (entry?.critical === false) return !isCritical;
  return true;
}

function damageTag(type, persistent) {
  return [damageTypeLabel(type), persistent ? systemText("Pf2e.Persistent") : null].filter(Boolean).join(", ") || null;
}

export function buildPf2eDamageBreakdown(roll, flags, { rollIndex = 0 } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "pf2e", rollIndex });
  const instances = getDamageInstances(roll);
  const isCritical = roll?.options?.degreeOfSuccess === 3;

  if (instances.length) {
    breakdown.diceTerms = instances.flatMap((instance) => {
      const deferred = isDeferredPersistent(instance);
      return collectDice(instance).map((die) => ({
        expression: dieExpression(die),
        total: deferred ? null : toFiniteNumber(die.total),
        totalText: deferred || die.total === undefined || die.total === null ? null : String(die.total),
        faces: toFiniteNumber(die.faces),
        number: toFiniteNumber(die.number),
        sourceLabel: damageTypeLabel(instance.type),
        sourceDetail: instance.persistent ? systemText(deferred ? "Pf2e.PersistentHint" : "Pf2e.Persistent") : null,
        muted: deferred,
        confidence: "exact"
      }));
    });
    // The instance pool is shown per instance below instead of as one computed term.
    breakdown.computedTerms = [];
    breakdown.modifiers = getRawModifiers(flags)
      .filter((modifier) => isEnabled(modifier) && appliesToDegree(modifier, isCritical))
      .map(toModifierRow);
    breakdown.totalStaticModifier = sumValues(breakdown.modifiers);
    summarizeBreakdown(breakdown);
  }

  const instanceSection = createSection(systemText("Pf2e.DamageParts"), instances.map((instance) => {
    const deferred = isDeferredPersistent(instance);
    return createItem({
      text: instanceExpression(instance),
      tag: damageTag(instance.type, instance.persistent),
      value: deferred || toFiniteNumber(instance.total) === null ? null : String(instance.total),
      tooltip: deferred ? systemText("Pf2e.PersistentHint") : null,
      muted: deferred
    });
  }));

  const extraDice = Array.isArray(flags?.dice)
    ? flags.dice.filter((dice) => dice && dice.enabled !== false && dice.ignored !== true && dice.diceNumber > 0 && dice.dieSize && appliesToDegree(dice, isCritical))
    : [];
  const diceSection = createSection(systemText("Pf2e.ExtraDice"), extraDice.map((dice) => createItem({
    text: localizeLabel(dice.label) ?? dice.slug,
    tag: damageTag(dice.damageType, dice.category === "persistent"),
    value: `${dice.diceNumber}${dice.dieSize}`
  })));

  const pills = [];
  if (isCritical) {
    const rule = roll.options.critRule === "double-dice" ? "Pf2e.CritDoubleDice" : roll.options.critRule === "double-damage" ? "Pf2e.CritDoubleDamage" : null;
    pills.push(createPill(systemText("Pf2e.Critical"), { emphasis: true, tooltip: rule ? systemText(rule) : null }));
  }

  return finalizeBreakdown(breakdown, {
    sections: [instanceSection, diceSection],
    pills,
    forceVisible: breakdown.diceTerms.length > 0
  });
}

export class Pf2eRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "pf2e";
    this.waitForCard = true;
  }

  supportsMessage(message) {
    return globalThis.game?.system?.id === "pf2e" && super.supportsMessage(message);
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();
    const isGM = isCurrentUserGM();
    const flags = message?.flags?.pf2e ?? {};
    const context = flags.context ?? null;

    return (message?.rolls ?? [])
      .map((roll, index) => {
        if (!roll) return null;
        // PF2e hides NPC breakdowns from players unless its metagame setting allows them.
        if (!isGM && roll.options?.showBreakdown === false) return null;
        if (index === 0 && isDamageRoll(roll, context)) return buildPf2eDamageBreakdown(roll, flags, { rollIndex: index });
        if (index === 0 && isCheckRoll(roll, context)) return buildPf2eCheckBreakdown(roll, flags, { rollIndex: index, isGM });
        if (isDamageRoll(roll, null)) return buildPf2eDamageBreakdown(roll, {}, { rollIndex: index });
        return keepNamed(parseRoll(roll, { adapterId: this.id, rollIndex: index }));
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
