# Sephral's Roll Breakdown

Sephral's Roll Breakdown adds a compact explanation panel to supported roll chat messages in FoundryVTT.

## Features

- Compact breakdown panel rendered directly inside eligible chat messages
- Separate display for dice terms, static modifiers, derived terms, and unresolved terms
- Honest classification of complex roll parts without guessing hidden sources
- Client-side settings for visibility, default expansion, and debug logging
- Cross-version support for Foundry VTT v13 and v14
- Generic parser foundation for future system-specific source mapping

## Usage

1. Enable the module in Foundry.
2. Trigger any supported roll chat message.
3. Open the `Breakdown` section on the chat card to inspect dice, modifiers, and unresolved terms.

## Current behavior and limits

- The module reads existing roll data from `message.rolls` and `roll.terms`.
- Static numeric terms are summarized directly.
- Computed terms such as math functions are shown as derived instead of being mislabeled.
- Symbolic or opaque terms remain marked as unknown or unresolved when no reliable source is available.
- Modifier names from systems or third-party modules are only shown when they are explicitly present in the roll data.

This keeps the output technically honest, but it also means some bonus sources such as effect names or module-provided context may still appear as generic derived or unknown terms until dedicated system adapters are added.

## Settings

- `Enable roll breakdowns` enables the module on the current client.
- `Expanded by default` opens the breakdown automatically for new supported messages.
- `Visible to players` allows non-GM users to see the breakdown panel.
- `Show unknown terms` keeps unresolved or unlabeled terms visible.
- `GM-only preview` hides the panel from players while testing.
- `Debug logging` writes parser and rendering decisions to the browser console.

## Validation

Run these commands from the module folder:

```bash
npm run check
npm run check:manifest
npm run release:prepare
```

## License

This module is free to use with Foundry Virtual Tabletop.

You may use it in private games, online games, streamed games, community games,
and games run by paid Game Masters.

GitHub forks are welcome for personal use, issue reproduction, private changes,
and pull requests.

Please do not redistribute, repackage, sell, publish unofficial releases, or
upload modified installable versions without permission.

Future versions, premium editions, or related modules may become paid products.
