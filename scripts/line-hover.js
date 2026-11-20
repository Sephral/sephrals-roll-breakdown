// The full breakdown as a popover while the pointer rests on the short line of a chat card (or the line has keyboard
// focus). The popover is a copy of the panel that is already on the card, so every visibility rule that decided what
// the card holds (who sees which roll, GM roll privacy, NPC rolls, bonuses) applies to it as well. A click still
// toggles the panel, touch input never opens it (a tap behaves as before).

export const HOVER_SHOW_DELAY_MS = 300;
export const HOVER_HIDE_DELAY_MS = 160;
const POPOVER_WIDTH = 360;
const MARGIN = 8;
const GAP = 8;
let popoverCounter = 0;

// Timing of one popover: it shows after the pointer rested for a moment and hides a moment after the pointer left both
// the line and the popover. Timers are injected, so the rules are testable without a browser.
export function createHoverController({
  onShow,
  onHide,
  showDelay = HOVER_SHOW_DELAY_MS,
  hideDelay = HOVER_HIDE_DELAY_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id)
} = {}) {
  let showTimer = null;
  let hideTimer = null;
  let shown = false;

  const clearShow = () => {
    if (showTimer === null) return;
    cancel(showTimer);
    showTimer = null;
  };
  const clearHide = () => {
    if (hideTimer === null) return;
    cancel(hideTimer);
    hideTimer = null;
  };

  return {
    get shown() {
      return shown;
    },
    get pending() {
      return showTimer !== null;
    },
    // The pointer or the focus came onto the line or the popover
    enter() {
      clearHide();
      if (shown || showTimer !== null) return;
      showTimer = schedule(() => {
        showTimer = null;
        shown = true;
        onShow?.();
      }, showDelay);
    },
    // It left them again
    leave() {
      clearShow();
      if (!shown || hideTimer !== null) return;
      hideTimer = schedule(() => {
        hideTimer = null;
        shown = false;
        onHide?.();
      }, hideDelay);
    },
    // Scrolling, a click or a key: what is pending is dropped, what is shown goes away at once
    dismiss() {
      clearShow();
      clearHide();
      if (!shown) return;
      shown = false;
      onHide?.();
    }
  };
}

// Where the popover goes: left of the card when the room beside it is wide enough (the chat sits at the screen edge),
// otherwise below the line, or above it when there is no room below. Returns the top left corner in viewport pixels.
export function placePopover(anchor, size, viewport) {
  const room = { left: anchor.left - GAP - MARGIN, right: viewport.width - anchor.right - GAP - MARGIN };
  const clampTop = (top) => Math.max(MARGIN, Math.min(top, viewport.height - size.height - MARGIN));
  if (room.left >= size.width) return { left: anchor.left - GAP - size.width, top: clampTop(anchor.top), side: "left" };
  if (room.right >= size.width) return { left: anchor.right + GAP, top: clampTop(anchor.top), side: "right" };
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - size.width - MARGIN));
  const below = anchor.bottom + GAP;
  if (below + size.height <= viewport.height - MARGIN) return { left, top: below, side: "below" };
  const above = anchor.top - GAP - size.height;
  return { left, top: Math.max(MARGIN, above), side: "above" };
}

function isFocusVisible(element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

function buildPopover(panel, id) {
  const source = panel.querySelector(".srb-breakdown__panel");
  if (!source) return null;
  const popover = document.createElement("div");
  popover.className = "srb-hover";
  popover.id = id;
  popover.setAttribute("role", "tooltip");
  const copy = source.cloneNode(true);
  copy.removeAttribute("id");
  // The settings gear belongs to the card, not to the preview
  copy.querySelectorAll(".srb-breakdown__tools").forEach((node) => node.remove());
  popover.append(copy);
  return popover;
}

// Wires the hover to the line of one panel. isEnabled is asked at every attempt, so the setting applies at once.
// onShown runs each time the popover opens (the caller counts it once per message).
export function attachLineHover(panel, { isEnabled = () => true, onShown = null } = {}) {
  const line = panel?.querySelector?.(".srb-breakdown__line");
  const summary = panel?.querySelector?.(".srb-breakdown__toggle");
  if (!line || !summary || typeof document === "undefined") return null;

  let popover = null;
  let watcher = null;
  let listening = false;

  const reposition = () => {
    if (!popover) return;
    const rect = (panel.isConnected ? panel : line).getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const anchor = { left: rect.left, right: rect.right, top: lineRect.top, bottom: lineRect.bottom };
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * MARGIN);
    popover.style.width = `${width}px`;
    const { left, top } = placePopover(anchor, { width, height: popover.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  };

  const onDismissEvent = (event) => {
    // Scrolling inside the popover itself is how a long breakdown is read
    if (popover && event?.target instanceof Node && popover.contains(event.target)) return;
    controller.dismiss();
  };
  const onKey = (event) => {
    if (event.key !== "Escape" || !controller.shown) return;
    // Escape closes the preview and nothing else (Foundry would open its game menu)
    controller.dismiss();
    event.stopPropagation();
    event.preventDefault();
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    document.addEventListener("scroll", onDismissEvent, { capture: true, passive: true });
    document.addEventListener("wheel", onDismissEvent, { capture: true, passive: true });
    document.addEventListener("pointerdown", onDismissEvent, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
  };
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    document.removeEventListener("scroll", onDismissEvent, { capture: true });
    document.removeEventListener("wheel", onDismissEvent, { capture: true });
    document.removeEventListener("pointerdown", onDismissEvent, { capture: true });
    window.removeEventListener("keydown", onKey, true);
  };

  const remove = () => {
    if (watcher !== null) clearInterval(watcher);
    watcher = null;
    summary.removeAttribute("aria-describedby");
    popover?.remove();
    popover = null;
    unlisten();
  };

  const controller = createHoverController({
    onShow: () => {
      // The card was drawn again, or its panel was opened meanwhile
      if (!line.isConnected || panel.open || !isEnabled()) {
        controller.dismiss();
        return;
      }
      popoverCounter += 1;
      popover = buildPopover(panel, `srb-hover-${popoverCounter}`);
      if (!popover) return;
      popover.addEventListener("pointerenter", () => controller.enter());
      popover.addEventListener("pointerleave", () => controller.leave());
      document.body.append(popover);
      summary.setAttribute("aria-describedby", popover.id);
      reposition();
      // A card that is drawn again while the popover is open leaves no event behind
      watcher = setInterval(() => {
        if (!line.isConnected || panel.open) controller.dismiss();
      }, 400);
      onShown?.();
    },
    onHide: remove
  });

  const begin = () => {
    if (!isEnabled() || panel.open) return;
    listen();
    controller.enter();
  };
  const end = () => {
    controller.leave();
    // Nothing pending or shown any more: the document listeners are not needed
    if (!controller.shown && !controller.pending) unlisten();
  };

  line.addEventListener("pointerenter", (event) => {
    // Touch and pen taps behave as before, only a mouse hovers
    if (event.pointerType && event.pointerType !== "mouse") return;
    begin();
  });
  line.addEventListener("pointerleave", end);
  summary.addEventListener("focus", () => {
    if (isFocusVisible(summary)) begin();
  });
  summary.addEventListener("blur", end);
  // A click toggles the panel, which replaces the preview
  summary.addEventListener("click", () => controller.dismiss());
  return controller;
}

export const __test__ = { buildPopover, POPOVER_WIDTH, MARGIN, GAP };
