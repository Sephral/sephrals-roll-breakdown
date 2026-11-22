import { GenericRollAdapter } from "./generic-adapter.js";
import { getTermType, isDiceTerm, parseRoll, summarizeBreakdown, toFiniteNumber } from "../formula-parser.js";
import { ensureSystemTranslationsLoaded } from "../settings.js";
import {
  findTormenta20Target,
  t20CriticalMultiplier,
  t20ItemData,
  t20Natural,
  t20RollKind,
  t20SaveOf,
  t20ThreatFrom,
  t20Threatens
} from "../tormenta20-targets.js";
import {
  createDataModifier,
  createPill,
  finalizeBreakdown,
  formatSignedNumber,
  isCurrentUserGM,
  keepNamed,
  systemText
} from "./system-adapter-utils.js";

// Data shapes follow the Tormenta20 system source (Vizael, 1.6): every d20 roll and every damage roll is a RollT20. A test
// (skill, attribute, saving throw) is 1d20 plus the total bonus of the skill or attribute plus an extra bonus term, an
// attack is 1d20 plus the skill, the bonus of the weapon and bonuses of the character, damage is the dice of the item with
// the damage type as flavor plus attribute and bonus terms. The terms carry no labels, the module names them from the
// item and the character that rolled. A critical threat multiplies the damage dice of the card (the system does it
// before it knows whether the attack hits).

const ATTRIBUTES = ["for", "des", "con", "int", "sab", "car"];
const DAMAGE_TYPES = ["dano", "perda", "acido", "corte", "eletricidade", "essencia", "fogo", "frio", "impacto", "luz", "psiquico", "perfuracao", "trevas"];
const HEALING_TYPES = ["curapv", "curatpv", "curapm", "curatpm"];

function speakerActorOf(message) {
  try {
    return message?.speakerActor ?? globalThis.game?.actors?.get?.(message?.speaker?.actor) ?? null;
  } catch {
    return null;
  }
}

function text(key, data) {
  return systemText(`Tormenta20.${key}`, data);
}

function attributeLabel(key) {
  return ATTRIBUTES.includes(key) ? text(`Attribute.${key}`) : null;
}

function skillLabel(key) {
  const label = text(`Skill.${key}`);
  return label === `SRB.Tormenta20.Skill.${key}` ? null : label;
}

function damageTypeLabel(flavor) {
  const key = String(flavor ?? "").trim();
  if (DAMAGE_TYPES.includes(key)) return text(`Type.${key}`);
  if (HEALING_TYPES.includes(key)) return text(`Heal.${key}`);
  return null;
}

// The name on the card of a test: the system puts the name of the skill there (empty for an attribute test).
function cardTitle(message) {
  const match = String(message?.content ?? "").match(/class="item-name">\s*<div>([^<]*)<\/div>/);
  return match ? match[1].trim() : "";
}

function findSkillKey(actor, title) {
  const skills = actor?.system?.pericias;
  if (!skills || !title) return null;
  const found = Object.entries(skills).find(([, skill]) => typeof skill?.label === "string" && skill.label.trim() === title);
  return found ? found[0] : null;
}

// How a skill value comes together: half the level, the attribute, the training and everything else.
function skillDetail(actor, key) {
  // The skills of a creature are set by hand, only a character's value comes together from level, attribute and training
  if (actor?.type !== "character") return null;
  const skill = actor?.system?.pericias?.[key];
  const value = toFiniteNumber(skill?.value);
  if (value === null) return null;
  const level = toFiniteNumber(actor?.system?.attributes?.nivel?.value) ?? 0;
  const half = Math.floor(level / 2);
  const attribute = toFiniteNumber(actor?.system?.atributos?.[skill.atributo]?.value) ?? 0;
  const training = skill.treinado ? (toFiniteNumber(actor?.system?.attributes?.treino) ?? 0) : 0;
  const other = value - half - attribute - training;
  const parts = [];
  if (half) parts.push(text("HalfLevel", { value: formatSignedNumber(half) }));
  if (attribute || attributeLabel(skill.atributo)) parts.push(`${attributeLabel(skill.atributo) ?? skill.atributo} ${formatSignedNumber(attribute)}`);
  if (training) parts.push(text("Training", { value: formatSignedNumber(training) }));
  if (other) parts.push(text("OtherBonus", { value: formatSignedNumber(other) }));
  return parts.join(", ") || null;
}

