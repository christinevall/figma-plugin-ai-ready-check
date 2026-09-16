# AI Ready Check · a plugin by Christine Vallaure, moonlearning.io

A Figma plugin that walks a designer through making a file readable for AI agents, step by step. It is for people who do not have access to the codebase and want to get their Figma file in order anyway: primitives and semantics, scopes, code names, descriptions, states, tokens on layers, and a checklist for what only a person can check.

It runs entirely on your machine. No AI, no account, no network. It only writes to the file when you click Apply.

## The seven steps

| # | Step | What it checks | What it can fix for you |
|---|---|---|---|
| ○ | **Overview** | One score, "start here" top 3, a card per step | |
| 1 | **Variables** (file-wide) | Primitives and semantics in separate collections · semantic tokens named for their use · scopes set · code syntax (Web) set · descriptions on semantic tokens · primitives hidden from publishing · modes named · one naming style | Apply suggested scopes (one or all) · apply suggested code names (one or all, editable) · write descriptions · rename tokens · hide a whole primitive collection |
| 2 | **Styles** (file-wide) | Text styles exist · styles built from type variables · style descriptions | Write descriptions |
| 3 | **Components** (scoped) | Description present and rich · property names not default · variant values not "Variant2" · interactive components carry states · docs link · auto-layout · no hidden layers | Description editor with a draft (also for the current selection) · rename properties · add docs links · annotations on non-components |
| 4 | **Layers** (scoped) | Fills and strokes bound to variables or styles · semantic tokens instead of primitives · text uses a style · radius, padding and gap bound · auto-layout · meaningful names · text contrast (not scored) | Bind a colour to a matching variable (semantic preferred) · rebind a primitive to its semantic alias · apply a matching text style · bind radius and spacing · rename layers |
| 5 | **Checklist** | 22 items no plugin can check: names match code, docs rules, states, accessibility, agent reach, the fresh-agent test | Ticks are saved in the file with the name of who ticked, so the team shares one list |
| 6 | **Report** | Plain-text summary of scores, open findings and checklist | Copy to clipboard |

Every step opens with **Why this matters**, and every check has a **?** that explains why an agent cares. The aim is that a beginner can go through the file once and understand each concept while fixing it.

## Scoring

Variables 30 · Styles 10 · Components 30 · Layers 30. Each step is the average of its checks' pass ratios; a check with nothing to measure is skipped. Contrast is reported but never scored. The checklist is shown as "n of 22", separately.

## How matching works

- **Colours**: every local colour variable is resolved through its aliases, per mode, and indexed by hex and alpha. A raw fill with the same value gets the matching variables offered, semantic ones first, hidden primitives last.
- **Numbers**: the same for radius, padding and gap, preferring variables scoped to Radius or Gap.
- **Text**: local text styles indexed by family, style and size. An exact match is offered.
- **Scopes**: suggested from the variable name (text → Text fill, border → Stroke, radius → Corner radius, space → Gap, and so on). Check a few before applying to all.
- **Code names**: `--` plus the kebab-cased Figma name, with `color-` prefixed for colours that lack it. Edit them to match what the developers use.
- **Naming examples** in the plugin follow category / property / variant, as in the W3C token format and the sample system: primitives `color/blue/500`, `space/4`; semantics `color/background/brand`, `color/content/muted`, `color/border/subtle`. The checks do not enforce this pattern; they only flag semantic names that read like values (a hue word or a numeric step).
- **Skipped on purpose**: component-set frames and sections. Their stroke, radius and spacing are Figma's own container defaults, not design.

**Files that use a published library** (most product files): variables from enabled team libraries are read as well. Layers bound to them count as tokenised, and they are offered as matches in the Layers step, including semantic tokens whose primitives are hidden from publishing. The Variables station only checks local variables, because scopes, code names and descriptions are set in the library file; a note there names the libraries in use. The plugin never writes to a library.

## Tests

