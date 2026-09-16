// AI Ready · a plugin by moonlearning.io
// Walks a designer through making a Figma file readable for AI agents, step by step:
// variables, styles, components, layers, and a checklist for what only a person can check.
// Runs entirely on this machine. No AI, no network, nothing leaves the file.
// It only writes to the file when the user clicks an Apply button.

var WIN = { w: 440, h: 720 };
figma.showUI(__html__, { width: WIN.w, height: WIN.h, themeColors: false });

var CHECKLIST_KEY = 'ai-ready-checklist-v1';

var DEFAULT_NAME = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Polygon|Star|Union|Subtract|Intersect|Exclude|Slice|Image|Component|Instance|Text|Section|Boolean group)(\s+\d+)?$/i;
var DEFAULT_PROP = /^(Property\s*\d*|Boolean\s*\d*|Instance\s*\d*|Variant\s*\d+|Text\s*\d+)$/i; // only Figma's auto-generated names; bare "variant" or "text" can be real prop names
var DEFAULT_VALUE = /^Variant\s*\d+$/i;
var DEFAULT_MODE = /^(Mode|Value)\s*\d*$/i;
var HUE_WORD = /(^|[\/\-_ .])(blue|red|green|gray|grey|neutral|orange|yellow|purple|pink|teal|slate|zinc|stone|amber|lime|emerald|cyan|sky|indigo|violet|fuchsia|rose|brown|magenta)([\/\-_ .]|$)/i;
var STEP_NUMBER = /(^|[\/\-_ .])\d{2,4}$/;
var INTERACTIVE = /button|btn|cta|input|field|textbox|checkbox|radio|toggle|switch|select|dropdown|combobox|tab|link|chip|slider|menu|item|accordion|pagination|stepper/i;
var STATE_AXIS = /state|status|interaction/i;
var STATE_PROP = /disabled|hover|focus|pressed|active|selected|checked|loading/i;

