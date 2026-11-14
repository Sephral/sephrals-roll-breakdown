import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";

import { importStable, resetGlobals } from "./helpers/test-helpers.mjs";
import { installDiceEnvironment, installLangFetch, installSystemGame } from "./helpers/system-fixtures.mjs";
import { loadMessageFixture } from "./helpers/roll-data.mjs";

// The line is built from the normalized breakdown, so every adapter has to give it text without holes:
// the real PF2e and SWADE messages of the live fixtures go through their adapter and the line builder.
const words = { advantage: "advantage", disadvantage: "disadvantage", from: "from", other: "other", more: "+{count} more", roll: "Roll", trims: [" modifier", " bonus"] };
const BAD = /undefined|NaN|\[object|SRB\.|null/;

function keys(system, version) {
  return readdirSync(new URL(`./fixtures/${system}/`, import.meta.url))
    .filter((name) => name.startsWith(`${version}-`))
    .map((name) => name.slice(version.length + 1, -".json".length));
}

test("pf2e fixtures give clean lines", async () => {
  let withLine = 0;
  for (const key of keys("pf2e", "8.6.1")) {
    resetGlobals();
    installDiceEnvironment();
    installLangFetch();
    const game = installSystemGame("pf2e", { isGM: true });
    game.pf2e = { settings: { metagame: { breakdowns: false, dcs: false, results: true } } };
    globalThis.CONFIG = { PF2E: { damageTypes: {} } };
    const { Pf2eRollAdapter } = await importStable("scripts/adapters/pf2e-adapter.js");
    const { normalizeBreakdown } = await importStable("scripts/adapter-registry.js");
    const { buildSummaryLine } = await importStable("scripts/summary-line.js");
    const message = await loadMessageFixture("pf2e", `8.6.1-${key}`);
    const breakdowns = (await new Pf2eRollAdapter().buildBreakdowns(message)).map(normalizeBreakdown);
    const line = buildSummaryLine(breakdowns, words);
    if (line) {
      withLine++;
      if (process.env.SRB_SHOW_LINES) console.log(`${key}: ${line.text}`);
      assert.doesNotMatch(line.text, BAD, `${key}: ${line.text}`);
      assert.ok(line.text.length < 400, key);
    }
  }
  assert.ok(withLine >= 8, `lines for ${withLine} fixtures`);
});

test("swade fixtures give clean lines", async () => {
  let withLine = 0;
  for (const key of keys("swade", "6.0.4")) {
    resetGlobals();
    installDiceEnvironment();
    installLangFetch();
    installSystemGame("swade", { isGM: false });
    const { SwadeRollAdapter } = await importStable("scripts/adapters/swade-adapter.js");
    const { normalizeBreakdown } = await importStable("scripts/adapter-registry.js");
    const { buildSummaryLine } = await importStable("scripts/summary-line.js");
    const message = await loadMessageFixture("swade", `6.0.4-${key}`);
    message.speakerActor = { isWildcard: message.fixture.speaker.isWildcard };
    const breakdowns = (await new SwadeRollAdapter().buildBreakdowns(message)).map(normalizeBreakdown);
    const line = buildSummaryLine(breakdowns, words);
    if (line) {
      withLine++;
      if (process.env.SRB_SHOW_LINES) console.log(`${key}: ${line.text}`);
      assert.doesNotMatch(line.text, BAD, `${key}: ${line.text}`);
    }
  }
  assert.ok(withLine >= 1, `lines for ${withLine} fixtures`);
});
