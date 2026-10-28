import { normalizeBreakdown } from "./adapter-registry.js";
import { DebugTrace, recentMessages, registerDebugProvider } from "./debug-file.mjs";
import { localize, MODULE_ID } from "./settings.js";

// Roll Breakdown's part of the debug file: the roll messages, how the adapter read them and why panels were skipped.
export const debugTrace = new DebugTrace();

function rollsOf(service, message) {
  return service.adapter?.getMessageRolls?.(message) ?? message?.rolls ?? [];
}

// What Roll Breakdown makes of a message: the adapter, what it read from the card and the breakdowns it builds.
export async function describeMessage(service, message) {
  const adapter = service.adapter;
  const description = {
    messageId: message.id,
    adapter: adapter?.id ?? null,
    supported: false,
    context: null,
    breakdowns: [],
    panelShown: Boolean(globalThis.document?.querySelector?.(`[data-message-id="${message.id}"] .srb-breakdown`)),
    error: null
  };
  try {
    description.supported = Boolean(adapter?.supportsMessage(message));
    if (typeof adapter?.debugInfo === "function") description.context = await adapter.debugInfo(message);
    if (description.supported) description.breakdowns = (await adapter.buildBreakdowns(message) ?? []).map(normalizeBreakdown);
  } catch (error) {
    description.error = String(error?.stack ?? error);
  }
  return description;
}

// The latest roll messages, also those without a panel.
export async function describeRecent(service) {
  const messages = recentMessages(undefined, (message) => rollsOf(service, message).length > 0);
  const details = {};
  for (const message of messages) details[message.id] = await describeMessage(service, message);
  return { messages, details };
}

export function registerDebug(service) {
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => localize("Debug.Entry"),
    notice: (file) => localize("Debug.Saved", { file }),
    applies: (message) => rollsOf(service, message).length > 0,
    message: (message) => describeMessage(service, message),
    recent: () => describeRecent(service),
    trace: debugTrace
  });
}
