import { curvePoints, EXPECTED_AVERAGE, luckStats, naturalFromRoll, normalizeLuck, recordNaturals, sessionIsCurrent } from "./luck.js";
import { getModuleLanguage, localize, MODULE_ID, SETTINGS } from "./settings.js";
import { countFeature } from "./usage.mjs";

// "My dice luck": the natural d20 results of a player against the expected 10.5. Each client keeps the numbers of its own
// rolls in its own user flag, so nobody needs extra permissions. A player opens only the own page, the GM sees a table of
// everybody and starts a new evening for all.

const FLAG = "luck";
let instance = null;
// One write after the other: a second roll may arrive before the first flag update came back
let queue = Promise.resolve();

function eveningStart() {
  try {
    return Number(game.settings.get(MODULE_ID, SETTINGS.LUCK_EVENING)) || 0;
  } catch {
    return 0;
  }
}

// Called for every new chat message. Only the client of the author counts, and only natural d20 results.
export function trackLuck(message, userId, rolls) {
  if (!game.user || userId !== game.user.id) return;
  const naturals = (Array.isArray(rolls) ? rolls : []).map(naturalFromRoll).filter((value) => value !== null);
  if (!naturals.length) return;
  queue = queue
    .then(async () => {
      const current = game.user.getFlag(MODULE_ID, FLAG);
      const next = recordNaturals(current, naturals, { now: Date.now(), eveningStart: eveningStart(), messageId: message?.id ?? null });
      if (next.all.n === normalizeLuck(current).all.n) return;
      await game.user.setFlag(MODULE_ID, FLAG, next);
    })
    .catch((error) => console.warn(`${MODULE_ID} | The dice luck could not be saved`, error));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function fmt(value, digits = 1) {
  if (!Number.isFinite(value)) return "";
  try {
    return value.toLocaleString(getModuleLanguage(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return value.toFixed(digits);
  }
}

// The numbers of one user: tonight (only while it still is tonight) and overall.
export function gatherLuck(user, now = Date.now()) {
  const data = normalizeLuck(user?.getFlag?.(MODULE_ID, FLAG));
  const current = sessionIsCurrent(data.session, now, eveningStart());
  return {
    id: user?.id,
    name: user?.name ?? "",
    isSelf: user?.id === game.user?.id,
    session: luckStats(current ? data.session : null),
    rolls: current ? data.session.rolls : [],
    all: luckStats(data.all)
  };
}

export function gatherAll(now = Date.now()) {
  const users = game.user?.isGM ? Array.from(game.users ?? []) : [game.user].filter(Boolean);
  return users.map((user) => gatherLuck(user, now));
}

function verdict(stats) {
  if (stats.n < 5) return localize("Luck.Few");
  const difference = stats.difference;
  if (Math.abs(difference) < 0.5) return localize("Luck.Even");
  return localize(difference > 0 ? "Luck.Above" : "Luck.Below", { value: fmt(Math.abs(difference)) });
}

function statBlock(title, stats) {
  const average = stats.n ? fmt(stats.average) : "·";
  return `<section class="srb-luck__block">
    <h3>${esc(title)}</h3>
    <div class="srb-luck__big">${esc(average)}</div>
    <div class="srb-luck__small">${esc(localize("Luck.Expected", { value: fmt(EXPECTED_AVERAGE) }))}</div>
    <dl>
      <dt>${esc(localize("Luck.Rolls"))}</dt><dd>${stats.n}</dd>
      <dt>${esc(localize("Luck.Twenties"))}</dt><dd>${stats.c20} <span>${esc(localize("Luck.ExpectedCount", { value: fmt(stats.expected20) }))}</span></dd>
      <dt>${esc(localize("Luck.Ones"))}</dt><dd>${stats.c1} <span>${esc(localize("Luck.ExpectedCount", { value: fmt(stats.expected1) }))}</span></dd>
    </dl>
  </section>`;
}

function curve(rolls) {
  const { points, mid } = curvePoints(rolls, 200, 48);
  if (!points) return "";
  return `<figure class="srb-luck__curve" aria-label="${esc(localize("Luck.Curve"))}">
    <svg viewBox="0 0 200 48" width="100%" height="48" preserveAspectRatio="none" role="img">
      <line x1="0" y1="${mid}" x2="200" y2="${mid}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 3"></line>
      <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></polyline>
    </svg>
    <figcaption>${esc(localize("Luck.Curve"))}</figcaption>
  </figure>`;
}

function table(rows) {
  const body = rows.map((row) => `<tr${row.isSelf ? " class=\"is-self\"" : ""}>
      <th scope="row">${esc(row.name)}</th>
      <td>${row.session.n}</td><td>${row.session.n ? esc(fmt(row.session.average)) : "·"}</td><td>${row.session.c20}</td><td>${row.session.c1}</td>
      <td>${row.all.n}</td><td>${row.all.n ? esc(fmt(row.all.average)) : "·"}</td><td>${row.all.c20}</td><td>${row.all.c1}</td>
    </tr>`).join("");
  return `<table class="srb-luck__table">
    <thead>
      <tr><th rowspan="2">${esc(localize("Luck.Player"))}</th><th colspan="4">${esc(localize("Luck.Tonight"))}</th><th colspan="4">${esc(localize("Luck.Overall"))}</th></tr>
      <tr><th>${esc(localize("Luck.Rolls"))}</th><th>${esc(localize("Luck.AverageShort"))}</th><th>20</th><th>1</th><th>${esc(localize("Luck.Rolls"))}</th><th>${esc(localize("Luck.AverageShort"))}</th><th>20</th><th>1</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function buildLuckHtml(rows, { isGM = false } = {}) {
  const own = rows.find((row) => row.isSelf) ?? rows[0] ?? gatherLuck(null);
  let html = `<div class="srb-luck">
    <p class="srb-luck__intro">${esc(localize(isGM ? "Luck.IntroGm" : "Luck.Intro"))}</p>
    <div class="srb-luck__blocks">${statBlock(localize("Luck.Tonight"), own.session)}${statBlock(localize("Luck.Overall"), own.all)}</div>
    ${curve(own.rolls)}
    <p class="srb-luck__verdict">${esc(verdict(own.session))}</p>`;
  if (isGM) {
    html += `${table(rows)}
    <div class="srb-luck__footer"><button type="button" data-action="newEvening"><i class="fa-solid fa-moon" inert></i> ${esc(localize("Luck.NewEvening"))}</button></div>`;
  }
  return `${html}</div>`;
}

let appClass = null;

function getAppClass() {
  if (appClass) return appClass;
  const { ApplicationV2 } = foundry.applications.api;
  appClass = class LuckWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "srb-luck",
      classes: ["srb-luck-window"],
      tag: "div",
      window: { icon: "fa-solid fa-clover", resizable: false },
      position: { width: 480, height: "auto" },
      actions: { newEvening: LuckWindow.#onNewEvening }
    };

    get title() {
      return localize("Luck.Title");
    }

    async _prepareContext() {
      return { rows: gatherAll(), isGM: Boolean(game.user?.isGM) };
    }

    async _renderHTML(context) {
      return buildLuckHtml(context.rows, { isGM: context.isGM });
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    static async #onNewEvening() {
      if (!game.user?.isGM) return;
      await game.settings.set(MODULE_ID, SETTINGS.LUCK_EVENING, Date.now());
      ui.notifications?.info(localize("Luck.NewEveningDone"));
    }
  };
  return appClass;
}

export async function openLuck() {
  const Window = getAppClass();
  if (!instance || instance.constructor !== Window) instance = new Window();
  countFeature(MODULE_ID, "luckViewed");
  await instance.render({ force: true });
  // The frame keeps its title when the language changed while the window was open
  if (instance.window?.title) instance.window.title.textContent = instance.title;
  return instance;
}

// A flag or the evening changed: an open window shows the new numbers.
export function refreshLuckWindow() {
  if (instance?.rendered) void instance.render();
}
