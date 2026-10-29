import { getMessageRolls, getRollActors, getSpeakerActor } from "./roll-actors.js";
import { getGmRollPrivacy, GM_ROLL_MODES } from "./settings.js";

// GM rolls as players see them: public rolls without formula, dice and breakdown, private rolls not at all.
// Only the chat card of the player changes, the message data stays in every client.

export const PRIVACY_CLASSES = Object.freeze({
  PRIVATE: "srb-gm-private",
  PUBLIC: "srb-gm-hidden",
  NO_CRITS: "srb-gm-no-crits"
});

export const PRIVACY_KINDS = Object.freeze({
  PRIVATE: "private",
  PUBLIC: "public"
});

function getRootElement(html) {
  const root = html?.[0] ?? html;
  return typeof root?.classList?.toggle === "function" ? root : null;
}

// Midi-QOL hides the attack and damage rolls of the GM on its own cards (gmAttackDisplay and gmDamageDisplay, before
// that hideRollDetails). Its cards are left to it as soon as one of these settings hides anything.
export function midiHidesGmRolls() {
  if (!globalThis.game?.modules?.get?.("midi-qol")?.active) return false;
  let config = null;
  try {
    config = game.settings.get("midi-qol", "ConfigSettings");
  } catch {
    return false;
  }
  if (!config || typeof config !== "object") return false;
  if ("gmAttackDisplay" in config || "gmDamageDisplay" in config) {
    return (config.gmAttackDisplay ?? "full") !== "full" || (config.gmDamageDisplay ?? "full") !== "full";
  }
  return (config.hideRollDetails ?? "none") !== "none";
}

function isMidiCard(message) {
  return Boolean(message?.flags?.["midi-qol"]);
}

// A GM roll in the chosen scope. Cards without a speaker that hold the rolls of several actors (Monk's TokenBar)
// count by their rollers: they are GM rolls only when no player owns any of them.
export function isGmRollInScope(message, adapter, mode) {
  if (mode !== GM_ROLL_MODES.NPC && mode !== GM_ROLL_MODES.ALL) return false;
  if (!message?.author?.isGM) return false;
  const speaker = getSpeakerActor(message, adapter);
  if (!speaker) {
    const rollActors = getRollActors(message, adapter);
    return rollActors ? rollActors.every((actor) => !actor?.hasPlayerOwner) : true;
  }
  return mode === GM_ROLL_MODES.ALL || !speaker.hasPlayerOwner;
}

function hasRolls(message, adapter, root) {
  if (message?.isRoll || getMessageRolls(message, adapter).length > 0) return true;
  return Boolean(root?.querySelector?.(".inline-roll.inline-result"));
}

// What the current user gets to see of a GM roll: "private" (nothing), "public" (the total only) or null (all of it).
// contentVisible: whether the current user may see the content (debug files ask for a player from the GM's client).
export function classifyGmRoll(message, adapter = null, {
  root = null,
  settings = getGmRollPrivacy(),
  isGM = Boolean(globalThis.game?.user?.isGM),
  contentVisible = message?.isContentVisible !== false
} = {}) {
  if (isGM || settings.mode === GM_ROLL_MODES.OFF) return null;
  if (!isGmRollInScope(message, adapter, settings.mode)) return null;
  if (!hasRolls(message, adapter, root)) return null;
  // Whispered rolls stay visible to everyone as "rolled privately", only their content is hidden
  if (!contentVisible) return settings.privateRolls ? PRIVACY_KINDS.PRIVATE : null;
  if (!settings.publicRolls) return null;
  if (isMidiCard(message) && midiHidesGmRolls()) return null;
  return PRIVACY_KINDS.PUBLIC;
}

// Without the crits option a critical or a fumble looks like any other roll: D&D 5e marks them with the classes
// critical and fumble and shows two icons where a success or a failure has one.
function removeCritMarks(root) {
  const marked = root.querySelectorAll?.(".dice-roll.critical, .dice-roll.fumble, .dice-total.critical, .dice-total.fumble") ?? [];
  for (const element of marked) {
    element.classList.remove("critical", "fumble");
    const icons = Array.from(element.querySelectorAll?.(".icons > i") ?? []);
    const keep = element.classList.contains("success") || element.classList.contains("failure") ? 1 : 0;
    for (const icon of icons.slice(keep)) icon.remove();
  }
}

// Marks the chat card; the stylesheet hides the parts. Classes on the card itself survive systems that rewrite the
// content of the card after the render hook.
export function applyGmRollPrivacy(message, html, adapter = null) {
  const root = getRootElement(html);
  if (!root) return null;
  const settings = getGmRollPrivacy();
  let kind = null;
  try {
    kind = classifyGmRoll(message, adapter, { root, settings });
  } catch (error) {
    console.warn("[SRB] Could not check the privacy of a GM roll.", error);
  }
  root.classList.toggle(PRIVACY_CLASSES.PRIVATE, kind === PRIVACY_KINDS.PRIVATE);
  root.classList.toggle(PRIVACY_CLASSES.PUBLIC, kind === PRIVACY_KINDS.PUBLIC);
  root.classList.toggle(PRIVACY_CLASSES.NO_CRITS, kind === PRIVACY_KINDS.PUBLIC && !settings.crits);
  if (kind === PRIVACY_KINDS.PUBLIC && !settings.crits) removeCritMarks(root);
  if (kind === PRIVACY_KINDS.PRIVATE) root.hidden = true;
  return kind;
}

// A GM roll of the current user that players will not see in full, for the usage statistics.
export function isOwnHiddenGmRoll(message, adapter = null) {
  const settings = getGmRollPrivacy();
  if (!message?.isAuthor || settings.mode === GM_ROLL_MODES.OFF) return false;
  if (!isGmRollInScope(message, adapter, settings.mode) || !hasRolls(message, adapter, null)) return false;
  const whispered = Array.isArray(message.whisper) && message.whisper.length > 0;
  return whispered ? settings.privateRolls : settings.publicRolls;
}

export const __test__ = { hasRolls, isMidiCard, removeCritMarks };