`node tests/run.js` from the `AI Ready Checker` folder. `tests/mock-figma.js` is a small stand-in for the Plugin API; `tests/run.js` builds fixture files (primitives, semantics, styles, a Button set) and checks what the audit flags: detached text styles, raw colours, primitives bound directly, radius and spacing, auto-layout, default names, descriptions, property names, variant values, hidden layers, scopes, code names, modes, contrast, scope handling. Add a case whenever a real file shows something the checker missed.

**In plain words:** the tests are a set of small fake Figma files with known problems built in, such as a label whose text style was removed, a fill with a raw hex colour, a token that is not scoped. The checker runs over them, and the test confirms it reports exactly those problems and nothing else. So when a rule changes, we know within seconds whether it still catches what it should, and whether it now flags something it should not. If you find a case the plugin gets wrong in a real file, that case becomes a new test before the rule is fixed.

## Install (Figma desktop app)

1. Figma desktop → **Plugins → Development → Import plugin from manifest…**
2. Pick `manifest.json` in this folder.
3. Run it from **Plugins → Development → AI Ready Check**.

While iterating, turn on **Plugins → Development → Hot reload plugin** once.

## Files

- `manifest.json` – `documentAccess: dynamic-page`, `networkAccess: none`, `permissions: ["currentuser", "teamlibrary"]` (the first labels checklist ticks with a name, the second reads variables from enabled libraries; nothing leaves the file).
- `code.js` – the audit, the matching indexes and every fix. Plain JavaScript, no build step.
- `ui.html` – the panel: stepper, explanations, rows with actions, checklist, report. Inline CSS and JS.

## What this deliberately does not do

- No AI and no network. Figma's review guidelines reject plugins that add an AI chat or expose an MCP server, and a checker should not need either.
- No silent changes. Every write is one explicit click, and batch actions say how many items they touch.
- No renaming by guesswork. Layer, property and token names are typed by you; the plugin only suggests scopes and code names, which follow from the existing name.
- No cross-file work. Library variables from other files are read-only through the API.

## Security notes

- Every message from the panel is validated in `code.js` before it touches the file: ids must be strings, names and code syntax are capped at 200 characters, descriptions at 5000, scopes and spacing fields must come from an allow-list, paint indexes must be integers, batches are capped at 500 items.
- External links open only for `moonlearning.io` and YouTube, and only over https. Everything else is dropped.
- Everything read from the file (layer names, variable names, descriptions) is HTML-escaped before it is rendered in the panel. No `eval`, no `innerHTML` with raw file content, no remote scripts.
- The only stored data is the checklist, as plugin data in the user's own file, with the name of who ticked.
- Team library access is read-only: variables from enabled libraries are imported into the plugin's memory to match raw values against tokens. Nothing in a library is changed.

## Legal and privacy

- **Licence:** see `LICENSE.txt`. Copyright Christine Vallaure. Free to use, not to redistribute, provided as is without warranty. Switch to MIT if you want the code reusable; the MIT warranty disclaimer gives the same liability protection.
- **Disclaimer in the product:** the start screen says results are heuristics, every change is undoable with Cmd+Z, work on a copy if the file matters, provided as is. Same wording in the listing.
- **Personal data (GDPR):** the plugin processes no personal data on the author's side. The only personal datum it touches is the current user's Figma display name, which it stores as plugin data inside the user's own file to show who ticked a checklist item. That data stays in the customer's file, in Figma's infrastructure, under the customer's existing Figma terms; the author never receives it, so the author is not a controller. The checklist screen says so in plain words. No cookies, no analytics, no network.
- **Impressum:** the listing links to moonlearning.io, which carries the Impressum and contact details required for an EU-based publisher. Support contact in the listing is the same address.
- **Figma:** publishing accepts Figma's Creator Agreement and Community terms. The plugin uses only the official Plugin API, no proposed APIs. Not affiliated with or endorsed by Figma, Inc.

Made by Christine Vallaure, moonlearning.io. Not affiliated with Figma.
