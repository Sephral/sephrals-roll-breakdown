import { GenericRollAdapter } from "./adapters/generic-adapter.js";
import { getSetting, localize, MODULE_ID, SETTINGS } from "./settings.js";
import { compactBreakdown, readStoredBreakdowns, restoreBreakdown } from "./stored-breakdown.js";
import { countFeature } from "./usage.mjs";

// Self-test: the support for the game system, a breakdown of a test roll, the breakdown of the latest roll in the
// chat, the panel template and the texts. Meant to be run after every update of Foundry or the system; the GM also
// gets a notice once when a newer version than the verified one is installed.

// The versions the module was verified against.
export const TESTED_VERSIONS = Object.freeze({ core: "14.369", dnd5e: "6.0.6", crucible: "0.11.2", pf2e: "8.6.1", swade: "6.0.4" });
const SUPPORTED_SYSTEMS = ["dnd5e", "crucible", "pf2e", "swade"];

async function checkIntegrations(service) {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if (!ok) problems.push(localize(`SelfTest.${key}`, data));
  };

  check(game.i18n.has("SRB.Chat.Toggle"), "Texts");
  if (SUPPORTED_SYSTEMS.includes(game.system.id)) check(service.adapter?.id === game.system.id, "Adapter", { system: game.system.title });

  let parsed = false;
  let roundTrip = false;
  try {
    const roll = await new Roll("1d20 + 3[Test]").evaluate();
    const breakdowns = await new GenericRollAdapter().buildBreakdowns({ id: "srb-self-test", rolls: [roll], flags: {} });
    parsed = Array.isArray(breakdowns) && breakdowns.length > 0;
    // The copy stored on a message reads back as the same breakdown
    const restored = parsed ? restoreBreakdown(compactBreakdown(breakdowns[0]), 0) : null;
    roundTrip = restored?.formula === breakdowns[0].formula && restored?.modifiers?.[0]?.sourceLabel === breakdowns[0].modifiers[0]?.sourceLabel;
  } catch (error) {
    console.warn(`${MODULE_ID} | Self-test could not break down a test roll`, error);
  }
  check(parsed, "TestRoll");
  check(roundTrip, "Stored");

  const latest = Array.from(game.messages ?? []).reverse().find((message) => {
    try {
      return service.adapter?.supportsMessage(message);
    } catch {
      return false;
    }
  });
  if (latest) {
    let built = false;
    try {
      built = Array.isArray(await service.adapter.buildBreakdowns(latest));
      readStoredBreakdowns(latest, service.adapter.getMessageRolls?.(latest) ?? latest.rolls ?? []);
    } catch (error) {
      built = false;
      console.warn(`${MODULE_ID} | Self-test could not break down the latest roll`, error);
    }
    check(built, "LatestRoll");
  }

  let template = false;
  try {
    const load = foundry.applications?.handlebars?.getTemplate ?? globalThis.getTemplate;
    template = typeof (await load(`modules/${MODULE_ID}/templates/breakdown-panel.hbs`)) === "function";
  } catch (error) {
    console.warn(`${MODULE_ID} | Self-test could not load the panel template`, error);
  }
  check(template, "Template");
  return { problems, checks, latest };
}

// The installed versions next to the tested ones.
function versionLine() {
  const current = { core: game.version, [game.system.id]: game.system.version };
  return Object.entries(TESTED_VERSIONS)
    .filter(([id]) => id in current)
    .map(([id, tested]) => localize("SelfTest.Version", { id, current: current[id] ?? "–", tested }))
    .join(", ");
}

// Runs the self-test and reports the result as a notification and a whispered chat message.
export async function runSelfTest(service, { report = true } = {}) {
  countFeature(MODULE_ID, "selfTestRun");
  const { problems, checks, latest } = await checkIntegrations(service);
  const support = SUPPORTED_SYSTEMS.includes(game.system.id) ? game.system.title : localize("SelfTest.Generic");
  const summary = problems.length
    ? localize("SelfTest.Problems", { problems: problems.length, checks })
    : localize("SelfTest.Passed", { checks, system: support });

  if (problems.length) ui.notifications.warn(summary, { permanent: true });
  else ui.notifications.info(summary);

  if (report) {
    const escape = foundry.utils.escapeHTML;
    let content = `<h3>${escape(localize("SelfTest.Title"))}</h3><p>${escape(summary)}</p><p><small>${escape(versionLine())}</small></p>`;
    if (problems.length) content += `<ul>${problems.map((problem) => `<li>${escape(problem)}</li>`).join("")}</ul>`;
    if (!latest) content += `<p><small>${escape(localize("SelfTest.NoRoll"))}</small></p>`;
    await ChatMessage.implementation.create({ content, whisper: [game.user.id], speaker: { alias: game.modules.get(MODULE_ID)?.title } });
  }
  return { problems, checks };
}

// Tells the GM once when Foundry or the system is newer than the versions the module was verified against.
export function noticeNewVersions() {
  if (!game.user?.isGM) return;
  const current = { core: game.version, [game.system.id]: game.system.version };
  const newer = Object.entries(current)
    .filter(([id, version]) => version && TESTED_VERSIONS[id] && foundry.utils.isNewerVersion(version, TESTED_VERSIONS[id]))
    .map(([id, version]) => `${id} ${version}`);
  if (!newer.length) return;
  const signature = newer.join(",");
  if (getSetting(SETTINGS.ACKNOWLEDGED_VERSIONS) === signature) return;
  void game.settings.set(MODULE_ID, SETTINGS.ACKNOWLEDGED_VERSIONS, signature);
  ui.notifications.info(localize("SelfTest.NewVersions", { versions: newer.join(", ") }), { permanent: true });
}
