import { MODULE_ID, localize } from "./settings.js";

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
    tooltip: term.sourceDetail ?? null
  };
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

function buildTemplateData(message, breakdowns, options, expanded) {
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

  return {
    messageId: message.id,
    expanded,
    labels,
    breakdowns: breakdowns.map((breakdown, index) => ({
      rollLabel: breakdowns.length > 1 ? `${labels.rollLabel} ${index + 1}` : null,
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
      unresolvedTerms: options.showUnknown
        ? breakdown.unresolvedTerms.map((term) => decorateTerm(term, labels.unresolvedTerm))
        : [],
      totalStaticModifierText: formatSignedNumber(breakdown.totalStaticModifier),
      rollTotalText: breakdown.rollTotal === null ? null : String(breakdown.rollTotal)
    }))
  };
}

export class ChatCardRenderer {
  constructor() {
    // Open state per message id for this client session. A message has one panel that holds all of its rolls,
    // and every re-render (Midi-QOL updates, chat log refresh, popout) builds that panel anew.
    this.openPanels = new Map();
  }

  async appendBreakdown(message, html, breakdowns, options) {
    const root = getRootElement(html);
    const selector = `.srb-breakdown[data-message-id="${message.id}"]`;
    if (!root || root.querySelector(selector)) return false;

    const expanded = this.openPanels.get(message.id) ?? options.defaultExpanded;
    const templateData = buildTemplateData(message, breakdowns, options, expanded);
    const render = globalThis.foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    const markup = await render(TEMPLATE_PATH, templateData);

    // Checked again after the await: two render passes for the same card (system hook and core fallback) may overlap.
    if (root.querySelector(selector)) return false;
    const messageContent = root.querySelector(".message-content") ?? root;
    messageContent.insertAdjacentHTML("beforeend", markup);

    const panel = root.querySelector(selector);
    panel?.addEventListener?.("toggle", () => this.openPanels.set(message.id, panel.open));
    return true;
  }
}