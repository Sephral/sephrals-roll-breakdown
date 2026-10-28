import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermExpression, getTermType, hasNestedDice, isDiceTerm, parseRoll, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded, localizeSystemTranslation, MODULE_ID } from "../settings.js";

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

// The top level parts of a formula with their sign: "2d8 + @mod - 1" gives "2d8", "+ @mod" and "- 1".
function splitFormula(formula) {
  const parts = [];
  let depth = 0;
  let current = "";
  let reference = false;
  for (const char of String(formula ?? "")) {
    // A roll data reference such as @scale.rogue.sneak-attack keeps its hyphens
    if (char === "@") reference = true;
    else if (reference && !/[\w.-]/.test(char)) reference = false;
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (depth === 0 && !reference && (char === "+" || char === "-") && current.trim() && !/[*/^]\s*$/.test(current)) {
      parts.push(current.trim());
      current = char;
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// A damage part as dnd5e rolls it: scaled for cantrips and higher spell levels, custom formulas such as
// @scale.rogue.sneak-attack resolved. A dnd5e 4 or older part without these helpers falls back to its fields.
function damagePartFormula(part, rollData) {
  const data = typeof rollData === "function" ? rollData() : rollData;
  try {
    if (typeof part?.scaledFormula === "function") return part.scaledFormula(data?.scaling ?? 0) ?? "";
    if (typeof part?.formula === "string") return part.formula;
  } catch {
    // fall back to the fields
  }
  const dice = part?.number && part?.denomination ? `${part.number}d${part.denomination}` : "";
  const bonus = sanitizeExpression(part?.bonus);
  return [dice, bonus].filter(Boolean).join(" + ");
}

// The damage or healing parts of an activity as term sources: dice are base damage (or healing), @mod is the
// ability modifier, the rest is a base bonus.
function buildBaseDamageCandidates(item, activity, rollData, abilityLabel, abilityDetail) {
  const create = withRollData(rollData);
  const candidates = [];
  let namesModifier = false;
  const healing = activity?.type === "heal";
  const parts = healing ? [activity.healing].filter(Boolean) : Array.from(activity?.damage?.parts ?? []);
  const itemName = item?.name ?? "Item";

  for (const part of parts) {
    for (const segment of splitFormula(damagePartFormula(part, rollData))) {
      const reference = sanitizeExpression(segment.replace(/^-\s*/, ""));
      if (reference === "@mod" && abilityLabel) {
        namesModifier = true;
        candidates.push(...create(abilityModifierLabel(abilityLabel), segment, { sourceType: "standard", confidence: "exact", detail: abilityDetail }));
        continue;
      }
      const isDice = /\d*d\d/i.test(resolveFormulaData(reference, rollData));
      const label = isDice
        ? (healing ? localizeRuleLabel("BaseHealingLabel", null, "Base healing") : localizeRuleLabel("BaseDamageLabel", null, "Base damage"))
        : localizeRuleLabel("BaseBonusLabel", null, "Base bonus");
      const detail = isDice
        ? localizeRule(healing ? "BaseHealing" : "BaseDamage", { item: itemName })
        : localizeRule("BaseBonus", { item: itemName });
      // Dice that scale with the spell level may roll more of them than the formula says (a spell cast with a higher slot)
      const scales = Boolean(part?.scaling?.mode) && part.scaling.mode !== "none";
      candidates.push(...create(label, segment, { sourceType: "item", confidence: "exact", detail }).map((entry) => ({ ...entry, scales })));
    }
  }

  return { candidates, namesModifier };
}

function itemDamageBonusLabel(item) {
  const name = item?.name ?? "Item";
  return localizeRuleLabel("ItemDamageBonusLabel", { item: name }, `${name} damage bonus`);
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

// A bonus or effect value may hold roll data references such as "3 + @prof". dnd5e resolves them when it rolls, so the
// candidate does the same, otherwise @prof becomes 0 and its term stays unknown.
function resolveFormulaData(value, rollData) {
  const text = sanitizeExpression(value);
  if (!text.includes("@") || !rollData) return text;
  const data = typeof rollData === "function" ? rollData() : rollData;
  if (!data) return text;
  try {
    return Roll.replaceFormulaData(text, data, { missing: "0" });
  } catch {
    return text;
  }
}

// The roll data of the first document that has some, for the references in bonuses and effect values. It is built
// on first use only, most bonuses hold plain numbers and every chat card render asks for it.
function getRollDataOf(...documents) {
  let data;
  return () => {
    if (data !== undefined) return data;
    data = null;
    for (const document of documents) {
      try {
        data = document?.getRollData?.() ?? null;
      } catch {
        data = null;
      }
      if (data) break;
    }
    return data;
  };
}

// createCandidate with the roll data of one roll filled in.
function withRollData(rollData) {
  return (label, expression, options) => createCandidate(label, expression, { ...options, rollData });
}

function createCandidate(label, expression, { sourceType = "effect", confidence = "labeled", detail = null, rollData = null } = {}) {
  const normalizedExpression = resolveFormulaData(expression, rollData);
  if (!normalizedExpression) return [];

  // Foundry parses a leading minus before dice ("-1d4", Bane) as (1d4 * -1). After a helper 0 it stays an operator
  // and a die, as in the roll itself.
  const negative = /^-/.test(normalizedExpression);
  let roll;
  try {
    roll = Roll.create(negative ? `0 ${normalizedExpression}` : normalizedExpression);
    if (!roll._evaluated && roll.isDeterministic) {
      roll.evaluateSync({ allowStrings: true });
    }
  } catch {
    return [];
  }

  let pendingOperator = "+";
  let skipHelper = negative;
  const segments = [];
  for (const term of roll.terms ?? []) {
    const termType = getTermType(term);
    if (termType === "OperatorTerm") {
      pendingOperator = String(term?.operator ?? "+").trim() === "-" ? "-" : "+";
      continue;
    }
    if (skipHelper) {
      skipHelper = false;
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
      faces: toFiniteNumber(term?.faces),
      classification: isDiceTerm(term) ? "dice" : hasNestedDice(term) ? "computed" : rawNumericValue === null ? "unresolved" : "modifier"
    });
    pendingOperator = "+";
  }

  return segments;
}

// Active effects that apply to the actor, also those an item transfers (a ring, a feat, a fighting style).
function activeEffectsOf(actor) {
  let effects;
  try {
    effects = typeof actor?.allApplicableEffects === "function" ? Array.from(actor.allApplicableEffects()) : Array.from(actor?.effects ?? []);
  } catch {
    effects = Array.from(actor?.effects ?? []);
  }
  return effects.filter((effect) => effect && !effect.disabled && !effect.isSuppressed);
}

// Foundry 14 keeps the changes of an effect in its system data, Foundry 13 on the effect.
function effectChanges(effect) {
  const changes = effect?.system?.changes ?? effect?.changes;
  return Array.isArray(changes) ? changes : [];
}

// Foundry 14 names the change type, Foundry 13 its mode (2 is ADD). A change without either counts as ADD.
function isAddChange(change) {
  if (change?.type !== undefined && change?.type !== null) return change.type === "add";
  if (change?.mode !== undefined && change?.mode !== null) return Number(change.mode) === 2;
  return true;
}

// An actor bonus as term sources. The parts that active effects add are named after their effect, what is left of
// the bonus keeps the general label. When an effect overrides the bonus, the whole bonus keeps the general label.
function actorBonusCandidates(create, actor, paths, bonus, label, { effectDetail = null, ...options } = {}) {
  const general = create(label, bonus, options);
  if (!general.length) return [];
  const keys = new Set(paths.filter(Boolean).map((path) => `system.${path}`));
  const named = [];
  for (const effect of activeEffectsOf(actor)) {
    for (const change of effectChanges(effect)) {
      if (!keys.has(change?.key)) continue;
      if (!isAddChange(change)) return general;
      named.push(...create(effect.name, change.value, { ...options, sourceType: "effect", confidence: "exact", detail: effectDetail?.(effect) ?? options.detail }));
    }
  }
  const rest = [...general];
  const matched = [];
  for (const segment of named) {
    const index = rest.findIndex((other) => other.classification === segment.classification && other.signedValue === segment.signedValue
      && (segment.classification !== "dice" || (other.expression === segment.expression && other.operator === segment.operator)));
    // A change that left no trace in the bonus (a rule whose condition failed) names nothing
    if (index === -1) continue;
    rest.splice(index, 1);
    matched.push(segment);
  }
  return [...matched, ...rest];
}

// The ammunition an attack message or an attack roll names (dnd5e keeps it in the roll options as well).
function ammunitionOf(message) {
  return getRollFlags(message).ammunition
    ?? (getStoredRolls(message) ?? message?.rolls ?? []).find?.((roll) => roll?.options?.ammunition)?.options?.ammunition
    ?? null;
}

// The ammunition of an attack or damage roll: the attack card or roll names it. A damage card uses the attack it
// belongs to: an attack on the same card (midi-qol, Ready Set Roll) or the latest attack of the same usage before it.
// Only a damage roll without any attack falls back to the ammunition the item used last.
function resolveAmmunition(actor, item, activity, message, rollType) {
  let id = ammunitionOf(message);
  if (!id && rollType === "damage") {
    let attacks = [];
    try {
      const origin = message?.getOriginatingMessage?.();
      attacks = origin && origin !== message ? Array.from(origin.getAssociatedRolls?.("attack") ?? []) : [];
    } catch {
      attacks = [];
    }
    const earlier = attacks.filter((attack) => attack !== message && (attack.timestamp ?? 0) <= (message?.timestamp ?? Infinity));
    if (earlier.length) id = ammunitionOf(earlier.at(-1));
    else if (!attacks.length) {
      try {
        id = item?.getFlag?.("dnd5e", `last.${activity?.id}.ammunition`) ?? null;
      } catch {
        id = null;
      }
    }
  }
  return id ? actor?.items?.get?.(id) ?? null : null;
}

function magicalBonusOf(item) {
  if (!item?.system?.magicAvailable) return "";
  return sanitizeExpression(item.system.magicalBonus);
}

function buildAttackSourceCandidates(actor, item, activity, message) {
  const bucket = inferAttackBucket(item);
  const create = withRollData(getRollDataOf(activity, item, actor));
  const candidates = [];
  const contextLabel = getBucketContextLabel(item);
  const detailText = getRollContextDetail(item, "attack");
  const abilityKey = resolveActivityAbility(actor, item, activity);
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod !== null) {
    candidates.push(...create(abilityModifierLabel(localizeAbilityLabel(abilityKey)), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("AttackAbility", { ability: localizeAbilityLabel(abilityKey), context: contextLabel })
    }));
  }

  // dnd5e 5 and 6 add the item's proficiency term, which is 0 for a weapon the actor is not proficient with
  const itemProficiency = item?.system?.prof;
  const proficiencyBonus = typeof itemProficiency?.term === "string"
    ? itemProficiency.term
    : toFiniteNumber(actor?.system?.attributes?.prof);
  if (proficiencyBonus || proficiencyBonus === "0") {
    candidates.push(...create(game.i18n.localize("DND5E.Proficiency") || "Proficiency bonus", `${proficiencyBonus}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const attackBonus = resolveActivityAttackBonus(activity);
  if (attackBonus) {
    candidates.push(...create(itemAttackBonusLabel(item), attackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const itemAttackBonus = sanitizeExpression(item?.system?.attack?.bonus);
  if (itemAttackBonus) {
    candidates.push(...create(itemAttackBonusLabel(item), itemAttackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  const magicalAttackBonus = magicalBonusOf(item);
  if (magicalAttackBonus) {
    candidates.push(...create(itemAttackBonusLabel(item), magicalAttackBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemAttackBonus", { item: item?.name ?? "Item" })
    }));
  }

  for (const effect of item?.effects ?? []) {
    for (const change of effectChanges(effect)) {
      if (!matchesItemAttackBonusKey(change?.key, activity?.id)) continue;
      candidates.push(...create(effect.name, change.value, {
        sourceType: "effect",
        confidence: "exact",
        detail: createEffectDetail(effect, "attack", item, actor)
      }));
    }
  }

  const actorLabel = localizeRuleLabel("ActorAttackBonusLabel", null, "Actor attack bonus");
  const actorOptions = { sourceType: "actor", confidence: "derived", detail: detailText.actor, effectDetail: (effect) => createEffectDetail(effect, "attack", item, actor) };
  candidates.push(...actorBonusCandidates(create, actor, [`rolls.attack.${bucket}.bonus`, `bonuses.${bucket}.attack`],
    readMoved(actor?.system, `rolls.attack.${bucket}.bonus`, `bonuses.${bucket}.attack`), actorLabel, actorOptions));

  // dnd5e 6 also has an attack bonus for all attacks and one per ability
  if (dnd5eMajorVersion() >= 6) {
    candidates.push(...actorBonusCandidates(create, actor, ["rolls.attack.bonus"], actor?.system?.rolls?.attack?.bonus, actorLabel, actorOptions));
    candidates.push(...actorBonusCandidates(create, actor, [`abilities.${abilityKey}.attack.roll.bonus`],
      actor?.system?.abilities?.[abilityKey]?.attack?.roll?.bonus, actorLabel, actorOptions));
  }

  // Magic ammunition such as +1 arrows (dnd5e 5 and 6 keep it as magicalBonus, older data as bonus)
  const ammunition = resolveAmmunition(actor, item, activity, message, "attack");
  const ammoBonus = magicalBonusOf(ammunition) || sanitizeExpression(ammunition?.system?.bonus);
  if (ammoBonus) {
    candidates.push(...create(ammunition.name, ammoBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("AmmunitionBonus", { item: ammunition.name })
    }));
  }

  candidates.push(...buildConditionReductionCandidates(actor));
  return candidates;
}

function buildDamageSourceCandidates(actor, item, activity, message) {
  const bucket = inferAttackBucket(item);
  const rollData = getRollDataOf(activity, item, actor);
  const create = withRollData(rollData);
  const candidates = [];
  const contextLabel = getDamageContextLabel(item, activity);
  const detailText = activity?.type === "save" && item?.type === "spell"
    ? {
        effect: localizeRule("ActiveEffectDamage", { context: contextLabel }),
        actor: localizeRule("ActorBonusDamage", { context: contextLabel })
      }
    : getRollContextDetail(item, "damage");

  const abilityKey = resolveActivityAbility(actor, item, activity);
  const abilityLabel = abilityKey ? localizeAbilityLabel(abilityKey) : null;
  const abilityDetail = abilityLabel ? localizeRule("DamageAbility", { ability: abilityLabel }) : null;
  const base = buildBaseDamageCandidates(item, activity, rollData, abilityLabel, abilityDetail);
  candidates.push(...base.candidates);

  // A versatile weapon used with two hands rolls its versatile die instead of the base die
  if (item?.system?.isVersatile) {
    const { base: baseDamage, versatile } = item.system.damage ?? {};
    let denomination = versatile?.denomination;
    try { denomination ||= baseDamage?.steppedDenomination?.(); } catch { denomination ||= null; }
    const number = versatile?.number || baseDamage?.number;
    if (number && denomination) {
      candidates.push(...create(localizeRuleLabel("BaseDamageLabel", null, "Base damage"), `${number}d${denomination}`, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("BaseDamage", { item: item.name })
      }));
    }
  }

  // dnd5e adds the ability modifier to weapon damage on its own, a formula with @mod names it already
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  if (abilityKey && abilityMod !== null && !base.namesModifier) {
    candidates.push(...create(abilityModifierLabel(abilityLabel), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: abilityDetail
    }));
  }

  // Magic weapons and magic ammunition add their bonus to the damage of the base part
  const magicBonus = magicalBonusOf(item);
  if (magicBonus) {
    candidates.push(...create(itemDamageBonusLabel(item), magicBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemDamageBonus", { item: item.name })
    }));
  }
  const itemBonus = sanitizeExpression(item?.system?.damage?.bonus ?? item?.system?.damageBonus);
  if (itemBonus) {
    candidates.push(...create(itemDamageBonusLabel(item), itemBonus, {
      sourceType: "item",
      confidence: "exact",
      detail: localizeRule("ItemDamageBonus", { item: item.name })
    }));
  }
  const ammunition = resolveAmmunition(actor, item, activity, message, "damage");
  if (ammunition) {
    const ammoBonus = magicalBonusOf(ammunition);
    if (ammoBonus) {
      candidates.push(...create(ammunition.name, ammoBonus, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("AmmunitionBonus", { item: ammunition.name })
      }));
    }
    const ammoDamage = ammunition.system?.damage?.base;
    const ammoFormula = typeof ammoDamage?.formula === "string" ? ammoDamage.formula : "";
    if (ammoFormula) {
      candidates.push(...create(ammunition.name, ammoFormula, {
        sourceType: "item",
        confidence: "exact",
        detail: localizeRule("AmmunitionBonus", { item: ammunition.name })
      }));
    }
  }

  candidates.push(...actorBonusCandidates(create, actor, [`rolls.damage.${bucket}.bonus`, `bonuses.${bucket}.damage`],
    readMoved(actor?.system, `rolls.damage.${bucket}.bonus`, `bonuses.${bucket}.damage`),
    localizeRuleLabel("ActorDamageBonusLabel", null, "Actor damage bonus"),
    { sourceType: "actor", confidence: "derived", detail: detailText.actor, effectDetail: (effect) => createEffectDetail(effect, "damage", item, actor) }));

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
function buildInitiativeCandidates(actor, abilityId, abilityLabel, contextLabel, rollData) {
  const create = withRollData(rollData);
  const candidates = [];
  const ability = actor.system?.abilities?.[abilityId];
  const init = actor.system?.attributes?.init ?? {};
  if (init.prof?.hasProficiency) {
    candidates.push(...create(getProficiencyLabel(init.prof.multiplier), init.prof.term, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  const bonuses = [
    [localizeRuleLabel("InitiativeBonusLabel", null, "Initiative bonus"), ["attributes.init.roll.bonus", "attributes.init.bonus"], "exact", localizeRule("InitiativeBonus", null)],
    [`${abilityLabel} ${localizeRule("CheckBonusLabel", null)}`, [`abilities.${abilityId}.check.roll.bonus`, `abilities.${abilityId}.bonuses.check`], "exact", getActorCheckDetail("initiative", abilityLabel)],
    [localizeRule("GlobalCheckBonus", null), ["rolls.ability.check.bonus", "bonuses.abilities.check"], "derived", localizeRule("GlobalBonusContext", { context: contextLabel })]
  ];
  for (const [label, [newPath, oldPath], confidence, detail] of bonuses) {
    candidates.push(...actorBonusCandidates(create, actor, [newPath, oldPath], readMoved(actor.system, newPath, oldPath), label, { sourceType: "actor", confidence, detail }));
  }

  if (actor.flags?.dnd5e?.initiativeAlert && globalThis.dnd5e?.settings?.rulesVersion === "legacy") {
    candidates.push(...create(localizeRuleLabel("AlertLabel", null, "Alert"), "5", {
      sourceType: "actor",
      confidence: "exact",
      detail: localizeRule("AlertBonus", null)
    }));
  }

  const score = toFiniteNumber(ability?.value);
  if (score !== null && readDnd5eSetting("initiativeDexTiebreaker")) {
    candidates.push(...create(localizeRuleLabel("TiebreakerLabel", { ability: abilityLabel }, `Tiebreaker (${abilityLabel})`), `${score / 100}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Tiebreaker", { ability: abilityLabel })
    }));
  }

  return candidates;
}

