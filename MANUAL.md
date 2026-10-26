# Sephral’s Roll Breakdown Manual

This manual covers the details. For a quick overview see the [README](README.md).

## How to use it

1. Enable the module in Foundry.
2. Roll as usual.
3. Open the `Breakdown` section on the chat card to see dice, modifiers and the other parts of the formula.
4. For D&D 5e attack rolls, the top of the panel lists the reasons for Advantage or Disadvantage when the roll contains them.

An opened panel stays open when the chat card updates or the chat log redraws. Rolls with nothing meaningful to explain get no panel.

## Supported systems

Roll Breakdown has its own breakdown for D&D 5e, Crucible, Pathfinder 2e and Savage Worlds. Every other system gets a general breakdown of dice and modifiers.

### D&D 5e

Roll Breakdown names the sources of most D&D 5e bonuses. It works with D&D 5e 5.x and 6.x.

Supported D&D 5e rolls:

* Attack rolls
* Damage rolls
* Saving throws
* Ability checks
* Skill checks
* Tool checks
* Concentration saves
* Death saves

When a chat card holds an attack roll and a damage roll, each of them gets its own breakdown. This includes the cards of MidiQOL and Ready Set Roll.

In D&D 5e 6 active effects can carry rules that only apply when a roll is made, a bonus to attacks for example, or advantage on Strength checks. The panel names the effect behind such a bonus and lists it as a reason for advantage or disadvantage. It checks the conditions of each rule the way D&D 5e does, with the actor as it is now.

Chat cards can still differ by system version, activity type and automation modules, so not every bonus can always be named.

### Crucible

Works with skill checks, attacks with weapons, spells and skills, group checks and the initiative report of each round.

* **Dice:** each of the three dice with its size. A die that boons made larger or banes made smaller says how many of them changed it.
* **Boons and banes:** every source the roll lists, such as Flanked or Prone, with the number it adds.
* **Bonuses:** ability bonus, skill bonus and enchantment, with the abilities, the skill or the weapon behind them. These labels only appear when the bonuses and dice add up to the roll total.
* **Result:** success, failure or a critical result. For attacks the result against the defense, such as Hit, Glance, Dodge or Parry.
* **Damage:** overflow, base, action bonus, resistance or vulnerability and the total, the same parts as in the roll details of the system.
* **Targets:** on action cards each roll is titled with its target.

The DC, the defense value and the margin are shown to the GM only, the same way the Crucible card hides them from players. Initiative rolls show their result without a DC, and unaware or incapacitated combatants show their fixed initiative. On the initiative report and on group checks, players see the rolls of their own heroes, and the visibility settings apply to each roll. Players get no breakdown for combatants that are hidden from them.

### Pathfinder 2e

* **Checks and attacks:** the single bonus of the roll is split into its named modifiers, each with its type (status, circumstance, item and so on). This happens only when the modifiers add up to that bonus. Modifiers that did not count, for example because a higher bonus of the same type applies, are listed separately.
* **Fortune and misfortune:** rolling twice and roll substitutions are listed with their source. A substitution such as Assurance takes the place of the die.
* **Result:** degree of success, DC and margin. When a rule changed the degree of success, the result names the degree before it. A reroll shows the result of the roll that was kept. Players see the DC and the result only when the Pathfinder 2e settings show them to players.
* **Damage:** the dice per damage type, each damage part, extra dice and the damage modifiers, and whether a critical hit doubled the dice or the damage. Extra dice and modifiers that only count on a critical hit appear only on critical hits.
* **Persistent damage:** a hit lists the persistent damage without a result, because Pathfinder 2e rolls it at the end of each turn. That roll then gets its own breakdown.

When Pathfinder 2e hides the breakdown of a roll from players, Roll Breakdown hides it too.

Tested with Pathfinder 2e 7.12.2 on Foundry 13 and 8.6.1 on Foundry 14.

### Savage Worlds

* **Trait rolls:** trait die and Wild Die, which die counted, aces, the named modifiers, the target number and the result with its raises. Modifiers that were switched off in the roll dialog are listed as not counted.
* **Rate of fire:** with more than one trait die every kept die is a result of its own, each with its raises, the same way the chat card shows them.
* **Critical failures:** Wild Cards and group rolls fail critically right away. For an Extra the panel shows a possible critical failure until the confirmation die is rolled, and only a 1 on that die confirms it.
* **Damage rolls:** the Strength die and the weapon dice with their aces, armor piercing and heavy weapons.

Initiative in Savage Worlds uses action cards instead of dice, so it gets no breakdown.

Tested with Savage Worlds 5.2.6 on Foundry 13 and 6.0.4 on Foundry 14.

### Other systems

