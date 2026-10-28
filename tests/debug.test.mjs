import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

function installGame() {
  resetGlobals();
  const { game } = createGameStub({ lang: "en", systemId: "dnd5e", settingsValues: { enabled: true }, translations: { "SRB.Debug.Saved": "Saved {file}" } });
  game.user.isGM = true;
  game.version = "14.369";
  globalThis.game = game;
  const saved = [];
  const notices = [];
  globalThis.foundry = { utils: { saveDataToFile: (text) => saved.push(JSON.parse(text)) } };
  globalThis.ui = { notifications: { info: (text) => notices.push(text), error: (text) => notices.push(`error ${text}`) } };
  return { game, saved, notices };
}

function createAdapter(overrides = {}) {
  return {
    id: "dnd5e",
    supportsMessage: () => true,
    getMessageRolls: (message) => message.rolls,
    buildBreakdowns: async () => [{ formula: "1d20 + 2", diceTerms: [], modifiers: [{ expression: "2", signedValue: 2, sourceLabel: "STR modifier" }] }],
    debugInfo: async (message) => ({ rollType: "check", rolls: [{ index: 0, actor: `Actor.${message.id}` }] }),
    ...overrides
  };
}

function createMessage(id) {
  return { id, rolls: [{ formula: "1d20 + 2" }], toObject: () => ({ _id: id, content: "", rolls: ['{"formula":"1d20 + 2"}'] }) };
}

test("the service records its decisions in the debug trace without debug logging", async () => {
  installGame();
  const TestHTMLElement = installHTMLElement();
  const root = Object.assign(new TestHTMLElement(), { querySelector: () => null });
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const { DebugTrace } = await importStable("scripts/debug-file.mjs");
  const trace = new DebugTrace();
  const service = new RollBreakdownService({ adapter: createAdapter({ supportsMessage: () => false }), renderer: {}, trace });
  await service.enhanceChatMessage({ id: "m1", visible: true, rolls: [] }, root);
  assert.deepEqual(trace.entries.map((entry) => [entry.event, entry.messageId]), [["Skipping message because no supported rolls were found.", "m1"]]);
});

test("roll breakdown's part of the debug file: the message, what the adapter read and its breakdowns", async () => {
  const { saved, notices } = installGame();
  const { RollBreakdownService } = await importStable("scripts/roll-breakdown-service.js");
  const { debugTrace, registerDebug } = await importStable("scripts/debug.js");
  const { saveDebugFile } = await importStable("scripts/debug-file.mjs");
  debugTrace.clear();
  const service = new RollBreakdownService({ adapter: createAdapter(), renderer: {}, trace: debugTrace });
  registerDebug(service);
  service.log("Rendered roll breakdown.", { messageId: "m1" });
  service.log("Rendered roll breakdown.", { messageId: "other" });
  const messages = [createMessage("m1"), { id: "plain", rolls: [], toObject: () => ({ _id: "plain" }) }, createMessage("m2")];
  game.messages = { contents: messages, get: (id) => messages.find((message) => message.id === id) };

  const name = await saveDebugFile("m1", { moduleId: "sephrals-roll-breakdown" });
  assert.match(name, /^sephrals-debug-/);
  assert.deepEqual(notices, [`Saved ${name}`]);
  const [file] = saved;
  assert.equal(file.subject, "message");
  assert.deepEqual(file.messages[0].rolls, [{ formula: "1d20 + 2" }]);
  const part = file.modules["sephrals-roll-breakdown"];
  assert.equal(part.details.adapter, "dnd5e");
  assert.equal(part.details.supported, true);
  assert.equal(part.details.context.rolls[0].actor, "Actor.m1");
  assert.equal(part.details.breakdowns[0].modifiers[0].sourceLabel, "STR modifier");
  assert.deepEqual(part.trace.map((entry) => entry.messageId), ["m1"]);

  // A message without rolls is nothing for Roll Breakdown
  await saveDebugFile("plain");
  assert.deepEqual(saved[1].modules, {});

  // An adapter error ends up in the file instead of stopping it
  service.adapter = createAdapter({ buildBreakdowns: async () => { throw new Error("broken card"); } });
  await saveDebugFile();
  const recent = saved[2];
  assert.equal(recent.subject, "recent");
  assert.deepEqual(recent.messages.map((message) => message._id), ["m1", "m2"]);
  assert.match(recent.modules["sephrals-roll-breakdown"].details.m2.error, /broken card/);
  assert.equal(recent.modules["sephrals-roll-breakdown"].trace.length, 2);
});
