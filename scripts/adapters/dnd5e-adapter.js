import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermExpression, getTermType, hasNestedDice, isDiceTerm, parseRoll, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded, localizeSystemTranslation } from "../settings.js";

function sanitizeExpression(expression) {
  return String(expression ?? "")
    .replace(/^\s*[+]+\s*/, "")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeRuleKey(value) {
  return normalizeText(value)
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return normalizeRuleKey(String(value ?? "").replace(/[-_]+/g, " "));
}

function localizeRule(key, data) {
  return localizeSystemTranslation(`SRB.Rule.${key}`, data);
}

function localizeVersionedRule(key, rulesVersion, data) {
  if (rulesVersion) {
    const localized = localizeSystemTranslation(`SRB.Rule.${key}.${rulesVersion}`, data);
    const versionedKey = `SRB.Rule.${key}.${rulesVersion}`;
    if (localized && localized !== versionedKey) return localized;
  }

  return localizeRule(key, data);
}

function joinDetails(...parts) {
  return parts.filter((part) => typeof part === "string" && part.trim().length > 0).join(" | ");
}

function getRulesVersion(document) {
  const value = String(document?.system?.source?.rules ?? "").trim();
  if (!value) return null;
  if (value.includes("2024")) return "2024";
  if (value.includes("2014")) return "2014";
  return value;
}

function getRulesVersionLabel(rulesVersion) {
  if (!rulesVersion) return null;
  return localizeRule(`Ruleset.${rulesVersion}`, null);
}

function createRulesVersionDetail(rulesVersion) {
  const label = getRulesVersionLabel(rulesVersion);
  if (!label) return null;
  return localizeRule("RulesetNote", { ruleset: label });
}

function resolveKnownRuleContext(label, actor, item) {
  const normalizedLabel = normalizeRuleKey(label);
  if (!normalizedLabel) return { key: "", rulesVersion: getRulesVersion(item) };

  const matchingItem = actor?.items?.find((candidate) => {
    const candidateName = normalizeRuleKey(candidate?.name);
    const candidateIdentifier = normalizeIdentifier(candidate?.system?.identifier);
    return candidateName === normalizedLabel || candidateIdentifier === normalizedLabel;
  });

  const key = normalizeIdentifier(matchingItem?.system?.identifier) || normalizeRuleKey(matchingItem?.name) || normalizedLabel;
  return {
    key,
    rulesVersion: getRulesVersion(matchingItem) || getRulesVersion(item)
  };
}

function localizeAbilityLabel(abilityKey) {
  const translated = game.i18n.localize(`DND5E.Ability${String(abilityKey ?? "").toUpperCase()}Abbr`);
  if (translated && translated !== `DND5E.Ability${String(abilityKey ?? "").toUpperCase()}Abbr`) return translated;

  const fallback = game.i18n.localize(`DND5E.Ability${String(abilityKey ?? "").toUpperCase()}`);
  if (fallback && fallback !== `DND5E.Ability${String(abilityKey ?? "").toUpperCase()}`) return fallback;

  return String(abilityKey ?? "").toUpperCase();
}

function inferAttackBucket(item) {
  const rangeValue = Number(item?.system?.range?.value ?? 0);
  const hasAmmunition = Boolean(item?.system?.ammunition?.type);
  const isSpell = item?.type === "spell";

  if (isSpell) return rangeValue > 5 ? "rsak" : "msak";
  return rangeValue > 5 || hasAmmunition ? "rwak" : "mwak";
}

function getBucketContextLabel(item) {
  const bucket = inferAttackBucket(item);
  return localizeRule(`Context.${bucket.toUpperCase()}`, null);
}

function getDamageContextLabel(item, activity) {
  if (activity?.type === "save" && item?.type === "spell") {
    return localizeRule("Context.SPELL_SAVE", null);
  }

  return getBucketContextLabel(item);
}

function getRollContextDetail(item, rollType) {
  const contextLabel = getBucketContextLabel(item);
  if (rollType === "damage") {
    return {
      effect: localizeRule("ActiveEffectDamage", { context: contextLabel }),
      actor: localizeRule("ActorBonusDamage", { context: contextLabel })
    };
  }

  return {
    effect: localizeRule("ActiveEffectAttack", { context: contextLabel }),
    actor: localizeRule("ActorBonusAttack", { context: contextLabel })
  };
}

function buildBaseDamageCandidates(item, activity) {
  const candidates = [];

  for (const part of activity?.damage?.parts ?? []) {
    const diceFormula = part.number && part.denomination ? `${part.number}d${part.denomination}` : null;
    const bonusFormula = sanitizeExpression(part.bonus);

    if (diceFormula) {
      candidates.push(...createCandidate("Base damage", diceFormula, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("BaseDamage", { item: item?.name ?? "Item" })
      }));
    }

    if (bonusFormula) {
      candidates.push(...createCandidate("Base bonus", bonusFormula, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("BaseBonus", { item: item?.name ?? "Item" })
      }));
    }
  }

  return candidates;
}