Other systems get a general breakdown of dice and modifiers. Labels and special roll types of those systems may not be recognized. Modules can add support for further systems, see [Adding a system](#adding-a-system).

## Advantage and Disadvantage reasons

When the roll records the reasons, for example with modules such as MidiQOL, the breakdown shows why an attack was rolled with Advantage or Disadvantage.

Typical examples depend on the module stack and include nearby foes, flanking, visibility, stealth, prone targets, long range or similar combat state reasons.

The module does not guess these reasons. It only shows causes the roll actually contains.

## What the panel shows

* **Dice:** every die with its result.
* **Modifiers:** fixed numbers, with their source when the roll names it.
* **Computed terms:** values computed from a formula, such as math functions.
* **Unresolved:** parts whose source the roll does not name. They stay marked instead of getting a guessed label.

The status line at the top tells you how complete the explanation is: *Exact terms*, *Derived terms* or *Partial explanation*.

Names of bonuses from the system or from other modules only appear when the roll itself contains them. Some sources, such as effect names, can therefore still show up as derived or unresolved.

## Settings

* `Language` follows Foundry (including community translations) or uses English or German.
* `Enable roll breakdowns` turns the module on or off for you.
* `Expanded by default` opens the breakdown automatically for new supported messages.
* `Breakdown visibility` is a world setting that decides who sees the panel: `GM only`, `Owners and GM` or `Everyone`. Owners are players who made the roll or own the speaking actor. Existing worlds keep their previous choice.
* `Hide NPC and GM rolls from players` is a world setting and is on by default. Players get no panel on rolls from actors that no player owns or on GM rolls without a speaker owned by a player. This keeps monster bonuses secret. On cards with rolls of several actors, such as the Crucible initiative report or a group check, this applies to each roll.
* `Show unknown terms` keeps unresolved parts visible.
* `Debug logging` writes extra information to the browser console for bug reports.
* `Run self test` (GM) checks the support for your game system, a test roll, the latest roll in the chat and the panel. Run it after every update of Foundry or the system. When a newer version than the tested one is installed, the GM gets a notice once. Macros call it as `game.modules.get("sephrals-roll-breakdown").api.runSelfTest()`.

The gear at the bottom of an open breakdown opens these settings.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Roll Breakdown it holds:

* on how many of the last 30 days the module was used
* how often a breakdown panel is opened, the settings are opened from a panel and the self test runs
* the settings *Breakdown visibility*, *Expanded by default* and *Hide NPC and GM rolls from players* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, chat messages, notes, dice results or other content of the world are sent.

## Adding a system

Other modules can teach the breakdown a new game system, or replace a built-in one, with an adapter. Register it in the `setup` hook or later:

```js
Hooks.once("setup", () => {
  const api = game.modules.get("sephrals-roll-breakdown")?.api;
  api?.registerAdapter("my-system", {
    supportsMessage(message) {
      return message.rolls.length > 0;
    },
    async buildBreakdowns(message) {
      return message.rolls.map((roll) => {
        const breakdown = api.parseRoll(roll);
        breakdown.pills = [{ text: "DC 12" }];
        return breakdown;
      });
    }
  });
});
```

An adapter has two functions:

* `supportsMessage(message)` returns `true` when the chat message has rolls the adapter can explain.
* `buildBreakdowns(message)` returns (or resolves to) a list with one entry per roll that should appear in the panel. An empty list means no panel.

`api.parseRoll(roll)` returns the general breakdown of a roll, a good starting point. Each entry in the list can contain:

* `title`: a heading for this roll, for example the target.
* `formula`, `rollTotal` and `totalStaticModifier`: the formula, the total and the sum of the fixed modifiers.
* `diceTerms`: dice with `expression`, `totalText`, an optional label `sourceLabel` with the explanation `sourceDetail`, extra tags in `notes` and `muted` for dice that did not count.
* `modifiers`: fixed modifiers with `value`, `valueText`, `sourceLabel` and `sourceDetail`.
* `computedTerms` and `unresolvedTerms`: parts of the formula that are computed or not explained.
* `sections`: extra lists with `label`, `placement` (`"top"` above the dice, otherwise below the modifiers) and `items`, each item with `text`, `tag`, `value`, `tooltip` and `muted`.
* `pills`: short facts in the footer, each with `text`, `tooltip` and `emphasis`.

Missing fields are filled with empty values. An adapter that sets `waitForCard: true` gets the chat card only after the system has finished drawing it. An optional `getMessageActor(message)` returns the actor who rolled when the chat message names no speaker, so the visibility settings treat the roll as that actor's roll. `api.getAdapter(systemId)` returns the adapter registered for a system. When an adapter fails, the chat card stays as it is and the error appears in the browser console.

## Help improve the breakdown

I am happy to teach the breakdown new sources when you send concrete examples of missing or wrong labels. It is careful on purpose: an unknown part is better than a wrong label.

Useful reports include:

* The game system and Foundry version
* The module stack, especially modules that change rolls
* A screenshot of the affected chat card

Send them on [Discord](https://discord.gg/7BjCgDYaBP) or open an issue in this repository.
