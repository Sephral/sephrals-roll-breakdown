// Made-up rolls and dice luck for the sample windows (api.samples, see sample-windows.js). Pure functions without Foundry:
// every card is a list of parts (dice with fixed results, numbers with a source) that gives both the data of a roll
// (Roll.fromData) and the breakdown the panel shows for it, so the numbers on the card always agree.
import { summarizeBreakdown } from "./formula-parser.js";
import { luckStats, recordNaturals } from "./luck.js";

const DEFAULT_WORDS = Object.freeze({
  strength: "Strength",
  dexterity: "Dexterity",
  wisdom: "Wisdom",
  intelligence: "Intelligence",
  proficiency: "Proficiency Bonus",
  expertise: "Expertise",
  cover: "Cover",
  coverDetail: "Cover bonus on this Dexterity saving throw.",
  weapon: "Longsword",
  weaponBonus: "Longsword +1",
  bow: "Shortbow",
  bless: "Bless",
  help: "Help",
  fireBrand: "Fire brand",
  poisoned: "Poisoned",
  darkness: "Darkness",
  critNote: "Critical hit",
  critRange: "Crit 19–20",
  critRangeHint: "A critical hit on a natural 19 or 20.",
  attackRoll: "Attack roll",
  damageRoll: "Damage roll",
  saveRoll: "Dexterity saving throw",
  checkRoll: "Perception check",
  proficiencyDetail: "Proficiency bonus for this roll."
});

const die = (faces, results, options = {}) => ({ die: { faces, results, ...options } });
const num = (value, label = null, detail = null) => ({ num: { value, label, detail } });

const ROLL_TOTAL = (parts) => {
  let total = 0;
  for (const part of parts) {
    if (part.die) total += part.die.results.filter((entry) => entry.active !== false).reduce((sum, entry) => sum + entry.result, 0) * (part.die.sign ?? 1);
    else total += part.num.value;
  }
  return total;
};

function dieExpression(spec) {
  const kept = spec.modifier ? spec.modifier : "";
  return `${spec.results.length}d${spec.faces}${kept}`;
}

function termFlavor(label) {
  return label ? { flavor: label } : {};
}

/**
 * The roll data (for Roll.fromData) and the breakdown of one roll of a card.
 * parts: dice and numbers in the order of the formula.
 */
export function buildRoll(parts, { type, target = null, criticalSuccess = null, advantage = null, lineInfo = null, pills = [], title = null } = {}) {
  const terms = [];
  const diceTerms = [];
  const modifiers = [];
  parts.forEach((part, index) => {
    if (index > 0) terms.push({ class: "OperatorTerm", options: {}, evaluated: true, operator: "+" });
    if (part.die) {
      const spec = part.die;
      terms.push({
        class: "Die",
        options: termFlavor(spec.label),
        evaluated: true,
        number: spec.results.length,
        faces: spec.faces,
        modifiers: spec.modifier ? [spec.modifier] : [],
        results: spec.results.map((entry) => (entry.active === false ? { result: entry.result, active: false, discarded: true } : { result: entry.result, active: true }))
      });
      const total = spec.results.filter((entry) => entry.active !== false).reduce((sum, entry) => sum + entry.result, 0);
      diceTerms.push({
        expression: dieExpression(spec),
        total,
        totalText: String(total),
        faces: spec.faces,
        number: spec.results.length,
        sourceLabel: spec.label ?? null,
        sourceDetail: null,
        sourceType: null,
        ...(spec.note ? { notes: [spec.note] } : {})
      });
    } else {
      const { value, label, detail } = part.num;
      terms.push({ class: "NumericTerm", options: termFlavor(label), evaluated: true, number: value });
      modifiers.push({
        expression: String(value),
        sourceLabel: label,
        sourceDetail: detail,
        value,
        valueText: value >= 0 ? `+${value}` : String(value),
        kind: "static",
        confidence: label ? "labeled" : "resolved"
      });
    }
  });
  const total = ROLL_TOTAL(parts);
  const formula = parts.map((part) => {
    if (part.die) return `${dieExpression(part.die)}${part.die.label ? `[${part.die.label}]` : ""}`;
    return `${part.num.value}${part.num.label ? `[${part.num.label}]` : ""}`;
  }).join(" + ");
  const options = { rollType: type };
  if (target !== null) options.target = target;
  if (criticalSuccess !== null) options.criticalSuccess = criticalSuccess;
  const breakdown = summarizeBreakdown({
    adapterId: "dnd5e",
    rollIndex: 0,
    formula,
    rollTotal: total,
    title,
    diceTerms,
    modifiers,
    computedTerms: [],
    unresolvedTerms: [],
    totalStaticModifier: modifiers.reduce((sum, modifier) => sum + modifier.value, 0),
    sections: [],
    pills,
    ...(advantage ? { advantageContext: advantage } : {}),
    ...(lineInfo ? { lineInfo } : {})
  });
  breakdown.hasVisibleContent = true;
  return {
    data: { class: "Roll", options, dice: [], formula, terms, total, evaluated: true },
    breakdown
  };
}

const kept = (result) => ({ result, active: true });
const dropped = (result) => ({ result, active: false });

/**
 * The sample cards. Each: { id, kind, rolls: [{data, breakdown}], flavor, speaker (cast id), gm }.
 * words: the texts of the language (labels of the sources), the English defaults fill the gaps.
 */
