import { readFile } from "node:fs/promises";

import { createGameStub, modulePath } from "./test-helpers.mjs";

// Minimal stand-ins for the Foundry dice classes. Constructor names matter: adapters match classes by name
// the same way Foundry restores rolls from chat messages.
export class DiceTerm {
  constructor({ number = 1, faces, results = [], flavor = null, options = {} } = {}) {
    this.number = number;
    this.faces = faces;
    this.results = results.map((result) => (typeof result === "object" ? result : { result, active: true }));
    this.total = this.results.filter((result) => result.active !== false && !result.discarded).reduce((sum, result) => sum + result.result, 0);
    this.formula = `${number}d${faces}`;
    this.options = { ...options, ...(flavor ? { flavor } : {}) };
    this.flavor = flavor;
  }
}

export class Die extends DiceTerm {}
export class WildDie extends Die {}

export class OperatorTerm {
  constructor(operator) {
    this.operator = operator;
  }
}

export class NumericTerm {
  constructor(number, { flavor = null } = {}) {
    this.number = number;
    this.total = number;
    this.options = flavor ? { flavor } : {};
    this.flavor = flavor;
  }
}

export function joinTerms(parts) {
  const terms = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      if (part instanceof NumericTerm && part.number < 0) {
        terms.push(new OperatorTerm("-"));
        terms.push(new NumericTerm(Math.abs(part.number), { flavor: part.flavor }));
        return;
      }
      terms.push(new OperatorTerm("+"));
    }
    terms.push(part);
  });
  return terms;
}

export function installDiceEnvironment() {
  globalThis.foundry = { dice: { terms: { DiceTerm } } };
}

// Serves the module's real language files to settings.js.
export function installLangFetch() {
  globalThis.fetch = async (url) => {
    const match = String(url).match(/lang\/([\w-]+\.json)$/);
    if (!match) return { ok: false, async json() { return {}; } };
    try {
      const text = await readFile(modulePath("lang", match[1]), "utf8");
      return { ok: true, async json() { return JSON.parse(text); } };
    } catch {
      return { ok: false, async json() { return {}; } };
    }
  };
}

export function installSystemGame(systemId, { isGM = true, translations = {} } = {}) {
  const stub = createGameStub({ systemId, translations, settingsValues: { uiLanguage: "en" } });
  stub.game.user = { isGM, isActiveGM: isGM };
  globalThis.game = stub.game;
  return stub.game;
}
