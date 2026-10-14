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

  const substitution = Array.isArray(context?.substitutions) ? context.substitutions.find((entry) => entry?.selected) : null;
  if (substitution) {
    effects.add(substitution.effectType);
    items.push(createItem({
      text: localizeLabel(substitution.label) ?? substitution.slug,
      tag: systemText(substitution.effectType === "misfortune" ? "Pf2e.Misfortune" : "Pf2e.Fortune"),
      value: substitution.value === undefined ? null : String(substitution.value)
    }));
  }

  if (effects.has("fortune") && effects.has("misfortune")) {
    items.push(createItem({ text: systemText("Pf2e.Cancelled"), muted: true }));
  }
  return createSection(null, items, { placement: "top" });
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
    const unadjusted = OUTCOME_KEYS[context?.unadjustedOutcome];
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

export function buildPf2eDamageBreakdown(roll, flags, { rollIndex = 0 } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "pf2e", rollIndex });
  const instances = getDamageInstances(roll);

  if (instances.length) {
    breakdown.diceTerms = instances.flatMap((instance) => collectDice(instance).map((die) => ({
      expression: String(die.formula ?? `${die.number}d${die.faces}`),
      total: toFiniteNumber(die.total),
      totalText: die.total === undefined || die.total === null ? null : String(die.total),
      faces: toFiniteNumber(die.faces),
      number: toFiniteNumber(die.number),
      sourceLabel: damageTypeLabel(instance.type),
      sourceDetail: instance.persistent ? systemText("Pf2e.Persistent") : null,
      confidence: "exact"
    })));
    // The instance pool is shown per instance below instead of as one computed term.
    breakdown.computedTerms = [];
    breakdown.modifiers = getRawModifiers(flags).filter(isEnabled).map(toModifierRow);
    breakdown.totalStaticModifier = sumValues(breakdown.modifiers);
    summarizeBreakdown(breakdown);
  }

  const instanceSection = createSection(systemText("Pf2e.DamageParts"), instances.map((instance) => createItem({
    text: String(instance.formula ?? ""),
    tag: [damageTypeLabel(instance.type), instance.persistent ? systemText("Pf2e.Persistent") : null].filter(Boolean).join(", ") || null,
    value: toFiniteNumber(instance.total) === null ? null : String(instance.total)
  })));

  const extraDice = Array.isArray(flags?.dice)
    ? flags.dice.filter((dice) => dice && dice.enabled !== false && dice.ignored !== true && dice.diceNumber > 0 && dice.dieSize)
    : [];
  const diceSection = createSection(systemText("Pf2e.ExtraDice"), extraDice.map((dice) => createItem({
    text: localizeLabel(dice.label) ?? dice.slug,
    tag: damageTypeLabel(dice.damageType),
    value: `${dice.diceNumber}${dice.dieSize}`
  })));

  const pills = [];
  if (roll?.options?.degreeOfSuccess === 3) {
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
        return parseRoll(roll, { adapterId: this.id, rollIndex: index });
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
