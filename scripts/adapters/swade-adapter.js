import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermType, isDiceTerm, parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import {
  countText,
  createItem,
  createPill,
  createSection,
  finalizeBreakdown,
  isInstanceOf,
  keepNamed,
  systemText
} from "./system-adapter-utils.js";

// Data shapes follow the SWADE system source: TraitRoll is a kept highest PoolTerm of the trait dice and the
// Wild Die (class WildDie), followed by labeled modifier terms; roll.options holds modifiers and targetNumber.
// Extras confirm a critical failure with an extra SwadeRoll (options.critfailConfirmationRoll) in the same message.
const DEFAULT_TARGET_NUMBER = 4;
const RAISE_STEP = 4;

function getPoolTerm(roll) {
  const term = roll?.terms?.[0];
  if (!term || !Array.isArray(term.rolls) || !term.rolls.length) return null;
  if (getTermType(term) === "PoolTerm" || isInstanceOf(term, globalThis.foundry?.dice?.terms?.PoolTerm, "PoolTerm")) return term;
  return null;
}

function isTraitRoll(roll) {
  return isInstanceOf(roll, null, "TraitRoll") || (roll?.options?.rollType === "trait" && Boolean(getPoolTerm(roll)));
}

function isDamageRoll(roll) {
  return isInstanceOf(roll, null, "DamageRoll");
}

function isWildDie(die) {
  return isInstanceOf(die, null, "WildDie");
}

// An exploding die that rolled its maximum at least once
function hasAced(die, total = null) {
  if (Array.isArray(die?.results) && die.results.some((result) => result?.exploded)) return true;
  const faces = toFiniteNumber(die?.faces);
  const number = toFiniteNumber(die?.number) ?? 1;
  return faces !== null && total !== null && total > faces * number;
}

// The die without its flavor, e.g. "2d8x" instead of "2d8x[Base Damage]"
function dieExpression(expression) {
  return String(expression ?? "").replace(/\[[^\]]*\]$/, "");
}

function getPoolDice(pool) {
  return pool.rolls.map((poolRoll, index) => {
    const die = poolRoll?.dice?.[0] ?? poolRoll?.terms?.[0] ?? null;
    const faces = toFiniteNumber(die?.faces);
    const total = toFiniteNumber(poolRoll?.total ?? die?.total);
    return {
      die,
      faces,
      total,
      wild: isWildDie(die),
      label: typeof die?.flavor === "string" && die.flavor.trim() ? die.flavor.trim() : null,
      discarded: Boolean(pool.results?.[index]?.discarded),
      aced: hasAced(die, total)
    };
  });
}

// TraitRoll#isCritfail: most dice show a 1 (with a Wild Die, the Wild Die must be one of them)
function isRollCritfail(dice) {
  const ones = dice.filter((entry) => entry.total === 1).length;
  const majority = ones > dice.length / 2;
  const wild = dice.find((entry) => entry.wild);
  return wild ? majority && wild.total === 1 : majority;
}

// SwadeChatMessage#isCritfail and #hasConfirmedCritfail: Wild Cards, group rolls and rolls with several dice fail
// critically right away. A single die of an Extra is only a possible critical failure until a confirmation die is
// rolled, and only a 1 on that die confirms it.
function getCritfailState(dice, { wildcard = null, confirmations = [] } = {}) {
  if (!dice.length || !isRollCritfail(dice)) return null;
  if (wildcard === true || dice.length > 1) return "CriticalFailure";
  if (!confirmations.length) return "PossibleCriticalFailure";
  return confirmations.every((total) => total === 1) ? "CriticalFailure" : null;
}

// TraitRoll#successes for one result
function getResultOutcome(total, targetNumber) {
  if (total < targetNumber) return { key: "Failure", raises: 0 };
  if (total < targetNumber + RAISE_STEP) return { key: "Success", raises: 0 };
  return { key: "Raise", raises: Math.floor((total - targetNumber) / RAISE_STEP) };
}

export function getTraitOutcome(total, dice, targetNumber, critfailContext = {}) {
  if (total === null) return null;
  const critfail = getCritfailState(dice, critfailContext);
  if (critfail) return { key: critfail, raises: 0 };
  return getResultOutcome(total, targetNumber);
}

function outcomeText(outcome) {
  return outcome.key === "Raise" ? countText("Swade.Outcome.Raise", outcome.raises) : systemText(`Swade.Outcome.${outcome.key}`);
}

function buildIgnoredSection(roll) {
  const modifiers = Array.isArray(roll?.options?.modifiers) ? roll.options.modifiers : [];
  const items = modifiers
    .filter((modifier) => modifier && modifier.ignore === true)
    .map((modifier) => createItem({
      text: String(modifier.label ?? "?"),
      value: String(modifier.value ?? ""),
      tooltip: systemText("Swade.NotCountedHint"),
      muted: true
    }));
  return createSection(systemText("Swade.NotCounted"), items);
}

// With a rate of fire above 1 every kept trait die is a result of its own: the die plus all modifiers.
function buildResultsSection(dice, modifierTotal, targetNumber, critfail) {
  const kept = dice.filter((entry) => !entry.discarded && entry.total !== null);
  if (kept.length < 2) return null;
  return createSection(systemText("Swade.Results"), kept.map((entry) => {
    const result = entry.total + modifierTotal;
    return createItem({
      text: entry.label ?? systemText(entry.wild ? "Swade.WildDie" : "Swade.TraitDie"),
      tag: critfail ? null : outcomeText(getResultOutcome(result, targetNumber)),
      value: String(result)
    });
  }));
}

