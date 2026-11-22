// Sample windows (api.samples, contract in samples.mjs): chat cards with made-up rolls and the My dice luck window, so
// translators and testers see every text in its place without rolling a die first. Nothing here writes: the cards are
// chat messages that are never saved (rolls built from fixed results in memory), the luck window shows made-up numbers
// and its button does nothing, no usage counter counts (the renderer skips messages flagged as samples).
import { MODULE_ID, localize } from "./settings.js";
import { buildLuckHtml } from "./luck-app.js";
import { sampleCards, sampleLuckRows } from "./sample-data.js";
import { compactBreakdown, rollSignature, STORE_KEY, STORE_VERSION } from "./stored-breakdown.js";
import { openSampleHtml, sampleCast, sampleText } from "./samples.mjs";

/** The flag that marks a message as a sample: the card renders like a real one but counts nothing. */
export const SAMPLE_FLAG = "sample";

function ability(key, fallback) {
  const text = game.i18n?.localize?.(`DND5E.Ability${key}`);
  return text && text !== `DND5E.Ability${key}` ? text : fallback;
}

function systemWord(key, fallback) {
  const text = game.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
}

// The labels of the sources in the language of Foundry (the dnd5e words where the system has them).
function sampleWords() {
  const dex = ability("Dex", "Dexterity");
  const skill = systemWord("DND5E.SkillPrc", "Perception");
  return {
    strength: ability("Str", "Strength"),
    dexterity: dex,
    wisdom: ability("Wis", "Wisdom"),
    intelligence: ability("Int", "Intelligence"),
    proficiency: systemWord("DND5E.Proficiency", "Proficiency Bonus"),
    expertise: localize("Sample.Expertise"),
    cover: localize("Sample.Cover"),
    coverDetail: localize("Sample.CoverDetail"),
    weapon: sampleText("longsword"),
    weaponBonus: `${sampleText("longsword")} +1`,
    bow: sampleText("shortbow"),
    bless: localize("Sample.Bless"),
    help: localize("Sample.Help"),
    fireBrand: localize("Sample.FireBrand"),
    poisoned: systemWord("EFFECT.StatusPoisoned", "Poisoned"),
    darkness: localize("Sample.Darkness"),
    critNote: localize("Sample.CritNote"),
    critRange: localize("Sample.CritRange", { range: "19–20" }),
    critRangeHint: localize("Sample.CritRangeHint"),
    attackRoll: localize("Sample.AttackRoll"),
    damageRoll: localize("Sample.DamageRoll"),
    saveRoll: localize("Sample.SaveRoll", { ability: dex }),
    checkRoll: localize("Sample.CheckRoll", { skill }),
    proficiencyDetail: localize("Sample.ProficiencyDetail")
  };
}

const CARD_ID_PREFIX = "srbSample";

// A chat message that is never saved: real Roll objects from fixed results, the stored breakdown in the module flag.
function buildMessage(card, index) {
  const Roll = CONFIG.Dice.Roll ?? foundry.dice.Roll;
  const rolls = card.rolls.map((entry) => Roll.fromData(foundry.utils.deepClone(entry.data)));
  const speaker = sampleCast().find((member) => member.id === card.speaker);
  const stored = {
    v: STORE_VERSION,
    adapter: "dnd5e",
    lang: game.i18n?.lang ?? "en",
    rolls: rolls.map((roll, rollIndex) => ({ s: rollSignature(roll), b: compactBreakdown({ ...card.rolls[rollIndex].breakdown, rollIndex }) }))
  };
  const Message = getDocumentClass("ChatMessage");
  return new Message({
    _id: `${CARD_ID_PREFIX}${String(index).padStart(7, "0")}`,
    content: "",
    flavor: card.flavor,
    speaker: { alias: speaker?.name ?? sampleText("troll") },
    author: game.user.id,
    timestamp: Date.now(),
    rolls,
    flags: { [MODULE_ID]: { [SAMPLE_FLAG]: true, [STORE_KEY]: stored } }
  });
}

// The panel is added a moment after the card is drawn (template render): wait for it, at most a few seconds.
async function waitForPanel(root, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const panel = root.querySelector(".srb-breakdown");
    if (panel) return panel;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function cardBody(card, index, { hiddenFromPlayers = false } = {}) {
  const message = buildMessage(card, index);
  const rendered = typeof message.renderHTML === "function" ? await message.renderHTML() : (await message.getHTML())?.[0];
  const log = document.createElement("ol");
  log.className = "chat-log sephral-sample-chat";
  log.style.cssText = "list-style:none;margin:0;padding:0;";
  if (!rendered) return log;
  log.append(rendered);
  if (hiddenFromPlayers) {
    // What a player gets of a GM roll with the setting "Hide GM rolls from players": the total only
    rendered.classList.add("srb-gm-hidden", "srb-gm-no-crits");
    return log;
  }
  const panel = await waitForPanel(rendered);
  // The details element opens like the real one (the click on it works in a sample as well)
  if (panel && !panel.open) panel.open = true;
  return log;
}

function luckBody(profile, { isGM = false } = {}) {
  const own = sampleCast().find((member) => member.id === "ari");
  const rows = sampleLuckRows(profile, own?.player ?? "Lena");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildLuckHtml(rows, { isGM });
  return wrapper;
}

/**
 * The sample windows of the module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows() {
  const chatGroup = localize("Sample.Chat");
  const luckGroup = localize("Sample.LuckGroup");
  const entries = [];
  const labels = {
    attack: "Sample.CardAttack",
    crit: "Sample.CardCrit",
    damage: "Sample.CardDamage",
    save: "Sample.CardSave",
    check: "Sample.CardCheck",
    two: "Sample.CardTwo",
    gm: "Sample.CardGm"
  };
  // The cards are built again on every render, so they follow the language while one types.
  sampleCards(sampleWords()).forEach((card, index) => {
    const label = localize(labels[card.id]);
    entries.push({
      id: `card-${card.id}`,
      label,
      group: chatGroup,
      open: () => openSampleHtml({
        moduleId: MODULE_ID,
        id: `card-${card.id}`,
        title: label,
        width: 380,
        classes: ["sephral-sample-chat-window"],
        body: () => cardBody(sampleCards(sampleWords())[index], index, { hiddenFromPlayers: Boolean(card.gm) })
      })
    });
  });
  const luck = (id, labelKey, profile, isGM) => {
    const label = localize(labelKey);
    entries.push({
      id,
      label,
      group: luckGroup,
      open: () => openSampleHtml({
        moduleId: MODULE_ID,
        id,
        title: localize("Luck.Title"),
        width: 480,
        classes: ["srb-luck-window"],
        body: () => luckBody(profile, { isGM })
      })
    });
  };
  luck("luck-above", "Sample.LuckAbove", "above", false);
  luck("luck-below", "Sample.LuckBelow", "below", false);
  luck("luck-even", "Sample.LuckEven", "even", false);
  luck("luck-few", "Sample.LuckFew", "few", false);
  luck("luck-gm", "Sample.LuckGm", "above", true);
  return entries;
}
