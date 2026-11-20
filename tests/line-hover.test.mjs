import assert from "node:assert/strict";
import test from "node:test";

import { createHoverController, placePopover, HOVER_SHOW_DELAY_MS, HOVER_HIDE_DELAY_MS } from "../scripts/line-hover.js";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    schedule(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    get count() {
      return timers.size;
    }
  };
}

function setup() {
  const clock = fakeTimers();
  const events = [];
  const controller = createHoverController({
    onShow: () => events.push("show"),
    onHide: () => events.push("hide"),
    schedule: clock.schedule,
    cancel: clock.cancel
  });
  return { clock, events, controller };
}

test("the popover shows only after the pointer rested for the delay", () => {
  const { clock, events, controller } = setup();
  controller.enter();
  clock.advance(HOVER_SHOW_DELAY_MS - 1);
  assert.deepEqual(events, []);
  clock.advance(1);
  assert.deepEqual(events, ["show"]);
  assert.equal(controller.shown, true);
});

test("passing over the line quickly shows nothing", () => {
  const { clock, events, controller } = setup();
  controller.enter();
  clock.advance(100);
  controller.leave();
  clock.advance(1000);
  assert.deepEqual(events, []);
  assert.equal(clock.count, 0);
});

test("moving from the line into the popover keeps it open", () => {
  const { clock, events, controller } = setup();
  controller.enter();
  clock.advance(HOVER_SHOW_DELAY_MS);
  controller.leave();
  clock.advance(HOVER_HIDE_DELAY_MS - 10);
  controller.enter();
  clock.advance(1000);
  assert.deepEqual(events, ["show"]);
  controller.leave();
  clock.advance(HOVER_HIDE_DELAY_MS);
  assert.deepEqual(events, ["show", "hide"]);
});

test("scrolling drops a pending popover and closes a shown one at once", () => {
  const { clock, events, controller } = setup();
  controller.enter();
  clock.advance(100);
  controller.dismiss();
  clock.advance(1000);
  assert.deepEqual(events, []);

  controller.enter();
  clock.advance(HOVER_SHOW_DELAY_MS);
  controller.dismiss();
  assert.deepEqual(events, ["show", "hide"]);
  controller.dismiss();
  assert.deepEqual(events, ["show", "hide"]);
});

test("entering again while shown does not show twice", () => {
  const { clock, events, controller } = setup();
  controller.enter();
  clock.advance(HOVER_SHOW_DELAY_MS);
  controller.enter();
  controller.enter();
  clock.advance(1000);
  assert.deepEqual(events, ["show"]);
});

test("the popover goes left of the card, right of it, below or above, always inside the screen", () => {
  const viewport = { width: 1400, height: 900 };
  const size = { width: 360, height: 300 };
  const card = { left: 1100, right: 1380, top: 400, bottom: 424 };
  assert.deepEqual(placePopover(card, size, viewport), { left: 732, top: 400, side: "left" });
  // Near the bottom edge the popover moves up so it stays visible
  assert.equal(placePopover({ ...card, top: 800, bottom: 824 }, size, viewport).top, 900 - 300 - 8);
  // A card on the left screen edge opens to its right
  const leftCard = { left: 10, right: 290, top: 100, bottom: 124 };
  assert.deepEqual(placePopover(leftCard, size, viewport), { left: 298, top: 100, side: "right" });
  // No room beside it (narrow window): below the line, or above when there is no room below
  const narrow = { width: 400, height: 900 };
  const wide = { left: 20, right: 380, top: 300, bottom: 324 };
  assert.deepEqual(placePopover(wide, size, narrow), { left: 20, top: 332, side: "below" });
  assert.deepEqual(placePopover({ ...wide, top: 700, bottom: 724 }, size, narrow), { left: 20, top: 392, side: "above" });
});
