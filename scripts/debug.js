import { normalizeBreakdown } from "./adapter-registry.js";
import { DebugTrace, recentMessages, registerDebugProvider } from "./debug-file.mjs";
import { classifyGmRoll } from "./gm-roll-privacy.js";
import { localize, MODULE_ID } from "./settings.js";
import { readStoreFlag } from "./stored-breakdown.js";

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
    stored: null,
    playerPrivacy: null,
    error: null
  };
  const stored = readStoreFlag(message);
  if (stored) description.stored = { adapter: stored.adapter ?? null, lang: stored.lang ?? null, rolls: stored.rolls.map((entry) => Boolean(entry?.b)) };
  try {
    description.supported = Boolean(adapter?.supportsMessage(message));
    if (typeof adapter?.debugInfo === "function") description.context = await adapter.debugInfo(message);
    if (description.supported) description.breakdowns = (await adapter.buildBreakdowns(message) ?? []).map(normalizeBreakdown);
    // What a player gets to see of this roll when it is a GM roll: "private", "public" (the total) or null
    description.playerPrivacy = classifyGmRoll(message, adapter, { isGM: false, contentVisible: !(message.whisper?.length || message.blind) });
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
