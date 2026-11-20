import test from "node:test";
import assert from "node:assert/strict";
import {
  buildParts,
  buildSummaryLine,
  CARD_DISPLAY,
  normalizeCardDisplay,
  showsLine,
  showsToggleLabel,
  shortenLabel
} from "../scripts/summary-line.js";

const words = { advantage: "advantage", disadvantage: "disadvantage", from: "from", other: "other", more: "+{count} more", roll: "Roll" };

test("card display modes normalize and decide what shows", () => {
  assert.equal(normalizeCardDisplay("nonsense"), CARD_DISPLAY.BOTH);
  assert.equal(normalizeCardDisplay("line"), "line");
  assert.equal(showsLine("panel"), false);
  assert.equal(showsLine("both"), true);
  assert.equal(showsToggleLabel("line"), false);
  assert.equal(showsToggleLabel("both"), true);
});

test("labels are aliased, cleaned and cut", () => {
  assert.equal(shortenLabel("Proficiency", { proficiency: "Prof" }), "Prof");
  assert.equal(shortenLabel("External Module: Bless"), "Bless");
  assert.equal(shortenLabel("A very long label of a magic item bonus").endsWith("…"), true);
  assert.equal(shortenLabel(null), "");
  const trims = [" attack bonus", " modifier"];
  assert.equal(shortenLabel("STR modifier", {}, trims), "STR");
  assert.equal(shortenLabel("Longsword +1 attack bonus", {}, trims), "Longsword +1");
  assert.equal(shortenLabel("modifier", {}, trims), "modifier");
  assert.equal(shortenLabel("Angriffsbonus von Langschwert +1", {}, ["^Angriffsbonus von "]), "Langschwert +1");
});

test("modifiers, extra dice and advantage make the parts", () => {
  const parts = buildParts({
    modifiers: [{ value: 5, sourceLabel: "STR" }, { value: 3, sourceLabel: "Proficiency" }, { value: 0, sourceLabel: "Nothing" }, { value: -1, sourceLabel: null }, { value: 2, sourceLabel: null }],
    diceTerms: [{ expression: "1d20", sourceLabel: null }, { expression: "1d4", sourceLabel: "Bless" }],
    advantageContext: { state: "advantage", attributions: [{ type: "ADV", displayName: "Help" }, { type: "DIS", displayName: "Ignored" }] }
  }, words, { proficiency: "Prof" });
  assert.deepEqual(parts, ["+5 STR", "+3 Prof", "+1d4 Bless", "+1 other", "advantage from Help"]);
});

test("advantage without a named source and disadvantage", () => {
  assert.deepEqual(buildParts({ advantageContext: { state: "advantage", attributions: [] } }, words), ["advantage"]);
  assert.deepEqual(buildParts({ advantageContext: { state: "disadvantage", attributions: [{ type: "DIS", displayName: "Prone" }] } }, words), ["disadvantage from Prone"]);
  assert.deepEqual(buildParts({ advantageContext: { state: "normal", attributions: [] } }, words), []);
});

test("the line caps the parts and keeps the rest for the tooltip", () => {
  const modifiers = Array.from({ length: 7 }, (_, index) => ({ value: index + 1, sourceLabel: `S${index}` }));
  const line = buildSummaryLine([{ modifiers }], words);
  assert.equal(line.text, "+1 S0, +2 S1, +3 S2, +4 S3, +5 S4 (+2 more)");
  assert.equal(line.full.split(",").length, 7);
});

test("cards with several rolls name each roll, rolls without parts are left out", () => {
  const line = buildSummaryLine([
    { title: "Attack", modifiers: [{ value: 4, sourceLabel: "STR" }] },
    { title: "Empty", modifiers: [] },
    { modifiers: [{ value: 2, sourceLabel: "Bonus" }] }
  ], words);
  assert.equal(line.text, "Attack: +4 STR · Roll 3: +2 Bonus");
  assert.equal(buildSummaryLine([{ modifiers: [] }], words), null);
  assert.equal(buildSummaryLine(null, words), null);
});

const extraWords = { ...words, cancelled: "adv and dis cancel", crit: "crit {range}", critMargin: "crit at +{margin}", nat20: "natural 20", nat1: "natural 1" };

test("extras: critical range, natural 20 or 1, advantage without a named reason", async () => {
  const { buildExtraParts } = await import("../scripts/summary-line.js");
  assert.deepEqual(buildExtraParts({ lineInfo: { critFrom: 19 } }, extraWords), ["crit 19–20"]);
  assert.deepEqual(buildExtraParts({ lineInfo: { critFrom: 18 } }, extraWords), ["crit 18–20"]);
  assert.deepEqual(buildExtraParts({ lineInfo: { critMargin: 5 } }, extraWords), ["crit at +5"]);
  assert.deepEqual(buildExtraParts({ lineInfo: { natural: 20 } }, extraWords), ["natural 20"]);
  assert.deepEqual(buildExtraParts({ lineInfo: { natural: 1 } }, extraWords), ["natural 1"]);
  assert.deepEqual(buildExtraParts({ lineInfo: { advantage: "advantage" } }, extraWords), ["advantage"]);
  // a named reason already says it, so it is not repeated
  assert.deepEqual(buildExtraParts({ lineInfo: { advantage: "advantage" }, advantageContext: { state: "advantage", attributions: [{ type: "ADV", displayName: "Help" }] } }, extraWords), []);
  assert.deepEqual(buildExtraParts({ advantageContext: { state: "normal", attributions: [{ type: "ADV", displayName: "A" }, { type: "DIS", displayName: "B" }] } }, extraWords), ["adv and dis cancel"]);
});

test("extras degrade silently without data or words", async () => {
  const { buildExtraParts } = await import("../scripts/summary-line.js");
  assert.deepEqual(buildExtraParts({}, extraWords), []);
  assert.deepEqual(buildExtraParts(null, extraWords), []);
  assert.deepEqual(buildExtraParts({ lineInfo: { critFrom: 19, natural: 20 } }, words), []);
  assert.deepEqual(buildExtraParts({ lineInfo: { critFrom: "x", critMargin: -2, natural: 7 } }, extraWords), []);
});

test("extras keep their place when the sources are cut and show in the full text", () => {
  const mods = Array.from({ length: 8 }, (_, i) => ({ value: i + 1, sourceLabel: `M${i}` }));
  const result = buildSummaryLine([{ modifiers: mods, lineInfo: { critFrom: 19 } }], extraWords);
  assert.match(result.text, /crit 19–20/);
  assert.match(result.text, /more/);
  assert.equal(result.text.split(", ").length <= 6, true);
  assert.match(result.full, /M7/);
  assert.match(result.full, /crit 19–20/);
  assert.equal(buildSummaryLine([{ lineInfo: { natural: 20 } }], extraWords).text, "natural 20");
});
