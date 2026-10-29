import assert from "node:assert/strict";
import test from "node:test";

import { createGameStub, importStable, installHTMLElement, resetGlobals } from "./helpers/test-helpers.mjs";

const gm = { id: "gm", isGM: true };
const player = { id: "player", isGM: false };
const goblin = { name: "Goblin", hasPlayerOwner: false, isOwner: false };
const hero = { name: "Aria", hasPlayerOwner: true, isOwner: true };

async function setup({ settingsValues = {}, isGM = false, modules = {}, foreignSettings = {} } = {}) {
  resetGlobals();
  installHTMLElement();
  const stub = createGameStub({ systemId: "dnd5e", settingsValues: { uiLanguage: "en", ...settingsValues } });
  stub.game.user = { id: isGM ? "gm" : "player", isGM };
  stub.game.modules = new Map(Object.entries(modules));
  const get = stub.game.settings.get.bind(stub.game.settings);
  stub.game.settings.get = (namespace, key, options) => {
    if (namespace !== "sephrals-roll-breakdown") {
      if (!(`${namespace}.${key}` in foreignSettings)) throw new Error("not registered");
      return foreignSettings[`${namespace}.${key}`];
    }
    return get(namespace, key, options);
  };
  globalThis.game = stub.game;
  const settings = await importStable("scripts/settings.js");
  settings.registerSettings();
  const privacy = await importStable("scripts/gm-roll-privacy.js");
  return { privacy, settings, game: stub.game };
}

function message({ author = gm, speakerActor = goblin, contentVisible = true, rolls = [{ formula: "1d20 + 4", total: 15 }], flags = {}, whisper = [] } = {}) {
  return { id: "m1", author, speakerActor, isContentVisible: contentVisible, isRoll: rolls.length > 0, rolls, flags, whisper, isAuthor: false };
}

function element({ inlineResult = false } = {}) {
  const classes = new Set();
  return {
    hidden: false,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      has: (name) => classes.has(name)
    },
    querySelector: (selector) => (inlineResult && selector === ".inline-roll.inline-result" ? {} : null),
    classes
  };
}

test("GM roll privacy is off by default and never touches the GM's own view", async () => {
  const { privacy } = await setup();
  assert.equal(privacy.classifyGmRoll(message()), null);
  const { privacy: on } = await setup({ settingsValues: { gmRollPrivacy: "all" }, isGM: true });
  assert.equal(on.classifyGmRoll(message()), null);
});

test("players see public GM rolls of NPCs without formula and dice, private ones not at all", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "npc" } });
  assert.equal(privacy.classifyGmRoll(message()), "public");
  assert.equal(privacy.classifyGmRoll(message({ contentVisible: false })), "private");
  // GM rolls without an actor count as NPC rolls, rolls for a hero only in the mode "all"
  assert.equal(privacy.classifyGmRoll(message({ speakerActor: null })), "public");
  assert.equal(privacy.classifyGmRoll(message({ speakerActor: hero })), null);
  // Player rolls stay as they are
  assert.equal(privacy.classifyGmRoll(message({ author: player, speakerActor: hero })), null);
  assert.equal(privacy.classifyGmRoll(message({ author: player, speakerActor: goblin, contentVisible: false })), null);
  // A GM message without rolls is no roll, an inline roll in its text is one
  assert.equal(privacy.classifyGmRoll(message({ rolls: [] })), null);
  assert.equal(privacy.classifyGmRoll(message({ rolls: [] }), null, { root: element({ inlineResult: true }) }), "public");

  const { privacy: all } = await setup({ settingsValues: { gmRollPrivacy: "all" } });
  assert.equal(all.classifyGmRoll(message({ speakerActor: hero })), "public");
  assert.equal(all.classifyGmRoll(message({ speakerActor: hero, contentVisible: false })), "private");
});

test("the parts can be switched off one by one", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "npc", gmRollPublic: false } });
  assert.equal(privacy.classifyGmRoll(message()), null);
  assert.equal(privacy.classifyGmRoll(message({ contentVisible: false })), "private");
  const { privacy: publicOnly } = await setup({ settingsValues: { gmRollPrivacy: "npc", gmRollPrivate: false } });
  assert.equal(publicOnly.classifyGmRoll(message({ contentVisible: false })), null);
  assert.equal(publicOnly.classifyGmRoll(message()), "public");
});

test("cards with rolls of several actors and no speaker count by their rollers", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "all" } });
  const tokenBar = (actors) => ({ getRollActors: () => actors, getMessageRolls: (msg) => msg.rolls });
  // Monk's TokenBar request of the GM: saves of heroes stay visible, saves of monsters only give their total
  assert.equal(privacy.classifyGmRoll(message({ speakerActor: null }), tokenBar([hero, goblin])), null);
  assert.equal(privacy.classifyGmRoll(message({ speakerActor: null }), tokenBar([goblin, goblin])), "public");
  // A card with a speaker counts by the speaker, also with target saves of heroes (midi-qol)
  assert.equal(privacy.classifyGmRoll(message(), tokenBar([null, hero])), "public");
});