// A hit die: dnd5e 6 rolls max(1, 1d10 + @abilities.con.mod) as one computed term (max(0, ...) under the 2014
// rules), dnd5e 5 rolls 1d10 + the CON modifier.
function buildHitDieCandidates(actor, roll) {
  const create = withRollData(getRollDataOf(actor));
  const conLabel = localizeAbilityLabel("con");
  const label = localizeRuleLabel("HitDieLabel", null, "Hit die");
  const candidates = [];
  for (const term of roll?.terms ?? []) {
    const expression = getTermExpression(term);
    if (isDiceTerm(term)) {
      candidates.push(...create(label, expression, { sourceType: "standard", confidence: "exact", detail: localizeRule("HitDie", { ability: conLabel, formula: expression }) }));
    } else if (hasNestedDice(term)) {
      candidates.push({
        label,
        detail: localizeRule("HitDie", { ability: conLabel, formula: expression }),
        sourceType: "standard",
        confidence: "exact",
        operator: "+",
        termType: getTermType(term),
        expression: normalizeText(expression),
        rawExpression: expression,
        signedValue: toFiniteNumber(term?.total),
        faces: null,
        classification: "computed"
      });
    }
  }
  const conMod = toFiniteNumber(actor?.system?.abilities?.con?.mod);
  if (conMod !== null) {
    candidates.push(...create(abilityModifierLabel(conLabel), `${conMod}`, { sourceType: "standard", confidence: "exact", detail: localizeRule("HitDie", { ability: conLabel, formula: "" }) }));
  }
  return candidates;
}

