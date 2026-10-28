import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermExpression, getTermType, hasNestedDice, isDiceTerm, parseRoll, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded, localizeSystemTranslation } from "../settings.js";

// dnd5e 6.0 moved the roll bonuses: bonuses.mwak.attack is rolls.attack.mwak.bonus, abilities.str.bonuses.check is
// abilities.str.check.roll.bonus, checkProf is check.prof and so on. The old paths still answer through deprecation
// getters until 6.2 or 7.0, and an unset bonus is missing at the new path, so the system version picks the path.
// Without a version (tests) the new path is read first.
function readMoved(source, newPath, oldPath) {
  const read = (path) => path.split(".").reduce((value, key) => value?.[key], source);
  const major = dnd5eMajorVersion();
  if (major !== null) return read(major >= 6 ? newPath : oldPath);
  const value = read(newPath);
  return value === undefined ? read(oldPath) : value;
}

function dnd5eMajorVersion() {
  const system = globalThis.game?.system;
  if (system?.id !== "dnd5e") return null;
  const major = Number.parseInt(String(system.version ?? ""), 10);
  return Number.isFinite(major) ? major : null;
}

// Active effect keys of a roll bonus in dnd5e 5.x and in 6.x (6.0 migrates the keys of existing effects).
function bonusEffectKeys(kind, bucket) {
  return new Set([`system.bonuses.${bucket}.${kind}`, `system.rolls.${kind}.${bucket}.bonus`]);
}

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

// Source labels in the panel. The English text stays as fallback, so a missing translation never shows a raw key.
function localizeRuleLabel(key, data, fallback) {
  const localized = localizeRule(key, data);
  return localized && localized !== `SRB.Rule.${key}` ? localized : fallback;
}

function abilityModifierLabel(abilityLabel) {
  return localizeRuleLabel("AbilityModifierLabel", { ability: abilityLabel }, `${abilityLabel} modifier`);
}

function itemAttackBonusLabel(item) {
  const name = item?.name ?? "Item";
  return localizeRuleLabel("ItemAttackBonusLabel", { item: name }, `${name} attack bonus`);
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
  if (rollType === "initiative") return localizeRule("Context.INITIATIVE", null);
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
  if (rollType === "initiative") return localizeRule("InitiativeAbility", { ability: abilityLabel });
  return localizeRule("CheckAbility", { ability: abilityLabel });
}

// dnd5e 6 keeps the roll data of a chat message in typed system data instead of flags.dnd5e.roll: an ability, skill
// or tool check is a "check" message (system.ability, system.skill, system.tool), a death or concentration save a
// "save" message with system.type, an attack keeps system.ability and system.ammunition. This returns the dnd5e 5
// shape for both versions.
const DND5E_ROLL_MESSAGE_TYPES = new Set(["attack", "check", "save", "damage", "healing", "generic", "hitDie", "hitPoints", "recharge"]);

function getRollFlags(message) {
  const flags = message?.flags?.dnd5e?.roll;
  if (flags) return flags;
  const type = message?.type;
  const system = message?.system ?? {};
  if (!DND5E_ROLL_MESSAGE_TYPES.has(type)) return {};
  if (type === "check") {
    const kind = system.skill ? "skill" : system.tool ? "tool" : system.type === "initiative" ? "initiative" : "ability";
    return { type: kind, ability: system.ability ?? undefined, skillId: system.skill ?? undefined, toolId: system.tool ?? undefined };
  }
  if (type === "save") {
    const kind = system.type === "death" ? "death" : system.type === "concentration" ? "concentration" : "save";
    return { type: kind, ability: system.ability ?? undefined, forceSuccess: system.resisted };
  }
  if (type === "attack") {
    return { type, ability: system.ability ?? undefined, ammunition: system.ammunition ?? undefined, mastery: system.mastery ?? undefined, attackMode: system.mode ?? undefined };
  }
  return { type };
}

// The item and activity a card names: flags.dnd5e in dnd5e 5, system.item and system.activity in dnd5e 6.
function getMessageReference(message, key) {
  return message?.flags?.dnd5e?.[key] ?? message?.system?.[key] ?? null;
}

