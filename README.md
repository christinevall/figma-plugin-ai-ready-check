# AI Ready Check · Figma plugin (beta)

A free Figma plugin that checks and fixes your Figma file for AI agents, MCP and dev handoff, step by step. For designers who do not have access to the codebase and want to get the file in order anyway.

It walks you through six stations:

1. **Variables**: primitives and semantics, scopes, code names.
2. **Styles**: a named type scale.
3. **Components**: descriptions, properties, states.
4. **Layers**: tokens applied, auto-layout, names.
5. **Checklist**: what only a person can check, saved in the file for the whole team.
6. **Report**: a plain-text summary for your developers.

Every station explains why it matters, every check has a "?" that says why an agent cares, and most findings come with a one-click fix: bind a raw colour to its token, apply a matching text style, set scopes and code names for all tokens, write a component description from a draft.

Runs entirely on your machine. No AI, no account, no network. It only writes to the file when you click, and every change is one Cmd+Z.

## Install (beta, Figma desktop app)

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it, or clone it.
2. Open the Figma **desktop** app (local plugins cannot be imported in the browser).
3. Menu → **Plugins → Development → Import plugin from manifest…**
4. Pick `ai-ready/manifest.json`.
5. Run it from **Plugins → Development → AI Ready Check**, or simply pick it from the Plugins menu once it is installed.

Try it on a copy of your file first. The checks are heuristics, not a verdict, and this is a beta.

## Feedback

Wrong result, a bug, or an idea? Mail **hello@moonlearning.io**. A screenshot of the check that was wrong, and what you expected, is the most useful thing you can send.

## What is in here

- `ai-ready/` – the plugin: `manifest.json`, `code.js` (the audit and every fix), `ui.html` (the panel). Plain JavaScript, no build step. Details in [ai-ready/README.md](ai-ready/README.md).
- `tests/` – `node tests/run.js` runs the audit against fixture files with a small stand-in for the Figma API.
- `docs/` – cover and icon.

## Licence

Free to use, not to redistribute, provided as is without warranty. See [LICENSE](LICENSE). Not affiliated with Figma.

Made by [Christine Vallaure](https://moonlearning.io), moonlearning.io.
