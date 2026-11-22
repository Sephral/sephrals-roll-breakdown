// Daggerheart: the difficulty a roll is measured against. Pure over the message data and a small environment, shared by
// the adapter (outcome pills) and the chance line. Data shapes follow the Daggerheart system source: the difficulty of an
// action lives in roll.options.roll.difficulty, the targets of an attack in message.system.targets (adversaries carry a
// difficulty, characters an evasion). A roll against a target hits on a critical success or when the total reaches the number.

function finite(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : null;
}

export function isDaggerheartRollOptions(roll) {
  return Boolean(roll?.options) && typeof roll.options === "object";
}

// { value, kind: "difficulty" | "evasion", known, name } or null.
// The difficulty the roll carries is printed on the card for everybody. The number of a single target follows the target
// section of the card, which the system can hide from players (setting "hide observer permission in chat").
export function findDaggerheartTarget({ roll, message, env = {} }) {
  const isGM = Boolean(env.isGM);
  const own = finite(roll?.options?.roll?.difficulty);
  if (own !== null && own > 0) return { value: own, kind: "difficulty", known: true, name: null };

  const targets = Array.isArray(message?.system?.targets) ? message.system.targets : [];
  if (targets.length !== 1) return null;
  const only = targets[0];
  const difficulty = finite(only?.difficulty);
  const evasion = finite(only?.evasion);
  const value = difficulty ?? evasion;
  if (value === null) return null;
  return {
    value,
    kind: difficulty !== null ? "difficulty" : "evasion",
    known: isGM || env.daggerheartHidesTargets !== true,
    name: typeof only?.name === "string" && only.name.trim() ? only.name.trim() : null
  };
}

// The lowest natural d20 of an action roll that is a critical success. The system uses a fixed 20 for reaction rolls and
// data.criticalThreshold of the roll otherwise.
export function adversaryCriticalFrom(roll) {
  if (roll?.options?.actionType === "reaction") return 20;
  const threshold = finite(roll?.options?.data?.criticalThreshold ?? roll?.data?.criticalThreshold);
  return threshold !== null && threshold >= 2 && threshold <= 20 ? threshold : 20;
}

// Daggerheart can hide the targets of a roll from players (metagaming setting of the system)
export function daggerheartHidesTargets() {
  const game = globalThis.game;
  if (game?.system?.id !== "daggerheart") return false;
  try {
    return game.settings.get("daggerheart", globalThis.CONFIG?.DH?.SETTINGS?.gameSettings?.Metagaming ?? "Metagaming")?.hideObserverPermissionInChat === true;
  } catch {
    return false;
  }
}

export const __test__ = { finite };