function resolveActorRollAbility(actor, rollType, rollFlags) {
  // A skill or tool may be rolled with another ability than its default; the card names the one it used.
  if (rollType === "skill") return rollFlags.ability || actor.system?.skills?.[rollFlags.skillId]?.ability;
  if (rollType === "tool") return rollFlags.ability || actor.system?.tools?.[rollFlags.toolId]?.ability;
  // The card names the ability it rolled. The actor's setting is "" when it uses the default.
  if (rollType === "concentration") {
    return rollFlags.ability
      || actor.system?.attributes?.concentration?.ability
      || CONFIG.DND5E?.defaultAbilities?.concentration;
  }

  if (rollType === "initiative") {
    return rollFlags.ability
      || actor.system?.attributes?.init?.ability
      || globalThis.CONFIG?.DND5E?.defaultAbilities?.initiative
      || "dex";
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
      candidates.push(...createCandidate(localizeRuleLabel("BaseDamageLabel", null, "Base damage"), diceFormula, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("BaseDamage", { item: item?.name ?? "Item" })
      }));
    }

    if (bonusFormula) {
      candidates.push(...createCandidate(localizeRuleLabel("BaseBonusLabel", null, "Base bonus"), bonusFormula, {
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

    // Foundry parses a lone "-2" as one negative number, inside a roll the same value is an operator and a 2.
    const rawNumericValue = toFiniteNumber(term?.total ?? term?.number ?? term?.term);
    const signedValue = rawNumericValue === null ? null : (pendingOperator === "-" ? -Math.abs(rawNumericValue) : rawNumericValue);
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
  const effectKeys = bonusEffectKeys("attack", bucket);
  const candidates = [];
  const contextLabel = getBucketContextLabel(item);
  const detailText = getRollContextDetail(item, "attack");
  const abilityKey = resolveActivityAbility(actor, item, activity);
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod !== null) {
    candidates.push(...createCandidate(abilityModifierLabel(localizeAbilityLabel(abilityKey)), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("AttackAbility", { ability: localizeAbilityLabel(abilityKey), context: contextLabel })
    }));
  }

  // dnd5e 6 adds the item's proficiency term, which is 0 for a weapon the actor is not proficient with
  const itemProficiency = item?.system?.prof;
  const proficiencyBonus = typeof itemProficiency?.term === "string" && dnd5eMajorVersion() >= 6
    ? itemProficiency.term
    : toFiniteNumber(actor?.system?.attributes?.prof);
  if (proficiencyBonus || proficiencyBonus === "0") {
    candidates.push(...createCandidate(game.i18n.localize("DND5E.Proficiency") || "Proficiency bonus", `${proficiencyBonus}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const attackBonus = resolveActivityAttackBonus(activity);
  if (attackBonus) {
    candidates.push(...createCandidate(itemAttackBonusLabel(item), attackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const itemAttackBonus = sanitizeExpression(item?.system?.attack?.bonus);
  if (itemAttackBonus) {
    candidates.push(...createCandidate(itemAttackBonusLabel(item), itemAttackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const magicalAttackBonus = item?.system?.magicAvailable ? sanitizeExpression(item?.system?.magicalBonus) : "";
  if (magicalAttackBonus) {
    candidates.push(...createCandidate(itemAttackBonusLabel(item), magicalAttackBonus, {
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
      if (!effectKeys.has(change?.key)) continue;
      candidates.push(...createCandidate(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "attack", item, actor)
      }));
    }
  }

  const actorBonus = sanitizeExpression(readMoved(actor?.system, `rolls.attack.${bucket}.bonus`, `bonuses.${bucket}.attack`));
  if (actorBonus) {
    candidates.push(...createCandidate(localizeRuleLabel("ActorAttackBonusLabel", null, "Actor attack bonus"), actorBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: detailText.actor
    }));
  }

  // dnd5e 6 also has an attack bonus for all attacks and one per ability
  if (dnd5eMajorVersion() >= 6) {
    for (const bonus of [actor?.system?.rolls?.attack?.bonus, actor?.system?.abilities?.[abilityKey]?.attack?.roll?.bonus]) {
      const expression = sanitizeExpression(bonus);
      if (!expression) continue;
      candidates.push(...createCandidate(localizeRuleLabel("ActorAttackBonusLabel", null, "Actor attack bonus"), expression, {
        sourceType: "actor",
        confidence: "derived",
        detail: detailText.actor
      }));
    }
  }

  const ammunitionId = getRollFlags(message).ammunition;
  if (ammunitionId) {
    const ammunition = actor?.items?.get?.(ammunitionId);
    const ammoBonus = sanitizeExpression(ammunition?.system?.bonus);
    if (ammoBonus) {
      candidates.push(...createCandidate(ammunition.name, ammoBonus, {
        sourceType: "item",
        confidence: "derived",
        detail: localizeRule("AmmunitionBonus", { item: ammunition.name })
      }));
    }
  }

  candidates.push(...buildConditionReductionCandidates(actor));
  return candidates;
}

function buildDamageSourceCandidates(actor, item, activity) {
  const bucket = inferAttackBucket(item);
  const effectKeys = bonusEffectKeys("damage", bucket);
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
      if (!effectKeys.has(change?.key)) continue;
      candidates.push(...createCandidate(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "damage", item, actor)
      }));
    }
  }

  const abilityKey = resolveActivityAbility(actor, item, activity);
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod !== null) {
    candidates.push(...createCandidate(abilityModifierLabel(localizeAbilityLabel(abilityKey)), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("DamageAbility", { ability: localizeAbilityLabel(abilityKey) })
    }));
  }

  const actorBonus = sanitizeExpression(readMoved(actor?.system, `rolls.damage.${bucket}.bonus`, `bonuses.${bucket}.damage`));
  if (actorBonus) {
    candidates.push(...createCandidate(localizeRuleLabel("ActorDamageBonusLabel", null, "Actor damage bonus"), actorBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: detailText.actor
    }));
  }

  return candidates;
}

function readDnd5eSetting(key) {
  try {
    return game.settings.get("dnd5e", key);
  } catch {
    return null;
  }
}

// Condition penalties on d20 rolls: dnd5e 6 adds one term per condition (actor.conditionRollReductions), dnd5e 5 one
// exhaustion term under the 2024 rules.
function buildConditionReductionCandidates(actor) {
  const conditionTypes = globalThis.CONFIG?.DND5E?.conditionTypes ?? {};
  let reductions = actor?.conditionRollReductions;
  if (!reductions || typeof reductions !== "object") {
    const level = toFiniteNumber(actor?.system?.attributes?.exhaustion);
    const perLevel = toFiniteNumber(conditionTypes.exhaustion?.reduction?.rolls);
    const immune = Boolean(actor?.system?.traits?.ci?.value?.has?.("exhaustion"));
    const modern = globalThis.dnd5e?.settings?.rulesVersion === "modern";
    reductions = level && perLevel && modern && !immune ? { exhaustion: -level * perLevel } : {};
  }

  return Object.entries(reductions).flatMap(([status, value]) => {
    const name = conditionTypes[status]?.name ?? conditionTypes[status]?.label;
    const condition = name ? game.i18n.localize(name) : status;
    return createCandidate(condition, `${value}`, {
      sourceType: "actor",
      confidence: "exact",
      detail: localizeRule("ConditionReduction", { condition })
    });
  });
}

// Initiative: the ability modifier comes from the caller, then proficiency (Jack of All Trades, Remarkable Athlete,
// the 2024 Alert), the initiative, ability check and global check bonuses, the 2014 Alert and the optional tiebreaker.
function buildInitiativeCandidates(actor, ability, abilityLabel, contextLabel) {
  const candidates = [];
  const init = actor.system?.attributes?.init ?? {};
  if (init.prof?.hasProficiency) {
    candidates.push(...createCandidate(getProficiencyLabel(init.prof.multiplier), init.prof.term, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const bonuses = [
    [localizeRuleLabel("InitiativeBonusLabel", null, "Initiative bonus"), readMoved(actor.system, "attributes.init.roll.bonus", "attributes.init.bonus"), "exact", localizeRule("InitiativeBonus", null)],
    [`${abilityLabel} ${localizeRule("CheckBonusLabel", null)}`, readMoved(ability, "check.roll.bonus", "bonuses.check"), "exact", getActorCheckDetail("initiative", abilityLabel)],
    [localizeRule("GlobalCheckBonus", null), readMoved(actor.system, "rolls.ability.check.bonus", "bonuses.abilities.check"), "derived", localizeRule("GlobalBonusContext", { context: contextLabel })]
  ];
  for (const [label, bonus, confidence, detail] of bonuses) {
    const expression = sanitizeExpression(bonus);
    if (expression) candidates.push(...createCandidate(label, expression, { sourceType: "actor", confidence, detail }));
  }

  if (actor.flags?.dnd5e?.initiativeAlert && globalThis.dnd5e?.settings?.rulesVersion === "legacy") {
    candidates.push(...createCandidate(localizeRuleLabel("AlertLabel", null, "Alert"), "5", {
      sourceType: "actor",
      confidence: "exact",
      detail: localizeRule("AlertBonus", null)
    }));
  }

  const score = toFiniteNumber(ability?.value);
  if (score !== null && readDnd5eSetting("initiativeDexTiebreaker")) {
    candidates.push(...createCandidate(localizeRuleLabel("TiebreakerLabel", { ability: abilityLabel }, `Tiebreaker (${abilityLabel})`), `${score / 100}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Tiebreaker", { ability: abilityLabel })
    }));
  }

  return candidates;
}

