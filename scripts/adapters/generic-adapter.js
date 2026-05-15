import { parseRoll } from "../formula-parser.js";

export class GenericRollAdapter {
  constructor() {
    this.id = "generic";
  }

  supportsMessage(message) {
    return Array.isArray(message?.rolls) && message.rolls.some((roll) => Boolean(roll));
  }

  async buildBreakdowns(message) {
    return (message?.rolls ?? [])
      .filter((roll) => Boolean(roll))
      .map((roll, index) => parseRoll(roll, { adapterId: this.id, rollIndex: index }))
      .filter((breakdown) => breakdown.hasVisibleContent);
  }
}