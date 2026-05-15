export function getTermType(term) {
  return term?.constructor?.name ?? "UnknownTerm";
}

export function getTermExpression(term) {
  const value = term?.formula ?? term?.expression ?? term?.operator ?? term?.total ?? term?.number;
  return value === undefined || value === null ? "" : String(value).trim();
}

function getSourceLabel(term) {
  const candidates = [
    term?.flavor,
    term?.label,
    term?.options?.flavor,
    term?.options?.label,
    term?.options?.source,
    term?.options?.name,
    term?.roll?.options?.flavor,
    term?.roll?.options?.label,
    term?.roll?.options?.source,
    term?.roll?.options?.name
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (normalized) return normalized;
  }

  return null;
}

function normalizeOperator(term) {
  const raw = String(term?.operator ?? term?.formula ?? "+").trim();
  return raw === "-" ? "-" : raw === "+" ? "+" : raw;
}

export function isDiceTerm(term) {
  const diceTermClass = globalThis.foundry?.dice?.terms?.DiceTerm;
  if (diceTermClass && term instanceof diceTermClass) return true;

  const termType = getTermType(term);
  return termType === "DiceTerm" || termType === "Die" || termType === "Coin" || termType === "FateDie";
}

export function hasNestedDice(term) {
  if (Array.isArray(term?.dice) && term.dice.length > 0) return true;
  if (Array.isArray(term?.roll?.dice) && term.roll.dice.length > 0) return true;
  if (Array.isArray(term?.rolls) && term.rolls.some((roll) => Array.isArray(roll?.dice) && roll.dice.length > 0)) return true;
  return false;
}

function formatSignedExpression(operator, expression) {
  if (!expression) return operator === "-" ? "- ?" : "?";
  return operator === "-" ? `- ${expression}` : expression;
}

export function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return value >= 0 ? `+${value}` : String(value);
}

function hasMeaningfulModifier(modifier) {
  return Number.isFinite(modifier?.value) && modifier.value !== 0;
}

function createUnresolvedTerm(term, operator) {
  const expression = getTermExpression(term);
  return {
    type: getTermType(term),
    expression: formatSignedExpression(operator, expression || "?"),
    sourceLabel: getSourceLabel(term),
    reason: hasNestedDice(term) ? "contains-dice" : "unresolved"
  };
}

function applySourceResolution(baseValue, resolution) {
  if (!resolution) return baseValue;

  return {
    ...baseValue,
    sourceLabel: resolution.sourceLabel ?? baseValue.sourceLabel ?? null,
    sourceDetail: resolution.sourceDetail ?? baseValue.sourceDetail ?? null,
    confidence: resolution.confidence ?? baseValue.confidence,
    kind: resolution.kind ?? baseValue.kind,
    sourceType: resolution.sourceType ?? baseValue.sourceType ?? null
  };
}

function resolveTermSource(termSourceResolver, payload, fallbackValue) {
  if (typeof termSourceResolver !== "function") return fallbackValue;
  return applySourceResolution(fallbackValue, termSourceResolver(payload));
}

function createModifier(term, operator, numericValue, kind) {
  const magnitude = kind === "static" ? Math.abs(numericValue) : numericValue;
  const signedValue = operator === "-" ? -Math.abs(magnitude) : magnitude;
  const sourceLabel = getSourceLabel(term);

  return {
    expression: formatSignedExpression(operator, getTermExpression(term) || Math.abs(magnitude)),
    sourceLabel,
    value: signedValue,
    valueText: formatSignedNumber(signedValue),
    kind,
    confidence: sourceLabel ? "labeled" : kind === "static" ? "resolved" : "derived"
  };
}

function createComputedTerm(term, operator, numericValue) {
  const sourceLabel = getSourceLabel(term);
  const signedValue = operator === "-" ? -Math.abs(numericValue) : numericValue;
  return {
    type: getTermType(term),
    expression: formatSignedExpression(operator, getTermExpression(term) || "?"),
    sourceLabel,
    total: signedValue,
    totalText: formatSignedNumber(signedValue),
    confidence: sourceLabel ? "labeled" : "derived"
  };
}