function getKnownRuleDetail(ruleContext, rollType) {
  const key = typeof ruleContext === "string" ? normalizeRuleKey(ruleContext) : normalizeRuleKey(ruleContext?.key);
  const rulesVersion = typeof ruleContext === "string" ? null : ruleContext?.rulesVersion;
  switch (`${key}:${rollType}`) {
    case "bless:attack":
      return localizeVersionedRule("Known.BlessAttack", rulesVersion, null);
    case "bane:attack":
      return localizeVersionedRule("Known.BaneAttack", rulesVersion, null);
    default:
      return null;
  }
}

function createFormulaDetail(expression) {
  const normalizedExpression = sanitizeExpression(expression);
  if (!normalizedExpression) return null;
  return localizeRule("FormulaSegment", { formula: normalizedExpression });
}

function createEffectDetail(effect, rollType, item, actor) {
  const detailText = getRollContextDetail(item, rollType);
  const ruleContext = resolveKnownRuleContext(effect?.name, actor, item);
  return joinDetails(
    getKnownRuleDetail(ruleContext, rollType),
    createRulesVersionDetail(ruleContext.rulesVersion),
    detailText.effect
  );
}

function createCandidate(label, expression, { sourceType = "effect", confidence = "labeled", detail = null } = {}) {
  const normalizedExpression = sanitizeExpression(expression);
  if (!normalizedExpression) return [];

  let roll;
  try {
    roll = Roll.create(normalizedExpression);
    if (!roll._evaluated && roll.isDeterministic) {
      roll.evaluateSync({ allowStrings: true });
    }
  } catch {
    return [];
  }

  let pendingOperator = "+";
  const segments = [];
  for (const term of roll.terms ?? []) {
    const termType = getTermType(term);
    if (termType === "OperatorTerm") {
      pendingOperator = String(term?.operator ?? "+").trim() === "-" ? "-" : "+";
      continue;
    }

    const rawNumericValue = toFiniteNumber(term?.total ?? term?.number ?? term?.term);
    const signedValue = rawNumericValue === null ? null : (pendingOperator === "-" ? -Math.abs(rawNumericValue) : Math.abs(rawNumericValue));
    segments.push({
      label,
      detail: joinDetails(detail, createFormulaDetail(getTermExpression(term))),
      sourceType,
      confidence,
      operator: pendingOperator,
      termType,
      expression: normalizeText(getTermExpression(term)),
      rawExpression: getTermExpression(term),
      signedValue,
      classification: isDiceTerm(term) ? "dice" : hasNestedDice(term) ? "computed" : rawNumericValue === null ? "unresolved" : "modifier"
    });
    pendingOperator = "+";
  }

  return segments;
}

