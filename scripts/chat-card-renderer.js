import { normalizeBreakdown } from "./adapter-registry.js";
import { MODULE_ID, getRenderOptions, hasOwnSettings, localize, openModuleSettings } from "./settings.js";
import { buildSummaryLine, showsLine, showsToggleLabel } from "./summary-line.js";
import { attachLineHover } from "./line-hover.js";
import { describeChance, resolveChance } from "./chance-target.js";
import { daggerheartHidesTargets } from "./daggerheart-targets.js";
import { openLuck } from "./luck-app.js";
import { countFeature } from "./usage.mjs";

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/breakdown-panel.hbs`;

function sanitizeSourceLabel(label) {
  if (typeof label !== "string") return label ?? null;
  const normalized = label.replace(/^external module:\s*/i, "").trim();
  return normalized || null;
}

function decorateTerm(term, fallbackLabel = null) {
  const label = sanitizeSourceLabel(term.sourceLabel ?? fallbackLabel);
  return {
    ...term,
    label,
    detail: term.sourceDetail,
    tooltip: term.sourceDetail ?? null,
    notes: Array.isArray(term.notes) ? term.notes.filter((note) => typeof note === "string" && note.trim()) : [],
    muted: Boolean(term.muted)
  };
}

function getSections(breakdown, placement) {
  return breakdown.sections.filter((section) => section.placement === placement);
}

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return value >= 0 ? `+${value}` : String(value);
}

function decorateAdvantageAttribution(attribution, labels) {
  const typeLabels = {
    ADV: labels.advantage,
    DIS: labels.disadvantage,
    NOADV: labels.suppressedAdvantage,
    NODIS: labels.suppressedDisadvantage
  };

  return {
    label: attribution.displayName,
    typeLabel: typeLabels[attribution.type] ?? attribution.type,
    tooltip: attribution.source ?? null
  };
}

function getRootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function getLineWords(labels) {
  return {
    advantage: localize("Line.Advantage"),
    disadvantage: localize("Line.Disadvantage"),
    from: localize("Line.From"),
    other: localize("Line.Other"),
    more: localize("Line.More"),
    cancelled: localize("Line.Cancelled"),
    crit: localize("Line.Crit"),
    critMargin: localize("Line.CritMargin"),
    nat20: localize("Line.Nat20"),
    nat1: localize("Line.Nat1"),
    roll: labels.rollLabel,
    trims: localize("Line.Trims").split("|").filter(Boolean)
  };
}

// System words that are too long for one line, by the label the adapters take from the system.
function getLineAliases() {
  const aliases = {};
  const proficiency = game.i18n?.localize?.("DND5E.Proficiency");
  const short = localize("Line.Proficiency");
  for (const word of [proficiency, "Proficiency", "Proficiency bonus"]) {
    if (typeof word === "string" && word && word !== "DND5E.Proficiency") aliases[word.toLowerCase()] = short;
  }
  return aliases;
}

function getChanceWords() {
  return {
    success: localize("Chance.Success"),
    better: localize("Chance.Better"),
    successHint: localize("Chance.SuccessHint"),
    betterHint: localize("Chance.BetterHint"),
    dc: localize("Chance.Dc"),
    ac: localize("Chance.Ac"),
    difficulty: localize("Chance.Difficulty"),
    evasion: localize("Chance.Evasion"),
    defense: localize("Chance.Defense"),
    dualityHint: localize("Chance.DualityHint"),
    percent: localize("Chance.Percent"),
    under: localize("Chance.Under"),
    over: localize("Chance.Over")
  };
}

// What the current user may know: a monster's armor class is the GM's secret, a DC the system hides stays hidden.
function getChanceEnvironment() {
  return {
    isGM: Boolean(game.user?.isGM),
    actorHasPlayerOwner: (uuid) => {
      try {
        return Boolean(globalThis.fromUuidSync?.(uuid)?.hasPlayerOwner);
      } catch {
        return false;
      }
    },
    pf2eShowsDcs: game.pf2e?.settings?.metagame?.dcs === true,
    daggerheartHidesTargets: daggerheartHidesTargets()
  };
}

function buildChance(message, breakdown, rolls, options) {
  if (options.showChance === false) return null;
  const roll = Array.isArray(rolls) ? rolls[breakdown.rollIndex ?? 0] : null;
  if (!roll) return null;
  try {
    return describeChance(resolveChance({ roll, message, systemId: game.system?.id, env: getChanceEnvironment() }), getChanceWords());
  } catch (error) {
    console.warn(`${MODULE_ID} | The chance could not be worked out`, error);
    return null;
  }
}

function buildTemplateData(message, rawBreakdowns, options, expanded, rolls = null) {
  const breakdowns = rawBreakdowns.map(normalizeBreakdown);
  const labels = {
    toggle: localize("Chat.Toggle"),
    rollLabel: localize("Chat.RollLabel"),
    status: localize("Chat.Status"),
    formula: localize("Chat.Formula"),
    dice: localize("Chat.Dice"),
    modifiers: localize("Chat.Modifiers"),
    computedTerms: localize("Chat.ComputedTerms"),
    unresolved: localize("Chat.Unresolved"),
    staticModifier: localize("Chat.StaticModifier"),
    rollTotal: localize("Chat.RollTotal"),
    possibleSources: localize("Chat.PossibleSources"),
    unknownModifier: localize("Chat.UnknownModifier"),
    unresolvedTerm: localize("Chat.UnresolvedTerm"),
    labeledSource: localize("Chat.LabeledSource"),
    derivedModifier: localize("Chat.DerivedModifier"),
    computedTerm: localize("Chat.ComputedTerm"),
    exactStatus: localize("Chat.StatusExact"),
    derivedStatus: localize("Chat.StatusDerived"),
    partialStatus: localize("Chat.StatusPartial"),
    none: localize("Chat.None"),
    advantageSection: localize("Chat.AdvantageSection"),
    advantage: localize("Chat.Advantage"),
    disadvantage: localize("Chat.Disadvantage"),
    normal: localize("Chat.Normal"),
    suppressedAdvantage: localize("Chat.SuppressedAdvantage"),
    suppressedDisadvantage: localize("Chat.SuppressedDisadvantage")
  };

  const line = showsLine(options.cardDisplay) ? buildSummaryLine(breakdowns, getLineWords(labels), getLineAliases()) : null;

  return {
    messageId: message.id,
    expanded,
    line,
    lineHover: Boolean(line) && options.lineHover !== false,
    // Without a line the toggle always keeps its text, otherwise there would be nothing to click
    showToggleLabel: !line || showsToggleLabel(options.cardDisplay),
    labels,
    settingsLabel: hasOwnSettings() ? localize("Chat.Settings") : null,
    luckLabel: localize("Luck.Title"),
    breakdowns: breakdowns.map((breakdown, index) => ({
      rollLabel: breakdown.title ?? (breakdowns.length > 1 ? `${labels.rollLabel} ${index + 1}` : null),
      formula: breakdown.formula,
      confidenceLabel:
        breakdown.sourceConfidence === "partial"
          ? labels.partialStatus
          : breakdown.sourceConfidence === "derived"
            ? labels.derivedStatus
            : labels.exactStatus,
      summaryPills: [
        breakdown.sourceSummary.labeledTermCount > 0 ? `${labels.labeledSource} ${breakdown.sourceSummary.labeledTermCount}` : null,
        breakdown.sourceSummary.derivedModifierCount > 0
          ? `${labels.derivedModifier} ${breakdown.sourceSummary.derivedModifierCount}`
          : null,
        breakdown.sourceSummary.computedTermCount > 0
          ? `${labels.computedTerm} ${breakdown.sourceSummary.computedTermCount}`
          : null,
        breakdown.sourceSummary.unresolvedTermCount > 0
          ? `${labels.unresolved} ${breakdown.sourceSummary.unresolvedTermCount}`
          : null
      ].filter(Boolean),
      diceTerms: breakdown.diceTerms.map((term) => decorateTerm(term)),
      modifiers: breakdown.modifiers.map((modifier) => decorateTerm(
        modifier,
        modifier.kind === "derived" ? labels.derivedModifier : options.showUnknown ? labels.unknownModifier : null
      )),
      computedTerms: breakdown.computedTerms.map((term) => decorateTerm(term, labels.computedTerm)),
      advantageContext: breakdown.advantageContext
        ? {
            stateLabel: labels[breakdown.advantageContext.state] ?? labels.normal,
            attributions: breakdown.advantageContext.attributions.map((attribution) => decorateAdvantageAttribution(attribution, labels))
          }
        : null,
      topSections: getSections(breakdown, "top"),
      bottomSections: getSections(breakdown, "bottom"),
      pills: breakdown.pills,
      unresolvedTerms: options.showUnknown
        ? breakdown.unresolvedTerms.map((term) => decorateTerm(term, labels.unresolvedTerm))
        : [],
      totalStaticModifierText: formatSignedNumber(breakdown.totalStaticModifier),
      rollTotalText: breakdown.rollTotal === null ? null : String(breakdown.rollTotal),
      chance: buildChance(message, breakdown, rolls, options)
    }))
  };
}

export class ChatCardRenderer {
  constructor() {
    // Open state per message id for this client session. A message has one panel that holds all of its rolls,
    // and every re-render (Midi-QOL updates, chat log refresh, popout) builds that panel anew.
    this.openPanels = new Map();
    // Messages whose line was counted already: a card is drawn again on every chat update
    this.countedLines = new Set();
    // Same for the hover preview: counted once per message and session
    this.countedHovers = new Set();
    // And the chance line
    this.countedChances = new Set();
  }

  async appendBreakdown(message, html, breakdowns, options, context = {}) {
    const root = getRootElement(html);
    const selector = `.srb-breakdown[data-message-id="${message.id}"]`;
    if (!root || root.querySelector(selector)) return false;

    const expanded = this.openPanels.get(message.id) ?? options.defaultExpanded;
    const templateData = buildTemplateData(message, breakdowns, options, expanded, context?.rolls ?? null);
    const render = globalThis.foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    const markup = await render(TEMPLATE_PATH, templateData);

    // Checked again after the await: two render passes for the same card (system hook and core fallback) may overlap.
    if (root.querySelector(selector)) return false;
    const messageContent = root.querySelector(".message-content") ?? root;
    messageContent.insertAdjacentHTML("beforeend", markup);

    const panel = root.querySelector(selector);
    // A sample card (see sample-windows.js) counts nothing
    const isSample = Boolean(message?.flags?.[MODULE_ID]?.sample);
    panel?.addEventListener?.("toggle", () => this.openPanels.set(message.id, panel.open));
    // Counted on the click: the toggle event also fires for panels that are rendered open.
    if (!isSample && templateData.line && !this.countedLines.has(message.id)) {
      this.countedLines.add(message.id);
      countFeature(MODULE_ID, "lineShown");
    }
    if (!isSample && templateData.breakdowns.some((entry) => entry.chance) && !this.countedChances.has(message.id)) {
      this.countedChances.add(message.id);
      countFeature(MODULE_ID, "chanceShown");
    }
    if (templateData.lineHover && panel) {
      attachLineHover(panel, {
        isEnabled: () => getRenderOptions().lineHover,
        onShown: () => {
          if (isSample || this.countedHovers.has(message.id)) return;
          this.countedHovers.add(message.id);
          countFeature(MODULE_ID, "lineHovered");
        }
      });
    }
    panel?.querySelector?.(".srb-breakdown__toggle")?.addEventListener?.("click", (event) => {
      if (panel.open || isSample) return;
      countFeature(MODULE_ID, "panelOpened");
      if (event?.target?.closest?.(".srb-breakdown__line")) countFeature(MODULE_ID, "lineClicked");
    });
    panel?.querySelector?.(".srb-breakdown__settings")?.addEventListener?.("click", (event) => {
      event.preventDefault();
      if (isSample) return;
      countFeature(MODULE_ID, "panelSettings");
      void openModuleSettings();
    });
    panel?.querySelector?.(".srb-breakdown__luck")?.addEventListener?.("click", (event) => {
      event.preventDefault();
      void openLuck();
    });
    return true;
  }
}