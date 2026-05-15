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

function getCheckContextLabel(rollType, rollId = null) {
  if (rollType === "save") return localizeRule("Context.SAVE", null);
  if (rollType === "concentration") return localizeRule("Context.CONCENTRATION", null);
  if (rollType === "death") return localizeRule("Context.DEATH", null);
  if (rollType === "skill") return rollId ? localizeRule("Context.SKILL", { skill: rollId }) : localizeRule("Context.SKILL_GENERIC", null);
  if (rollType === "tool") return rollId ? localizeRule("Context.TOOL", { tool: rollId }) : localizeRule("Context.TOOL_GENERIC", null);
  return localizeRule("Context.CHECK", null);
}

function getProficiencyLabel(multiplier) {
  if (multiplier >= 2) return localizeRule("Expertise", null);
  if (multiplier > 0 && multiplier < 1) return localizeRule("HalfProficiency", null);
  return game.i18n.localize("DND5E.Proficiency") || "Proficiency";
}

function getActorCheckDetail(rollType, abilityLabel, rollId = null) {
  if (rollType === "save") return localizeRule("SaveAbility", { ability: abilityLabel });
  if (rollType === "concentration") return localizeRule("ConcentrationAbility", { ability: abilityLabel });
  if (rollType === "death") return localizeRule("DeathSaveAbility", { ability: abilityLabel });
  if (rollType === "skill") return localizeRule("SkillAbility", { ability: abilityLabel });
  if (rollType === "tool") return localizeRule("ToolAbility", { ability: abilityLabel });
  return localizeRule("CheckAbility", { ability: abilityLabel });
}

function resolveActorRollAbility(actor, rollType, rollFlags) {
  if (rollType === "skill") return actor.system?.skills?.[rollFlags.skillId]?.ability;
  if (rollType === "tool") return actor.system?.tools?.[rollFlags.toolId]?.ability;
  if (rollType === "concentration") {
    return actor.system?.attributes?.concentration?.ability
      ?? CONFIG.DND5E?.defaultAbilities?.concentration
      ?? rollFlags.ability;
  }

  if (rollType === "death") return null;
  return rollFlags.ability;
}

function getFirstAvailableAbility(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value.first === "function") {
    const first = value.first();
    return typeof first === "string" && first.trim() ? first.trim() : null;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    return first?.trim() ?? null;
  }

  if (value instanceof Set) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
    }
  }

  return null;
}

function resolveSpellcastingAbility(actor, item, activity) {
  const activityAbility = getFirstAvailableAbility(activity?.availableAbilities);
  if (activityAbility) return activityAbility;

  const itemAbility = getFirstAvailableAbility(item?.system?.availableAbilities);
  if (itemAbility) return itemAbility;

  const classIdentifier = String(item?.system?.classIdentifier ?? "").trim();
  const classAbility = actor?.spellcastingClasses?.[classIdentifier]?.spellcasting?.ability;
  if (typeof classAbility === "string" && classAbility.trim()) return classAbility.trim();

  const actorAbility = actor?.system?.attributes?.spellcasting;
  if (typeof actorAbility === "string" && actorAbility.trim()) return actorAbility.trim();

  return null;
}

function resolveActivityAbility(actor, item, activity) {
  const directAbility = [
    activity?.ability,
    activity?.attack?.ability,
    activity?.damage?.ability,
    activity?.check?.ability,
    activity?.save?.ability,
    activity?.system?.ability,
    item?.system?.ability
  ].find((value) => typeof value === "string" && value.trim());

  if (directAbility && directAbility !== "spellcasting") return directAbility.trim();
  return resolveSpellcastingAbility(actor, item, activity);
}

function resolveActivityAttackBonus(activity) {
  return sanitizeExpression(activity?.attack?.bonus ?? activity?.attackBonus);
}

