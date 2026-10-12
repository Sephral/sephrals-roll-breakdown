# Sephral's Roll Breakdown Manual

This manual covers the details. For a quick overview see the [README](README.md).

## How to use it

1. Enable the module in Foundry.
2. Roll as usual.
3. Open the `Breakdown` section on the chat card to see dice, modifiers and the other parts of the formula.
4. For D&D 5e attack rolls, the top of the panel lists the reasons for Advantage or Disadvantage when the roll contains them.

An opened panel stays open when the chat card updates or the chat log redraws. Rolls with nothing meaningful to explain get no panel.

## Supported systems

Roll Breakdown works best with D&D 5e, where it can name the sources of most bonuses.

Supported D&D 5e rolls:

* Attack rolls
* Damage rolls
* Saving throws
* Ability checks
* Skill checks
* Tool checks
* Concentration saves
* Death saves

When a chat card holds an attack roll and a damage roll, each of them gets its own breakdown.

Chat cards can still differ by system version, activity type and automation modules, so not every bonus can always be named.

Other systems get a general breakdown of dice and modifiers. Labels and special roll types of those systems may not be recognized.

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
* `Hide NPC and GM rolls from players` is a world setting and is on by default. Players get no panel on rolls from actors that no player owns or on GM rolls without a speaker owned by a player. This keeps monster bonuses secret.
* `Show unknown terms` keeps unresolved parts visible.
* `Debug logging` writes extra information to the browser console for bug reports.

## Help improve the breakdown

I am happy to teach the breakdown new sources when you send concrete examples of missing or wrong labels. It is careful on purpose: an unknown part is better than a wrong label.

Useful reports include:

* The game system and Foundry version
* The module stack, especially modules that change rolls
* A screenshot of the affected chat card

Send them on [Discord](https://discord.gg/7BjCgDYaBP) or open an issue in this repository.