const ACTOR_ROLL_TYPES = new Set(["ability", "save", "skill", "tool", "concentration", "death", "initiative"]);

function buildActorRollSourceCandidates(actor, rollType, rollFlags) {
  if (!ACTOR_ROLL_TYPES.has(rollType) || !actor) return [];

  const candidates = [];
  const abilityId = resolveActorRollAbility(actor, rollType, rollFlags);
  const abilityLabel = abilityId ? localizeAbilityLabel(abilityId) : null;
  const ability = actor.system?.abilities?.[abilityId];
  const rollId = rollType === "skill" ? rollFlags.skillId : rollType === "tool" ? rollFlags.toolId : null;
  const contextLabel = getCheckContextLabel(rollType, rollId);

  const abilityMod = toFiniteNumber(ability?.mod);
  if (abilityId && abilityMod !== null) {
    candidates.push(...createCandidate(abilityModifierLabel(abilityLabel), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: getActorCheckDetail(rollType, abilityLabel, rollId)
    }));
  }

  candidates.push(...buildConditionReductionCandidates(actor));
  if (rollType === "initiative") {
    candidates.push(...buildInitiativeCandidates(actor, ability, abilityLabel, contextLabel));
    return candidates;
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

    const deathBonus = sanitizeExpression(readMoved(actor.system, "attributes.death.roll.bonus", "attributes.death.bonuses.save"));
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
    const kind = rollType === "ability" ? "check" : "save";
    const proficiency = readMoved(ability, `${kind}.prof`, `${kind}Prof`);
    if (proficiency?.hasProficiency) {
      candidates.push(...createCandidate(getProficiencyLabel(proficiency.multiplier), proficiency.term, {
        sourceType: "standard",
        confidence: "exact",
        detail: localizeRule("Proficiency", { context: contextLabel })
      }));
    }

    const abilityBonus = sanitizeExpression(readMoved(ability, `${kind}.roll.bonus`, `bonuses.${kind}`));
    if (abilityBonus) {
      candidates.push(...createCandidate(`${abilityLabel} ${rollType === "ability" ? localizeRule("CheckBonusLabel", null) : localizeRule("SaveBonusLabel", null)}`, abilityBonus, {
        sourceType: "actor",
        confidence: "exact",
        detail: getActorCheckDetail(rollType, abilityLabel, rollId)
      }));
    }

    const globalBonus = sanitizeExpression(readMoved(actor.system, `rolls.ability.${kind}.bonus`, `bonuses.abilities.${kind}`));
    if (globalBonus) {
      candidates.push(...createCandidate(rollType === "ability" ? localizeRule("GlobalCheckBonus", null) : localizeRule("GlobalSaveBonus", null), globalBonus, {
        sourceType: "actor",
        confidence: "derived",
        detail: localizeRule("GlobalBonusContext", { context: contextLabel })
      }));
    }

    if (rollType === "concentration") {
      const concentrationBonus = sanitizeExpression(readMoved(actor.system, "attributes.concentration.roll.bonus", "attributes.concentration.bonuses.save"));
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

  const relevantBonus = sanitizeExpression(readMoved(relevant, "roll.bonus", "bonuses.check"));
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

  const abilityCheckBonus = sanitizeExpression(readMoved(ability, "check.roll.bonus", "bonuses.check"));
  if (abilityCheckBonus) {
    candidates.push(...createCandidate(`${abilityLabel} ${localizeRule("CheckBonusLabel", null)}`, abilityCheckBonus, {
      sourceType: "actor",
      confidence: "exact",
      detail: getActorCheckDetail(rollType, abilityLabel, rollId)
    }));
  }

  const typeBonus = sanitizeExpression(readMoved(actor.system, `rolls.ability.${rollType}.bonus`, `bonuses.abilities.${rollType}`));
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

  const globalCheckBonus = sanitizeExpression(readMoved(actor.system, "rolls.ability.check.bonus", "bonuses.abilities.check"));
  if (globalCheckBonus) {
    candidates.push(...createCandidate(localizeRule("GlobalCheckBonus", null), globalCheckBonus, {
      sourceType: "actor",
      confidence: "derived",
      detail: localizeRule("GlobalBonusContext", { context: contextLabel })
    }));
  }

  return candidates;
}

// dnd5e 6 rules: Active Effect changes of the types dnd5e.bonus and dnd5e.advantage, which dnd5e applies only when a
// roll is made. Their key is a category: attack, check, save, d20 (any of these three), damage or healing. dnd5e checks
// the conditions of each rule against the roll data and adds a bonus as plain formula parts. The same check on rebuilt
// roll data tells which effects took part in a roll.
const RULE_CATEGORIES = { attack: "attack", ability: "check", skill: "check", tool: "check", initiative: "check", save: "save", concentration: "save", damage: "damage" };

const RULE_ADVANTAGE_TYPES = { "1": "ADV", "+1": "ADV", "=1": "ADV", "=+1": "ADV", "-1": "DIS", "=-1": "DIS", ">=0": "NODIS", "<=0": "NOADV" };

// The rules of a category and type, filtered with the roll data when there is some. A rule that is consumed by a
// damage part counts only for that part, as in dnd5e.
function collectRules(category, type, actor, item, rollData, consumed = null) {
  const Rules = actor?.appliedRules?.constructor;
  if (typeof Rules?.collect !== "function") return [];
  try {
    const rules = Rules.collect(`${category}:${type}`, actor, item);
    return (rollData ? rules.filterWith(rollData, consumed ? { consumed } : {}) : rules).toArray();
  } catch {
    return [];
  }
}

// The roll data dnd5e checked the rules against, rebuilt from the card and the current actor.
function buildRuleRollData(rollType, { actor, item, activity, message, roll = null, rollFlags = getRollFlags(message) }) {
  try {
    if (rollType === "attack" || rollType === "damage") {
      const data = activity?.getRollData?.({ roll: { ability: rollFlags.ability, attackMode: rollFlags.attackMode } });
      if (!data || rollType === "attack") return data ?? null;
      data.roll ??= {};
      data.roll.isCritical = Boolean(roll?.isCritical ?? roll?.options?.isCritical);
      data.roll.properties = Array.from(item?.system?.properties ?? []).filter((p) => CONFIG.DND5E?.itemProperties?.[p]?.isPhysical);
      data.roll.damage = { ...(data.roll.damage ?? {}), type: roll?.options?.type ?? null };
      return data;
    }

    const data = actor?.getRollData?.({ roll: true });
    if (!data) return null;
    data.roll ??= {};
    const abilityId = resolveActorRollAbility(actor, rollType, rollFlags);
    if (rollType === "skill" || rollType === "tool") {
      const id = rollType === "skill" ? rollFlags.skillId : rollFlags.toolId;
      const relevant = rollType === "skill" ? actor.system?.skills?.[id] : actor.system?.tools?.[id];
      Object.assign(data.roll, { ability: abilityId, proficient: (relevant?.prof?.multiplier ?? 0) >= 1, type: rollType, [rollType]: id });
    } else if (rollType === "initiative") {
      Object.assign(data.roll, { ability: abilityId, proficient: (actor.system?.attributes?.init?.prof?.multiplier ?? 0) >= 1, type: "initiative" });
    } else {
      const kind = rollType === "ability" ? "check" : "save";
      Object.assign(data.roll, {
        ability: abilityId,
        proficient: (actor.system?.abilities?.[abilityId]?.[kind]?.prof?.multiplier ?? 0) >= 1,
        type: rollType === "concentration" ? "concentration" : "ability"
      });
    }
    return data;
  } catch {
    return null;
  }
}

function resolveRuleValue(value, rollData) {
  const text = sanitizeExpression(value);
  if (!text.includes("@") || !rollData) return text;
  try {
    return Roll.replaceFormulaData(text, rollData, { missing: "0" });
  } catch {
    return text;
  }
}

// Bonus rules as term sources, named after their effect.
function buildRuleBonusCandidates(rules, rollData, rollType, item, actor) {
  return rules.flatMap((rule) => createCandidate(
    rule.effect?.name || localizeRuleLabel("ActiveEffectLabel", null, "Active effect"),
    resolveRuleValue(rule.value, rollData),
    {
      sourceType: "effect",
      confidence: rollData ? "exact" : "labeled",
      detail: createEffectDetail(rule.effect, rollType, item, actor)
    }
  ));
}

// Advantage rules as reasons for advantage or disadvantage, in the form of dnd5e's roll attributions.
function buildRuleAdvantageAttributions(rules) {
  return rules
    .map((rule) => ({ type: RULE_ADVANTAGE_TYPES[String(rule.value ?? "").trim()], source: rule.effect?.uuid ?? null, displayName: rule.effect?.name ?? "" }))
    .filter((entry) => entry.type && entry.displayName);
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
  const itemUuid = getMessageReference(message, "item")?.uuid;
  if (itemUuid) {
    const item = await fromUuid(itemUuid);
    if (item) return item;
  }

  const actor = message?.getAssociatedActor?.() ?? null;
  const itemId = getMessageReference(message, "item")?.id;
  if (actor && itemId) {
    const item = actor.items?.get?.(itemId) ?? actor.items?.find?.((candidate) => candidate?.id === itemId) ?? null;
    if (item) return item;
  }

  return null;
}

async function resolveMessageActivity(message, item, actor) {
  const activityUuid = getMessageReference(message, "activity")?.uuid;
  if (activityUuid) {
    const activity = await fromUuid(activityUuid);
    if (activity) return activity;
  }

  const causeRelativeUuid = message?.system?.cause;
  if (causeRelativeUuid && actor && typeof fromUuid === "function") {
    const activity = await fromUuid(causeRelativeUuid, { relative: actor, strict: false });
    if (activity) return activity;
  }

  const activityId = getMessageReference(message, "activity")?.id;
  if (item && activityId) {
    const activity = item.system?.activities?.get?.(activityId)
      ?? item.system?.activities?.find?.((candidate) => candidate?.id === activityId)
      ?? null;
    if (activity) return activity;
  }

  return null;
}

// Ready Set Roll stores Roll#toJSON(). Rebuilt rolls keep their class, terms and dice results.
function restoreRoll(data) {
  const Roll = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if (!data || typeof data !== "object" || (typeof Roll === "function" && data instanceof Roll)) return data ?? null;
  if (typeof Roll?.fromData !== "function") return data;
  try {
    return Roll.fromData(data) ?? data;
  } catch {
    return data;
  }
}

// Ready Set Roll (dnd5e 5.3 builds) keeps the rolls of its cards serialized in flags.rsr5e.rolls and leaves
// message.rolls empty. The flag wins whenever it is there, as in Ready Set Roll itself.
function getStoredRolls(message) {
  const stored = message?.flags?.rsr5e?.rolls;
  return Array.isArray(stored) ? stored.map(restoreRoll).filter(Boolean) : null;
}

// dnd5e 6 stores the message type as roll.options.rollType, so a skill check says "check" and a death save "save".
// The message data tells which kind it is.
const REFINED_ROLL_TYPES = { check: ["ability", "skill", "tool", "initiative"], save: ["save", "death", "concentration"] };

function resolveMessageRollType(message, roll = null) {
  const own = roll?.options?.rollType ?? roll?.options?.["midi-qol"]?.rollType;
  const fromMessage = getRollFlags(message).type;
  if (own && !REFINED_ROLL_TYPES[own]?.includes(fromMessage)) return own;
  // dnd5e 5 posts initiative without roll flags, core marks the message
  return fromMessage
    ?? (message?.flags?.core?.initiativeRoll ? "initiative" : undefined)
    ?? (getStoredRolls(message) ?? message?.rolls ?? []).find?.((candidate) => typeof candidate?.options?.rollType === "string")?.options?.rollType
    ?? getMessageReference(message, "activity")?.type
    ?? message?.flags?.["midi-qol"]?.messageType
    ?? null;
}

function resolveAdvantageState(roll) {
  const advantageMode = roll?.options?.advantageMode;
  const configMode = globalThis.CONFIG?.Dice?.D20Roll?.ADV_MODE;
  if (advantageMode === configMode?.ADVANTAGE || advantageMode === 1) return "advantage";
  if (advantageMode === configMode?.DISADVANTAGE || advantageMode === -1) return "disadvantage";
  if (roll?.options?.advantage && !roll?.options?.disadvantage) return "advantage";
  if (!roll?.options?.advantage && roll?.options?.disadvantage) return "disadvantage";
  return "normal";
}

function getRollAttributions(message, roll, rollType) {
  const directAttributions = Array.isArray(roll?.options?.attributions) ? roll.options.attributions : null;
  if (directAttributions) return directAttributions;

  if (rollType === "attack") {
    const midiAttackRoll = message?.flags?.["midi-qol"]?.attackRoll;
    if (Array.isArray(midiAttackRoll?.options?.attributions)) return midiAttackRoll.options.attributions;
  }

  return [];
}

function extractAdvantageContext(message, roll, rollType, ruleAttributions = []) {
  const direct = getRollAttributions(message, roll, rollType);
  const attributions = (direct.length ? direct : (resolveAdvantageState(roll) === "normal" ? [] : ruleAttributions))
    .filter((entry) => ["ADV", "DIS", "NOADV", "NODIS"].includes(entry?.type))
    .map((entry) => ({
      type: entry.type,
      source: entry.source ?? null,
      displayName: String(entry.displayName ?? entry.source ?? "").trim()
    }))
    .filter((entry) => entry.displayName.length > 0);

  if (!attributions.length) return null;

  const sourceRoll = rollType === "attack" && !Array.isArray(roll?.options?.attributions)
    ? message?.flags?.["midi-qol"]?.attackRoll
    : roll;
  const state = resolveAdvantageState(sourceRoll ?? roll);

  return {
    state,
    attributions
  };
}

// The rule effects of one card: bonus candidates per roll (a damage rule counts for the first matching part only) and
// advantage reasons per roll type.
function createRuleSources({ actor, item, activity, message, rollFlags = getRollFlags(message) }) {
  const consumed = new Set();
  const rollData = new Map();
  const dataFor = (rollType) => {
    if (!rollData.has(rollType)) rollData.set(rollType, buildRuleRollData(rollType, { actor, item, activity, message, rollFlags }));
    return rollData.get(rollType);
  };
  return {
    bonusCandidates(rollType, roll) {
      const category = rollType === "damage" && activity?.type === "heal" ? "healing" : RULE_CATEGORIES[rollType];
      if (!category || !actor) return [];
      const data = rollType === "damage" ? buildRuleRollData(rollType, { actor, item, activity, message, roll, rollFlags }) : dataFor(rollType);
      const rules = collectRules(category, "bonus", actor, ["attack", "damage"].includes(rollType) ? item : null, data, rollType === "damage" ? consumed : null);
      return buildRuleBonusCandidates(rules, data, rollType, item, actor);
    },
    advantage(rollType) {
      const category = RULE_CATEGORIES[rollType];
      if (!category || category === "damage" || !actor) return [];
      const data = dataFor(rollType);
      if (!data) return [];
      return buildRuleAdvantageAttributions(collectRules(category, "advantage", actor, rollType === "attack" ? item : null, data));
    }
  };
}

// The roller of a check, save or initiative. A roll message names its roller as speaker: a dnd5e 6 save rolled from a
// card also names the caster's item, whose actor would be the wrong one. midi-qol copies the saves of its targets onto
// its own card, there the roll names its target and the target's save message the ability. Rolls on other cards keep
// the speaker only when the card itself counts as such a roll (dnd5e 5 initiative, cards of other modules).
async function resolveActorRollContext(message, roll, messageRollType, speakerActor, activity) {
  const rollFlags = getRollFlags(message);
  const targetUuid = roll?.options?.["midi-qol"]?.targetUuid;
  if (ACTOR_ROLL_TYPES.has(rollFlags.type)) return { actor: speakerActor, rollFlags };
  if (!targetUuid) return { actor: ACTOR_ROLL_TYPES.has(messageRollType) ? speakerActor : null, rollFlags };

  let target = null;
  try {
    target = typeof fromUuid === "function" ? await fromUuid(targetUuid) : null;
  } catch {
    target = null;
  }
  const actor = target?.documentName === "Actor" ? target : target?.actor ?? null;
  if (!actor) return { actor: null, rollFlags: {} };

  const isTargetMessage = (candidate) => (target.documentName === "Token" ? candidate?.speaker?.token === target.id : candidate?.speaker?.actor === actor.id);
  const linked = game.messages?.contents?.findLast?.((candidate) => candidate !== message && isTargetMessage(candidate)
    && candidate.rolls?.some?.((other) => other?.options?.originatingMessage === message.id));
  const ability = (linked ? getRollFlags(linked).ability : null) ?? getFirstAvailableAbility(activity?.save?.ability);
  return { actor, rollFlags: { ability: ability ?? undefined } };
}

export class Dnd5eRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "dnd5e";
  }

  getMessageRolls(message) {
    return getStoredRolls(message) ?? super.getMessageRolls(message);
  }

  supportsMessage(message) {
    return game.system?.id === "dnd5e" && this.getMessageRolls(message).length > 0;
  }

  // What the adapter reads from a card, for debug files: roll type, item, activity and the roller of each roll.
  async debugInfo(message) {
    const rollType = resolveMessageRollType(message);
    const item = await resolveMessageItem(message);
    const speakerActor = message?.getAssociatedActor?.() ?? null;
    const actor = item?.actor ?? speakerActor;
    const activity = await resolveMessageActivity(message, item, actor);
    const rolls = [];
    for (const [index, roll] of this.getMessageRolls(message).entries()) {
      const currentRollType = resolveMessageRollType(message, roll) ?? rollType;
      const context = ACTOR_ROLL_TYPES.has(currentRollType)
        ? await resolveActorRollContext(message, roll, rollType, speakerActor ?? actor, activity)
        : { actor, rollFlags: null };
      rolls.push({ index, rollType: currentRollType, actor: context.actor?.uuid ?? null, rollFlags: context.rollFlags });
    }
    return {
      rollType,
      rollFlags: getRollFlags(message),
      item: item?.uuid ?? null,
      activity: activity?.uuid ?? null,
      speakerActor: speakerActor?.uuid ?? null,
      readySetRoll: Boolean(getStoredRolls(message)),
      rolls
    };
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();

    const rollType = resolveMessageRollType(message);
    if (!rollType) return super.buildBreakdowns(message);

    const item = await resolveMessageItem(message);
    const speakerActor = message?.getAssociatedActor?.() ?? null;
    const actor = item?.actor ?? speakerActor;
    const activity = await resolveMessageActivity(message, item, actor);
    const attackCandidates = item && activity && actor
      ? buildAttackSourceCandidates(actor, item, activity, message)
      : null;
    const damageCandidates = item && activity && actor
      ? buildDamageSourceCandidates(actor, item, activity, message)
      : null;
    const rules = createRuleSources({ actor, item, activity, message });

    const breakdowns = [];
    for (const [index, roll] of this.getMessageRolls(message).entries()) {
      const currentRollType = resolveMessageRollType(message, roll) ?? rollType;
      let baseCandidates = currentRollType === "attack" ? attackCandidates : currentRollType === "damage" ? damageCandidates : null;
      let rollRules = rules;
      if (ACTOR_ROLL_TYPES.has(currentRollType)) {
        const context = await resolveActorRollContext(message, roll, rollType, speakerActor ?? actor, activity);
        baseCandidates = context.actor ? buildActorRollSourceCandidates(context.actor, currentRollType, context.rollFlags) : null;
        rollRules = createRuleSources({ actor: context.actor, item, activity, message, rollFlags: context.rollFlags });
      }
      const ruleCandidates = rollRules.bonusCandidates(currentRollType, roll);
      const candidates = baseCandidates || ruleCandidates.length ? [...(baseCandidates ?? []), ...ruleCandidates] : null;

      const breakdown = parseRoll(roll, {
        adapterId: this.id,
        rollIndex: index,
        termSourceResolver: candidates ? createTermSourceResolver(candidates) : null
      });

      if (currentRollType === "damage" && breakdown.diceTerms.length > 0) {
        breakdown.hasVisibleContent = true;
      }

      breakdown.advantageContext = extractAdvantageContext(message, roll, currentRollType, rollRules.advantage(currentRollType));
      if (breakdown.advantageContext) {
        breakdown.hasVisibleContent = true;
      }

      breakdowns.push(breakdown);
    }

    return breakdowns.filter((breakdown) => breakdown.hasVisibleContent);
  }
}