// Splits the terms into signed groups, one per added part. Null for formulas with other operators.
function splitGroups(roll) {
  const groups = [];
  let sign = 1;
  let group = null;
  for (const term of roll?.terms ?? []) {
    if (getTermType(term) === "OperatorTerm") {
      if (term.operator !== "+" && term.operator !== "-") return null;
      sign = term.operator === "-" ? -1 : 1;
      group = null;
      continue;
    }
    if (!group) {
      group = { sign, terms: [] };
      groups.push(group);
    }
    group.terms.push(term);
  }
  return groups;
}

function termValue(term) {
  return toFiniteNumber(getTermType(term) === "NumericTerm" ? (term.total ?? term.number) : term?.total);
}

function dieExpression(term) {
  return `${term?.number ?? 1}d${term?.faces}${(Array.isArray(term?.modifiers) ? term.modifiers : []).join("")}`;
}

function createDie(term, sign, { label = null, notes = [] } = {}) {
  const total = toFiniteNumber(term?.total);
  const signed = total === null ? null : sign * total;
  return {
    expression: `${sign < 0 ? "-" : ""}${dieExpression(term)}`,
    total: signed,
    totalText: signed === null ? null : String(signed),
    faces: toFiniteNumber(term?.faces),
    number: toFiniteNumber(term?.number),
    sourceLabel: label,
    sourceDetail: null,
    notes: notes.filter(Boolean),
    confidence: "exact"
  };
}

// The labels of the number groups of a roll in the order the system adds them, from what the item and the character say.
function labelQueue(kind, { message, actor, roll }) {
  const data = t20ItemData(message);
  const queue = [];
  if (kind === "check") {
    const title = cardTitle(message);
    const skillKey = findSkillKey(actor, title);
    if (skillKey) {
      queue.push({ label: skillLabel(skillKey) ?? title, detail: skillDetail(actor, skillKey) });
    } else {
      // An attribute test has no name on its card, the value tells which one when only one attribute has it
      const firstGroup = (splitGroups(roll) ?? []).find((group) => !group.terms.some((term) => isDiceTerm(term)));
      const parts = (firstGroup?.terms ?? []).map(termValue);
      const value = firstGroup && parts.every((entry) => entry !== null) ? firstGroup.sign * parts.reduce((sum, entry) => sum + entry, 0) : null;
      const matches = ATTRIBUTES.filter((key) => toFiniteNumber(actor?.system?.atributos?.[key]?.value) === value);
      queue.push({ label: matches.length === 1 ? attributeLabel(matches[0]) : text("AttributeModifier"), detail: null });
    }
  } else if (kind === "attack") {
    const attack = (data?.rolls ?? []).find((entry) => entry?.type === "ataque");
    const skillKey = String(attack?.parts?.[1]?.[0] ?? "");
    if (skillKey) queue.push({ label: skillLabel(skillKey) ?? skillKey, detail: skillDetail(actor, skillKey) });
    const bonus = attack?.parts?.[2]?.[0];
    if (bonus !== undefined && String(bonus).trim() !== "") queue.push({ label: text("AttackBonus"), detail: null });
  } else if (kind === "damage") {
    const index = (message?.rolls ?? []).filter((entry) => t20RollKind(entry, message) === "damage").indexOf(roll);
    const damage = (data?.rolls ?? []).filter((entry) => entry?.type === "dano")[index];
    for (const [formula] of (damage?.parts ?? []).slice(1)) {
      for (const piece of String(formula ?? "").split("+").map((entry) => entry.trim()).filter(Boolean)) {
        if (/\d*d\d+/i.test(piece)) continue;
        const token = piece.replace(/^@/, "");
        if (ATTRIBUTES.includes(token)) queue.push({ label: attributeLabel(token), detail: null });
        else if (/^(dano|danoMagico|danoCAC|danoAD|danoALQ)$/.test(token)) queue.push({ label: text("DamageBonus"), detail: null });
        else if (/^(curaGeral|curaMagica|curaALQ)$/.test(token)) queue.push({ label: text("HealingBonus"), detail: null });
        else queue.push({ label: text("Bonus"), detail: null });
      }
    }
  }
  return queue;
}

