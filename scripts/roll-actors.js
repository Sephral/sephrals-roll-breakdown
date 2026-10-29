// Who rolled: the speaker of a message, or the actor of each roll on cards with rolls of several actors.

// Core's speakerActor resolves the speaker token or actor and falls back to the author's assigned character.
// Some systems post rolls without a speaker (Crucible skill checks keep the actor in the roll data), so the
// adapter may name the rolling actor first.
export function getSpeakerActor(message, adapter = null) {
  let adapterActor = null;
  try {
    adapterActor = typeof adapter?.getMessageActor === "function" ? adapter.getMessageActor(message) : null;
  } catch {
    adapterActor = null;
  }
  return adapterActor ?? message?.speakerActor ?? null;
}

// Actors per roll index when the adapter says a message holds rolls of several actors (Crucible initiative
// reports and group checks), else null.
export function getRollActors(message, adapter = null) {
  if (typeof adapter?.getRollActors !== "function") return null;
  let actors = null;
  try {
    actors = adapter.getRollActors(message);
  } catch {
    actors = null;
  }
  return Array.isArray(actors) && actors.some(Boolean) ? actors : null;
}

// The rolls of a message as the adapter reads them (Ready Set Roll keeps them in flags in dnd5e).
export function getMessageRolls(message, adapter = null) {
  try {
    const rolls = typeof adapter?.getMessageRolls === "function" ? adapter.getMessageRolls(message) : message?.rolls;
    return Array.isArray(rolls) ? rolls.filter(Boolean) : [];
  } catch {
    return [];
  }
}
