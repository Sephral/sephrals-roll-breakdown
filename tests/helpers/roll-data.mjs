import { readFile } from "node:fs/promises";

import { modulePath } from "./test-helpers.mjs";

// Rebuilds rolls from real chat message data (Roll#toJSON as stored in ChatMessage#rolls), captured in live
// Pathfinder 2e and Savage Worlds worlds. Constructor names match the classes of Foundry, PF2e and SWADE, because the
// adapters recognize rolls and terms by class name the same way Foundry restores them from chat messages.

function sumActive(results) {
  return (results ?? []).filter((result) => result.active !== false && !result.discarded).reduce((sum, result) => sum + result.result, 0);
}

function withFlavor(expression, flavor) {
  return flavor ? `${expression}[${flavor}]` : expression;
}

class RollTerm {
  constructor(data) {
    this.options = data.options ?? {};
  }

  get flavor() {
    return this.options.flavor ?? "";
  }

  get formula() {
    return withFlavor(this.expression, this.flavor);
  }
}

export class Die extends RollTerm {
  constructor(data) {
    super(data);
    this.number = data.number;
    this.faces = data.faces;
    this.modifiers = data.modifiers ?? [];
    this.results = data.results ?? [];
  }

  get expression() {
    return `${this.number}d${this.faces}${this.modifiers.join("")}`;
  }

  get total() {
    return sumActive(this.results);
  }

  get dice() {
    return [this];
  }
}

export class WildDie extends Die {
  get expression() {
    return `1dw${this.faces}`;
  }
}

class NumericTerm extends RollTerm {
  constructor(data) {
    super(data);
    this.number = data.number;
  }

  get expression() {
    return String(this.number);
  }

  get total() {
    return this.number;
  }
}

class OperatorTerm extends RollTerm {
  constructor(data) {
    super(data);
    this.operator = data.operator;
  }

  get expression() {
    return this.operator;
  }

  get total() {
    return this.operator;
  }
}

class StringTerm extends RollTerm {
  constructor(data) {
    super(data);
    this.term = data.term;
  }

  get expression() {
    return this.term;
  }
}

class PoolTerm extends RollTerm {
  constructor(data) {
    super(data);
    this.rolls = (data.rolls ?? []).map(fromRollData);
    this.results = data.results ?? [];
    this.modifiers = data.modifiers ?? [];
  }

  get expression() {
    return `{${this.rolls.map((roll) => roll.formula).join(",")}}${this.modifiers.join("")}`;
  }

  get total() {
    return sumActive(this.results);
  }

  get dice() {
    return this.rolls.flatMap((roll) => roll.dice);
  }
}

class InstancePool extends PoolTerm {}

// PF2e damage terms
class Grouping extends RollTerm {
  constructor(data) {
    super(data);
    this.term = fromTermData(data.term);
  }

  get expression() {
    return `(${this.term.expression})`;
  }

  get total() {
    return this.term.total;
  }

  get dice() {
    return this.term.dice ?? [];
  }
}

class ArithmeticExpression extends RollTerm {
  constructor(data) {
    super(data);
    this.operator = data.operator;
    this.operands = (data.operands ?? []).map(fromTermData);
  }

  get expression() {
    return `${this.operands[0].expression} ${this.operator} ${this.operands[1].expression}`;
  }

  get total() {
    const [a, b] = this.operands.map((operand) => Number(operand.total));
    return { "+": a + b, "-": a - b, "*": a * b, "/": a / b }[this.operator];
  }

  get dice() {
    return this.operands.flatMap((operand) => operand.dice ?? []);
  }
}

// Daggerheart dice: the duality dice are Die subclasses with their own names, the damage dice are a BaseDie
class HopeDie extends Die {}
class FearDie extends Die {}
class AdvantageDie extends Die {}
class DisadvantageDie extends Die {}
class BaseDie extends Die {}

const TERM_CLASSES = { Die, HopeDie, FearDie, AdvantageDie, DisadvantageDie, BaseDie, WildDie, NumericTerm, OperatorTerm, StringTerm, PoolTerm, InstancePool, Grouping, ArithmeticExpression };