export function sampleCards(words = {}) {
  const w = { ...DEFAULT_WORDS, ...words };
  const abilityAttack = (ability) => num(3, ability, null);
  const prof = (value = 3) => num(value, w.proficiency, w.proficiencyDetail);

  const attack = buildRoll([
    die(20, [dropped(8), kept(17)], { modifier: "kh" }),
    abilityAttack(w.strength),
    prof(),
    num(1, w.weaponBonus),
    die(4, [kept(3)], { label: w.bless })
  ], {
    type: "attack",
    target: 15,
    advantage: { state: "advantage", attributions: [{ type: "ADV", source: null, displayName: w.help }] }
  });

  const crit = buildRoll([
    die(20, [kept(20)]),
    num(4, w.intelligence),
    prof()
  ], {
    type: "attack",
    target: 14,
    criticalSuccess: 19,
    lineInfo: { critFrom: 19, natural: 20 },
    pills: [{ text: w.critRange, tooltip: w.critRangeHint, emphasis: false }]
  });

  const damage = buildRoll([
    die(8, [kept(6), kept(3)], { label: w.weapon, note: w.critNote }),
    die(6, [kept(4)], { label: w.fireBrand }),
    num(3, w.strength),
    num(1, w.weaponBonus)
  ], { type: "damage" });

  const save = buildRoll([
    die(20, [dropped(16), kept(9)], { modifier: "kl" }),
    num(2, w.dexterity),
    prof(),
    num(2, w.cover, w.coverDetail)
  ], {
    type: "save",
    target: 14,
    advantage: { state: "disadvantage", attributions: [{ type: "DIS", source: "poisoned", displayName: w.poisoned }] }
  });

  const check = buildRoll([
    die(20, [dropped(5), kept(12)], { modifier: "kh" }),
    num(2, w.wisdom),
    num(6, w.expertise)
  ], {
    type: "skill",
    advantage: {
      state: "normal",
      attributions: [
        { type: "ADV", source: null, displayName: w.help },
        { type: "DIS", source: null, displayName: w.darkness }
      ]
    }
  });

  const shot = buildRoll([die(20, [kept(13)]), num(4, w.dexterity), prof()], { type: "attack", target: 14 });
  const arrow = buildRoll([die(6, [kept(5)], { label: w.bow }), num(4, w.dexterity)], { type: "damage" });

  const gmHit = buildRoll([die(20, [kept(18)]), num(7, w.strength)], { type: "attack", target: 16 });

  return [
    { id: "attack", kind: "attack", rolls: [attack], flavor: `${w.weapon}: ${w.attackRoll}`, speaker: "ari" },
    { id: "crit", kind: "attack", rolls: [crit], flavor: `${w.attackRoll}`, speaker: "mira" },
    { id: "damage", kind: "damage", rolls: [damage], flavor: `${w.weapon}: ${w.damageRoll}`, speaker: "ari" },
    { id: "save", kind: "save", rolls: [save], flavor: w.saveRoll, speaker: "sela" },
    { id: "check", kind: "skill", rolls: [check], flavor: w.checkRoll, speaker: "sela" },
    { id: "two", kind: "attack", rolls: [shot, arrow], flavor: `${w.bow}: ${w.attackRoll}`, speaker: "sela" },
    { id: "gm", kind: "attack", rolls: [gmHit], flavor: w.attackRoll, speaker: "troll", gm: true }
  ];
}

/* -------------------------------------------- */
/*  Dice luck                                   */
/* -------------------------------------------- */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// natural d20 results of a made-up player: older evenings count overall, tonight's make the session
function luckRow({ id, name, isSelf = false, before = [], tonight = [] }, now) {
  let data = null;
  if (before.length) data = recordNaturals(data, before, { now: now - 3 * DAY });
  if (tonight.length) data = recordNaturals(data, tonight, { now: now - HOUR });
  const session = data?.session && now - data.session.last < 8 * HOUR ? data.session : null;
  return {
    id,
    name,
    isSelf,
    session: luckStats(session),
    rolls: session ? session.rolls : [],
    all: luckStats(data?.all ?? null)
  };
}

const ABOVE = [14, 17, 9, 20, 12, 15, 11, 18, 13, 16, 20, 8];
const BELOW = [4, 9, 1, 12, 7, 10, 3, 15, 6, 8, 1, 11];
const EVEN = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
const OLD = [12, 5, 18, 9, 14, 20, 3, 11, 16, 7, 13, 1, 10, 19, 8, 15, 6, 17, 12, 4, 20, 9, 14, 2];

/**
 * The rows of a luck window. profile: "above", "below", "even" or "few" decides how the own evening went,
 * the table of the GM always lists the four players.
 * @param {string} profile
 * @param {string} ownName
 * @param {number} [now]
 */
export function sampleLuckRows(profile, ownName = "Ari", now = Date.now()) {
  const own = { above: ABOVE, below: BELOW, even: EVEN, few: [14, 6] }[profile] ?? ABOVE;
  return [
    luckRow({ id: "ari", name: ownName, isSelf: true, before: OLD, tonight: own }, now),
    luckRow({ id: "mira", name: "Tom", before: OLD.slice(3, 19), tonight: BELOW }, now),
    luckRow({ id: "tovin", name: "Sam", before: OLD.slice(0, 14), tonight: EVEN }, now),
    luckRow({ id: "sela", name: "Jo", before: OLD.slice(6), tonight: [] }, now)
  ];
}

export const __test__ = { buildRoll, ROLL_TOTAL, dieExpression };