function buildAttackSourceCandidates(actor, item, activity, message) {
  const bucket = inferAttackBucket(item);
  const effectKey = `system.bonuses.${bucket}.attack`;
  const candidates = [];
  const contextLabel = getBucketContextLabel(item);
  const detailText = getRollContextDetail(item, "attack");
  const abilityKey = activity?.ability;
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod) {
    candidates.push(...createCandidate(`${localizeAbilityLabel(abilityKey)} modifier`, `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("AttackAbility", { ability: localizeAbilityLabel(abilityKey), context: contextLabel })
    }));
  }

  const proficiencyBonus = toFiniteNumber(actor?.system?.attributes?.prof);
  if (proficiencyBonus) {
    candidates.push(...createCandidate(game.i18n.localize("DND5E.Proficiency") || "Proficiency bonus", `${proficiencyBonus}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const attackBonus = sanitizeExpression(activity?.attackBonus);
  if (attackBonus) {
    candidates.push(...createCandidate(`${item?.name ?? "Item"} attack bonus`, attackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  for (const effect of actor?.effects ?? []) {
    for (const change of effect.changes ?? []) {
      if (change?.key !== effectKey) continue;
      candidates.push(...createCandidate(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "attack", item, actor)
      }));
    }
  }

  const actorBonus = sanitizeExpression(actor?.system?.bonuses?.[bucket]?.attack);
  if (actorBonus) {
    candidates.push(...createCandidate("Actor attack bonus", actorBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: detailText.actor
    }));
  }

  if (message?.flags?.dnd5e?.roll?.ammunition) {
    const ammunition = actor?.items?.get?.(message.flags.dnd5e.roll.ammunition);
    const ammoBonus = sanitizeExpression(ammunition?.system?.bonus);
    if (ammoBonus) {
      candidates.push(...createCandidate(ammunition.name, ammoBonus, {
        sourceType: "item",
        confidence: "derived",
        detail: localizeRule("AmmunitionBonus", { item: ammunition.name })
      }));
    }
  }

  return candidates;
}

function buildDamageSourceCandidates(actor, item, activity) {
  const bucket = inferAttackBucket(item);
  const effectKey = `system.bonuses.${bucket}.damage`;
  const candidates = [];
  const contextLabel = getDamageContextLabel(item, activity);
  const detailText = activity?.type === "save" && item?.type === "spell"
    ? {
        effect: localizeRule("ActiveEffectDamage", { context: contextLabel }),
        actor: localizeRule("ActorBonusDamage", { context: contextLabel })
      }
    : getRollContextDetail(item, "damage");

  candidates.push(...buildBaseDamageCandidates(item, activity));

  for (const effect of actor?.effects ?? []) {
    for (const change of effect.changes ?? []) {
      if (change?.key !== effectKey) continue;
      candidates.push(...createCandidate(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "damage", item, actor)
      }));
    }
  }

  const abilityKey = activity?.ability;
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod) {
    candidates.push(...createCandidate(`${localizeAbilityLabel(abilityKey)} modifier`, `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("DamageAbility", { ability: localizeAbilityLabel(abilityKey) })
    }));
  }

  const actorBonus = sanitizeExpression(actor?.system?.bonuses?.[bucket]?.damage);
  if (actorBonus) {
    candidates.push(...createCandidate("Actor damage bonus", actorBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: detailText.actor
    }));
  }

  return candidates;
}

function getSegmentMatchScore(payload, segment) {
  if (!segment || segment.classification !== payload.classification) return -1;
  const payloadExpression = normalizeText(payload.expression);
  if (payload.classification === "dice") {
    return segment.expression === payloadExpression ? 100 : -1;
  }

  if (payload.classification === "modifier" || payload.classification === "computed") {
    if (segment.signedValue === null || payload.signedValue === null || segment.signedValue !== payload.signedValue) return -1;

    let score = 20;
    if (segment.expression === payloadExpression) score += 100;
    else if (payloadExpression && segment.expression && (payloadExpression.includes(segment.expression) || segment.expression.includes(payloadExpression))) score += 40;
    if (segment.termType === payload.termType) score += 30;
    if (segment.operator === payload.operator) score += 5;
    return score;
  }

  return segment.expression === payloadExpression ? 100 : -1;
}

function createTermSourceResolver(candidates) {
  const queue = [...candidates];

  return (payload) => {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < queue.length; index += 1) {
      const segment = queue[index];
      const score = getSegmentMatchScore(payload, segment);
      if (score <= bestScore) continue;
      bestScore = score;
      bestIndex = index;
    }

    if (bestIndex === -1) return null;

    const [segment] = queue.splice(bestIndex, 1);
    return {
      sourceLabel: segment.label,
      sourceDetail: segment.detail,
      confidence: segment.confidence,
      sourceType: segment.sourceType,
      kind: payload.classification === "modifier" && segment.confidence === "exact" ? "static" : undefined
    };

  };
}

export class Dnd5eRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "dnd5e";
  }

  supportsMessage(message) {
    return game.system?.id === "dnd5e" && Array.isArray(message?.rolls) && message.rolls.length > 0;
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();

    const activityUuid = message?.flags?.dnd5e?.activity?.uuid;
    const itemUuid = message?.flags?.dnd5e?.item?.uuid;
    const rollType = message?.flags?.dnd5e?.roll?.type;
    if (!activityUuid || !itemUuid || !rollType) return super.buildBreakdowns(message);

    const item = await fromUuid(itemUuid);
    const activity = await fromUuid(activityUuid);
    const actor = item?.actor;
    if (!item || !activity || !actor) return super.buildBreakdowns(message);

    const candidates = rollType === "attack"
      ? buildAttackSourceCandidates(actor, item, activity, message)
      : buildDamageSourceCandidates(actor, item, activity, message);

    return (message?.rolls ?? [])
      .filter((roll) => Boolean(roll))
      .map((roll, index) => parseRoll(roll, {
        adapterId: this.id,
        rollIndex: index,
        termSourceResolver: createTermSourceResolver(candidates)
      }))
      .filter((breakdown) => breakdown.hasVisibleContent);
  }
}