function fromTermData(data) {
  const cls = TERM_CLASSES[data?.class];
  if (!cls) throw new Error(`No test class for term ${data?.class}`);
  return new cls(data);
}

class Roll {
  constructor(data) {
    this.options = data.options ?? {};
    this.data = {};
    this._formula = data.formula;
    this._total = data.total;
    this.terms = (data.terms ?? []).map(fromTermData);
  }

  get formula() {
    return this._formula;
  }

  get total() {
    return this._total;
  }

  get dice() {
    return this.terms.flatMap((term) => term.dice ?? []);
  }
}

class CheckRoll extends Roll {}
class StrikeAttackRoll extends CheckRoll {}

class DamageRoll extends Roll {
  get instances() {
    return this.terms[0]?.rolls ?? [];
  }
}

// PF2e DamageInstance: damage type and persistence come from the flavor, persistent damage counts 0 until it is
// evaluated at the end of a turn.
class DamageInstance extends Roll {
  constructor(data) {
    super(data);
    const identifiers = String(this.options.flavor ?? "").replace(/[^a-z,_-]/g, "").split(",");
    const damageTypes = globalThis.CONFIG?.PF2E?.damageTypes ?? {};
    this.type = identifiers.find((identifier) => identifier in damageTypes) ?? "untyped";
    this.persistent = identifiers.includes("persistent") || identifiers.includes("bleed");
  }

  get head() {
    return this.terms[0];
  }

  get total() {
    return this.persistent && !this.options.evaluatePersistent ? 0 : super.total;
  }
}

class SwadeRoll extends Roll {}
class TraitRoll extends SwadeRoll {}
class SwadeDamageRoll extends SwadeRoll {}
Object.defineProperty(SwadeDamageRoll, "name", { value: "DamageRoll" });

// Daggerheart rolls: DualityRoll and FateRoll extend D20Roll, as in the system
class D20Roll extends Roll {}
class DualityRoll extends D20Roll {}
class FateRoll extends D20Roll {}
class DaggerheartDamageRoll extends Roll {}
Object.defineProperty(DaggerheartDamageRoll, "name", { value: "DamageRoll" });

// Tormenta20: every d20 and damage roll is a RollT20
class RollT20 extends Roll {}

// The SWADE, PF2e and Daggerheart damage rolls share a class name, the system decides which one is meant.
const ROLL_CLASSES = {
  pf2e: { Roll, CheckRoll, StrikeAttackRoll, DamageRoll, DamageInstance },
  swade: { Roll, SwadeRoll, TraitRoll, DamageRoll: SwadeDamageRoll },
  daggerheart: { Roll, D20Roll, DualityRoll, FateRoll, DamageRoll: DaggerheartDamageRoll },
  tormenta20: { Roll, RollT20 }
};

let rollClasses = ROLL_CLASSES.pf2e;

export function fromRollData(data) {
  const cls = rollClasses[data?.class] ?? Roll;
  return new cls(data);
}

// Loads tests/fixtures/<system>/<name>.json and rebuilds its rolls. Returns a chat message stand-in.
export async function loadMessageFixture(system, name, extra = {}) {
  rollClasses = ROLL_CLASSES[system];
  const data = JSON.parse(await readFile(modulePath("tests", "fixtures", system, `${name}.json`), "utf8"));
  const message = {
    id: name,
    ...extra,
    flags: data.flags ?? {},
    rolls: data.rolls.map(fromRollData),
    fixture: data
  };
  // Daggerheart keeps the damage of an attack in the system data of the message, not in its rolls
  if (data.system) {
    message.type = data.type;
    message.system = {
      ...data.system,
      ...(data.system.damage ? { damage: { main: data.system.damage.main ? fromRollData(data.system.damage.main) : null, resources: Object.fromEntries(Object.entries(data.system.damage.resources ?? {}).map(([key, roll]) => [key, fromRollData(roll)])) } } : {})
    };
  }
  return message;
}