function matchesItemAttackBonusKey(changeKey, activityId) {
  if (typeof changeKey !== "string") return false;
  return changeKey === "system.attack.bonus"
    || changeKey === `system.activities.${activityId}.attack.bonus`;
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
  const abilityKey = resolveActivityAbility(actor, item, activity);
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

  const attackBonus = resolveActivityAttackBonus(activity);
  if (attackBonus) {
    candidates.push(...createCandidate(`${item?.name ?? "Item"} attack bonus`, attackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const itemAttackBonus = sanitizeExpression(item?.system?.attack?.bonus);
  if (itemAttackBonus) {
    candidates.push(...createCandidate(`${item?.name ?? "Item"} attack bonus`, itemAttackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const magicalAttackBonus = item?.system?.magicAvailable ? sanitizeExpression(item?.system?.magicalBonus) : "";
  if (magicalAttackBonus) {
    candidates.push(...createCandidate(`${item?.name ?? "Item"} attack bonus`, magicalAttackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  for (const effect of item?.effects ?? []) {
    for (const change of effect.changes ?? []) {
      if (!matchesItemAttackBonusKey(change?.key, activity?.id)) continue;
      candidates.push(...createCandidate(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "attack", item, actor)
      }));
    }
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

  const abilityKey = resolveActivityAbility(actor, item, activity);
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

function buildActorRollSourceCandidates(actor, message) {
  const rollType = resolveMessageRollType(message);
  const rollFlags = message?.flags?.dnd5e?.roll ?? {};
  if (!["ability", "save", "skill", "tool", "concentration", "death"].includes(rollType) || !actor) return [];

  const candidates = [];
  const abilityId = resolveActorRollAbility(actor, rollType, rollFlags);
  const abilityLabel = abilityId ? localizeAbilityLabel(abilityId) : null;
  const ability = actor.system?.abilities?.[abilityId];
  const rollId = rollType === "skill" ? rollFlags.skillId : rollType === "tool" ? rollFlags.toolId : null;
  const contextLabel = getCheckContextLabel(rollType, rollId);

  const abilityMod = toFiniteNumber(ability?.mod);
  if (abilityId && abilityMod) {
    candidates.push(...createCandidate(`${abilityLabel} modifier`, `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: getActorCheckDetail(rollType, abilityLabel, rollId)
    }));
  }

  if (rollType === "death") {
    if (actor.flags?.dnd5e?.diamondSoul) {
      const proficiencyBonus = toFiniteNumber(actor.system?.attributes?.prof);
      if (proficiencyBonus) {
        candidates.push(...createCandidate(game.i18n.localize("DND5E.Proficiency") || "Proficiency", `${proficiencyBonus}`, {
          sourceType: "standard",
          confidence: "exact",
          detail: localizeRule("Proficiency", { context: contextLabel })
        }));
      }
    }

    const deathBonus = sanitizeExpression(actor.system?.attributes?.death?.bonuses?.save);
    if (deathBonus) {
      candidates.push(...createCandidate(localizeRule("DeathSaveBonusLabel", null), deathBonus, {
        sourceType: "actor",
        confidence: "exact",
        detail: localizeRule("DeathSaveBonus", null)
      }));
    }

    return candidates;
  }

  if (rollType === "ability" || rollType === "save" || rollType === "concentration") {
    const proficiency = ability?.[`${rollType === "ability" ? "check" : "save"}Prof`];
    if (proficiency?.hasProficiency) {
      candidates.push(...createCandidate(getProficiencyLabel(proficiency.multiplier), proficiency.term, {
        sourceType: "standard",
        confidence: "exact",
        detail: localizeRule("Proficiency", { context: contextLabel })
      }));
    }

    const abilityBonus = sanitizeExpression(ability?.bonuses?.[rollType === "ability" ? "check" : "save"]);
    if (abilityBonus) {
      candidates.push(...createCandidate(`${abilityLabel} ${rollType === "ability" ? localizeRule("CheckBonusLabel", null) : localizeRule("SaveBonusLabel", null)}`, abilityBonus, {
        sourceType: "actor",
        confidence: "exact",
        detail: getActorCheckDetail(rollType, abilityLabel, rollId)
      }));
    }

    const globalBonus = sanitizeExpression(actor.system?.bonuses?.abilities?.[rollType === "ability" ? "check" : "save"]);
    if (globalBonus) {
      candidates.push(...createCandidate(rollType === "ability" ? localizeRule("GlobalCheckBonus", null) : localizeRule("GlobalSaveBonus", null), globalBonus, {
        sourceType: "actor",
        confidence: "derived",
        detail: localizeRule("GlobalBonusContext", { context: contextLabel })
      }));
    }

    if (rollType === "concentration") {
      const concentrationBonus = sanitizeExpression(actor.system?.attributes?.concentration?.bonuses?.save);
      if (concentrationBonus) {
        candidates.push(...createCandidate(localizeRule("ConcentrationBonusLabel", null), concentrationBonus, {
          sourceType: "actor",
          confidence: "exact",
          detail: localizeRule("ConcentrationBonus", null)
        }));
      }
    }

    const coverBonus = rollType === "save" && rollFlags.ability === "dex"
      ? sanitizeExpression(actor.system?.attributes?.ac?.cover)
      : "";
    if (coverBonus) {
      candidates.push(...createCandidate(localizeRule("Cover", null), coverBonus, {
        sourceType: "actor",
        confidence: "exact",
        detail: localizeRule("CoverBonus", null)
      }));
    }

    return candidates;
  }

  const relevant = rollType === "skill" ? actor.system?.skills?.[rollFlags.skillId] : actor.system?.tools?.[rollFlags.toolId];
  const proficiency = relevant?.prof;
  if (proficiency?.hasProficiency) {
    candidates.push(...createCandidate(getProficiencyLabel(proficiency.multiplier), proficiency.term, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const relevantBonus = sanitizeExpression(relevant?.bonuses?.check);
  if (relevantBonus) {
    candidates.push(...createCandidate(
      rollType === "skill"
        ? (CONFIG.DND5E.skills?.[rollFlags.skillId]?.label ?? rollFlags.skillId ?? localizeRule("SkillBonusLabel", null))
        : (CONFIG.DND5E.tools?.[rollFlags.toolId]?.label ?? rollFlags.toolId ?? localizeRule("ToolBonusLabel", null)),
      relevantBonus,
      {
        sourceType: "actor",
        confidence: "exact",
        detail: localizeRule(rollType === "skill" ? "SkillBonus" : "ToolBonus", { context: contextLabel })
      }
    ));
  }

  const abilityCheckBonus = sanitizeExpression(ability?.bonuses?.check);
  if (abilityCheckBonus) {
    candidates.push(...createCandidate(`${abilityLabel} ${localizeRule("CheckBonusLabel", null)}`, abilityCheckBonus, {
      sourceType: "actor",
      confidence: "exact",
      detail: getActorCheckDetail(rollType, abilityLabel, rollId)
    }));
  }

  const typeBonus = sanitizeExpression(actor.system?.bonuses?.abilities?.[rollType]);
  if (typeBonus) {
    candidates.push(...createCandidate(
      rollType === "skill" ? localizeRule("GlobalSkillBonus", null) : localizeRule("GlobalToolBonus", null),
      typeBonus,
      {
        sourceType: "actor",
        confidence: "derived",
        detail: localizeRule("GlobalBonusContext", { context: contextLabel })
      }
    ));
  }

  const globalCheckBonus = sanitizeExpression(actor.system?.bonuses?.abilities?.check);
  if (globalCheckBonus) {
    candidates.push(...createCandidate(localizeRule("GlobalCheckBonus", null), globalCheckBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: localizeRule("GlobalBonusContext", { context: contextLabel })
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

async function resolveMessageItem(message) {
  const itemUuid = message?.flags?.dnd5e?.item?.uuid;
  if (itemUuid) {
    const item = await fromUuid(itemUuid);
    if (item) return item;
  }

  const actor = message?.getAssociatedActor?.() ?? null;
  const itemId = message?.flags?.dnd5e?.item?.id;
  if (actor && itemId) {
    const item = actor.items?.get?.(itemId) ?? actor.items?.find?.((candidate) => candidate?.id === itemId) ?? null;
    if (item) return item;
  }

  return null;
}

async function resolveMessageActivity(message, item, actor) {
  const activityUuid = message?.flags?.dnd5e?.activity?.uuid;
  if (activityUuid) {
    const activity = await fromUuid(activityUuid);
    if (activity) return activity;
  }

  const causeRelativeUuid = message?.system?.cause;
  if (causeRelativeUuid && actor && typeof fromUuid === "function") {
    const activity = await fromUuid(causeRelativeUuid, { relative: actor, strict: false });
    if (activity) return activity;
  }

  const activityId = message?.flags?.dnd5e?.activity?.id;
  if (item && activityId) {
    const activity = item.system?.activities?.get?.(activityId)
      ?? item.system?.activities?.find?.((candidate) => candidate?.id === activityId)
      ?? null;
    if (activity) return activity;
  }

  return null;
}

function resolveMessageRollType(message, roll = null) {
  return roll?.options?.rollType
    ?? roll?.options?.["midi-qol"]?.rollType
    ?? message?.flags?.dnd5e?.roll?.type
    ?? message?.rolls?.find?.((candidate) => typeof candidate?.options?.rollType === "string")?.options?.rollType
    ?? message?.flags?.dnd5e?.activity?.type
    ?? message?.flags?.["midi-qol"]?.messageType
    ?? null;
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

    const rollType = resolveMessageRollType(message);
    if (!rollType) return super.buildBreakdowns(message);

    const item = await resolveMessageItem(message);
    const actor = item?.actor ?? message?.getAssociatedActor?.() ?? null;
    const activity = await resolveMessageActivity(message, item, actor);
    const actorRollCandidates = actor && ["ability", "save", "skill", "tool", "concentration", "death"].includes(rollType)
      ? buildActorRollSourceCandidates(actor, message)
      : null;
    const attackCandidates = item && activity && actor
      ? buildAttackSourceCandidates(actor, item, activity, message)
      : null;
    const damageCandidates = item && activity && actor
      ? buildDamageSourceCandidates(actor, item, activity, message)
      : null;

    return (message?.rolls ?? [])
      .filter((roll) => Boolean(roll))
      .map((roll, index) => {
        const currentRollType = resolveMessageRollType(message, roll) ?? rollType;
        const candidates = ["ability", "save", "skill", "tool", "concentration", "death"].includes(currentRollType)
          ? actorRollCandidates
          : currentRollType === "attack"
            ? attackCandidates
            : currentRollType === "damage"
              ? damageCandidates
              : null;

        return parseRoll(roll, {
          adapterId: this.id,
          rollIndex: index,
          termSourceResolver: candidates ? createTermSourceResolver(candidates) : null
        });
      })
      .filter((breakdown) => breakdown.hasVisibleContent);
  }
}