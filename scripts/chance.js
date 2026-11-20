// How likely a roll was: the exact distribution of the dice part of a formula plus its flat modifiers. Pure functions
// over a small model of the roll, so the maths is testable without Foundry. Anything the engine cannot do exactly
// (nested dice, dice pools, counted successes, too many combinations) gives null and the panel shows no chance line.
// Exploding dice are cut after a few explosions, which changes the result by far less than a percent.

export const LIMITS = Object.freeze({
  maxDice: 100,
  maxValues: 4000,
  maxCombinations: 200000,
  maxExplosions: 3
});

// A distribution is a Map from a value to its probability.
function point(value) {
  return new Map([[value, 1]]);
}

function add(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function uniform(faces) {
  const map = new Map();
  for (let value = 1; value <= faces; value++) map.set(value, 1 / faces);
  return map;
}

function shift(dist, offset, sign = 1) {
  const result = new Map();
  for (const [value, probability] of dist) add(result, sign * value + offset, probability);
  return result;
}

function convolve(a, b) {
  const result = new Map();
  for (const [x, px] of a) for (const [y, py] of b) add(result, x + y, px * py);
  if (result.size > LIMITS.maxValues) return null;
  return result;
}

function compare(value, comparison, target) {
  switch (comparison) {
    case "<": return value < target;
    case "<=": return value <= target;
    case ">": return value > target;
    case ">=": return value >= target;
    default: return value === target;
  }
}

// "r1", "r1=1", "r<2", "rr<=2", "x", "x>5", "xo", "min2", "max5", "kh", "kh2", "kl", "dh", "dl1", "k", "d".
export function parseModifier(text, faces) {
  const value = String(text ?? "").trim().toLowerCase();
  let match = value.match(/^(kh|kl|dh|dl|k|d)(\d+)?$/);
  if (match) {
    const kind = match[1] === "k" ? "kh" : match[1] === "d" ? "dl" : match[1];
    return { type: "keep", kind, count: match[2] ? Number(match[2]) : 1 };
  }
  match = value.match(/^(min|max)(\d+)$/);
  if (match) return { type: match[1], value: Number(match[2]) };
  match = value.match(/^(rr|r|xo|x)(\d+)?(<=|>=|<|>|=)?(\d+)?$/);
  if (match) {
    const [, name, first, comparison, second] = match;
    let operator = comparison ?? "=";
    let target = second !== undefined ? Number(second) : first !== undefined ? Number(first) : null;
    if (!comparison && first !== undefined && second === undefined) operator = "=";
    if (target === null) {
      // No threshold: rerolls take a 1, explosions the highest face
      target = name.startsWith("x") ? faces : 1;
    }
    return { type: name.startsWith("x") ? "explode" : "reroll", once: name === "xo" || name === "r", recursive: name === "rr", operator, target };
  }
  return null;
}

function applyReroll(dist, modifier) {
  let matching = 0;
  for (const [value, probability] of dist) if (compare(value, modifier.operator, modifier.target)) matching += probability;
  if (matching === 0) return dist;
  const result = new Map();
  if (modifier.recursive) {
    if (matching >= 1) return null;
    for (const [value, probability] of dist) if (!compare(value, modifier.operator, modifier.target)) add(result, value, probability / (1 - matching));
    return result;
  }
  for (const [value, probability] of dist) {
    if (compare(value, modifier.operator, modifier.target)) continue;
    add(result, value, probability * (1 + matching));
  }
  // The rerolled die lands anywhere, a second match stays
  for (const [value, probability] of dist) {
    if (compare(value, modifier.operator, modifier.target)) add(result, value, probability * matching);
  }
  return result;
}

function applyExplode(dist, modifier) {
  const depth = modifier.once ? 1 : LIMITS.maxExplosions;
  let current = dist;
  for (let step = 0; step < depth; step++) {
    const next = new Map();
    for (const [value, probability] of dist) {
      if (!compare(value, modifier.operator, modifier.target)) {
        add(next, value, probability);
        continue;
      }
      for (const [extra, extraProbability] of current) add(next, value + extra, probability * extraProbability);
    }
    if (next.size > LIMITS.maxValues) return null;
    current = next;
  }
  return current;
}

// One die after its own modifiers, plus what is kept: { dist, keep }. Null when it cannot be done.
export function dieDistribution(faces, modifiers = []) {
  if (!Number.isInteger(faces) || faces < 1) return null;
  let dist = uniform(faces);
  let keep = null;
  for (const text of modifiers) {
    const modifier = parseModifier(text, faces);
    if (!modifier) return null;
    if (modifier.type === "keep") {
      keep = modifier;
    } else if (modifier.type === "min" || modifier.type === "max") {
      const clamped = new Map();
      for (const [value, probability] of dist) add(clamped, modifier.type === "min" ? Math.max(value, modifier.value) : Math.min(value, modifier.value), probability);
      dist = clamped;
    } else if (modifier.type === "reroll") {
      dist = applyReroll(dist, modifier);
    } else if (modifier.type === "explode") {
      dist = applyExplode(dist, modifier);
    }
    if (!dist) return null;
  }
  return { dist, keep };
}

function keptCount(number, keep) {
  if (!keep) return number;
  const count = Math.max(0, Math.min(number, keep.count));
  return keep.kind === "kh" || keep.kind === "kl" ? count : number - count;
}

// The sum of the kept dice of one dice term: { dist, natural }. natural is the distribution of the single kept die when
// exactly one die counts (the d20 of an advantage roll), otherwise null.
export function diceTermDistribution({ number, faces, modifiers = [] }) {
  const count = Number(number);
  if (!Number.isInteger(count) || count < 0 || count > LIMITS.maxDice) return null;
  if (count === 0) return { dist: point(0), natural: null };
  const die = dieDistribution(faces, modifiers);
  if (!die) return null;
  const kept = keptCount(count, die.keep);
  if (!die.keep || kept === count) {
    let sum = point(0);
    for (let index = 0; index < count; index++) {
      sum = convolve(sum, die.dist);
      if (!sum) return null;
    }
    return { dist: sum, natural: count === 1 ? die.dist : null };
  }
  if (kept === 0) return { dist: point(0), natural: null };

  const outcomes = [...die.dist];
  if (Math.pow(outcomes.length, count) > LIMITS.maxCombinations) return null;
  const highest = die.keep.kind === "kh" || die.keep.kind === "dl";
  const sums = new Map();
  const values = new Array(count);
  const recurse = (index, weight) => {
    if (index === count) {
      const sorted = [...values].sort((x, y) => (highest ? y - x : x - y));
      let total = 0;
      for (let position = 0; position < kept; position++) total += sorted[position];
      add(sums, total, weight);
      return;
    }
    for (const [value, probability] of outcomes) {
      values[index] = value;
      recurse(index + 1, weight * probability);
    }
  };
  recurse(0, 1);
  return { dist: sums, natural: kept === 1 ? sums : null };
}

// The model of a roll: dice terms and constants with their sign. Null when the formula holds anything else.
export function modelFromRoll(roll) {
  const terms = Array.isArray(roll?.terms) ? roll.terms : null;
  if (!terms?.length) return null;
  const items = [];
  let sign = 1;
  let pendingOperator = false;
  for (const term of terms) {
    // An arithmetic expression (2 * 1d6) has an operator as well, but it holds operands
    if (typeof term?.operator === "string" && term.faces === undefined && term.operands === undefined) {
      if (term.operator === "+") continue;
      if (term.operator === "-") {
        sign = -sign;
        pendingOperator = true;
        continue;
      }
      return null;
    }
    const isDie = typeof term?.faces === "number" && Number.isInteger(term.number ?? NaN);
    if (isDie) {
      items.push({ kind: "die", number: term.number, faces: term.faces, modifiers: Array.isArray(term.modifiers) ? term.modifiers : [], sign });
    } else if (typeof term?.number === "number" && term.faces === undefined) {
      items.push({ kind: "const", value: sign * term.number });
    } else if (term?.dice?.length || term?.rolls?.length || term?.terms?.some?.((inner) => typeof inner?.faces === "number")) {
      return null;
    } else if (Number.isFinite(Number(term?.total)) && term?.isDeterministic !== false) {
      items.push({ kind: "const", value: sign * Number(term.total) });
    } else {
      return null;
    }
    sign = 1;
    pendingOperator = false;
  }
  if (pendingOperator) return null;
  return items.some((item) => item.kind === "die") ? items : null;
}

// The distribution of everything except the main die, and of the main die itself.
function combine(items) {
  let total = point(0);
  let main = null;
  let rest = point(0);
  for (const item of items) {
    let part;
    if (item.kind === "const") {
      part = point(item.value);
    } else {
      const term = diceTermDistribution(item);
      if (!term) return null;
      part = item.sign < 0 ? shift(term.dist, 0, -1) : term.dist;
      if (!main && item.faces === 20 && item.sign > 0 && term.natural) {
        main = { natural: term.natural, index: items.indexOf(item) };
        continue;
      }
    }
    rest = convolve(rest, part);
    if (!rest) return null;
  }
  total = main ? convolve(rest, main.natural) : rest;
  if (!total) return null;
  return { total, rest, natural: main?.natural ?? null };
}

export function probabilityAtLeast(dist, value) {
  let sum = 0;
  for (const [key, probability] of dist) if (key >= value) sum += probability;
  return Math.min(1, Math.max(0, sum));
}

// The chance of a roll reaching a target number. Natural results can move the threshold (a natural 20 hits whatever the
// number is): needs(natural) gives the lowest total that counts as a success for that natural result.
export function chanceToReach(model, target, needs = null) {
  const combined = combine(model);
  if (!combined) return null;
  if (!needs || !combined.natural) return probabilityAtLeast(combined.total, target);
  let sum = 0;
  for (const [natural, probability] of combined.natural) {
    const threshold = needs(natural, target);
    if (threshold === Infinity) continue;
    if (threshold === -Infinity) {
      sum += probability;
      continue;
    }
    sum += probability * probabilityAtLeast(combined.rest, threshold - natural);
  }
  return Math.min(1, Math.max(0, sum));
}

// The distribution of the whole roll, or null: { total, rest, natural }.
export function distribution(model) {
  return combine(model);
}

// This result or better, before the roll.
export function chanceOrBetter(model, result) {
  const combined = combine(model);
  return combined ? probabilityAtLeast(combined.total, result) : null;
}

// The lowest total that succeeds for one natural d20, per rule set.
export const NATURAL_RULES = Object.freeze({
  // D&D 5e attack: a natural result in the critical range hits, the fumble result misses
  attack(critFrom = 20, fumble = 1) {
    return (natural, target) => (natural >= critFrom ? -Infinity : natural <= fumble ? Infinity : target);
  },
  // Pathfinder 2e: a natural 20 raises the degree of success by one step, a natural 1 lowers it. A success needs the
  // number (a critical failure moves up to a failure, which is no success), a natural 1 needs ten more.
  degree() {
    return (natural, target) => (natural === 20 ? target - 9 : natural === 1 ? target + 10 : target);
  }
});

// "65 %", "< 1 %", "> 99 %". The words are the translated templates.
export function formatPercent(probability, words = {}) {
  if (!Number.isFinite(probability)) return "";
  const percent = probability * 100;
  const fill = (template, value) => String(template).replace("{value}", value);
  if (percent <= 0) return fill(words.percent ?? "{value} %", 0);
  if (percent < 1) return fill(words.under ?? "< 1 %", 1);
  if (percent >= 100) return fill(words.percent ?? "{value} %", 100);
  if (percent > 99) return fill(words.over ?? "> 99 %", 99);
  return fill(words.percent ?? "{value} %", Math.round(percent));
}

export const __test__ = { combine, convolve, diceTermDistribution };