export function buildSwadeTraitBreakdown(roll, { rollIndex = 0, wildcard = null, confirmations = [] } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "swade", rollIndex });
  const pool = getPoolTerm(roll);
  const dice = pool ? getPoolDice(pool) : [];

  if (pool) {
    // The pool appears as one computed term in the generic parse, the dice below replace it.
    breakdown.computedTerms = breakdown.computedTerms.filter((term) => term.type !== getTermType(pool));
    breakdown.diceTerms = dice.map((entry) => ({
      expression: entry.faces === null ? "?" : `1d${entry.faces}`,
      total: entry.total,
      totalText: entry.total === null ? null : String(entry.total),
      faces: entry.faces,
      number: 1,
      sourceLabel: entry.label ?? (entry.wild ? systemText("Swade.WildDie") : systemText("Swade.TraitDie")),
      sourceDetail: entry.wild ? systemText("Swade.WildDieHint") : null,
      notes: [entry.discarded ? systemText("Swade.Dropped") : null, entry.aced ? systemText("Swade.Aced") : null].filter(Boolean),
      muted: entry.discarded,
      confidence: "exact"
    }));
    summarizeBreakdown(breakdown);
  }

  const total = toFiniteNumber(roll?.total);
  const targetNumber = toFiniteNumber(roll?.options?.targetNumber) ?? DEFAULT_TARGET_NUMBER;
  const critfail = getCritfailState(dice, { wildcard, confirmations });
  const kept = dice.filter((entry) => !entry.discarded);
  const pills = [createPill(systemText("Swade.TargetNumber", { tn: targetNumber }))];
  let resultsSection = null;

  if (kept.length > 1 && total !== null) {
    // The sum of several kept dice is no result in SWADE, so the panel lists each result instead of a total.
    const modifierTotal = total - kept.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
    resultsSection = buildResultsSection(dice, modifierTotal, targetNumber, critfail);
    breakdown.rollTotal = null;
    if (critfail) pills.push(createPill(systemText(`Swade.Outcome.${critfail}`), { emphasis: true, tooltip: critfailHint(critfail) }));
  } else if (dice.length) {
    const outcome = getTraitOutcome(total, dice, targetNumber, { wildcard, confirmations });
    if (outcome) pills.push(createPill(outcomeText(outcome), { emphasis: true, tooltip: critfailHint(outcome.key) }));
  }

  return finalizeBreakdown(breakdown, {
    sections: [resultsSection, buildIgnoredSection(roll)],
    pills,
    forceVisible: breakdown.diceTerms.length > 0
  });
}

function critfailHint(key) {
  return key === "PossibleCriticalFailure" ? systemText("Swade.PossibleCriticalFailureHint") : null;
}

export function buildSwadeDamageBreakdown(roll, { rollIndex = 0 } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "swade", rollIndex });
  // Top level dice in formula order, the same order the generic parse lists them in
  const dice = (roll?.terms ?? []).filter((term) => isDiceTerm(term));
  breakdown.diceTerms.forEach((term, index) => {
    term.expression = dieExpression(term.expression);
    if (hasAced(dice[index], term.total)) term.notes = [systemText("Swade.Aced")];
  });

  const pills = [];
  const ap = toFiniteNumber(roll?.options?.ap);
  if (ap) pills.push(createPill(systemText("Swade.ArmorPiercing", { ap })));
  if (roll?.options?.isHeavyWeapon) pills.push(createPill(systemText("Swade.HeavyWeapon")));

  // Strength die plus weapon die is the usual melee damage, and an ace is worth explaining as well.
  const explains = breakdown.modifiers.length > 0 || breakdown.diceTerms.length > 1 || breakdown.diceTerms.some((term) => term.notes?.length);
  return finalizeBreakdown(breakdown, {
    sections: [buildIgnoredSection(roll)],
    pills,
    forceVisible: breakdown.diceTerms.length > 0 && explains
  });
}

function getConfirmationTotals(message) {
  return (message?.rolls ?? [])
    .filter((roll) => roll?.options?.critfailConfirmationRoll)
    .map((roll) => toFiniteNumber(roll.total))
    .filter((total) => total !== null);
}

export class SwadeRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "swade";
  }

  supportsMessage(message) {
    return globalThis.game?.system?.id === "swade" && super.supportsMessage(message);
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();
    const confirmations = getConfirmationTotals(message);
    const isWildcard = message?.speakerActor?.isWildcard;
    const wildcard = typeof isWildcard === "boolean" ? isWildcard : null;
    return (message?.rolls ?? [])
      .map((roll, index) => {
        if (!roll) return null;
        // The confirmation die of an Extra is part of the trait roll's result
        if (roll.options?.critfailConfirmationRoll) return null;
        if (isTraitRoll(roll)) return buildSwadeTraitBreakdown(roll, { rollIndex: index, wildcard, confirmations });
        if (isDamageRoll(roll)) return buildSwadeDamageBreakdown(roll, { rollIndex: index });
        return keepNamed(parseRoll(roll, { adapterId: this.id, rollIndex: index }));
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
