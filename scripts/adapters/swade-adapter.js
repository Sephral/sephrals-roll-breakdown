import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermType, parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import {
  countText,
  createItem,
  createPill,
  createSection,
  finalizeBreakdown,
  isInstanceOf,
  systemText
} from "./system-adapter-utils.js";

// Data shapes follow the SWADE system source: TraitRoll is a kept highest PoolTerm of the trait die and the
// Wild Die (class WildDie), followed by labeled modifier terms; roll.options holds modifiers and targetNumber.
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
      aced: faces !== null && total !== null && total > faces
    };
  });
}

// TraitRoll#isCritfail and #successes
export function getTraitOutcome(total, dice, targetNumber) {
  if (total === null) return null;
  const ones = dice.filter((entry) => entry.total === 1).length;
  const majority = ones > dice.length / 2;
  const wild = dice.find((entry) => entry.wild);
  const critfail = wild ? majority && wild.total === 1 : majority;
  if (critfail) return { key: "CriticalFailure", raises: 0 };
  if (total < targetNumber) return { key: "Failure", raises: 0 };
  if (total < targetNumber + RAISE_STEP) return { key: "Success", raises: 0 };
  return { key: "Raise", raises: Math.floor((total - targetNumber) / RAISE_STEP) };
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

export function buildSwadeTraitBreakdown(roll, { rollIndex = 0 } = {}) {
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
  const outcome = dice.length ? getTraitOutcome(total, dice, targetNumber) : null;
  const pills = [createPill(systemText("Swade.TargetNumber", { tn: targetNumber }))];
  if (outcome) {
    const text = outcome.key === "Raise"
      ? countText("Swade.Outcome.Raise", outcome.raises)
      : systemText(`Swade.Outcome.${outcome.key}`);
    pills.push(createPill(text, { emphasis: true }));
  }

  return finalizeBreakdown(breakdown, {
    sections: [buildIgnoredSection(roll)],
    pills,
    forceVisible: breakdown.diceTerms.length > 0
  });
}

export function buildSwadeDamageBreakdown(roll, { rollIndex = 0 } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "swade", rollIndex });
  for (const term of breakdown.diceTerms) {
    if (Number.isFinite(term.faces) && Number.isFinite(term.number) && Number.isFinite(term.total) && term.total > term.faces * term.number) {
      term.notes = [systemText("Swade.Aced")];
    }
  }

  const pills = [];
  const ap = toFiniteNumber(roll?.options?.ap);
  if (ap) pills.push(createPill(systemText("Swade.ArmorPiercing", { ap })));
  if (roll?.options?.isHeavyWeapon) pills.push(createPill(systemText("Swade.HeavyWeapon")));

  return finalizeBreakdown(breakdown, {
    sections: [buildIgnoredSection(roll)],
    pills,
    forceVisible: breakdown.diceTerms.length > 0 && breakdown.modifiers.length > 0
  });
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
    return (message?.rolls ?? [])
      .map((roll, index) => {
        if (!roll) return null;
        if (isTraitRoll(roll)) return buildSwadeTraitBreakdown(roll, { rollIndex: index });
        if (isDamageRoll(roll)) return buildSwadeDamageBreakdown(roll, { rollIndex: index });
        return parseRoll(roll, { adapterId: this.id, rollIndex: index });
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
