// The one line on the chat card: "+5 STR, +3 Prof, +1d4 Bless, advantage from Help". Pure functions over normalized
// breakdowns, so the text rules are testable without Foundry. The renderer passes the translated words.

export const CARD_DISPLAY = Object.freeze({ LINE: "line", BOTH: "both", PANEL: "panel" });
export const DEFAULT_CARD_DISPLAY = CARD_DISPLAY.BOTH;

const MAX_PARTS = 5;
const MAX_LABEL_LENGTH = 22;

export function normalizeCardDisplay(value) {
  return Object.values(CARD_DISPLAY).includes(value) ? value : DEFAULT_CARD_DISPLAY;
}

export function showsLine(mode) {
  return normalizeCardDisplay(mode) !== CARD_DISPLAY.PANEL;
}

export function showsToggleLabel(mode) {
  return normalizeCardDisplay(mode) !== CARD_DISPLAY.LINE;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// Shortens one source label: known words (proficiency) by the alias table, anything long with an ellipsis.
export function shortenLabel(label, aliases = {}, trims = []) {
  let text = clean(label).replace(/^external module:\s*/i, "");
  if (!text) return "";
  const alias = aliases[text.toLowerCase()];
  if (alias) return alias;
  // Filler words go ("STR modifier", "Longsword +1 attack bonus"), a leading "^" marks a prefix ("^Attack bonus of "),
  // as long as something stays
  for (const trim of trims) {
    if (!trim) continue;
    const prefix = trim.startsWith("^");
    const word = (prefix ? trim.slice(1) : trim).toLowerCase();
    const lower = text.toLowerCase();
    if (text.length <= word.length + 1) continue;
    if (prefix && lower.startsWith(word)) { text = text.slice(word.length).trimStart(); break; }
    if (!prefix && lower.endsWith(word)) { text = text.slice(0, text.length - word.length).trimEnd(); break; }
  }
  if (text.length <= MAX_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
}

function signed(value) {
  if (!Number.isFinite(value)) return "";
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function join(parts) {
  return parts.filter(Boolean).join(", ");
}

// Parts of one roll: modifiers with a value, extra dice (every die after the main one), advantage.
// Modifiers without a source are summed into one "other" part.
export function buildParts(breakdown, words = {}, aliases = {}) {
  const parts = [];
  const trims = Array.isArray(words.trims) ? words.trims : [];
  let unlabeled = 0;
  for (const modifier of Array.isArray(breakdown?.modifiers) ? breakdown.modifiers : []) {
    const value = Number(modifier?.value);
    if (!Number.isFinite(value) || value === 0) continue;
    const label = shortenLabel(modifier.sourceLabel, aliases, trims);
    if (label) parts.push(`${signed(value)} ${label}`);
    else unlabeled += value;
  }
  const dice = Array.isArray(breakdown?.diceTerms) ? breakdown.diceTerms : [];
  dice.forEach((term, index) => {
    if (index === 0) return;
    const expression = clean(term?.expression);
    if (!expression) return;
    const label = shortenLabel(term.sourceLabel, aliases, trims);
    const sign = expression.startsWith("-") ? "" : "+";
    parts.push(`${sign}${expression}${label ? ` ${label}` : ""}`);
  });
  if (unlabeled !== 0) parts.push(`${signed(unlabeled)} ${words.other ?? "other"}`);

  const context = breakdown?.advantageContext;
  const state = context?.state;
  if (state === "advantage" || state === "disadvantage") {
    const names = (Array.isArray(context.attributions) ? context.attributions : [])
      .filter((entry) => entry?.type === (state === "advantage" ? "ADV" : "DIS"))
      .map((entry) => shortenLabel(entry.displayName, aliases, trims))
      .filter(Boolean);
    const stateWord = state === "advantage" ? words.advantage : words.disadvantage;
    const unique = [...new Set(names)];
    if (stateWord) parts.push(unique.length ? `${stateWord} ${words.from ?? "from"} ${unique.slice(0, 2).join(" + ")}` : stateWord);
  }
  return parts;
}

// The text for a whole card. Several rolls on one card get their roll label in front.
// Returns { text, full } where full lists every part for the tooltip. Null when no roll has anything to say.
export function buildSummaryLine(breakdowns, words = {}, aliases = {}) {
  const list = Array.isArray(breakdowns) ? breakdowns : [];
  const lines = [];
  const fullLines = [];
  list.forEach((breakdown, index) => {
    const parts = buildParts(breakdown, words, aliases);
    if (!parts.length) return;
    const shown = parts.slice(0, MAX_PARTS);
    const hidden = parts.length - shown.length;
    let text = join(shown);
    if (hidden > 0) text += ` (${(words.more ?? "+{count} more").replace("{count}", hidden)})`;
    const prefix = list.length > 1 ? `${clean(breakdown.title) || `${words.roll ?? "Roll"} ${index + 1}`}: ` : "";
    lines.push(prefix + text);
    fullLines.push(prefix + join(parts));
  });
  if (!lines.length) return null;
  return { text: lines.join(" · "), full: fullLines.join("\n") };
}

export const __test__ = { buildParts, shortenLabel, signed, MAX_PARTS, MAX_LABEL_LENGTH };
