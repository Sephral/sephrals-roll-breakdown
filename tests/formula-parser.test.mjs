import assert from "node:assert/strict";
import test from "node:test";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";

class OperatorTerm {
  constructor(operator) {
    this.operator = operator;
  }
}

class NumericTerm {
  constructor(value, extras = {}) {
    this.number = value;
    this.total = value;
    Object.assign(this, extras);
  }
}

class DiceTerm {
  constructor(formula, total, extras = {}) {
    this.formula = formula;
    this.total = total;
    Object.assign(this, extras);
  }
}

class ParentheticalTerm {
  constructor(total, formula, extras = {}) {
    this.total = total;
    this.formula = formula;
    Object.assign(this, extras);
  }
}

class StringTerm {
  constructor(formula, extras = {}) {
    this.formula = formula;
    Object.assign(this, extras);
  }
}

test("parseRoll classifies dice, modifiers, computed terms, and unresolved terms", async () => {
  resetGlobals();
  globalThis.foundry = { dice: { terms: { DiceTerm } } };

  const parser = await importStable("scripts/formula-parser.js");

  const roll = {
    formula: "1d20 + 3 - 2d4 + mystery",
    total: 17,
    terms: [
      new DiceTerm("1d20", 14, { faces: 20, number: 1, label: "Attack roll" }),
      new OperatorTerm("+"),
      new NumericTerm(3, { label: "External Module: Proficiency" }),
      new OperatorTerm("-"),
      new ParentheticalTerm(2, "2d4", { rolls: [{ dice: [{}] }], label: "Bless" }),
      new OperatorTerm("+"),
      new StringTerm("mystery", { label: "Mystery term" })
    ]
  };

  const breakdown = parser.parseRoll(roll, {
    adapterId: "unit",
    rollIndex: 2,
    termSourceResolver(payload) {
      if (payload.classification === "dice") {
        return { sourceLabel: "Attack roll", sourceDetail: "from d20", sourceType: "item", confidence: "exact" };
      }

      if (payload.classification === "modifier") {
        return { sourceLabel: "Proficiency", sourceDetail: "from actor", sourceType: "actor", confidence: "exact" };
      }

      if (payload.classification === "computed") {
        return { sourceLabel: "Bless", sourceDetail: "nested 2d4", sourceType: "effect", confidence: "derived" };
      }

      return null;
    }
  });

  assert.equal(breakdown.adapterId, "unit");
  assert.equal(breakdown.rollIndex, 2);
  assert.equal(breakdown.rollTotal, 17);
  assert.equal(breakdown.diceTerms.length, 1);
  assert.equal(breakdown.modifiers.length, 1);
  assert.equal(breakdown.computedTerms.length, 1);
  assert.equal(breakdown.unresolvedTerms.length, 1);
  assert.equal(breakdown.modifiers[0].value, 3);
  assert.equal(breakdown.modifiers[0].valueText, "+3");
  assert.equal(breakdown.modifiers[0].sourceLabel, "Proficiency");
  assert.equal(breakdown.computedTerms[0].totalText, "-2");
  assert.equal(breakdown.unresolvedTerms[0].reason, "unresolved");
  assert.equal(breakdown.sourceSummary.labeledTermCount, 4);
  assert.equal(breakdown.sourceSummary.computedTermCount, 1);
  assert.equal(breakdown.sourceConfidence, "partial");
  assert.equal(breakdown.hasVisibleContent, true);
});

test("helper functions normalize numeric and dice term behavior", async () => {
  resetGlobals();
  globalThis.foundry = { dice: { terms: { DiceTerm } } };

  const parser = await importStable("scripts/formula-parser.js");

  assert.equal(parser.getTermType(new NumericTerm(5)), "NumericTerm");
  assert.equal(parser.getTermExpression({ formula: " 1d6 " }), "1d6");
  assert.equal(parser.getTermExpression({ expression: " + 2 " }), "+ 2");
  assert.equal(parser.getTermExpression({ operator: "-" }), "-");
  assert.equal(parser.getTermExpression({ total: 4 }), "4");
  assert.equal(parser.getTermExpression({ number: 9 }), "9");
  assert.equal(parser.isDiceTerm(new DiceTerm("1d6", 4)), true);
  assert.equal(parser.hasNestedDice({ dice: [{}] }), true);
  assert.equal(parser.hasNestedDice({ roll: { dice: [{}] } }), true);
  assert.equal(parser.hasNestedDice({ rolls: [{ dice: [{}] }] }), true);
  assert.equal(parser.toFiniteNumber("12"), 12);
  assert.equal(parser.toFiniteNumber("not-a-number"), null);

  const unresolved = parser.parseRoll({
    formula: "?",
    terms: [{ constructor: { name: "WeirdTerm" }, formula: "?", rolls: [{ dice: [{}] }] }]
  });
  assert.equal(unresolved.unresolvedTerms[0].reason, "contains-dice");
  assert.equal(unresolved.sourceConfidence, "partial");
});

test("parseRoll handles unresolved numeric operators, derived totals, and empty rolls", async () => {
  resetGlobals();
  globalThis.foundry = { dice: { terms: { DiceTerm } } };

  const parser = await importStable("scripts/formula-parser.js");

  const weirdRoll = parser.parseRoll({
    formula: "*4 + 6",
    terms: [
      new OperatorTerm("*"),
      new NumericTerm(4, { formula: "weird 4" }),
      new OperatorTerm("+"),
      new ParentheticalTerm(6, "derived total")
    ]
  });

  assert.equal(weirdRoll.unresolvedTerms.length, 1);
  assert.equal(weirdRoll.unresolvedTerms[0].expression, "weird 4");
  assert.equal(weirdRoll.modifiers.length, 1);
  assert.equal(weirdRoll.modifiers[0].kind, "derived");

  const emptyRoll = parser.parseRoll({ formula: "", terms: [] });
  assert.equal(emptyRoll.hasVisibleContent, false);
});