function isEmpty(s) { return !s || !String(s).trim(); }
function readableName(key) { return String(key).split('#')[0]; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function visiblePaints(p) {
  if (!p || p === figma.mixed || !Array.isArray(p)) return [];
  return p.filter(function (x) { return x && x.visible !== false; });
}
function hexOf(c) {
  function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? '0' + s : s; }
  return '#' + h(c.r) + h(c.g) + h(c.b);
}
function colorKey(c, opacity) {
  var a = (c && typeof c.a === 'number') ? c.a : 1;
  if (typeof opacity === 'number') a = a * opacity;
  return hexOf(c) + '@' + Math.round(a * 100);
}
function kebab(s) {
  return String(s).toLowerCase().replace(/[\/\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function componentProps(node) {
  var props = [], variants = [], keys = [];
  try {
    var defs = node.componentPropertyDefinitions;
    if (defs) Object.keys(defs).forEach(function (k) {
      var d = defs[k], nm = readableName(k);
      keys.push({ key: k, name: nm, type: d.type });
      if (d.type === 'VARIANT') variants.push({ name: nm, values: (d.variantOptions || []) });
      else props.push(nm);
    });
  } catch (e) {}
  return { props: props, variants: variants, keys: keys };
}
// WCAG contrast (colors are 0..1 in the Figma API)
function _chan(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function _lum(col) { return 0.2126 * _chan(col.r) + 0.7152 * _chan(col.g) + 0.0722 * _chan(col.b); }
function contrastRatio(a, b) { var l1 = _lum(a), l2 = _lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function firstOpaqueSolid(paints) {
  var v = visiblePaints(paints);
  for (var i = v.length - 1; i >= 0; i--) {
    if (v[i].type === 'SOLID' && (v[i].opacity == null || v[i].opacity >= 0.95)) return v[i].color;
  }
  return null;
}
function hasAncestorOfType(node, type) {
  var p = node.parent;
  while (p && p.type !== 'PAGE' && p.type !== 'DOCUMENT') { if (p.type === type) return true; p = p.parent; }
  return false;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
async function collectScope(scope) {
  var roots = [];
  if (scope === 'file') { await figma.loadAllPagesAsync(); roots = figma.root.children.slice(); }
  else if (scope === 'page') { roots = [figma.currentPage]; }
  else {
    var sel = figma.currentPage.selection;
    if (sel.length === 0) return { error: 'empty-selection' };
    roots = sel.slice();
  }
  var all = [], seen = {};
  function visit(n) {
    if (!n || seen[n.id]) return; seen[n.id] = true; all.push(n);
    if ('children' in n && n.children) for (var i = 0; i < n.children.length; i++) visit(n.children[i]);
  }
  for (var r = 0; r < roots.length; r++) visit(roots[r]);
  // A set's variants are COMPONENTs too; the set carries the description.
  var components = all.filter(function (n) {
    if (n.type === 'COMPONENT_SET') return true;
    if (n.type === 'COMPONENT') return !(n.parent && n.parent.type === 'COMPONENT_SET');
    return false;
  });
  return { all: all, components: components };
}

// ---------------------------------------------------------------------------
// Variables: load, classify, index for matching
// ---------------------------------------------------------------------------
function suggestScopes(v) {
  var n = v.name.toLowerCase(), t = v.type || v.resolvedType;
  if (t === 'COLOR') {
    if (/text|content|fg|foreground|\bon[-\/_ ]|label|heading|body/.test(n)) return ['TEXT_FILL'];
    if (/border|stroke|outline|divider|ring/.test(n)) return ['STROKE_COLOR'];
    if (/icon/.test(n)) return ['SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
    if (/bg|background|surface|fill|canvas|overlay/.test(n)) return ['FRAME_FILL', 'SHAPE_FILL'];
    return ['ALL_FILLS', 'STROKE_COLOR'];
  }
  if (t === 'FLOAT') {
    if (/radius|corner|round/.test(n)) return ['CORNER_RADIUS'];
    if (/space|spacing|gap|padding|inset|margin/.test(n)) return ['GAP'];
    if (/font[-\/_ ]?size|text[-\/_ ]?size|type[-\/_ ]?size/.test(n)) return ['FONT_SIZE'];
    if (/line[-\/_ ]?height|leading/.test(n)) return ['LINE_HEIGHT'];
    if (/letter|tracking/.test(n)) return ['LETTER_SPACING'];
    if (/weight/.test(n)) return ['FONT_WEIGHT'];
    if (/opacity|alpha/.test(n)) return ['OPACITY'];
    if (/stroke|border/.test(n)) return ['STROKE_FLOAT'];
    if (/size|width|height|icon|dimension/.test(n)) return ['WIDTH_HEIGHT'];
    return ['GAP', 'WIDTH_HEIGHT'];
  }
  if (t === 'STRING') {
    if (/family|font/.test(n) && !/style|weight/.test(n)) return ['FONT_FAMILY'];
    if (/style|weight/.test(n)) return ['FONT_STYLE'];
    return ['TEXT_CONTENT'];
  }
  return null;
}
function suggestSyntax(v) {
  var k = kebab(v.name);
  if ((v.type || v.resolvedType) === 'COLOR' && !/^colou?r/.test(k)) k = 'color-' + k;
  return '--' + k;
}
function looksPrimitiveName(name) {
  return STEP_NUMBER.test(name) || HUE_WORD.test(name) || /#[0-9a-f]{3,8}/i.test(name);
}
function nameStyle(name) {
  var last = String(name).split('/').pop();
  if (/\s/.test(last)) return 'spaces';
  if (/[A-Z]/.test(last) && /[a-z]/.test(last) && !/[-_]/.test(last)) return 'camel';
  if (/_/.test(last)) return 'snake';
  if (/-/.test(last)) return 'kebab';
  return 'plain';
}

var LIBRARY_IMPORT_CAP = 1500; // variables read from enabled libraries, at most

async function loadVariables() {
  var cols = [], vars = [];
  try { cols = await figma.variables.getLocalVariableCollectionsAsync(); } catch (e) {}
  try { vars = await figma.variables.getLocalVariablesAsync(); } catch (e) {}
  var localIds = {}; vars.forEach(function (v) { localIds[v.id] = true; });

  // Variables from enabled team libraries, read-only. They are what a product file binds to,
  // so they must count as tokens and serve as match candidates for the one-click fixes.
  var libraries = [], libVars = [];
  try {
    var libCols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (var lc = 0; lc < libCols.length && libVars.length < LIBRARY_IMPORT_CAP; lc++) {
      var col = libCols[lc], lib = { name: col.name, libraryName: col.libraryName, key: col.key, count: 0 };
      try {
        var list = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(col.key);
        for (var li = 0; li < list.length && libVars.length < LIBRARY_IMPORT_CAP; li++) {
          try { var iv = await figma.variables.importVariableByKeyAsync(list[li].key); if (iv && !localIds[iv.id]) { libVars.push(iv); lib.count++; } } catch (e) {}
        }
      } catch (e) {}
      libraries.push(lib);
    }
  } catch (e) {}

  var byId = {}, colById = {};
  vars.forEach(function (v) { byId[v.id] = v; });
  libVars.forEach(function (v) { byId[v.id] = v; });
  cols.forEach(function (c) { colById[c.id] = c; });
  // Alias targets can sit in a library (often hidden primitives). Fetch them so semantic
  // library tokens resolve to a value and can be matched against raw values.
  for (var pass = 0; pass < 3; pass++) {
    var missing = {};
    Object.keys(byId).forEach(function (id) { var v = byId[id]; Object.keys(v.valuesByMode || {}).forEach(function (m) { var val = v.valuesByMode[m]; if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS' && !byId[val.id]) missing[val.id] = true; }); });
    var ids = Object.keys(missing); if (!ids.length) break;
    for (var mi = 0; mi < ids.length; mi++) { try { var tv = await figma.variables.getVariableByIdAsync(ids[mi]); if (tv) byId[tv.id] = tv; } catch (e) {} }
  }
  // collections of library variables are not local; look them up on demand
  var extraCols = {};
  async function colOf(v) { if (colById[v.variableCollectionId]) return colById[v.variableCollectionId]; if (extraCols[v.variableCollectionId] !== undefined) return extraCols[v.variableCollectionId]; var c = null; try { c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId); } catch (e) {} extraCols[v.variableCollectionId] = c; return c; }
  var allKnown = Object.keys(byId).map(function (id) { return byId[id]; });
  for (var ai = 0; ai < allKnown.length; ai++) { var cc = await colOf(allKnown[ai]); if (cc && !colById[cc.id]) colById[cc.id] = cc; }

  function resolveValue(v, modeId, depth) {
    var val = v.valuesByMode[modeId];
    if (val === undefined) { var c0 = colById[v.variableCollectionId]; if (c0) val = v.valuesByMode[c0.defaultModeId]; }
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
      var t = byId[val.id]; if (!t || depth > 12) return null;
      var tc = colById[t.variableCollectionId];
      var m = (t.valuesByMode[modeId] !== undefined) ? modeId : (tc ? tc.defaultModeId : null);
      return m ? resolveValue(t, m, depth + 1) : null;
    }
    return val;
  }
  var info = {}, aliasTargets = {}; // aliasTargets[primitiveId] -> [semantic var ids]
  vars.concat(libVars).forEach(function (v) {
    var col = colById[v.variableCollectionId];
    var isAlias = false, targets = [];
    Object.keys(v.valuesByMode).forEach(function (m) {
      var val = v.valuesByMode[m];
      if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') { isAlias = true; targets.push(val.id); }
    });
    var web = '';
    try { web = (v.codeSyntax && v.codeSyntax.WEB) || ''; } catch (e) {}
    info[v.id] = {
      id: v.id, name: v.name, type: v.resolvedType, collectionId: v.variableCollectionId,
      collectionName: col ? col.name : '', isAlias: isAlias, targets: targets,
      scopes: v.scopes ? v.scopes.slice() : [], codeSyntax: web,
      description: v.description || '', hidden: !!v.hiddenFromPublishing, remote: !localIds[v.id]
    };
    targets.forEach(function (t) { if (!aliasTargets[t]) aliasTargets[t] = []; if (aliasTargets[t].indexOf(v.id) < 0) aliasTargets[t].push(v.id); });
  });
  // classify collections
  var collections = cols.map(function (c) {
    var ids = c.variableIds || [], alias = 0, raw = 0, types = {};
    ids.forEach(function (id) { var i = info[id]; if (!i) return; if (i.isAlias) alias++; else raw++; types[i.type] = (types[i.type] || 0) + 1; });
    var kind = ids.length === 0 ? 'empty' : (alias >= raw ? 'semantic' : 'primitive');
    if (ids.length > 0 && alias > 0 && raw > 0 && Math.min(alias, raw) / ids.length > 0.3) kind = 'mixed';
    return { id: c.id, name: c.name, count: ids.length, alias: alias, raw: raw, kind: kind, types: types,
      modes: (c.modes || []).map(function (m) { return { id: m.modeId, name: m.name }; }), hiddenCount: ids.filter(function (id) { return info[id] && info[id].hidden; }).length };
  });
  var kindOf = {}; collections.forEach(function (c) { kindOf[c.id] = c.kind; });
  // library collections: classify by their own variables (alias-heavy = semantic)
  var libColStats = {};
  Object.keys(info).forEach(function (id) { var i = info[id]; if (!i.remote) return; var st = libColStats[i.collectionId] || (libColStats[i.collectionId] = { a: 0, r: 0 }); if (i.isAlias) st.a++; else st.r++; });
  Object.keys(libColStats).forEach(function (cid) { var st = libColStats[cid]; kindOf[cid] = st.a >= st.r ? 'semantic' : 'primitive'; });
  Object.keys(info).forEach(function (id) { info[id].collectionKind = kindOf[info[id].collectionId] || 'empty'; info[id].semantic = info[id].isAlias || info[id].collectionKind === 'semantic'; });

  // indexes for matching layers to variables
  var colorIndex = {}, floatIndex = {};
  vars.concat(libVars).forEach(function (v) {
    var i = info[v.id]; if (!i) return;
    var col = colById[v.variableCollectionId]; if (!col) return;
    (col.modes || []).forEach(function (m) {
      var val = resolveValue(v, m.modeId, 0); if (val === null || val === undefined) return;
      if (v.resolvedType === 'COLOR' && typeof val === 'object' && 'r' in val) {
        var k = colorKey(val); if (!colorIndex[k]) colorIndex[k] = [];
        if (!colorIndex[k].some(function (x) { return x.id === v.id; })) colorIndex[k].push({ id: v.id, name: v.name, semantic: i.semantic, hidden: i.hidden, scopes: i.scopes });
      } else if (v.resolvedType === 'FLOAT' && typeof val === 'number') {
        var fk = String(Math.round(val * 100) / 100); if (!floatIndex[fk]) floatIndex[fk] = [];
        if (!floatIndex[fk].some(function (x) { return x.id === v.id; })) floatIndex[fk].push({ id: v.id, name: v.name, semantic: i.semantic, hidden: i.hidden, scopes: i.scopes });
      }
    });
  });
  var hasSemanticColors = Object.keys(info).some(function (id) { return info[id].type === 'COLOR' && info[id].semantic; });
  return { info: info, collections: collections, colorIndex: colorIndex, floatIndex: floatIndex, aliasTargets: aliasTargets, hasSemanticColors: hasSemanticColors, count: vars.length, libraries: libraries.filter(function (l) { return l.count > 0; }), libraryCount: libVars.length };
}
function rankCandidates(list, wantScope) {
  if (!list) return [];
  return list.slice().sort(function (a, b) {
    function s(x) {
      var sc = 0;
      if (x.semantic) sc += 4;
      if (!x.hidden) sc += 2;
      if (wantScope && x.scopes && (x.scopes.indexOf(wantScope) >= 0 || x.scopes.indexOf('ALL_SCOPES') >= 0 || (wantScope === 'FRAME_FILL' && x.scopes.indexOf('ALL_FILLS') >= 0) || (wantScope === 'TEXT_FILL' && x.scopes.indexOf('ALL_FILLS') >= 0) || (wantScope === 'SHAPE_FILL' && x.scopes.indexOf('ALL_FILLS') >= 0))) sc += 1;
      return sc;
    }
    return s(b) - s(a);
  }).slice(0, 6).map(function (x) { return { id: x.id, name: x.name, semantic: x.semantic }; });
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------
async function runAudit(scope) {
  var scoped = await collectScope(scope);
  if (scoped.error) return scoped;
  var all = scoped.all, components = scoped.components;
  var V = await loadVariables();
  var textStyles = [];
  try { textStyles = await figma.getLocalTextStylesAsync(); } catch (e) {}
  // Styles from libraries are not local, but the layers that use them carry the style id. Count those too,
  // so a file built on a shared library is not treated as "no text styles".
  var remoteStyles = [], seenStyle = {};
  textStyles.forEach(function (s) { seenStyle[s.id] = true; });
  for (var si = 0; si < all.length; si++) {
    var tn = all[si]; if (tn.type !== 'TEXT') continue;
    var sid = null; try { sid = tn.textStyleId; } catch (e) {}
    if (!sid || sid === figma.mixed || seenStyle[sid]) continue; seenStyle[sid] = true;
    try { var rs = await figma.getStyleByIdAsync(sid); if (rs && rs.type === 'TEXT') remoteStyles.push(rs); } catch (e) {}
  }
  var allTextStyles = textStyles.concat(remoteStyles);
  var styleIndex = {};
  allTextStyles.forEach(function (s) {
    try { var k = s.fontName.family + '|' + s.fontName.style + '|' + s.fontSize; if (!styleIndex[k]) styleIndex[k] = []; styleIndex[k].push({ id: s.id, name: s.name + (s.remote ? ' (library)' : '') }); } catch (e) {}
  });

  function mkCheck(key, label, severity, why, fix, opts) {
    var c = { key: key, label: label, severity: severity, why: why, fix: fix, pass: 0, total: 0, items: [], scored: severity !== 'note' };
    if (opts) Object.keys(opts).forEach(function (k) { c[k] = opts[k]; });
    return c;
  }
  function P(c) { c.pass++; c.total++; }
  function F(c, item) { c.total++; c.items.push(item); }
  function nodeItem(n, extra) { var it = { kind: 'node', id: n.id, name: n.name, nodeType: n.type }; if (extra) Object.keys(extra).forEach(function (k) { it[k] = extra[k]; }); return it; }
  function varItem(v, extra) { var it = { kind: 'variable', id: v.id, name: v.name, collection: v.collectionName, type: v.type }; if (extra) Object.keys(extra).forEach(function (k) { it[k] = extra[k]; }); return it; }

  // ---------------- Step 1: Variables (file-wide) ----------------
  var vSplit = mkCheck('split', 'Primitives and semantics are separate', 'warn',
    'Primitives are the raw palette: color/blue/500, space/4. Semantics say what a value is for: color/background/brand, space/inset/md. Semantic tokens point to primitives (an alias). An agent that reads color/background/brand knows the intent and can map it to the code token of the same name. A raw color/blue/500 on a layer tells it nothing about why.',
    'Create one collection for primitives (raw values) and one for semantics (aliases to primitives). Layers use semantics only.', { unit: 'collection' });
  var vNaming = mkCheck('semantic-naming', 'Semantic tokens are named for their use', 'warn',
    'A semantic token named blue/500 is a primitive with extra steps. Name it for what it does, category / property / variant: color/background/brand, color/content/muted, color/border/subtle. Then dark mode, a rebrand, or an agent mapping to code only touches the alias, never the name.',
    'Rename the token after its role (background, content, border, icon + emphasis or state), not after its colour or size. Primitives keep their value names.', { unit: 'variable' });
  var vStyle = mkCheck('naming-style', 'One naming style everywhere', 'info',
    'Agents match names literally. If half your tokens use spaces and half use dashes, a lookup for "space-md" misses "Space md". One convention, all the way down, makes every name predictable.',
    'Pick one style (kebab-case is the common one in code) and stick to it in every collection.', { unit: 'variable' });
  var vScopes = mkCheck('scopes', 'Semantic tokens are scoped', 'warn',
    'A scope limits where a variable shows up: text colours in the text picker, radius values in the radius field. Without scopes every picker lists everything, which makes wrong bindings easy. For an agent, a scope is a strong hint of the token\'s role. Primitives are left out here: they stay hidden and unscoped, and the semantic tokens that point at them carry the scope.',
    'Set each semantic token\'s scope in the variable panel (Local variables → Edit variable → Scoping), or apply the suggestion here.', { unit: 'variable', batch: 'scopes' });
  var vSyntax = mkCheck('code-syntax', 'Semantic tokens have a code name', 'warn',
    'The code syntax field is where Figma stores the name your token has in code. Dev Mode shows it, and an agent reading the file over MCP gets it with the variable, so it can type the real name instead of guessing a translation. If your tokens live in JSON, the Figma name already mirrors the path (color/background/brand is color.background.brand). What an agent cannot guess is what a developer actually types: the generated CSS variable with its prefix, like --sds-color-background-brand. Put that here. Primitives are skipped: code should reference semantic tokens only.',
    'Ask your developers for the token names and enter them under Code syntax → Web. If there is no code yet, the suggested name follows the Figma name.', { unit: 'variable', batch: 'syntax', passed: [], passedLabel: 'Figma name → code name', caveat: 'This only checks that the field is filled. Whether the names match the code, only a developer can tell: checklist item "Variables carry the code token names".' });
  var vDesc = mkCheck('var-desc', 'Semantic tokens have a description', 'info',
    'A description says when to use a token: "Default page background. Not for cards." A name alone cannot carry that rule. Agents copy what they find, so the rule in the description is what keeps them from using the wrong token.',
    'Add a one-line description to each semantic token: what it is for, and what it is not for.', { unit: 'variable', caveat: 'This only checks that a description exists, not what it says. Pattern: what it is for, then what it is not for. Example for color/content/muted: "Secondary text: captions and helper text. Not for body copy." The Draft button writes a starting point from the name; it will be wrong where your tokens mean something else.' });
  var vHidden = mkCheck('hide-primitives', 'Primitives are hidden from publishing', 'info',
    'When primitives are hidden from publishing, designers and agents working from the published library only see semantic tokens. That makes the right choice the only choice. The primitives still exist and still feed the semantics. They do not need scopes either: the semantic tokens that point at them carry the scope.',
    'In the variable panel, select all primitives and choose "Hide from publishing". Or hide a whole collection here.', { unit: 'variable' });
  var vModes = mkCheck('modes', 'Modes are named', 'info',
    'A mode called "Mode 1" says nothing. "Light" and "Dark", or "Compact" and "Comfortable", tell an agent what switching it means and how to map it to a theme in code.',
    'Rename modes in the collection header of the variable panel.', { unit: 'collection' });

  var colorCols = V.collections.filter(function (c) { return c.count > 0; });
  var noSemantics = !V.collections.some(function (c) { return c.kind === 'semantic' || c.kind === 'mixed'; });
  if (noSemantics && V.count > 0) { vSyntax.label = 'Variables have a code name'; vScopes.label = 'Variables are scoped'; vScopes.caveat = 'This file has no semantic layer yet, so its raw variables are what layers bind to. Scope them now; when you add semantic tokens, the scopes move there and the primitives can stay unscoped and hidden.'; }
  if (colorCols.length) {
    var hasPrim = colorCols.some(function (c) { return c.kind === 'primitive'; }), hasSem = colorCols.some(function (c) { return c.kind === 'semantic'; });
    colorCols.forEach(function (c) {
      var ok = c.kind !== 'mixed' && (hasPrim && hasSem || (c.kind === 'semantic'));
      if (c.kind === 'mixed') F(vSplit, { kind: 'collection', id: c.id, name: c.name, note: c.alias + ' aliases and ' + c.raw + ' raw values in one collection' });
      else if (!ok) F(vSplit, { kind: 'collection', id: c.id, name: c.name, note: c.kind === 'primitive' ? 'Only raw values, and no semantic collection points at them' : 'Semantic collection without a primitive one' });
      else P(vSplit);
      var badModes = c.modes.filter(function (m) { return DEFAULT_MODE.test(m.name); });
      if (c.modes.length > 1 && badModes.length) F(vModes, { kind: 'collection', id: c.id, name: c.name, note: 'Modes: ' + c.modes.map(function (m) { return m.name; }).join(', ') });
      else P(vModes);
    });
  }
  var styleCounts = {}, styleTotal = 0;
  Object.keys(V.info).forEach(function (id) {
    var v = V.info[id]; if (v.remote) return; // library tokens are checked in the library file, not here
    var st = nameStyle(v.name); styleCounts[st] = (styleCounts[st] || 0) + 1; styleTotal++;
    if (v.semantic && v.type === 'COLOR') {
      if (looksPrimitiveName(v.name)) F(vNaming, varItem(v, { note: 'Reads like a raw value' })); else P(vNaming);
    }
    if (v.type !== 'BOOLEAN') {
      if (v.semantic || noSemantics) {
        var sug = suggestScopes(v);
        if ((!v.scopes.length || v.scopes.indexOf('ALL_SCOPES') >= 0) && sug) F(vScopes, varItem(v, { suggest: sug })); else P(vScopes);
      }
      if (v.semantic || noSemantics) {
        if (!v.codeSyntax) F(vSyntax, varItem(v, { suggest: suggestSyntax(v) })); else { P(vSyntax); if (vSyntax.passed.length < 300) vSyntax.passed.push({ name: v.name, value: v.codeSyntax }); }
      }
    }
    if (v.semantic) { if (isEmpty(v.description)) F(vDesc, varItem(v)); else P(vDesc); }
    else if (V.hasSemanticColors || V.collections.some(function (c) { return c.kind === 'semantic'; })) { if (v.hidden) P(vHidden); else F(vHidden, varItem(v, { collectionId: v.collectionId })); }
  });
  if (styleTotal >= 6) {
    var styles = Object.keys(styleCounts).filter(function (k) { return styleCounts[k] / styleTotal > 0.15; });
    if (styles.length > 1) { F(vStyle, { kind: 'note', id: 'style', name: 'Mixed styles: ' + styles.map(function (k) { return k + ' (' + styleCounts[k] + ')'; }).join(', ') }); }
    else P(vStyle);
  }
  var stepVariables = { key: 'variables', label: 'Variables', weight: 30,
    what: 'Variables are the tokens an agent maps to code. This step checks whether they are split into primitives and semantics, named for their use, scoped, and carry their code name.',
    note: V.libraries.length ? ('This file uses ' + V.libraryCount + ' variables from ' + V.libraries.map(function (l) { return l.libraryName; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') + '. Scopes, code names and descriptions are set in the library file: open it and run the check there. Library tokens still count as tokens on your layers, and they are offered as matches in the Layers step.') : 'Variables belong to the whole file, so this step ignores the scope setting above.',
    checks: [vSplit, vNaming, vScopes, vSyntax, vDesc, vHidden, vModes, vStyle],
    meta: { collections: V.collections, variableCount: V.count, libraries: V.libraries, libraryCount: V.libraryCount } };

  // ---------------- Step 2: Styles ----------------
  var sExist = mkCheck('text-styles-exist', 'Text styles exist', 'warn',
    'Text styles are how an agent learns your type scale: a name like body/md maps to a text token in code. Without them every text layer is a one-off font setting and the agent has to reverse-engineer the scale from sizes.',
    'Create text styles for your scale (display, heading, body, caption) and apply them to every text layer.', { unit: 'style' });
  var sBound = mkCheck('text-styles-bound', 'Text styles use type variables', 'info',
    'When a text style\'s size, line height and family come from variables, the style and the code token share one source. Change the variable and both follow. It also lets an agent read the size as a token, not as a number.',
    'Edit each text style and bind font size, family and weight to your typography variables. Line height stays a value: Figma reads a bound line-height variable as pixels.', { unit: 'style' });
  var sDesc = mkCheck('text-style-desc', 'Text styles have a description', 'info',
    'A description on a style says where it belongs: "Section headings. Never inside cards." Names alone do not carry rules, and agents copy what they find.',
    'Add a one-line description to each text style.', { unit: 'style' });
  var hasText = all.some(function (n) { return n.type === 'TEXT'; });
  if (hasText || allTextStyles.length) {
    if (allTextStyles.length) P(sExist); else F(sExist, { kind: 'note', id: 'nostyles', name: 'No text styles in this file, and none used from a library' });
    textStyles.forEach(function (s) {
      var bv = null; try { bv = s.boundVariables; } catch (e) {}
      var isBound = bv && (bv.fontSize || bv.fontFamily || bv.fontStyle || bv.fontWeight);
      if (isBound) P(sBound); else F(sBound, { kind: 'style', id: s.id, name: s.name });
      if (isEmpty(s.description)) F(sDesc, { kind: 'style', id: s.id, name: s.name }); else P(sDesc);
    });
  }
  var stepStyles = { key: 'styles', label: 'Styles', weight: 10,
    what: 'Text styles name your type scale. This step checks that they exist, that they are built from variables where they can be, and that they say where they belong.',
    note: 'Styles belong to the whole file, so this step ignores the scope setting above.',
    checks: [sExist, sBound, sDesc], meta: { textStyleCount: allTextStyles.length, remoteTextStyles: remoteStyles.length } };

  // ---------------- Step 3: Components (scoped) ----------------
  var cDesc = mkCheck('desc', 'Components have a description', 'error',
    'Through MCP an agent reads the description first. It is the main place it learns what a component is and when to use it. Empty means it guesses from the layer name.',
    'Write a description: what it is, when to use it, when not to. Use the draft here and edit it.', { unit: 'component' });
  var cRich = mkCheck('desc-rich', 'Descriptions say when to use it', 'warn',
    'A label alone ("Primary button") does not tell an agent when to choose it over the secondary one. One or two sentences on purpose and use are what make the description useful.',
    'Expand to purpose, when to use, when not to, and notable states.', { unit: 'component', caveat: 'This only checks that a description exists and is longer than a label. Whether it says the right thing, only you can tell.' });
  var cProps = mkCheck('props', 'Property names are clear', 'warn',
    'Agents map Figma properties to code props by name. "Boolean" or "Property 1" carries no meaning. "Has icon" or "Size" does, and ideally it is the same word the code uses. This check only catches Figma\'s auto-generated names; whether a name matches the code is a checklist item.',
    'Rename to what the property controls, using the code\'s prop name if there is code.', { unit: 'property' });
  var cValues = mkCheck('values', 'Variant values are named', 'warn',
    'A variant value called "Variant2" is a placeholder. "Secondary" or "Large" tells an agent what it gets, and can match the code\'s option name.',
    'Rename the variant values in the component set\'s property panel.', { unit: 'value' });
  var cStates = mkCheck('states', 'Interactive components carry their states', 'info',
    'Hover, focus, pressed and disabled do not exist in a static frame unless you draw them. An agent building the component needs to know they exist and what changes. A State variant or a Disabled boolean makes that explicit.',
    'Add a State variant (default, hover, focus, pressed, disabled) or note the states in the description.', { unit: 'component' });
  var cDocs = mkCheck('docs-link', 'Components link to their docs', 'info',
    'A documentation link on the component points straight at the page that explains the rules, in Storybook, Zeroheight or a wiki. An agent that can follow links gets the full story, not the summary.',
    'Add the link under the component description in the right panel, or paste it here.', { unit: 'component', caveat: 'This only checks that a link exists, not that it points to the right page.' });
  var cHidden = mkCheck('hidden', 'No hidden layers inside components', 'info',
    'Hidden layers are still in the file. An agent reading the structure sees them and may build them. If a layer is a leftover, delete it. If it is a real option, make it a boolean property instead.',
    'Delete leftover hidden layers, or turn optional parts into a boolean property.', { unit: 'layer' });
  var cLayout = mkCheck('comp-layout', 'Components use auto-layout', 'warn',
    'Auto-layout is how an agent reads direction, spacing and how things resize. A component with absolutely placed children is a picture, not a layout.',
    'Add auto-layout (Shift+A) to the component and its containers.', { unit: 'component' });

  components.forEach(function (comp) {
    var desc = ''; try { desc = comp.description || ''; } catch (e) {}
    var cp = componentProps(comp);
    var base = { props: cp.props, variants: cp.variants, isSet: comp.type === 'COMPONENT_SET', descText: desc };
    if (isEmpty(desc)) F(cDesc, nodeItem(comp, base)); else { P(cDesc); if (desc.trim().length >= 40) P(cRich); else F(cRich, nodeItem(comp, base)); }
    cp.keys.forEach(function (k) {
      if (DEFAULT_PROP.test(k.name)) F(cProps, nodeItem(comp, { propKey: k.key, propName: k.name, propType: k.type })); else P(cProps);
    });
    cp.variants.forEach(function (v) {
      v.values.forEach(function (val) { if (DEFAULT_VALUE.test(val)) F(cValues, nodeItem(comp, { propName: v.name, value: val })); else P(cValues); });
    });
    if (INTERACTIVE.test(comp.name)) {
      var hasState = cp.variants.some(function (v) { return STATE_AXIS.test(v.name); }) || cp.keys.some(function (k) { return STATE_PROP.test(k.name); }) || /hover|focus|pressed|disabled/i.test(desc);
      if (hasState) P(cStates); else F(cStates, nodeItem(comp, base));
    }
    var links = []; try { links = comp.documentationLinks || []; } catch (e) {}
    if (links.length) P(cDocs); else F(cDocs, nodeItem(comp, {}));
    var root = comp.type === 'COMPONENT_SET' ? (comp.children && comp.children[0]) : comp;
    if (root && 'children' in root && root.children && root.children.length > 1) {
      if (root.layoutMode && root.layoutMode !== 'NONE') P(cLayout); else F(cLayout, nodeItem(comp, {}));
    }
  });
  all.forEach(function (n) {
    if (n.visible === false && n.type !== 'PAGE' && (hasAncestorOfType(n, 'COMPONENT') || hasAncestorOfType(n, 'COMPONENT_SET'))) {
      // only flag the topmost hidden node
      if (!(n.parent && n.parent.visible === false)) F(cHidden, nodeItem(n, {}));
    }
  });
  if (cHidden.total === 0 && components.length) { cHidden.pass = 1; cHidden.total = 1; }
  var stepComponents = { key: 'components', label: 'Components', weight: 30,
    what: 'Components are what an agent reuses. This step checks the context it reads first: descriptions, property names, variant values, states and docs links.',
    checks: [cDesc, cRich, cProps, cValues, cStates, cDocs, cLayout, cHidden], meta: { componentCount: components.length } };

  // ---------------- Step 4: Layers (scoped) ----------------
  var lColor = mkCheck('colors', 'Colours come from variables or styles', 'warn',
    'A raw colour is not tied to any token. An agent cannot map it to your system and has to invent a value. A bound variable gives it the token name, and with code syntax the exact CSS variable.',
    'Bind each fill and stroke to a colour variable (semantic, not primitive). Where the value matches a token, apply the match here.', { unit: 'layer' });
  var lPrim = mkCheck('semantic-on-layers', 'Layers use semantic tokens, not primitives', 'warn',
    'A layer bound to color/blue/500 is tokenised but says nothing about intent. Bound to color/background/brand it says why, and follows a theme change. When a semantic token aliases the same primitive, use it.',
    'Rebind the layer to the semantic token that points at this primitive.', { unit: 'layer' });
  var lRadius = mkCheck('radius', 'Corner radius comes from variables', 'info',
    'A raw radius (8) is a number. A radius variable (radius/2) is a token an agent can name in code. It also keeps the scale from drifting.',
    'Bind the radius to a number variable. Where the value matches, apply the match here.', { unit: 'layer' });
  var lSpace = mkCheck('spacing', 'Padding and gaps come from variables', 'info',
    'Spacing values bound to variables tell an agent your spacing scale, and it can use the same tokens in code. Raw numbers make it guess whether 12 is a token or a slip.',
    'Bind padding and gap in auto-layout frames to spacing variables. Where the value matches, apply the match here.', { unit: 'layer' });
  var lText = mkCheck('text', 'Text uses a text style', 'warn',
    'A one-off font setting is not part of your scale. With a text style the agent reads typography/body-md and maps it to the matching type token. Type variables bound straight on a layer only count when the file has no text styles at all; a detached style often leaves size and weight bound, which looks tokenised but is not the style. Where a local style matches the font and size exactly, you can apply it here.',
    'Apply a text style to every text layer.', { unit: 'layer' });
  var lLayout = mkCheck('layout', 'Containers use auto-layout', 'warn',
    'Auto-layout tells an agent how things stack and resize. Absolute positions make it a flat picture that has to be measured.',
    'Add auto-layout (Shift+A) so direction, spacing and alignment are explicit.', { unit: 'layer' });
  var lName = mkCheck('names', 'Layers have meaningful names', 'info',
    'Layer names are the hooks an agent uses to understand structure: "Card / Header" says what a frame is, "Frame 12" says nothing. Names that match the code\'s parts (header, body, actions) are best.',
    'Rename after the role the layer plays. You can rename right here.', { unit: 'layer' });
  var lContrast = mkCheck('contrast', 'Text contrast (not scored)', 'note',
    'Contrast is something only the design can fix. An agent will faithfully copy a colour pair that fails. This is a conservative estimate: text against the nearest solid background, WCAG AA.',
    'Darken the text or lighten the background until it reaches at least 4.5:1 (3:1 for text 24px and up).', { unit: 'layer' });

  all.forEach(function (node) {
    if (node.type === 'PAGE' || node.type === 'DOCUMENT') return;
    // A component set's frame (purple dashed stroke, radius, spacing) and sections are Figma's own containers, not design.
    if (node.type === 'COMPONENT_SET' || node.type === 'SECTION') return;
    var inInstance = node.type === 'INSTANCE' || hasAncestorOfType(node, 'INSTANCE');
    // colours: fills and strokes
    // Children of an instance come from the main component; a raw colour there is the component's finding, not this layer's.
    // The instance itself can carry an override, so it is still checked.
    var insideInstance = node.type !== 'INSTANCE' && inInstance;
    ['fills', 'strokes'].forEach(function (prop) {
      if (insideInstance || !(prop in node)) return;
      var paints = visiblePaints(node[prop]);
      var styleId = prop === 'fills' ? node.fillStyleId : node.strokeStyleId;
      var hasStyle = styleId && styleId !== figma.mixed && styleId !== '';
      paints.forEach(function (p, idx) {
        if (p.type !== 'SOLID' && !(p.type && p.type.indexOf('GRADIENT') === 0)) return;
        var bound = p.boundVariables && p.boundVariables.color;
        if (hasStyle || (bound && p.type !== 'SOLID')) { P(lColor); return; }
        if (bound) {
          P(lColor);
          var bv = V.info[bound.id];
          if (bv && !bv.semantic && V.aliasTargets[bound.id] && V.aliasTargets[bound.id].length) {
            var sem = V.aliasTargets[bound.id].map(function (id) { return { id: id, name: V.info[id].name, semantic: true }; }).slice(0, 6);
            F(lPrim, nodeItem(node, { prop: prop, paintIndex: idx, bound: bv.name, candidates: sem }));
          } else if (bv) P(lPrim);
          return;
        }
        if (p.type !== 'SOLID') { F(lColor, nodeItem(node, { prop: prop, paintIndex: idx, value: 'gradient', candidates: [] })); return; }
        var want = prop === 'strokes' ? 'STROKE_COLOR' : (node.type === 'TEXT' ? 'TEXT_FILL' : (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' ? 'FRAME_FILL' : 'SHAPE_FILL'));
        var cands = rankCandidates(V.colorIndex[colorKey(p.color, p.opacity)], want);
        F(lColor, nodeItem(node, { prop: prop, paintIndex: idx, value: hexOf(p.color) + (p.opacity != null && p.opacity < 1 ? ' @ ' + Math.round(p.opacity * 100) + '%' : ''), candidates: cands }));
      });
    });
    // radius
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0 && !inInstance) {
      var bvr = node.boundVariables || {};
      if (bvr.topLeftRadius || bvr.topRightRadius || bvr.bottomLeftRadius || bvr.bottomRightRadius) P(lRadius);
      else F(lRadius, nodeItem(node, { value: node.cornerRadius, candidates: rankCandidates(V.floatIndex[String(node.cornerRadius)], 'CORNER_RADIUS') }));
    }
    // spacing
    if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE' && !inInstance) {
      var bvs = node.boundVariables || {}, fields = [], allBound = true, any = false;
      ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing'].forEach(function (f) {
        var val = node[f]; if (typeof val !== 'number' || val <= 0) return; any = true;
        if (bvs[f]) return;
        allBound = false; fields.push({ field: f, value: val, candidates: rankCandidates(V.floatIndex[String(val)], 'GAP') });
      });
      if (any) { if (allBound) P(lSpace); else F(lSpace, nodeItem(node, { fields: fields })); }
    }
    // text
    if (node.type === 'TEXT') {
      var ts = node.textStyleId && node.textStyleId !== figma.mixed && node.textStyleId !== '';
      var tbv = node.boundVariables || {};
      var fullyBound = !!(tbv.fontSize && tbv.fontFamily && (tbv.fontWeight || tbv.fontStyle));
      var partlyBound = !fullyBound && !!(tbv.fontSize || tbv.fontFamily || tbv.fontWeight || tbv.fontStyle);
      // A text style is the unit an agent reads. Type variables bound straight on the layer only count when the file has no text styles at all.
      if (ts || (fullyBound && allTextStyles.length === 0)) P(lText);
      else {
        var font = '', cands = [];
        try { if (node.fontName !== figma.mixed && node.fontSize !== figma.mixed) { font = node.fontName.family + ' ' + node.fontName.style + ' ' + node.fontSize; cands = styleIndex[node.fontName.family + '|' + node.fontName.style + '|' + node.fontSize] || []; } else font = 'mixed fonts'; } catch (e) {}
        if (fullyBound) font += ' · type variables bound, no style'; else if (partlyBound) font += ' · style detached, some variables left';
        F(lText, nodeItem(node, { value: font, candidates: cands.slice(0, 6) }));
      }
      try {
        var tcol = firstOpaqueSolid(node.fills), bg = null, anc = node.parent;
        if (tcol) {
          while (anc && anc.type !== 'PAGE' && anc.type !== 'DOCUMENT') { if ('fills' in anc) { var bc = firstOpaqueSolid(anc.fills); if (bc) { bg = bc; break; } } anc = anc.parent; }
          if (bg) {
            var cr = contrastRatio(tcol, bg), big = (typeof node.fontSize === 'number' && node.fontSize >= 24), thr = big ? 3 : 4.5;
            if (cr + 0.05 < thr) F(lContrast, nodeItem(node, { value: cr.toFixed(1) + ':1, needs ' + thr + ':1' })); else P(lContrast);
          }
        }
      } catch (e) {}
    }
    // auto-layout
    if ((node.type === 'FRAME' || node.type === 'COMPONENT') && 'children' in node && node.children && node.children.length > 1 && !inInstance) {
      if (node.layoutMode && node.layoutMode !== 'NONE') P(lLayout); else F(lLayout, nodeItem(node, { count: node.children.length }));
    }
    // names
    if (node.type !== 'INSTANCE' && !inInstance) {
      if (DEFAULT_NAME.test(node.name)) F(lName, nodeItem(node, {})); else P(lName);
    }
  });
  var stepLayers = { key: 'layers', label: 'Layers', weight: 30,
    what: 'Layers are where tokens get used. This step checks that colours, radius, spacing and type point at variables and styles, that containers use auto-layout, and that names mean something.',
    checks: [lColor, lPrim, lText, lRadius, lSpace, lLayout, lName, lContrast] };

  // ---------------- Scores ----------------
  var steps = [stepVariables, stepStyles, stepComponents, stepLayers];
  var wSum = 0, sSum = 0, counts = { errors: 0, warnings: 0, infos: 0 };
  steps.forEach(function (st) {
    var ratios = [];
    st.checks.forEach(function (c) {
      if (c.scored && c.total > 0) ratios.push(c.pass / c.total);
      if (c.items.length) { if (c.severity === 'error') counts.errors += c.items.length; else if (c.severity === 'warn') counts.warnings += c.items.length; else if (c.severity === 'info') counts.infos += c.items.length; }
      c.items = c.items.slice(0, 400);
    });
    st.score = ratios.length ? Math.round(ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length * 100) : null;
    if (st.score !== null) { wSum += st.weight; sSum += st.score * st.weight; }
  });
  return {
    scope: scope, overall: wSum ? Math.round(sSum / wSum) : null, steps: steps,
    counts: { components: components.length, nodes: all.length, variables: V.count, textStyles: allTextStyles.length, errors: counts.errors, warnings: counts.warnings, infos: counts.infos },
    fileName: figma.root.name
  };
}

// ---------------------------------------------------------------------------
// Selection info (for the context card in the Components step)
// ---------------------------------------------------------------------------
function selectionInfo() {
  var sel = figma.currentPage.selection;
  if (!sel.length) return { kind: 'none' };
  if (sel.length > 1) return { kind: 'multi', count: sel.length };
  var n = sel[0];
  if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') return { kind: 'variant', id: n.id, name: n.name, setId: n.parent.id, setName: n.parent.name };
  if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') {
    var cp = componentProps(n), desc = ''; try { desc = n.description || ''; } catch (e) {}
    var links = []; try { links = (n.documentationLinks || []).map(function (l) { return l.uri; }); } catch (e) {}
    return { kind: n.type === 'COMPONENT_SET' ? 'set' : 'component', id: n.id, name: n.name, props: cp.props, variants: cp.variants, descText: desc, docLink: links[0] || '' };
  }
  if (n.type === 'INSTANCE') return { kind: 'instance', id: n.id, name: n.name };
  var canAnno = ('annotations' in n), annoText = '';
  try { if (n.annotations && n.annotations.length > 0) annoText = n.annotations[0].label || n.annotations[0].labelMarkdown || ''; } catch (e) {}
  return { kind: canAnno ? 'node' : 'other', id: n.id, name: n.name, nodeType: n.type, canAnnotate: canAnno, annoText: annoText };
}

// ---------------------------------------------------------------------------
// Fixes. Every one runs only on an explicit click in the UI.
// ---------------------------------------------------------------------------
async function getNode(id) { var n = await figma.getNodeByIdAsync(id); if (!n) throw new Error('Layer not found. It may have been deleted.'); return n; }
async function getVar(id) { var v = await figma.variables.getVariableByIdAsync(id); if (!v) throw new Error('Variable not found.'); return v; }

var FIX = {
  'set-scopes': async function (m) { var v = await getVar(m.variableId); v.scopes = m.scopes; },
  'batch-scopes': async function (m) { for (var i = 0; i < m.items.length; i++) { try { var v = await getVar(m.items[i].id); v.scopes = m.items[i].scopes; } catch (e) {} } },
  'set-syntax': async function (m) { var v = await getVar(m.variableId); if (m.syntax) v.setVariableCodeSyntax('WEB', m.syntax); else v.removeVariableCodeSyntax('WEB'); },
  'batch-syntax': async function (m) { for (var i = 0; i < m.items.length; i++) { try { var v = await getVar(m.items[i].id); if (m.items[i].syntax) v.setVariableCodeSyntax('WEB', m.items[i].syntax); } catch (e) {} } },
  'rename-variable': async function (m) { var v = await getVar(m.variableId); if (isEmpty(m.name)) throw new Error('Name is empty.'); v.name = m.name.trim(); },
  'set-var-desc': async function (m) { var v = await getVar(m.variableId); v.description = m.text || ''; },
  'set-hidden': async function (m) { var v = await getVar(m.variableId); v.hiddenFromPublishing = !!m.hidden; },
  'hide-collection': async function (m) {
    var cols = await figma.variables.getLocalVariableCollectionsAsync();
    var col = cols.filter(function (c) { return c.id === m.collectionId; })[0]; if (!col) throw new Error('Collection not found.');
    for (var i = 0; i < col.variableIds.length; i++) { try { var v = await getVar(col.variableIds[i]); v.hiddenFromPublishing = !!m.hidden; } catch (e) {} }
  },
  'set-style-desc': async function (m) { var s = await figma.getStyleByIdAsync(m.styleId); if (!s) throw new Error('Style not found.'); s.description = m.text || ''; },
  'rename-node': async function (m) { var n = await getNode(m.nodeId); if (isEmpty(m.name)) throw new Error('Name is empty.'); n.name = m.name.trim(); },
  'rename-property': async function (m) {
    var n = await getNode(m.nodeId);
    if (n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') throw new Error('Not a component.');
    if (isEmpty(m.newName)) throw new Error('Name is empty.');
    n.editComponentProperty(m.propKey, { name: m.newName.trim() });
  },
  'apply-description': async function (m) {
    var n = await getNode(m.nodeId);
    if (n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') throw new Error('Not a component.');
    n.description = m.text || '';
  },
  'set-doc-link': async function (m) {
    var n = await getNode(m.nodeId);
    if (n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') throw new Error('Not a component.');
    if (!/^https?:\/\//i.test(m.uri || '')) throw new Error('The link must start with http:// or https://');
    n.documentationLinks = [{ uri: m.uri }];
  },
  'apply-annotation': async function (m) {
    var n = await getNode(m.nodeId);
    if (!('annotations' in n)) throw new Error('This layer cannot hold an annotation.');
    n.annotations = m.text ? [{ label: m.text }] : [];
  },
  'bind-color': async function (m) {
    var n = await getNode(m.nodeId), v = await getVar(m.variableId);
    if (!(m.prop in n)) throw new Error('No ' + m.prop + ' on this layer.');
    var paints = clone(n[m.prop]); if (!Array.isArray(paints) || !paints[m.paintIndex]) throw new Error('Paint not found.');
    paints[m.paintIndex] = figma.variables.setBoundVariableForPaint(paints[m.paintIndex], 'color', v);
    n[m.prop] = paints;
  },
  'bind-radius': async function (m) {
    var n = await getNode(m.nodeId), v = await getVar(m.variableId);
    ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'].forEach(function (f) { try { n.setBoundVariable(f, v); } catch (e) {} });
  },
  'bind-spacing': async function (m) {
    var n = await getNode(m.nodeId);
    for (var i = 0; i < m.bindings.length; i++) { var v = await getVar(m.bindings[i].variableId); n.setBoundVariable(m.bindings[i].field, v); }
  },
  'apply-text-style': async function (m) {
    var n = await getNode(m.nodeId); if (n.type !== 'TEXT') throw new Error('Not a text layer.');
    var s = await figma.getStyleByIdAsync(m.styleId); if (!s || s.type !== 'TEXT') throw new Error('Text style not found.');
    if (n.fontName !== figma.mixed) await figma.loadFontAsync(n.fontName);
    await figma.loadFontAsync(s.fontName);
    await n.setTextStyleIdAsync(s.id);
  }
};

// ---------------------------------------------------------------------------
// Checklist state lives in the file, so the whole team sees the same ticks
// ---------------------------------------------------------------------------
function readChecklist() { try { return JSON.parse(figma.root.getPluginData(CHECKLIST_KEY) || '{}'); } catch (e) { return {}; } }
function writeChecklist(state) { try { figma.root.setPluginData(CHECKLIST_KEY, JSON.stringify(state || {})); } catch (e) {} }

// ---------------------------------------------------------------------------
// Message validation. The UI is our own code, but every payload is checked
// before it touches the file: types, lengths, allowed values.
// ---------------------------------------------------------------------------
var LIMITS = { name: 200, syntax: 200, text: 5000, uri: 2000, notify: 120, batch: 500 };
var ALLOWED_SCOPES = ['ALL_SCOPES', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR', 'CORNER_RADIUS', 'GAP', 'WIDTH_HEIGHT', 'TEXT_CONTENT', 'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'FONT_WEIGHT', 'FONT_FAMILY', 'FONT_STYLE', 'OPACITY', 'STROKE_FLOAT', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT', 'EFFECT_FLOAT', 'FONT_VARIATIONS'];
var SPACING_FIELDS = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
var ALLOWED_HOSTS = ['moonlearning.io', 'www.moonlearning.io', 'youtu.be', 'www.youtube.com'];

function isId(v) { return typeof v === 'string' && v.length > 0 && v.length <= 200; }
function str(v, max) { if (typeof v !== 'string') throw new Error('Invalid input.'); if (v.length > max) throw new Error('Too long (max ' + max + ' characters).'); return v; }
function reqId(v, what) { if (!isId(v)) throw new Error('Missing ' + (what || 'id') + '.'); return v; }
function scopesOf(v) {
  if (!Array.isArray(v) || !v.length || v.length > 12) throw new Error('Invalid scopes.');
  v.forEach(function (x) { if (ALLOWED_SCOPES.indexOf(x) < 0) throw new Error('Unknown scope ' + String(x) + '.'); });
  return v.slice();
}
function listOf(v) { if (!Array.isArray(v) || !v.length) throw new Error('Nothing to apply.'); return v.slice(0, LIMITS.batch); }
function safeUrl(u) {
  if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return null;
  var host = u.replace(/^https:\/\//i, '').split(/[\/?#]/)[0].toLowerCase();
  return ALLOWED_HOSTS.indexOf(host) >= 0 ? u : null;
}
function isComponentLike(n) { return n.type === 'COMPONENT' || n.type === 'COMPONENT_SET'; }

// ---------------------------------------------------------------------------
// Fixes. Every one runs only on an explicit click in the UI.
// ---------------------------------------------------------------------------
async function getNode(id) { var n = await figma.getNodeByIdAsync(reqId(id, 'layer')); if (!n) throw new Error('Layer not found. It may have been deleted.'); return n; }
async function getVar(id) { var v = await figma.variables.getVariableByIdAsync(reqId(id, 'variable')); if (!v) throw new Error('Variable not found.'); return v; }
async function getComponent(id) { var n = await getNode(id); if (!isComponentLike(n)) throw new Error('Not a component.'); return n; }
async function forEachVar(ids, fn) { for (var i = 0; i < ids.length; i++) { try { await fn(await getVar(ids[i].id !== undefined ? ids[i].id : ids[i]), ids[i]); } catch (e) {} } }

var FIX = {
  'set-scopes': async function (m) { var v = await getVar(m.variableId); v.scopes = scopesOf(m.scopes); },
  'batch-scopes': async function (m) { await forEachVar(listOf(m.items), function (v, it) { v.scopes = scopesOf(it.scopes); }); },
  'set-syntax': async function (m) { var v = await getVar(m.variableId); var syn = str(m.syntax || '', LIMITS.syntax).trim(); if (syn) v.setVariableCodeSyntax('WEB', syn); else v.removeVariableCodeSyntax('WEB'); },
  'batch-syntax': async function (m) { await forEachVar(listOf(m.items), function (v, it) { var syn = str(it.syntax || '', LIMITS.syntax).trim(); if (syn) v.setVariableCodeSyntax('WEB', syn); }); },
  'rename-variable': async function (m) { var v = await getVar(m.variableId); var name = str(m.name || '', LIMITS.name).trim(); if (!name) throw new Error('Name is empty.'); v.name = name; },
  'set-var-desc': async function (m) { var v = await getVar(m.variableId); v.description = str(m.text || '', LIMITS.text); },
  'set-hidden': async function (m) { var v = await getVar(m.variableId); v.hiddenFromPublishing = !!m.hidden; },
  'hide-collection': async function (m) {
    var cols = await figma.variables.getLocalVariableCollectionsAsync();
    var col = cols.filter(function (c) { return c.id === reqId(m.collectionId, 'collection'); })[0]; if (!col) throw new Error('Collection not found.');
    await forEachVar(col.variableIds, function (v) { v.hiddenFromPublishing = !!m.hidden; });
  },
  'set-style-desc': async function (m) { var s = await figma.getStyleByIdAsync(reqId(m.styleId, 'style')); if (!s) throw new Error('Style not found.'); s.description = str(m.text || '', LIMITS.text); },
  'rename-node': async function (m) { var n = await getNode(m.nodeId); var name = str(m.name || '', LIMITS.name).trim(); if (!name) throw new Error('Name is empty.'); n.name = name; },
  'rename-property': async function (m) {
    var n = await getComponent(m.nodeId), name = str(m.newName || '', LIMITS.name).trim();
    if (!name) throw new Error('Name is empty.');
    n.editComponentProperty(str(m.propKey || '', LIMITS.name), { name: name });
  },
  'apply-description': async function (m) { var n = await getComponent(m.nodeId); n.description = str(m.text || '', LIMITS.text); },
  'set-doc-link': async function (m) {
    var n = await getComponent(m.nodeId), uri = str(m.uri || '', LIMITS.uri).trim();
    if (!/^https?:\/\/\S+$/i.test(uri)) throw new Error('The link must start with http:// or https://');
    n.documentationLinks = [{ uri: uri }];
  },
  'apply-annotation': async function (m) {
    var n = await getNode(m.nodeId), text = str(m.text || '', LIMITS.text).trim();
    if (!('annotations' in n)) throw new Error('This layer cannot hold an annotation.');
    n.annotations = text ? [{ label: text }] : [];
  },
  'bind-color': async function (m) {
    var n = await getNode(m.nodeId), v = await getVar(m.variableId);
    if (m.prop !== 'fills' && m.prop !== 'strokes') throw new Error('Invalid paint property.');
    if (!(m.prop in n)) throw new Error('No ' + m.prop + ' on this layer.');
    var idx = m.paintIndex, paints = clone(n[m.prop]);
    if (!Number.isInteger(idx) || !Array.isArray(paints) || !paints[idx]) throw new Error('Paint not found.');
    paints[idx] = figma.variables.setBoundVariableForPaint(paints[idx], 'color', v);
    n[m.prop] = paints;
  },
  'bind-radius': async function (m) {
    var n = await getNode(m.nodeId), v = await getVar(m.variableId);
    ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'].forEach(function (f) { try { n.setBoundVariable(f, v); } catch (e) {} });
  },
  'bind-spacing': async function (m) {
    var n = await getNode(m.nodeId), bindings = listOf(m.bindings);
    for (var i = 0; i < bindings.length; i++) {
      if (SPACING_FIELDS.indexOf(bindings[i].field) < 0) throw new Error('Invalid spacing field.');
      n.setBoundVariable(bindings[i].field, await getVar(bindings[i].variableId));
    }
  },
  'apply-text-style': async function (m) {
    var n = await getNode(m.nodeId); if (n.type !== 'TEXT') throw new Error('Not a text layer.');
    var s = await figma.getStyleByIdAsync(reqId(m.styleId, 'style')); if (!s || s.type !== 'TEXT') throw new Error('Text style not found.');
    if (n.fontName !== figma.mixed) await figma.loadFontAsync(n.fontName);
    await figma.loadFontAsync(s.fontName);
    await n.setTextStyleIdAsync(s.id);
  }
};

// ---------------------------------------------------------------------------
// Checklist state lives in the file, so the whole team sees the same ticks
// ---------------------------------------------------------------------------
var CHECKLIST_ITEM = /^[a-z0-9-]{1,40}$/;
function readChecklist() { try { var st = JSON.parse(figma.root.getPluginData(CHECKLIST_KEY) || '{}'); return st && typeof st === 'object' ? st : {}; } catch (e) { return {}; } }
function writeChecklist(state) { try { figma.root.setPluginData(CHECKLIST_KEY, JSON.stringify(state || {})); } catch (e) {} }
function post(type, data) { var m = { type: type }; if (data !== undefined) m.data = data; figma.ui.postMessage(m); }

// ---------------------------------------------------------------------------
// Messages from the UI
// ---------------------------------------------------------------------------
var HANDLERS = {
  'run': async function (m) {
    post('running');
    var scope = ['selection', 'page', 'file'].indexOf(m.scope) >= 0 ? m.scope : 'selection';
    post('result', await runAudit(scope));
    post('checklist', readChecklist());
    post('selection-info', selectionInfo());
  },
  'fix': async function (m) {
    var fn = FIX[m.action]; if (!fn) throw new Error('Unknown action.');
    await fn(m);
    try { figma.commitUndo(); } catch (e) {} // one undo step per fix, so Cmd+Z reverts exactly one click
    figma.ui.postMessage({ type: 'fixed', ok: true, token: m.token, action: m.action });
    if (typeof m.notify === 'string' && m.notify) figma.notify(m.notify.slice(0, LIMITS.notify), { timeout: 1500 });
  },
  'select': async function (m) {
    var n = await figma.getNodeByIdAsync(reqId(m.nodeId, 'layer')); if (!n) return;
    var pg = n; while (pg && pg.type !== 'PAGE') pg = pg.parent;
    if (pg && pg !== figma.currentPage) await figma.setCurrentPageAsync(pg);
    figma.currentPage.selection = [n]; figma.viewport.scrollAndZoomIntoView([n]);
  },
  'selection-info': function () { post('selection-info', selectionInfo()); },
  'checklist-get': function () { post('checklist', readChecklist()); },
  'banner-get': async function () { var v = false; try { v = !!(await figma.clientStorage.getAsync('banner-dismissed')); } catch (e) {} post('banner', v); },
  'banner-dismiss': async function () { try { await figma.clientStorage.setAsync('banner-dismissed', true); } catch (e) {} },
  'checklist-set': function (m) {
    if (typeof m.key !== 'string' || !CHECKLIST_ITEM.test(m.key)) throw new Error('Invalid checklist item.');
    var st = readChecklist();
    if (m.checked) st[m.key] = { by: (figma.currentUser && figma.currentUser.name) || '', at: Date.now() }; else delete st[m.key];
    writeChecklist(st); post('checklist', st);
  },
  'checklist-reset': function () { writeChecklist({}); post('checklist', {}); },
  'notify': function (m) { if (typeof m.text === 'string' && m.text) figma.notify(m.text.slice(0, LIMITS.notify), { timeout: 2000 }); },
  'open-url': function (m) { var u = safeUrl(m.url); if (u) figma.openExternal(u); },
  'resize': function (m) {
    var w = Number(m.width), h = Number(m.height);
    if (!isFinite(w) || !isFinite(h)) return;
    figma.ui.resize(Math.max(360, Math.min(960, Math.round(w))), Math.max(480, Math.min(1200, Math.round(h))));
  },
  'close': function () { figma.closePlugin(); }
};

figma.on('selectionchange', function () { post('selection-info', selectionInfo()); });

figma.ui.onmessage = async function (msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  var handler = HANDLERS[msg.type]; if (!handler) return;
  try {
    await handler(msg);
  } catch (err) {
    var message = String(err && err.message || err);
    if (msg.type === 'fix') figma.ui.postMessage({ type: 'fixed', ok: false, token: msg.token, action: msg.action, error: message });
    else post('error', message);
  }
};