// Replaces the generic terms: dice with the damage type as their name, numbers with what the system added them for.
function rebuildTerms(breakdown, roll, kind, context) {
  const groups = splitGroups(roll);
  if (!groups) return false;
  const queue = labelQueue(kind, { ...context, roll });
  const diceOut = [];
  const modifiersOut = [];
  const critical = kind === "damage" && context.critical;

  for (const group of groups) {
    const dice = group.terms.filter((term) => isDiceTerm(term));
    if (dice.length) {
      for (const term of dice) {
        const flavor = typeof term?.flavor === "string" ? term.flavor.trim() : "";
        const notes = critical && diceOut.length === 0 ? [text("Doubled", { factor: context.multiplier })] : [];
        diceOut.push(createDie(term, group.sign, { label: damageTypeLabel(flavor) ?? (flavor || null), notes }));
      }
      continue;
    }
    const values = group.terms.map(termValue);
    if (values.some((value) => value === null)) return false;
    const value = group.sign * values.reduce((sum, entry) => sum + entry, 0);
    const named = queue.shift() ?? null;
    // A bonus of zero is the empty extra term the system always adds, it says nothing
    if (value === 0) continue;
    modifiersOut.push(createDataModifier({ label: named?.label ?? text("Bonus"), value, detail: named?.detail ?? null }));
  }

  breakdown.diceTerms = diceOut;
  breakdown.modifiers = modifiersOut;
  breakdown.computedTerms = [];
  breakdown.unresolvedTerms = [];
  breakdown.totalStaticModifier = modifiersOut.reduce((sum, entry) => sum + entry.value, 0);
  summarizeBreakdown(breakdown);
  return true;
}

function buildEnv() {
  return {
    isGM: isCurrentUserGM(),
    actorHasPlayerOwner: (uuid) => {
      try {
        return Boolean(globalThis.fromUuidSync?.(uuid)?.hasPlayerOwner);
      } catch {
        return false;
      }
    }
  };
}

// The Defense, the result against it and the margin, for numbers the current user may know.
function buildTargetPills(roll, message, env) {
  const target = findTormenta20Target({ roll, message, env });
  if (!target?.known) return [];
  const total = toFiniteNumber(roll?.total);
  const pills = [createPill(text("Defense", { value: target.value }), { tooltip: target.name })];
  if (total === null) return pills;
  const hit = total >= target.value;
  pills.push(createPill(text(hit ? "Hit" : "Miss"), { emphasis: true }));
  pills.push(createPill(text("Margin", { margin: formatSignedNumber(total - target.value) })));
  return pills;
}

export function buildCheckBreakdown(roll, { rollIndex = 0, message = null, actor = null, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "tormenta20", rollIndex });
  const rebuilt = rebuildTerms(breakdown, roll, "check", { message, actor });
  return finalizeBreakdown(breakdown, { title, forceVisible: rebuilt && breakdown.diceTerms.length > 0 });
}