const ACTOR_ROLL_TYPES = new Set(["ability", "save", "skill", "tool", "concentration", "death", "initiative"]);

function buildActorRollSourceCandidates(actor, rollType, rollFlags) {
  if (!ACTOR_ROLL_TYPES.has(rollType) || !actor) return [];

  const rollData = getRollDataOf(actor);
  const create = withRollData(rollData);
  const candidates = [];
  const abilityId = resolveActorRollAbility(actor, rollType, rollFlags);
  const abilityLabel = abilityId ? localizeAbilityLabel(abilityId) : null;
  const ability = actor.system?.abilities?.[abilityId];
  const rollId = rollType === "skill" ? rollFlags.skillId : rollType === "tool" ? rollFlags.toolId : null;
  const contextLabel = getCheckContextLabel(rollType, rollId);

  const abilityMod = toFiniteNumber(ability?.mod);
  if (abilityId && abilityMod !== null) {
    candidates.push(...create(abilityModifierLabel(abilityLabel), `${abilityMod}`, {
      sourceType: "standard",
      confidence: "exact",
      detail: getActorCheckDetail(rollType, abilityLabel, rollId)
    }));
  }

  candidates.push(...buildConditionReductionCandidates(actor));
  if (rollType === "initiative") {
    candidates.push(...buildInitiativeCandidates(actor, abilityId, abilityLabel, contextLabel, rollData));
    return candidates;
  }

  // A bonus at its dnd5e 6 or dnd5e 5 path, the parts from active effects named after their effect
  const addBonus = (label, newPath, oldPath, confidence, detail) => {
    candidates.push(...actorBonusCandidates(create, actor, [newPath, oldPath], readMoved(actor.system, newPath, oldPath), label,
      { sourceType: "actor", confidence, detail }));
  };
  const globalDetail = localizeRule("GlobalBonusContext", { context: contextLabel });

  if (rollType === "death") {
    if (actor.flags?.dnd5e?.diamondSoul) {
      const proficiencyBonus = toFiniteNumber(actor.system?.attributes?.prof);
      if (proficiencyBonus) {
        candidates.push(...create(game.i18n.localize("DND5E.Proficiency") || "Proficiency", `${proficiencyBonus}`, {
          sourceType: "standard",
          confidence: "exact",
          detail: localizeRule("Proficiency", { context: contextLabel })
        }));
      }
    }

    addBonus(localizeRule("DeathSaveBonusLabel", null), "attributes.death.roll.bonus", "attributes.death.bonuses.save", "exact", localizeRule("DeathSaveBonus", null));
    // A death save is a saving throw, so the global save bonus applies as well
    addBonus(localizeRule("GlobalSaveBonus", null), "rolls.ability.save.bonus", "bonuses.abilities.save", "derived", globalDetail);
    return candidates;
  }

  if (rollType === "ability" || rollType === "save" || rollType === "concentration") {
    const kind = rollType === "ability" ? "check" : "save";
    const proficiency = readMoved(ability, `${kind}.prof`, `${kind}Prof`);
    if (proficiency?.hasProficiency) {
      candidates.push(...create(getProficiencyLabel(proficiency.multiplier), proficiency.term, {
        sourceType: "standard",
        confidence: "exact",
        detail: localizeRule("Proficiency", { context: contextLabel })
      }));
    }

    addBonus(`${abilityLabel} ${rollType === "ability" ? localizeRule("CheckBonusLabel", null) : localizeRule("SaveBonusLabel", null)}`,
      `abilities.${abilityId}.${kind}.roll.bonus`, `abilities.${abilityId}.bonuses.${kind}`, "exact", getActorCheckDetail(rollType, abilityLabel, rollId));
    addBonus(rollType === "ability" ? localizeRule("GlobalCheckBonus", null) : localizeRule("GlobalSaveBonus", null),
      `rolls.ability.${kind}.bonus`, `bonuses.abilities.${kind}`, "derived", globalDetail);
    if (rollType === "concentration") {
      addBonus(localizeRule("ConcentrationBonusLabel", null), "attributes.concentration.roll.bonus", "attributes.concentration.bonuses.save",
        "exact", localizeRule("ConcentrationBonus", null));
    }

    const coverBonus = rollType === "save" && rollFlags.ability === "dex"
      ? sanitizeExpression(actor.system?.attributes?.ac?.cover)
      : "";
    if (coverBonus) {
      candidates.push(...create(localizeRule("Cover", null), coverBonus, {
        sourceType: "actor",
        confidence: "exact",
        detail: localizeRule("CoverBonus", null)
      }));
    }

    return candidates;
  }

  const collection = rollType === "skill" ? "skills" : "tools";
  const id = rollType === "skill" ? rollFlags.skillId : rollFlags.toolId;
  const relevant = actor.system?.[collection]?.[id];
  const proficiency = relevant?.prof;
  if (proficiency?.hasProficiency) {
    candidates.push(...create(getProficiencyLabel(proficiency.multiplier), proficiency.term, {
      sourceType: "standard",
      confidence: "exact",
      detail: localizeRule("Proficiency", { context: contextLabel })
    }));
  }

  addBonus(
    rollType === "skill"
      ? (CONFIG.DND5E.skills?.[id]?.label ?? id ?? localizeRule("SkillBonusLabel", null))
      : (CONFIG.DND5E.tools?.[id]?.label ?? id ?? localizeRule("ToolBonusLabel", null)),
    `${collection}.${id}.roll.bonus`, `${collection}.${id}.bonuses.check`, "exact",
    localizeRule(rollType === "skill" ? "SkillBonus" : "ToolBonus", { context: contextLabel })
  );
  addBonus(`${abilityLabel} ${localizeRule("CheckBonusLabel", null)}`, `abilities.${abilityId}.check.roll.bonus`, `abilities.${abilityId}.bonuses.check`,
    "exact", getActorCheckDetail(rollType, abilityLabel, rollId));
  addBonus(rollType === "skill" ? localizeRule("GlobalSkillBonus", null) : localizeRule("GlobalToolBonus", null),
    `rolls.ability.${rollType}.bonus`, `bonuses.abilities.${rollType}`, "derived", globalDetail);
  addBonus(localizeRule("GlobalCheckBonus", null), "rolls.ability.check.bonus", "bonuses.abilities.check", "derived", globalDetail);

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

// Bonus rules as term sources, named after their effect.
function buildRuleBonusCandidates(rules, rollData, rollType, item, actor) {
  return rules.flatMap((rule) => createCandidate(
    rule.effect?.name || localizeRuleLabel("ActiveEffectLabel", null, "Active effect"),
    rule.value,
    {
      sourceType: "effect",
      confidence: rollData ? "exact" : "labeled",
      detail: createEffectDetail(rule.effect, rollType, item, actor),
      rollData
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
    // Bless (+1d4) and Bane (-1d4) roll the same die
    if ((segment.operator ?? "+") !== (payload.operator ?? "+")) return -1;
    if (segment.expression === payloadExpression) return 100;
    // A critical hit doubles the dice (and may add some), a higher spell slot adds some: the die size still matches.
    // Only then, a bonus die of the same size (a smite on a merged card) must not pass for base damage.
    const critical = Boolean(payload.roll?.isCritical ?? payload.roll?.options?.isCritical);
    const faces = toFiniteNumber(payload.term?.faces);
    return (critical || segment.scales) && faces !== null && segment.faces === faces ? 50 : -1;
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

// Each term takes the best candidate of the pools, earlier pools win ties. A taken candidate leaves its pool, so a
// pool shared by several rolls of a card is used up over all of them.
function createTermSourceResolver(...pools) {
  return (payload) => {
    let bestPool = null;
    let bestIndex = -1;
    let bestScore = -1;
    for (const pool of pools) {
      for (let index = 0; index < pool.length; index += 1) {
        const score = getSegmentMatchScore(payload, pool[index]);
        if (score <= bestScore) continue;
        bestScore = score;
        bestPool = pool;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) return null;

    const [segment] = bestPool.splice(bestIndex, 1);
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

// Healing is rolled like damage, from the heal part of an activity. midi-qol names its damage rolls defaultDamage,
// otherDamage and bonusDamage.
const DAMAGE_ROLL_TYPES = new Set(["damage", "healing", "heal", "defaultDamage", "otherDamage", "bonusDamage"]);

function resolveMessageRollType(message, roll = null) {
  const type = resolveRawMessageRollType(message, roll);
  return DAMAGE_ROLL_TYPES.has(type) ? "damage" : type;
}

function resolveRawMessageRollType(message, roll = null) {
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

// The fields whose mode decides advantage for a roll, as dnd5e combines them.
function rollModePaths(rollType, abilityId, rollFlags, item, activity) {
  const check = [`abilities.${abilityId}.check.roll`, "rolls.ability.check"];
  const save = [`abilities.${abilityId}.save.roll`, "rolls.ability.save"];
  switch (rollType) {
    case "attack": {
      let actionType = null;
      try { actionType = activity?.getActionType?.(rollFlags.attackMode) ?? null; } catch { actionType = null; }
      return [`abilities.${abilityId}.attack.roll`, "rolls.attack", actionType ? `rolls.attack.${actionType}` : null];
    }
    case "ability": return check;
    case "skill": return [...check, "rolls.ability.skill", `skills.${rollFlags.skillId}.roll`];
    case "tool": return [...check, "rolls.ability.tool", `tools.${rollFlags.toolId}.roll`];
    case "initiative": return [...check, "attributes.init.roll"];
    case "save": return save;
    case "concentration": return [...save, "attributes.concentration.roll"];
    case "death": return ["attributes.death.roll", "rolls.ability.save"];
    default: return [];
  }
}

// The condition effects dnd5e turns into advantage or disadvantage, per roll type.
function rollModeConditions(rollType, abilityId) {
  const physical = globalThis.CONFIG?.DND5E?.abilities?.[abilityId]?.type === "physical";
  const check = [["abilityCheckDisadvantage", "DIS"], ...(physical ? [["physicalCheckDisadvantage", "DIS"]] : [])];
  const save = [["abilitySaveDisadvantage", "DIS"], ...(physical ? [["physicalSaveDisadvantage", "DIS"]] : []),
    ...(abilityId === "dex" ? [["dexteritySaveDisadvantage", "DIS"], ["dexteritySaveAdvantage", "ADV"]] : [])];
  switch (rollType) {
    case "ability": case "skill": case "tool": return check;
    case "initiative": return [...check, ["initiativeAdvantage", "ADV"], ["initiativeDisadvantage", "DIS"]];
    case "save": case "concentration": return save;
    default: return [];
  }
}

// One entry of CONFIG.DND5E.conditionEffects: a status ("poisoned") or a level of a leveled condition
// ("exhaustion-3", which dnd5e only uses under the 2014 rules). Immunities cancel it, as in dnd5e.
function conditionPropertyApplies(actor, property) {
  const [status, levelText] = String(property).split("-");
  if (actor?.system?.traits?.ci?.value?.has?.(status)) return false;
  const level = Number(levelText);
  if (levelText && Number.isInteger(level)) {
    if (globalThis.dnd5e?.settings?.rulesVersion === "modern" && status === "exhaustion") return false;
    const current = Number(actor?.system?.conditions?.[status] ?? actor?.system?.attributes?.[status] ?? 0);
    return current >= level;
  }
  return Boolean(actor?.statuses?.has?.(status));
}

function conditionName(status) {
  const name = globalThis.CONFIG?.DND5E?.conditionTypes?.[status]?.name
    ?? globalThis.CONFIG?.DND5E?.conditionTypes?.[status]?.label
    ?? globalThis.CONFIG?.statusEffects?.find?.((effect) => effect.id === status)?.name;
  return name ? game.i18n.localize(name) : null;
}

// Reasons for advantage or disadvantage outside of rules: active effects that change a roll mode (Rage, the
// "Strength Check Advantage" effects of dnd5e) and conditions such as poisoned, restrained or invisible.
function buildModeAttributions(actor, rollType, abilityId, rollFlags, item, activity) {
  if (!actor) return [];
  const attributions = [];
  const keys = new Set(rollModePaths(rollType, abilityId, rollFlags, item, activity).filter(Boolean).map((path) => `system.${path}.mode`));
  for (const effect of activeEffectsOf(actor)) {
    for (const change of effectChanges(effect)) {
      if (!keys.has(change?.key)) continue;
      // Foundry 14 warns when the numeric mode is read, so the mode only counts where there is no type (Foundry 13)
      const override = change?.type !== undefined && change?.type !== null ? change.type === "override" : Number(change?.mode) === 5;
      if (!isAddChange(change) && !override) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value) || value === 0) continue;
      attributions.push({ type: value > 0 ? "ADV" : "DIS", source: effect.uuid ?? null, displayName: effect.name ?? "" });
    }
  }

  const conditionEffects = globalThis.CONFIG?.DND5E?.conditionEffects ?? {};
  for (const [key, type] of rollModeConditions(rollType, abilityId)) {
    let applies = false;
    try { applies = Boolean(actor.hasConditionEffect?.(key)); } catch { applies = false; }
    if (!applies) continue;
    for (const property of conditionEffects[key] ?? []) {
      if (!conditionPropertyApplies(actor, property)) continue;
      const status = String(property).split("-")[0];
      const name = conditionName(status);
      if (name && !attributions.some((entry) => entry.type === type && entry.displayName === name)) attributions.push({ type, source: status, displayName: name });
    }
  }
  return attributions.filter((entry) => entry.displayName);
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
      const ruleReasons = data ? buildRuleAdvantageAttributions(collectRules(category, "advantage", actor, rollType === "attack" ? item : null, data)) : [];
      const abilityId = rollType === "attack"
        ? (rollFlags.ability || resolveActivityAbility(actor, item, activity))
        : resolveActorRollAbility(actor, rollType, rollFlags);
      return [...ruleReasons, ...buildModeAttributions(actor, rollType, abilityId, rollFlags, item, activity)];
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
  return { actor, rollFlags: { ability: ability ?? undefined }, title: target.name ?? actor.name ?? null };
}

// dnd5e keeps a situational bonus from the roll dialog only in the roll data, which a chat message does not store,
// and dnd5e 5 does not name the ability a skill or tool check was rolled with. Before the roll is evaluated both are
// copied into the roll options (dnd5e.postRollConfiguration), so the card still knows them later.
export function rememberRollContext(rolls, config = null) {
  for (const roll of rolls ?? []) {
    const chosen = roll?.data?.abilityId ?? config?.ability;
    const ability = typeof chosen === "string" && chosen ? chosen : null;
    if (ability && roll?.options && (config?.skill || config?.tool)) roll.options[MODULE_ID] = { ...(roll.options[MODULE_ID] ?? {}), ability };
    const situational = roll?.data?.situational;
    if (situational === undefined || situational === null || String(situational).trim() === "" || !roll.options) continue;
    let formula = String(situational);
    try {
      formula = Roll.replaceFormulaData(formula, roll.data ?? {}, { missing: "0" });
    } catch {
      // keep the bonus as typed
    }
    roll.options[MODULE_ID] = { ...(roll.options[MODULE_ID] ?? {}), situational: formula };
  }
}

function buildSituationalCandidates(roll) {
  const situational = roll?.options?.[MODULE_ID]?.situational;
  if (!situational) return [];
  return createCandidate(localizeRuleLabel("SituationalLabel", null, "Situational bonus"), situational, {
    sourceType: "standard",
    confidence: "exact",
    detail: localizeRule("SituationalBonus", null)
  });
}

function actorFromUuid(uuid) {
  if (!uuid || typeof fromUuidSync !== "function") return null;
  try {
    const document = fromUuidSync(uuid);
    return document?.documentName === "Actor" ? document : document?.actor ?? null;
  } catch {
    return null;
  }
}

// Monk's TokenBar puts the requested rolls of several tokens on one card of the GM. Its flags hold one entry per
// token with the roller, the request and the roll, in the order of the card's rolls.
function tokenBarEntries(message) {
  const flags = message?.flags?.["monks-tokenbar"];
  if (!flags || typeof flags !== "object") return [];
  return Object.entries(flags).filter(([key, value]) => key.startsWith("token") && value?.roll).map(([, value]) => value);
}

function tokenBarEntryFor(message, roll, index) {
  const entries = tokenBarEntries(message);
  if (!entries.length) return null;
  const same = (entry) => entry?.roll?.total === roll?.total && String(entry?.roll?.formula ?? "") === String(roll?.formula ?? "");
  return same(entries[index]) ? entries[index] : entries.find(same) ?? null;
}

const TOKEN_BAR_ROLL_TYPES = { ability: "ability", save: "save", skill: "skill", tool: "tool" };

// The roller and the roll of a token bar entry: its request names the kind of roll and the ability, skill or tool.
function resolveTokenBarContext(message, roll, index) {
  const entry = tokenBarEntryFor(message, roll, index);
  if (!entry) return null;
  const { type, key } = entry.request ?? {};
  const rollType = TOKEN_BAR_ROLL_TYPES[type] ?? (key === "death" ? "death" : key === "init" ? "initiative" : null);
  if (!rollType) return null;
  const actor = actorFromUuid(entry.uuid);
  const rollFlags = { type: rollType, ability: roll?.options?.ability ?? undefined };
  if (rollType === "save" || rollType === "ability") rollFlags.ability = key;
  if (rollType === "skill") rollFlags.skillId = key;
  if (rollType === "tool") {
    const slug = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const tool = actor?.items?.find?.((item) => item._stats?.compendiumSource === key || item.flags?.core?.sourceId === key || slug(item.name) === key);
    rollFlags.toolId = tool?.system?.type?.baseItem || tool?.system?.identifier || key;
  }
  return { actor, rollFlags, rollType, title: entry.name ?? actor?.name ?? null };
}

// The modifier the character sheet shows for initiative, a skill or a save.
function sheetTotalFor(actor, rollType, rollFlags) {
  const system = actor?.system;
  if (!system) return null;
  if (rollType === "initiative") return toFiniteNumber(system.attributes?.init?.total);
  if (rollType === "skill") return toFiniteNumber(system.skills?.[rollFlags?.skillId]?.total);
  if (rollType === "save") {
    const save = system.abilities?.[rollFlags?.ability]?.save;
    return toFiniteNumber(typeof save === "object" ? save?.value : save);
  }
  return null;
}

// Safety net for terms no source explains: when the modifiers of an initiative, skill or save roll add up to the
// modifier on the character sheet, the rest belongs to that modifier. It gets that name instead of "Unknown modifier".
function applySheetTotal(breakdown, actor, rollType, rollFlags) {
  const unknown = breakdown.modifiers.filter((modifier) => !modifier.sourceLabel);
  if (!unknown.length) return;
  const total = sheetTotalFor(actor, rollType, rollFlags);
  if (total === null) return;
  // The optional tiebreaker is part of the initiative roll, not of the total on the sheet
  const abilityId = resolveActorRollAbility(actor, rollType, rollFlags ?? {});
  const tiebreaker = rollType === "initiative" && readDnd5eSetting("initiativeDexTiebreaker")
    ? (toFiniteNumber(actor.system?.abilities?.[abilityId]?.value) ?? 0) / 100
    : 0;
  const sum = breakdown.modifiers.reduce((value, modifier) => value + (toFiniteNumber(modifier.value) ?? 0), 0);
  if (Math.abs(sum - total - tiebreaker) > 0.0001) return;
  const context = getCheckContextLabel(rollType, rollType === "skill" ? rollFlags?.skillId : null);
  const label = localizeRuleLabel("SheetBonusLabel", null, "Sheet bonus");
  const detail = localizeRule("SheetBonus", { context, total: total >= 0 ? `+${total}` : `${total}` });
  for (const modifier of unknown) Object.assign(modifier, { sourceLabel: label, sourceDetail: detail, confidence: "derived", sourceType: "actor" });
}

// Everything a card offers as term sources: item, activity and speaker, then per roll its type, roller, rule sources
// and candidates. The breakdowns and the debug file read a card the same way.
// A damage card that names no item, only "Scimitar - Damage Roll" in its flavor: Mob Attack Tool sums the damage of
// several hits into one roll that way, without a speaker. With midi-qol the text is the name of a temporary item of
// the card instead. The item of that name on the speaker, or else on the actors of the scene and the world whose
// numbers explain the roll.
function resolveFlavorItem(message, roll) {
  const flavor = String(message?.flavor || getMessageReference(message, "item")?.name || "");
  const separator = flavor.indexOf(" - ");
  if (separator <= 0) return null;
  const name = flavor.slice(0, separator).trim();
  const speaker = message?.getAssociatedActor?.() ?? null;
  const actors = speaker ? [speaker]
    : [...new Set([...Array.from(globalThis.canvas?.scene?.tokens ?? []).map((token) => token.actor), ...(game.actors?.contents ?? [])].filter(Boolean))];
  for (const actor of actors) {
    const item = actor.items?.getName?.(name) ?? null;
    const activity = item?.system?.activities?.find?.((candidate) => candidate?.damage?.parts?.length) ?? null;
    if (!item || !activity) continue;
    if (speaker || buildMultipliedDamageCandidates(roll, actor, item, activity).length) return { actor, item, activity };
  }
  return null;
}

// The damage of several hits in one roll: the item's die rolled once per hit (and more on a critical hit), the
// ability modifier times the number of hits.
function buildMultipliedDamageCandidates(roll, actor, item, activity) {
  const base = activity?.damage?.parts?.[0];
  const die = (roll?.terms ?? []).find((term) => isDiceTerm(term));
  if (!base?.denomination || toFiniteNumber(die?.faces) !== base.denomination) return [];
  const abilityKey = resolveActivityAbility(actor, item, activity);
  const abilityMod = toFiniteNumber(actor?.system?.abilities?.[abilityKey]?.mod);
  const numeric = (roll?.terms ?? []).filter((term) => getTermType(term) === "NumericTerm").map((term) => toFiniteNumber(term.number ?? term.total) ?? 0);
  if (!abilityMod || numeric.length !== 1) return [];
  const hits = numeric[0] / abilityMod;
  if (!Number.isInteger(hits) || hits < 2 || toFiniteNumber(die.number) < hits * (base.number || 1)) return [];
  const detail = localizeRule("MultipliedDamage", { hits, item: item.name });
  return [
    ...createCandidate(localizeRuleLabel("BaseDamageLabel", null, "Base damage"), die.expression ?? `${die.number}d${die.faces}`, { sourceType: "item", confidence: "exact", detail }),
    ...createCandidate(`${abilityModifierLabel(localizeAbilityLabel(abilityKey))} ×${hits}`, `${numeric[0]}`, { sourceType: "standard", confidence: "exact", detail })
  ];
}

async function readCardRolls(message, rolls, rollType) {
  let item = await resolveMessageItem(message);
  const speakerActor = message?.getAssociatedActor?.() ?? null;
  let activity = await resolveMessageActivity(message, item, item?.actor ?? speakerActor);
  const flavorItem = !item && rollType === "damage" ? resolveFlavorItem(message, rolls[0]) : null;
  if (flavorItem) ({ item, activity } = flavorItem);
  const actor = flavorItem?.actor ?? item?.actor ?? speakerActor;
  const attackCandidates = item && activity && actor
    ? buildAttackSourceCandidates(actor, item, activity, message)
    : null;
  const damageCandidates = item && activity && actor
    ? buildDamageSourceCandidates(actor, item, activity, message)
    : null;
  const rules = createRuleSources({ actor, item, activity, message });
  // dnd5e rolls one damage roll per damage part and adds the ability modifier, magic and actor bonuses to the first
  // one only. The damage rolls of a card share one pool, so a bonus die that a module adds as another roll (Hunter's
  // Mark through Chris's Premades) cannot pass for base damage a second time.
  const damagePool = damageCandidates ? [...damageCandidates] : null;

  const result = [];
  for (const [index, roll] of rolls.entries()) {
    const tokenBar = resolveTokenBarContext(message, roll, index);
    const currentRollType = tokenBar?.rollType ?? resolveMessageRollType(message, roll) ?? rollType;
    let baseCandidates = currentRollType === "attack" ? attackCandidates : currentRollType === "damage" ? damageCandidates : null;
    // midi-qol bonus damage (a smite, sneak attack from a macro) is no part of the item's own damage
    if (roll?.options?.["midi-qol"]?.rollType === "bonusDamage") baseCandidates = null;
    let rollRules = rules;
    let context = { actor, rollFlags: null };
    if (ACTOR_ROLL_TYPES.has(currentRollType)) {
      context = tokenBar ?? await resolveActorRollContext(message, roll, rollType, speakerActor ?? actor, activity);
      const remembered = roll?.options?.[MODULE_ID]?.ability;
      if (remembered && !context.rollFlags?.ability) context = { ...context, rollFlags: { ...(context.rollFlags ?? {}), ability: remembered } };
      baseCandidates = context.actor ? buildActorRollSourceCandidates(context.actor, currentRollType, context.rollFlags) : null;
      rollRules = createRuleSources({ actor: context.actor, item, activity, message, rollFlags: context.rollFlags });
    } else if (currentRollType === "hitDie" && (speakerActor ?? actor)) {
      baseCandidates = buildHitDieCandidates(speakerActor ?? actor, roll);
    }
    const ruleCandidates = [...rollRules.bonusCandidates(currentRollType, roll), ...buildSituationalCandidates(roll)];
    const candidates = baseCandidates || ruleCandidates.length ? [...(baseCandidates ?? []), ...ruleCandidates] : null;
    const basePool = baseCandidates && baseCandidates === damageCandidates ? damagePool : [...(baseCandidates ?? [])];
    if (flavorItem && currentRollType === "damage") basePool.unshift(...buildMultipliedDamageCandidates(roll, actor, item, activity));
    result.push({ index, roll, rollType: currentRollType, context, rules: rollRules, candidates, pools: [basePool, ruleCandidates] });
  }
  return { item, activity, speakerActor, rolls: result };
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

  // Cards with rolls of several actors: Monk's TokenBar requests and the target saves midi-qol adds to the card of
  // the caster. The visibility rules then apply per roll, so a player sees the save of the own hero but not the
  // save bonus of a monster. Other rolls of such a card follow the card.
  getRollActors(message) {
    const rolls = this.getMessageRolls(message);
    const tokenBar = tokenBarEntries(message).length > 0;
    if (!tokenBar && !rolls.some((roll) => roll?.options?.["midi-qol"]?.targetUuid)) return null;
    return rolls.map((roll, index) => {
      if (tokenBar) return actorFromUuid(tokenBarEntryFor(message, roll, index)?.uuid);
      return actorFromUuid(roll?.options?.["midi-qol"]?.targetUuid);
    });
  }

  // What the adapter reads from a card, for debug files: roll type, item, activity, the roller of each roll and the
  // term sources it found for it.
  async debugInfo(message) {
    await ensureSystemTranslationsLoaded();
    const rollType = resolveMessageRollType(message);
    const card = await readCardRolls(message, this.getMessageRolls(message), rollType);
    return {
      rollType,
      rollFlags: getRollFlags(message),
      item: card.item?.uuid ?? null,
      activity: card.activity?.uuid ?? null,
      speakerActor: card.speakerActor?.uuid ?? null,
      readySetRoll: Boolean(getStoredRolls(message)),
      rolls: card.rolls.map(({ index, rollType: currentRollType, context, candidates }) => ({
        index,
        rollType: currentRollType,
        actor: context.actor?.uuid ?? null,
        rollFlags: context.rollFlags,
        sources: (candidates ?? []).map((segment) => ({ label: segment.label, expression: segment.expression, value: segment.signedValue }))
      }))
    };
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();

    const rollType = resolveMessageRollType(message);
    if (!rollType) return super.buildBreakdowns(message);

    const card = await readCardRolls(message, this.getMessageRolls(message), rollType);
    const breakdowns = [];
    for (const { index, roll, rollType: currentRollType, rules: rollRules, candidates, pools, context } of card.rolls) {
      const breakdown = parseRoll(roll, {
        adapterId: this.id,
        rollIndex: index,
        termSourceResolver: candidates ? createTermSourceResolver(...pools) : null
      });
      if (context?.actor) applySheetTotal(breakdown, context.actor, currentRollType, context.rollFlags);
      // Cards with rolls of several actors name each roll after its roller, for the GM and for the owners of the roller
      if (context?.title && (game.user?.isGM || context.actor?.isOwner)) breakdown.title = context.title;

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