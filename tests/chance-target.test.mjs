import test from "node:test";
import assert from "node:assert/strict";
import { describeChance, resolveChance } from "../scripts/chance-target.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

function d20Roll({ natural = 12, bonus = 5, options = {}, number = 1, modifiers = [] } = {}) {
  return {
    total: natural + bonus,
    options,
    terms: [
      { faces: 20, number, modifiers, results: [{ result: natural, active: true }] },
      { operator: "+" },
      { number: bonus }
    ]
  };
}

const gm = { isGM: true };
const player = { isGM: false, actorHasPlayerOwner: () => false };

test("a save with a DC: the chance of success for GM and player", () => {
  const message = { flags: { dnd5e: { roll: { type: "save" } } } };
  const roll = d20Roll({ options: { target: 15 } });
  near(resolveChance({ roll, message, systemId: "dnd5e", env: gm }).probability, 11 / 20);
  const seen = resolveChance({ roll, message, systemId: "dnd5e", env: player });
  assert.equal(seen.kind, "success");
  assert.equal(seen.target, 15);
});

test("a private roll keeps its DC from players", () => {
  const roll = d20Roll({ natural: 15, options: { target: 15 } });
  for (const message of [{ blind: true, flags: { dnd5e: { roll: { type: "save" } } } }, { whisper: ["gm"], flags: { dnd5e: { roll: { type: "save" } } } }]) {
    const seen = resolveChance({ roll, message, systemId: "dnd5e", env: player });
    assert.equal(seen.kind, "better");
    near(seen.probability, 6 / 20);
    assert.equal(resolveChance({ roll, message, systemId: "dnd5e", env: gm }).kind, "success");
  }
});

test("without a DC the line is this result or better", () => {
  const message = { flags: { dnd5e: { roll: { type: "skill" } } } };
  const seen = resolveChance({ roll: d20Roll({ natural: 15 }), message, systemId: "dnd5e", env: player });
  assert.equal(seen.kind, "better");
  near(seen.probability, 6 / 20);
});

test("a 5e attack uses the armor class and the critical rules", () => {
  const roll = d20Roll({ natural: 9, bonus: 5 });
  const monster = { flags: { dnd5e: { roll: { type: "attack" }, targets: [{ ac: 40, actor: "Actor.monster" }] } } };
  const result = resolveChance({ roll, message: monster, systemId: "dnd5e", env: gm });
  assert.equal(result.targetKind, "ac");
  near(result.probability, 1 / 20);
  // the armor class of a monster is hidden from players, the one of a player character is not
  assert.equal(resolveChance({ roll, message: monster, systemId: "dnd5e", env: player }).kind, "better");
  const owned = { isGM: false, actorHasPlayerOwner: (uuid) => uuid === "Actor.monster" };
  assert.equal(resolveChance({ roll, message: monster, systemId: "dnd5e", env: owned }).kind, "success");
  // several targets: no single armor class
  const crowd = { flags: { dnd5e: { roll: { type: "attack" }, targets: [{ ac: 12 }, { ac: 15 }] } } };
  assert.equal(resolveChance({ roll, message: crowd, systemId: "dnd5e", env: gm }).kind, "better");
  // advantage against AC 40
  const advantage = d20Roll({ natural: 9, bonus: 5, number: 2, modifiers: ["kh"] });
  near(resolveChance({ roll: advantage, message: monster, systemId: "dnd5e", env: gm }).probability, 1 - (19 / 20) ** 2);
});

test("dnd5e 6 keeps type and targets in the typed message", () => {
  const roll = d20Roll({ natural: 9, bonus: 5, options: { rollType: "attack", target: 40 } });
  const message = { type: "attack", flags: {}, system: { targets: [{ ac: 40, actor: "Scene.s.Token.t.Actor.a" }] } };
  const result = resolveChance({ roll, message, systemId: "dnd5e", env: gm });
  assert.equal(result.targetKind, "ac");
  near(result.probability, 1 / 20);
  assert.equal(resolveChance({ roll, message, systemId: "dnd5e", env: player }).kind, "better");
  const damage = { type: "damage", flags: {}, system: {} };
  assert.equal(resolveChance({ roll: { total: 7, options: { rollType: "damage" }, terms: [{ faces: 8, number: 1, modifiers: [] }, { operator: "+" }, { number: 3 }] }, message: damage, systemId: "dnd5e", env: gm }), null);
});

test("damage rolls get no chance", () => {
  const message = { flags: { dnd5e: { roll: { type: "damage" } } } };
  const roll = { total: 7, terms: [{ faces: 8, number: 1, modifiers: [], results: [{ result: 4 }] }, { operator: "+" }, { number: 3 }] };
  assert.equal(resolveChance({ roll, message, systemId: "dnd5e", env: gm }), null);
});

test("a total the formula cannot make means a module changed it, no line", () => {
  const roll = { ...d20Roll({ natural: 12, bonus: 5 }), total: 99 };
  assert.equal(resolveChance({ roll, message: {}, systemId: "generic", env: gm }), null);
});

test("Pathfinder 2e follows the DC the system shows", () => {
  const roll = d20Roll({ natural: 10, bonus: 10 });
  const message = { flags: { pf2e: { context: { type: "skill-check", dc: { value: 20, visible: false } } } } };
  const asGm = resolveChance({ roll, message, systemId: "pf2e", env: gm });
  near(asGm.probability, 11 / 20);
  assert.equal(resolveChance({ roll, message, systemId: "pf2e", env: player }).kind, "better");
  assert.equal(resolveChance({ roll, message, systemId: "pf2e", env: { isGM: false, pf2eShowsDcs: true } }).kind, "success");
  const shown = { flags: { pf2e: { context: { dc: { value: 20, visible: true } } } } };
  assert.equal(resolveChance({ roll, message: shown, systemId: "pf2e", env: player }).kind, "success");
});

test("rolls the engine cannot read give nothing", () => {
  assert.equal(resolveChance({ roll: { total: 5, terms: [{ number: 5 }] }, message: {}, systemId: "generic", env: gm }), null);
  assert.equal(resolveChance({ roll: null, message: {}, systemId: "generic", env: gm }), null);
});

test("texts", () => {
  const words = { success: "Chance auf Erfolg: {percent}", better: "Dieses Ergebnis oder besser: {percent}", successHint: "Gegen {kind} {target}", betterHint: "x", dc: "SG", ac: "RK", percent: "{value} %", under: "< 1 %", over: "> 99 %" };
  assert.equal(describeChance({ kind: "success", probability: 0.65, target: 15, targetKind: "dc" }, words).text, "Chance auf Erfolg: 65 %");
  assert.equal(describeChance({ kind: "success", probability: 0.65, target: 15, targetKind: "dc" }, words).hint, "Gegen SG 15");
  assert.equal(describeChance({ kind: "success", probability: 0.5, target: 17, targetKind: "ac" }, words).hint, "Gegen RK 17");
  assert.equal(describeChance({ kind: "better", probability: 0.15 }, words).text, "Dieses Ergebnis oder besser: 15 %");
  assert.equal(describeChance(null, words), null);
});
