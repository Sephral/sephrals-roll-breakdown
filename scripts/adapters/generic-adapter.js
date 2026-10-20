import { parseRoll } from "../formula-parser.js";

export class GenericRollAdapter {
  constructor() {
    this.id = "generic";
  }

  // The rolls of a chat message. System adapters also read rolls that modules keep elsewhere (Ready Set Roll in dnd5e).
  getMessageRolls(message) {
    return Array.isArray(message?.rolls) ? message.rolls.filter((roll) => Boolean(roll)) : [];
  }

  supportsMessage(message) {
    return this.getMessageRolls(message).length > 0;
  }

  async buildBreakdowns(message) {
    return this.getMessageRolls(message)
      .map((roll, index) => parseRoll(roll, { adapterId: this.id, rollIndex: index }))
      .filter((breakdown) => breakdown.hasVisibleContent);
  }
}