export function buildAttackBreakdown(roll, { rollIndex = 0, message = null, actor = null, env = null, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "tormenta20", rollIndex });
  const rebuilt = rebuildTerms(breakdown, roll, "attack", { message, actor });
  const pills = [];
  const natural = t20Natural(roll);
  const from = t20ThreatFrom(roll, message);
  const isWeapon = toFiniteNumber(t20ItemData(message)?.criticoM) !== null;
  if (isWeapon && natural !== null && natural >= from) {
    pills.push(createPill(text("Threat"), {
      emphasis: true,
      tooltip: text("ThreatHint", { natural, from, factor: t20CriticalMultiplier(message) })
    }));
  }
  pills.push(...buildTargetPills(roll, message, env ?? buildEnv()));
  return finalizeBreakdown(breakdown, { pills, title, forceVisible: rebuilt && breakdown.diceTerms.length > 0 });
}

export function buildDamageBreakdown(roll, { rollIndex = 0, message = null, actor = null, title = null } = {}) {
  const breakdown = parseRoll(roll, { adapterId: "tormenta20", rollIndex });
  const data = t20ItemData(message);
  const attack = (data?.rolls ?? []).find((entry) => entry?.type === "ataque");
  // The system multiplies the dice of the damage of a weapon after a threat of the attack named "Ataque" on the same card
  // Only a first term that is a die is multiplied by the system
  const critical = toFiniteNumber(data?.criticoM) !== null && attack?.name === "Ataque" && t20Threatens(message) && isDiceTerm(roll?.terms?.[0]);
  const multiplier = t20CriticalMultiplier(message);
  const rebuilt = rebuildTerms(breakdown, roll, "damage", { message, actor, critical, multiplier });
  const pills = [];
  if (critical) {
    pills.push(createPill(text("CriticalDamage", { factor: multiplier }), { emphasis: true, tooltip: text("CriticalDamageHint", { factor: multiplier }) }));
  }
  const flavors = [...new Set((roll?.terms ?? []).filter((term) => isDiceTerm(term)).map((term) => damageTypeLabel(term.flavor)).filter(Boolean))];
  if (flavors.length) pills.push(createPill(flavors.join(", ")));
  const save = t20SaveOf(message, actor);
  if (save) {
    pills.push(createPill(save.dc ? text("SaveDc", { value: save.dc }) : text("Save"), { tooltip: save.text }));
  }
  return finalizeBreakdown(breakdown, {
    pills,
    title,
    forceVisible: rebuilt && breakdown.diceTerms.length > 0 && (breakdown.modifiers.length > 0 || breakdown.diceTerms.length > 1 || pills.length > 0)
  });
}

export class Tormenta20RollAdapter extends GenericRollAdapter {
  constructor() {
    super();
    this.id = "tormenta20";
    // No stored copy: the Defense of a target is something each viewer may or may not know, so the panel is built per viewer
  }

  supportsMessage(message) {
    return globalThis.game?.system?.id === "tormenta20" && super.supportsMessage(message);
  }

  async buildBreakdowns(message) {
    await ensureSystemTranslationsLoaded();
    const rolls = this.getMessageRolls(message);
    const several = rolls.length > 1;
    const actor = speakerActorOf(message);
    const env = buildEnv();
    const data = t20ItemData(message);
    return rolls
      .map((roll, index) => {
        const kind = t20RollKind(roll, message);
        if (kind === "check") return buildCheckBreakdown(roll, { rollIndex: index, message, actor });
        if (kind === "attack") return buildAttackBreakdown(roll, { rollIndex: index, message, actor, env, title: several ? text("Attack") : null });
        if (kind === "damage") {
          const heal = (roll?.terms ?? []).some((term) => HEALING_TYPES.includes(String(term?.flavor ?? "")));
          return buildDamageBreakdown(roll, { rollIndex: index, message, actor, title: several || data ? text(heal ? "Healing" : "Damage") : null });
        }
        return keepNamed(parseRoll(roll, { adapterId: this.id, rollIndex: index }));
      })
      .filter((breakdown) => breakdown?.hasVisibleContent);
  }
}
