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

function getRootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function buildTemplateData(message, breakdowns, options) {
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
    none: localize("Chat.None")
  };

  return {
    messageId: message.id,
    expanded: options.defaultExpanded,
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
      unresolvedTerms: options.showUnknown
        ? breakdown.unresolvedTerms.map((term) => decorateTerm(term, labels.unresolvedTerm))
        : [],
      totalStaticModifierText: formatSignedNumber(breakdown.totalStaticModifier),
      rollTotalText: breakdown.rollTotal === null ? null : String(breakdown.rollTotal)
    }))
  };
}

export class ChatCardRenderer {
  async appendBreakdown(message, html, breakdowns, options) {
    const root = getRootElement(html);
    if (!root || root.querySelector(`.srb-breakdown[data-message-id="${message.id}"]`)) return false;

    const messageContent = root.querySelector(".message-content") ?? root;
    const templateData = buildTemplateData(message, breakdowns, options);
    const markup = await renderTemplate(TEMPLATE_PATH, templateData);
    messageContent.insertAdjacentHTML("beforeend", markup);
    return true;
  }
}