test("Midi-QOL cards are left to Midi-QOL when it hides GM rolls itself", async () => {
  const modules = { "midi-qol": { active: true } };
  const midiCard = message({ flags: { "midi-qol": { workflowId: "w" } } });
  const hiding = await setup({ settingsValues: { gmRollPrivacy: "npc" }, modules, foreignSettings: { "midi-qol.ConfigSettings": { gmAttackDisplay: "hideFormula", gmDamageDisplay: "full" } } });
  assert.equal(hiding.privacy.midiHidesGmRolls(), true);
  assert.equal(hiding.privacy.classifyGmRoll(midiCard), null);
  // Other cards and private rolls are still handled
  assert.equal(hiding.privacy.classifyGmRoll(message()), "public");
  assert.equal(hiding.privacy.classifyGmRoll({ ...midiCard, isContentVisible: false }), "private");

  const showing = await setup({ settingsValues: { gmRollPrivacy: "npc" }, modules, foreignSettings: { "midi-qol.ConfigSettings": { gmAttackDisplay: "full", gmDamageDisplay: "full" } } });
  assert.equal(showing.privacy.midiHidesGmRolls(), false);
  assert.equal(showing.privacy.classifyGmRoll(midiCard), "public");

  const older = await setup({ settingsValues: { gmRollPrivacy: "npc" }, modules, foreignSettings: { "midi-qol.ConfigSettings": { hideRollDetails: "d20Only" } } });
  assert.equal(older.privacy.midiHidesGmRolls(), true);
  const inactive = await setup({ settingsValues: { gmRollPrivacy: "npc" }, modules: { "midi-qol": { active: false } } });
  assert.equal(inactive.privacy.midiHidesGmRolls(), false);
});

test("the chat card gets the classes the stylesheet hides, private rolls are hidden at once", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "npc", gmRollCrits: false } });
  const publicCard = element();
  assert.equal(privacy.applyGmRollPrivacy(message(), publicCard), "public");
  assert.deepEqual([...publicCard.classes].sort(), ["srb-gm-hidden", "srb-gm-no-crits"]);
  assert.equal(publicCard.hidden, false);

  const privateCard = element();
  assert.equal(privacy.applyGmRollPrivacy(message({ contentVisible: false }), privateCard), "private");
  assert.deepEqual([...privateCard.classes], ["srb-gm-private"]);
  assert.equal(privateCard.hidden, true);

  // A card that is rendered again after a change loses the old classes
  assert.equal(privacy.applyGmRollPrivacy(message({ speakerActor: hero }), publicCard), null);
  assert.deepEqual([...publicCard.classes], []);
  // jQuery and plain objects
  assert.equal(privacy.applyGmRollPrivacy(message(), [element()]), "public");
  assert.equal(privacy.applyGmRollPrivacy(message(), { html: true }), null);

  const { privacy: withCrits } = await setup({ settingsValues: { gmRollPrivacy: "npc" } });
  const card = element();
  withCrits.applyGmRollPrivacy(message(), card);
  assert.deepEqual([...card.classes], ["srb-gm-hidden"]);
});

test("without the crits option a critical or a fumble looks like any other roll", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "npc", gmRollCrits: false } });
  const markedElement = (classes, iconCount) => {
    const list = new Set(classes);
    const icons = Array.from({ length: iconCount }, () => ({ removed: false, remove() { this.removed = true; } }));
    return {
      icons,
      classList: { remove: (...names) => names.forEach((name) => list.delete(name)), contains: (name) => list.has(name), list },
      querySelectorAll: () => icons
    };
  };
  const critSuccess = markedElement(["success", "critical"], 2);
  const critPlain = markedElement(["critical"], 2);
  const fumble = markedElement(["failure", "fumble"], 2);
  const card = element();
  card.querySelectorAll = () => [critSuccess, critPlain, fumble];
  assert.equal(privacy.applyGmRollPrivacy(message(), card), "public");
  assert.deepEqual([...critSuccess.classList.list], ["success"]);
  assert.deepEqual(critSuccess.icons.map((icon) => icon.removed), [false, true]);
  assert.deepEqual([...critPlain.classList.list], []);
  assert.deepEqual(critPlain.icons.map((icon) => icon.removed), [true, true]);
  assert.deepEqual([...fumble.classList.list], ["failure"]);
  assert.deepEqual(fumble.icons.map((icon) => icon.removed), [false, true]);

  // With the option on the marks stay
  const { privacy: withCrits } = await setup({ settingsValues: { gmRollPrivacy: "npc" } });
  const kept = markedElement(["critical"], 2);
  const keptCard = element();
  keptCard.querySelectorAll = () => [kept];
  withCrits.applyGmRollPrivacy(message(), keptCard);
  assert.deepEqual([...kept.classList.list], ["critical"]);
});

test("the GM's hidden rolls are counted on the GM's own client", async () => {
  const { privacy } = await setup({ settingsValues: { gmRollPrivacy: "npc" }, isGM: true });
  assert.equal(privacy.isOwnHiddenGmRoll({ ...message(), isAuthor: true }), true);
  assert.equal(privacy.isOwnHiddenGmRoll({ ...message({ whisper: ["gm"] }), isAuthor: true }), true);
  assert.equal(privacy.isOwnHiddenGmRoll(message()), false);
  assert.equal(privacy.isOwnHiddenGmRoll({ ...message({ speakerActor: hero }), isAuthor: true }), false);
  const { privacy: publicOff } = await setup({ settingsValues: { gmRollPrivacy: "npc", gmRollPublic: false }, isGM: true });
  assert.equal(publicOff.isOwnHiddenGmRoll({ ...message(), isAuthor: true }), false);
});

test("players get no breakdown panel on GM rolls whose dice are hidden", async () => {
  const { game } = await setup({ settingsValues: { gmRollPrivacy: "all", hideNpcRolls: false } });
  game.user = player;
  const { __test__ } = await importStable("scripts/roll-breakdown-service.js");
  assert.equal(__test__.canSeeBreakdown(message({ speakerActor: hero })), false);
  assert.equal(__test__.canSeeBreakdown(message({ author: player, speakerActor: hero })), true);
  game.user = gm;
  assert.equal(__test__.canSeeBreakdown(message({ speakerActor: hero })), true);
});