export function parseRoll(roll, { adapterId = "generic", rollIndex = 0, termSourceResolver = null } = {}) {
  const breakdown = {
    adapterId,
    rollIndex,
    formula: String(roll?.formula ?? "").trim(),
    rollTotal: toFiniteNumber(roll?.total),
    diceTerms: [],
    modifiers: [],
    computedTerms: [],
    unresolvedTerms: [],
    totalStaticModifier: 0,
    sourceConfidence: "resolved",
    sourceSummary: null,
    hasVisibleContent: false
  };

  let pendingOperator = "+";
  for (const [termIndex, term] of (roll?.terms ?? []).entries()) {
    const termType = getTermType(term);

    if (termType === "OperatorTerm") {
      pendingOperator = normalizeOperator(term);
      continue;
    }

    if (termType === "NumericTerm") {
      const numericValue = toFiniteNumber(term?.total ?? term?.number ?? term?.term);
      if (numericValue === null || !["+", "-"].includes(pendingOperator)) {
        breakdown.unresolvedTerms.push(resolveTermSource(termSourceResolver, {
          classification: "unresolved",
          adapterId,
          roll,
          rollIndex,
          term,
          termIndex,
          termType,
          operator: pendingOperator,
          expression: getTermExpression(term),
          signedValue: null
        }, createUnresolvedTerm(term, pendingOperator)));
      } else {
        const signedValue = pendingOperator === "-" ? -Math.abs(numericValue) : Math.abs(numericValue);
        const modifier = resolveTermSource(termSourceResolver, {
          classification: "modifier",
          adapterId,
          roll,
          rollIndex,
          term,
          termIndex,
          termType,
          operator: pendingOperator,
          expression: getTermExpression(term),
          signedValue,
          numericValue
        }, createModifier(term, pendingOperator, numericValue, "static"));
        breakdown.modifiers.push(modifier);
        breakdown.totalStaticModifier += modifier.value;
      }

      pendingOperator = "+";
      continue;
    }

    if (isDiceTerm(term)) {
      const diceTerm = resolveTermSource(termSourceResolver, {
        classification: "dice",
        adapterId,
        roll,
        rollIndex,
        term,
        termIndex,
        termType,
        operator: pendingOperator,
        expression: getTermExpression(term),
        signedValue: toFiniteNumber(term?.total)
      }, {
        expression: formatSignedExpression(pendingOperator, getTermExpression(term)),
        total: toFiniteNumber(term?.total),
        totalText: term?.total === undefined || term?.total === null ? null : String(term.total),
        faces: toFiniteNumber(term?.faces),
        number: toFiniteNumber(term?.number),
        sourceLabel: getSourceLabel(term),
        sourceDetail: null,
        sourceType: null
      });
      breakdown.diceTerms.push(diceTerm);
      pendingOperator = "+";
      continue;
    }

    const numericValue = toFiniteNumber(term?.total);
    if (numericValue !== null && ["+", "-"].includes(pendingOperator)) {
      if (hasNestedDice(term)) {
        breakdown.computedTerms.push(resolveTermSource(termSourceResolver, {
          classification: "computed",
          adapterId,
          roll,
          rollIndex,
          term,
          termIndex,
          termType,
          operator: pendingOperator,
          expression: getTermExpression(term),
          signedValue: pendingOperator === "-" ? -Math.abs(numericValue) : numericValue,
          numericValue
        }, createComputedTerm(term, pendingOperator, numericValue)));
      } else {
        const signedValue = pendingOperator === "-" ? -Math.abs(numericValue) : numericValue;
        breakdown.modifiers.push(resolveTermSource(termSourceResolver, {
          classification: "modifier",
          adapterId,
          roll,
          rollIndex,
          term,
          termIndex,
          termType,
          operator: pendingOperator,
          expression: getTermExpression(term),
          signedValue,
          numericValue
        }, createModifier(term, pendingOperator, numericValue, "derived")));
      }

      pendingOperator = "+";
      continue;
    }

    breakdown.unresolvedTerms.push(resolveTermSource(termSourceResolver, {
      classification: "unresolved",
      adapterId,
      roll,
      rollIndex,
      term,
      termIndex,
      termType,
      operator: pendingOperator,
      expression: getTermExpression(term),
      signedValue: null
    }, createUnresolvedTerm(term, pendingOperator)));
    pendingOperator = "+";
  }

  const labeledTermCount = [...breakdown.diceTerms, ...breakdown.modifiers, ...breakdown.computedTerms, ...breakdown.unresolvedTerms].filter(
    (term) => Boolean(term.sourceLabel)
  ).length;

  breakdown.sourceSummary = {
    labeledTermCount,
    derivedModifierCount: breakdown.modifiers.filter((modifier) => modifier.kind === "derived").length,
    computedTermCount: breakdown.computedTerms.length,
    unresolvedTermCount: breakdown.unresolvedTerms.length
  };

  const resolvedTerms = [
    ...breakdown.diceTerms,
    ...breakdown.modifiers,
    ...breakdown.computedTerms
  ];

  if (breakdown.unresolvedTerms.length > 0) {
    breakdown.sourceConfidence = "partial";
  } else if (resolvedTerms.some((term) => term.confidence === "derived")) {
    breakdown.sourceConfidence = "derived";
  } else {
    breakdown.sourceConfidence = "resolved";
  }

  breakdown.hasVisibleContent = Boolean(
    breakdown.modifiers.some((modifier) => hasMeaningfulModifier(modifier)) ||
    breakdown.computedTerms.length ||
    breakdown.unresolvedTerms.length
  );

  return breakdown;
}