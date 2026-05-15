import { getRenderOptions, isDebugEnabled, shouldRenderForCurrentUser } from "./settings.js";

function getRootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function canSeeMessageContent(message) {
  if (!message) return false;
  if (message.visible === false) return false;
  if (message.isContentVisible === false) return false;
  return true;
}

export class RollBreakdownService {
  constructor({ adapter, renderer }) {
    this.adapter = adapter;
    this.renderer = renderer;
  }

  log(message, extra) {
    if (!isDebugEnabled()) return;
    console.debug("[SRB]", message, extra ?? "");
  }

  async enhanceChatMessage(message, html) {
    const root = getRootElement(html);
    if (!root) return;

    if (!shouldRenderForCurrentUser()) {
      this.log("Skipping message because rendering is disabled for the current user.", { messageId: message?.id });
      return;
    }

    if (!canSeeMessageContent(message)) {
      this.log("Skipping message because the current user cannot see its content.", { messageId: message?.id });
      return;
    }

    if (root.querySelector(".srb-breakdown")) {
      this.log("Skipping message because a breakdown is already present.", { messageId: message?.id });
      return;
    }

    if (!this.adapter.supportsMessage(message)) {
      this.log("Skipping message because no supported rolls were found.", { messageId: message?.id });
      return;
    }

    const breakdowns = await this.adapter.buildBreakdowns(message);
    if (!breakdowns.length) {
      this.log("Skipping message because no visible breakdown content was produced.", { messageId: message?.id });
      return;
    }

    const appended = await this.renderer.appendBreakdown(message, html, breakdowns, getRenderOptions());
    if (appended) {
      this.log("Rendered roll breakdown.", { messageId: message?.id, count: breakdowns.length });
    }
  }
}