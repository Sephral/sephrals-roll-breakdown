import { GenericRollAdapter } from "./generic-adapter.js";
import { parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import {
  countText,
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

// Dice rules of the Crucible standard check (crucible/module/const/dice.mjs, dice/standard-check.mjs).
const BASE_DIE = 8;
const DIE_STEP = 2;
const MIN_DIE = 4;
const MAX_DIE = 12;
const MAX_BOONS = 6;
const DEFAULT_CRITICAL_THRESHOLD = 6;

// AttackRoll.RESULT_TYPES (crucible/module/dice/attack-roll.mjs)
const RESULT_KEYS = ["Miss", "Dodge", "Parry", "Block", "Armor", "Resist", "Glance", "Hit"];
const RESULT_GLANCE = 6;
const RESULT_HIT = 7;

function getCrucibleDiceClasses() {
  return globalThis.crucible?.api?.dice ?? {};
}

function getSystemConfig() {
  return globalThis.SYSTEM ?? globalThis.crucible?.CONST ?? {};
}

function isStandardCheck(roll) {
  if (isInstanceOf(roll, getCrucibleDiceClasses().StandardCheck, "StandardCheck")) return true;
  const data = roll?.data;
  return Boolean(
    data
    && typeof data === "object"
    && data.boons && typeof data.boons === "object"
    && data.banes && typeof data.banes === "object"
    && "ability" in data
    && "skill" in data
  );
}

// InitiativeCheck inherits the DC 15 of StandardCheck, which means nothing for an initiative roll.
function isInitiativeCheck(roll) {
  return isInstanceOf(roll, getCrucibleDiceClasses().InitiativeCheck, "InitiativeCheck") || roll?.data?.type === "initiative";
}

function isAttackRoll(roll) {
  if (isInstanceOf(roll, getCrucibleDiceClasses().AttackRoll, "AttackRoll")) return true;
  return Number.isInteger(roll?.data?.result) && typeof roll?.data?.defenseType === "string";
}

function getBoonEntries(record) {
  if (!record || typeof record !== "object") return [];
  return Object.entries(record)
    .map(([id, entry]) => ({
      id,
      label: localizeLabel(entry?.label) ?? id,
      number: toFiniteNumber(entry?.number ?? 1) ?? 0
    }))
    .filter((entry) => entry.number > 0);
}

function getTotal(explicitTotal, entries, max) {
  const total = toFiniteNumber(explicitTotal);
  if (total !== null) return total;
  return Math.min(sumValues(entries.map((entry) => ({ value: entry.number }))), max);
}

// Replays StandardCheck.parse: boons enlarge dice from the left, banes shrink dice from the right.
export function computeDicePool(totalBoons, totalBanes) {
  const pool = [0, 1, 2].map(() => ({ faces: BASE_DIE, boons: 0, banes: 0 }));

  let index = 0;
  for (let step = 0; step < totalBoons && index <= 2; step += 1) {
    pool[index].faces += DIE_STEP;
    pool[index].boons += 1;
    if (pool[index].faces === MAX_DIE) index += 1;
  }

  index = 2;
  for (let step = 0; step < totalBanes && index >= 0; step += 1) {
    pool[index].faces -= DIE_STEP;
    pool[index].banes += 1;
    if (pool[index].faces === MIN_DIE) index -= 1;
  }

  return pool;
}

function describeDieChange(die) {
  const counts = [
    die.boons ? countText("Crucible.BoonCount", die.boons) : null,
    die.banes ? countText("Crucible.BaneCount", die.banes) : null
  ].filter(Boolean);

  const detailKey = die.faces > BASE_DIE ? "Crucible.DieRaised" : die.faces < BASE_DIE ? "Crucible.DieLowered" : "Crucible.DieKept";
  return {
    label: counts.join(", "),
    detail: systemText(detailKey, { base: `d${BASE_DIE}`, die: `d${die.faces}` })
  };
}

// Only annotates the dice when the rolled pool matches the boons and banes in the roll data.
function annotateDice(breakdown, pool) {
  if (breakdown.diceTerms.length !== pool.length) return false;
  if (breakdown.diceTerms.some((term, index) => term.faces !== pool[index].faces || term.number !== 1)) return false;

  breakdown.diceTerms.forEach((term, index) => {
    const die = pool[index];
    if (!die.boons && !die.banes) return;
    const { label, detail } = describeDieChange(die);
    term.sourceLabel = label;
    term.sourceDetail = detail;
    term.confidence = "exact";
  });
  return true;
}

function buildBoonSection(boons, banes) {
  const items = [
    ...boons.map((entry) => createItem({ text: entry.label, tag: systemText("Crucible.Boon"), value: String(entry.number) })),
    ...banes.map((entry) => createItem({ text: entry.label, tag: systemText("Crucible.Bane"), value: String(entry.number) }))
  ];
  return createSection(systemText("Crucible.BoonsBanes"), items, { placement: "top" });
}

function abilityNames(abilityIds) {
  const abilities = getSystemConfig().ABILITIES ?? {};
  const names = (abilityIds ?? [])
    .map((id) => localizeLabel(abilities[id]?.label) ?? null)
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

function getSkillConfig(skillId) {
  if (typeof skillId !== "string") return null;
  return getSystemConfig().SKILLS?.[skillId] ?? null;
}

function resolveRollItem(data) {
  const actor = data?.actorId ? globalThis.game?.actors?.get?.(data.actorId) : null;
  if (!actor || !data?.itemId) return null;
  return actor.items?.get?.(data.itemId) ?? null;
}

// Ability, skill and enchantment are the fixed parts of every StandardCheck formula.
function buildDataModifiers(data) {
  const skill = getSkillConfig(data.type);
  const item = resolveRollItem(data);
  const scaling = typeof item?.system?.scaling === "string" ? item.system.scaling.split(".") : null;

  let abilityDetail = null;
  if (skill?.abilities) abilityDetail = abilityNames(skill.abilities);
  else if (data.type === "initiative") abilityDetail = abilityNames(["dexterity", "intellect"]);
  else if (scaling) abilityDetail = abilityNames(scaling);

  const modifiers = [
    createDataModifier({
      label: systemText("Crucible.AbilityBonus"),
      value: toFiniteNumber(data.ability) ?? 0,
      detail: abilityDetail ? systemText("Crucible.FromAbilities", { abilities: abilityDetail }) : null
    }),
    createDataModifier({
      label: systemText("Crucible.SkillBonus"),
      value: toFiniteNumber(data.skill) ?? 0,
      detail: skill ? localizeLabel(skill.label) : null
    })
  ];

  const enchantment = toFiniteNumber(data.enchantment) ?? 0;
  if (enchantment !== 0) {
    modifiers.push(createDataModifier({
      label: systemText("Crucible.Enchantment"),
      value: enchantment,
      detail: item?.name ? systemText("Crucible.FromItem", { item: item.name }) : null
    }));
  }

  return modifiers;
}

function getDiceSum(breakdown) {
  return breakdown.diceTerms.reduce((total, term) => total + (Number.isFinite(term.total) ? term.total : Number.NaN), 0);
}

function getCheckOutcome(total, data) {
  const dc = toFiniteNumber(data.dc);
  if (dc === null || data.dc === null || total === null) return null;
  const successThreshold = toFiniteNumber(data.criticalSuccessThreshold) ?? DEFAULT_CRITICAL_THRESHOLD;
  const failureThreshold = toFiniteNumber(data.criticalFailureThreshold) ?? DEFAULT_CRITICAL_THRESHOLD;
  const success = total > dc;
  let key = success ? "Success" : "Failure";
  if (total > dc + successThreshold) key = "CriticalSuccess";
  else if (total <= dc - failureThreshold) key = "CriticalFailure";
  return {
    dc,
    key,
    success,
    critical: key.startsWith("Critical"),
    margin: total - dc,
    criticalHigh: dc + successThreshold,
    criticalLow: dc - failureThreshold
  };
}

function getDefenseLabel(defenseType) {
  const config = getSystemConfig();
  const defense = config.DEFENSES?.[defenseType];
  if (defense) return localizeLabel(defense.shortLabel ?? defense.label);
  const skill = config.SKILLS?.[defenseType];
  if (skill) return localizeLabel(skill.label);
  return systemText("Crucible.Dc");
}

function buildOutcomePills(roll, data, isGM) {
  // Initiative has no DC, its result is the roll total
  if (isInitiativeCheck(roll)) return [];
  const total = toFiniteNumber(roll?.total);
  const outcome = getCheckOutcome(total, data);
  const pills = [];

  if (isAttackRoll(roll)) {
    const defense = getDefenseLabel(data.defenseType);
    if (outcome) pills.push(createPill(isGM ? `${defense} ${outcome.dc}` : defense));
    const resultKey = RESULT_KEYS[data.result];
    if (resultKey) {
      const key = data.result === RESULT_HIT && outcome?.key === "CriticalSuccess" ? "CriticalHit" : resultKey;
      pills.push(createPill(systemText(`Crucible.Result.${key}`), { emphasis: true }));
    }
    if (outcome && isGM) pills.push(createPill(systemText("Crucible.Margin", { margin: formatSignedNumber(outcome.margin) })));
    return pills;
  }

  if (!outcome) return pills;
  if (isGM) pills.push(createPill(`${systemText("Crucible.Dc")} ${outcome.dc}`));
  pills.push(createPill(systemText(`Crucible.Outcome.${outcome.key}`), {
    emphasis: true,
    tooltip: isGM ? systemText("Crucible.CriticalRange", { high: outcome.criticalHigh, low: outcome.criticalLow }) : null
  }));
  if (isGM) pills.push(createPill(systemText("Crucible.Margin", { margin: formatSignedNumber(outcome.margin) })));
  return pills;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// CrucibleAction.computeDamage (crucible/module/models/action.mjs); the system's own function is preferred.
function computeDamage(damage) {
  const systemCompute = globalThis.crucible?.api?.models?.CrucibleAction?.computeDamage;
  if (typeof systemCompute === "function") return systemCompute(damage);

  const { overflow = 1, base = 0, bonus = 0, resistance = 0, restoration = false } = damage;
  let { multiplier = 1 } = damage;
  if (overflow < 0) multiplier = Math.max(multiplier, 1);
  const preMitigation = (overflow * multiplier) + base + bonus;
  if (preMitigation <= 0) return 0;
  const postMitigation = restoration ? preMitigation : preMitigation - resistance;
  return clamp(postMitigation, 0, 2 * preMitigation);
}

function getDamageTypeLabel(damage) {
  const config = getSystemConfig();
  if (damage.restoration) return localizeLabel(config.RESOURCES?.[damage.resource]?.label);
  return localizeLabel(config.DAMAGE_TYPES?.[damage.type]?.label) ?? (typeof damage.type === "string" ? damage.type : null);
}

// Mirrors the damage part of the system's own roll tooltip (StandardCheck#prepareRenderedDamage).
function buildDamageSection(data) {
  const damage = data?.damage;
  if (!damage || typeof damage !== "object" || damage.harmless) return null;
  if (!(data.result >= RESULT_GLANCE)) return null;
  const total = toFiniteNumber(damage.total);
  if (total === null) return null;

  const overflow = toFiniteNumber(damage.overflow);
  const multiplier = toFiniteNumber(damage.multiplier) ?? 1;
  const base = toFiniteNumber(damage.base);
  const bonus = toFiniteNumber(damage.bonus);
  const items = [];

  if (overflow !== null) {
    items.push(createItem({
      text: systemText("Crucible.Damage.Overflow"),
      tag: multiplier !== 1 ? `x${multiplier}` : null,
      tooltip: multiplier !== 1 ? systemText("Crucible.Damage.Multiplier", { multiplier }) : null,
      value: String(overflow)
    }));
  }
  if (base !== null) items.push(createItem({ text: systemText("Crucible.Damage.Base"), value: String(base) }));
  if (bonus !== null) items.push(createItem({ text: systemText("Crucible.Damage.Bonus"), value: String(bonus) }));

  const resistance = damage.resistance === null || damage.resistance === undefined ? null : Number(damage.resistance);
  if (!damage.restoration && resistance !== null && !Number.isNaN(resistance) && resistance !== 0) {
    let applied = resistance;
    if (Number.isFinite(applied)) {
      const preMitigation = computeDamage({ ...damage, resistance: 0 });
      applied = clamp(applied, -preMitigation, preMitigation);
    }
    if (applied !== 0) {
      items.push(createItem({
        text: systemText(applied < 0 ? "Crucible.Damage.Vulnerability" : "Crucible.Damage.Resistance"),
        value: Number.isFinite(applied) ? String(Math.abs(applied)) : "∞"
      }));
    }
  }

  items.push(createItem({ text: systemText("Crucible.Damage.Total"), tag: getDamageTypeLabel(damage), value: String(total) }));
  return createSection(systemText(damage.restoration ? "Crucible.Healing" : "Crucible.Damage.Label"), items);
}

function getSpecialInitiativeKey(data) {
  return data.incapacitated ? "Incapacitated" : data.unaware ? "Unaware" : null;
}

function buildSpecialInitiativeSection(data, total) {
  const key = getSpecialInitiativeKey(data);
  if (!key) return null;
  return createSection(null, [createItem({
    text: systemText(`Crucible.${key}`),
    tooltip: systemText(`Crucible.${key}Hint`),
    value: total === null ? null : String(total)
  })], { placement: "top" });
}

function getSectionTitles(message) {
  const titles = new Map();
  for (const section of message?.flags?.crucible?.sections ?? []) {
    for (const index of section?.rollIndices ?? []) {
      if (Number.isInteger(index) && typeof section.name === "string") titles.set(index, section.name);
    }
  }
  return titles;
}

function findCombatant(actorId) {
  const combats = [globalThis.game?.combat, ...(globalThis.game?.combats?.contents ?? [])].filter(Boolean);
  for (const combat of combats) {
    const combatant = combat.combatants?.find?.((entry) => entry?.actorId === actorId);
    if (combatant) return combatant;
  }
  return null;
}

function resolveRollTitle(message, roll, rollIndex, sectionTitles) {
  if (sectionTitles.has(rollIndex)) return sectionTitles.get(rollIndex);
  const data = roll?.data ?? {};
  if (data.target && typeof globalThis.fromUuidSync === "function") {
    try {
      const target = globalThis.fromUuidSync(data.target);
      if (target?.name) return target.name;
    } catch {
      // Unresolvable targets simply get no title.
    }
  }

  const flags = message?.flags?.crucible ?? {};
  if ((flags.isInitiativeReport || flags.groupCheck) && data.actorId) {
    return findCombatant(data.actorId)?.name ?? globalThis.game?.actors?.get?.(data.actorId)?.name ?? null;
  }
  return null;
}

// The initiative report hides hidden combatants from players, so their breakdown stays hidden too.
function isRollVisibleToUser(message, roll, isGM) {
  if (isGM || !message?.flags?.crucible?.isInitiativeReport) return true;
  const actorId = roll?.data?.actorId;
  if (!actorId) return false;
  if (globalThis.game?.actors?.get?.(actorId)?.isOwner) return true;
  const combatant = findCombatant(actorId);
  return Boolean(combatant) && !combatant.hidden;
}

export function buildCrucibleBreakdown(roll, { rollIndex = 0, title = null, isGM = false } = {}) {
  const data = roll?.data ?? {};
  const breakdown = parseRoll(roll, { adapterId: "crucible", rollIndex });

  const boons = getBoonEntries(data.boons);
  const banes = getBoonEntries(data.banes);
  const pool = computeDicePool(getTotal(data.totalBoons, boons, MAX_BOONS), getTotal(data.totalBanes, banes, MAX_BOONS));
  annotateDice(breakdown, pool);

  // The formula is "3 dice + ability + skill (+ enchantment)". Labels replace the parsed numbers only when they add up.
  const total = toFiniteNumber(roll?.total);
  const dataModifiers = buildDataModifiers(data);
  const diceSum = getDiceSum(breakdown);
  const specialInitiative = getSpecialInitiativeKey(data);
  if (breakdown.diceTerms.length > 0 && total !== null && diceSum + sumValues(dataModifiers) === total) {
    breakdown.modifiers = dataModifiers;
    breakdown.unresolvedTerms = [];
    breakdown.totalStaticModifier = sumValues(dataModifiers);
  } else if (specialInitiative && !breakdown.diceTerms.length && total !== null) {
    // Unaware (1) and incapacitated (0) combatants roll no dice, the whole formula is the fixed value
    const fixed = createDataModifier({
      label: systemText("Crucible.FixedInitiative"),
      value: total,
      detail: systemText(`Crucible.${specialInitiative}Hint`)
    });
    breakdown.modifiers = [fixed];
    breakdown.computedTerms = [];
    breakdown.unresolvedTerms = [];
    breakdown.totalStaticModifier = total;
  }
  summarizeBreakdown(breakdown);

  const sections = [
    buildSpecialInitiativeSection(data, total),
    buildBoonSection(boons, banes),
    buildDamageSection(data)
  ];
  return finalizeBreakdown(breakdown, {
    sections,
    pills: buildOutcomePills(roll, data, isGM),
    title,
    forceVisible: breakdown.diceTerms.length > 0
  });
}

export class CrucibleRollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "crucible";
    // Crucible adds its action sections after the render hook, the panel waits for the finished card.
    this.waitForCard = true;
  }

  supportsMessage(message) {
    return globalThis.game?.system?.id === "crucible" && super.supportsMessage(message);
  }

  // Skill checks posted with rollSkill(..., {chatMessage: true}) carry no speaker, only roll.data.actorId.
  // Without it a GM posting a check for a player's hero would count as a GM roll for the visibility rules.
  getMessageActor(message) {
    if (message?.speaker?.actor || message?.speaker?.token) return null;
    const actorIds = new Set((message?.rolls ?? []).filter(isStandardCheck).map((roll) => roll.data?.actorId).filter(Boolean));
    if (actorIds.size !== 1) return null;
    return globalThis.game?.actors?.get?.([...actorIds][0]) ?? null;
  }

  // Initiative reports and group checks hold rolls of several actors. The visibility rules then apply per roll,
  // so players see the rolls of their heroes while NPC rolls stay hidden.
  getRollActors(message) {
    const flags = message?.flags?.crucible ?? {};
    const actorIds = (message?.rolls ?? []).map((roll) => (isStandardCheck(roll) ? roll.data?.actorId ?? null : null));
    const distinct = new Set(actorIds.filter(Boolean));
    if (!distinct.size) return null;
    const report = Boolean(flags.isInitiativeReport || flags.groupCheck);
    const hasSpeaker = Boolean(message?.speaker?.actor || message?.speaker?.token);
    if (!report && (distinct.size < 2 || hasSpeaker)) return null;
    return actorIds.map((actorId) => (actorId ? globalThis.game?.actors?.get?.(actorId) ?? null : null));
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();
    const isGM = isCurrentUserGM();
    const sectionTitles = getSectionTitles(message);

    return (message?.rolls ?? [])
      .map((roll, index) => {
        if (!roll) return null;
        if (!isStandardCheck(roll)) return keepNamed(parseRoll(roll, { adapterId: this.id, rollIndex: index }));
        if (!isRollVisibleToUser(message, roll, isGM)) return null;
        return buildCrucibleBreakdown(roll, {
          rollIndex: index,
          title: resolveRollTitle(message, roll, index, sectionTitles),
          isGM
        });
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
