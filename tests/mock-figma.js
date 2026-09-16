// A small stand-in for the Figma Plugin API, enough to run code.js's audit in Node.
// Build a file with the helpers, then load code.js in a vm context with this `figma` global.
'use strict';

const MIXED = Symbol('mixed');
let nextId = 1;
const id = () => String(nextId++) + ':' + String(nextId++);

function rgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; }
function solid(hex, opts = {}) { return Object.assign({ type: 'SOLID', color: rgb(hex), opacity: 1, visible: true }, opts); }

function node(type, name, props = {}) {
  const n = Object.assign({ id: id(), type, name, parent: null, visible: true, children: [] }, props);
  if (type === 'TEXT') { delete n.children; }
  if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION', 'PAGE'].indexOf(type) < 0 && !props.children) delete n.children;
  if (n.children) n.children.forEach(c => { c.parent = n; });
  if (n.fills === undefined && type !== 'PAGE' && type !== 'GROUP') n.fills = [];
  if (n.strokes === undefined && type !== 'PAGE' && type !== 'GROUP') n.strokes = [];
  if (type === 'TEXT') { n.fontName = n.fontName || { family: 'Inter', style: 'Regular' }; n.fontSize = n.fontSize || 14; if (n.textStyleId === undefined) n.textStyleId = ''; }
  if (n.boundVariables === undefined) n.boundVariables = {};
  if (n.annotations === undefined && type !== 'PAGE') n.annotations = [];
  return n;
}
function add(parent, child) { child.parent = parent; parent.children.push(child); return child; }

class File {
  constructor() {
    this.collections = []; this.variables = []; this.textStyles = []; this.stylesById = {};
    this.page = node('PAGE', 'Page 1', { children: [], selection: [] });
    this.root = { type: 'DOCUMENT', name: 'Test file', children: [this.page], _pd: {}, getPluginData(k) { return this._pd[k] || ''; }, setPluginData(k, v) { this._pd[k] = v; } };
    this.page.parent = this.root;
    this.nodesById = {};
  }
  collection(name, modes = ['Mode 1']) {
    const c = { id: 'VariableCollectionId:' + id(), name, modes: modes.map(m => ({ modeId: 'm:' + m, name: m })), defaultModeId: 'm:' + modes[0], variableIds: [] };
    this.collections.push(c); return c;
  }
  // value: hex string, number, or { alias: variable }
  variable(col, name, type, valueByMode, opts = {}) {
    const v = { id: 'VariableID:' + id(), name, resolvedType: type, variableCollectionId: col.id, valuesByMode: {}, scopes: opts.scopes || ['ALL_SCOPES'], codeSyntax: opts.codeSyntax || {}, description: opts.description || '', hiddenFromPublishing: !!opts.hidden, remote: false,
      setVariableCodeSyntax(p, s) { this.codeSyntax[p] = s; }, removeVariableCodeSyntax(p) { delete this.codeSyntax[p]; } };
    col.modes.forEach((m, i) => {
      const val = Array.isArray(valueByMode) ? valueByMode[i] : valueByMode;
      v.valuesByMode[m.modeId] = (val && val.alias) ? { type: 'VARIABLE_ALIAS', id: val.alias.id } : (type === 'COLOR' ? Object.assign(rgb(val), { a: 1 }) : val);
    });
    col.variableIds.push(v.id); this.variables.push(v); return v;
  }
  textStyle(name, family, style, size, opts = {}) {
    const s = { id: 'S:' + id(), type: 'TEXT', name, fontName: { family, style }, fontSize: size, description: opts.description || '', boundVariables: opts.boundVariables || {}, remote: !!opts.remote };
    if (!opts.remote) this.textStyles.push(s); this.stylesById[s.id] = s; return s;
  }
  // A team library: its collections and variables are not local, only reachable through teamLibrary + import
  library(libraryName) {
    const self = this; this.libs = this.libs || [];
    const lib = { libraryName, collections: [], variables: [] };
    lib.collection = (name, modes = ['Mode 1']) => { const c = { id: 'VariableCollectionId:' + id(), key: 'ck' + id(), name, libraryName, modes: modes.map(m => ({ modeId: 'm:' + m, name: m })), defaultModeId: 'm:' + modes[0], variableIds: [], remote: true, hidden: false }; lib.collections.push(c); return c; };
    lib.variable = (col, name, type, valueByMode, opts = {}) => {
      const v = { id: 'VariableID:' + id(), key: 'vk' + id(), name, resolvedType: type, variableCollectionId: col.id, valuesByMode: {}, scopes: opts.scopes || ['ALL_SCOPES'], codeSyntax: opts.codeSyntax || {}, description: opts.description || '', hiddenFromPublishing: !!opts.hidden, remote: true };
      col.modes.forEach((m, i) => { const val = Array.isArray(valueByMode) ? valueByMode[i] : valueByMode; v.valuesByMode[m.modeId] = (val && val.alias) ? { type: 'VARIABLE_ALIAS', id: val.alias.id } : (type === 'COLOR' ? Object.assign(rgb(val), { a: 1 }) : val); });
      col.variableIds.push(v.id); lib.variables.push(v); return v;
    };
    this.libs.push(lib); return lib;
  }
  index() { const walk = n => { this.nodesById[n.id] = n; (n.children || []).forEach(walk); }; walk(this.page); }
  select(...nodes) { this.page.selection = nodes; }
  figma() {
    const self = this; this.index();
    const posted = [];
    return {
      _posted: posted, mixed: MIXED, currentUser: { name: 'Tester' },
      showUI() {}, on() {}, notify() {}, closePlugin() {}, openExternal() {}, commitUndo() {},
      ui: { postMessage(m) { posted.push(m); }, resize() {}, onmessage: null },
      root: this.root, currentPage: this.page,
      async loadAllPagesAsync() {},
      async setCurrentPageAsync() {},
      viewport: { scrollAndZoomIntoView() {} },
      clientStorage: { async getAsync() { return false; }, async setAsync() {} },
      teamLibrary: {
        // only collections whose variables are not hidden from publishing are "available"
        async getAvailableLibraryVariableCollectionsAsync() { return (self.libs || []).flatMap(l => l.collections.filter(c => l.variables.some(v => v.variableCollectionId === c.id && !v.hiddenFromPublishing)).map(c => ({ key: c.key, name: c.name, libraryName: l.libraryName }))); },
        async getVariablesInLibraryCollectionAsync(key) { const lib = (self.libs || []).find(l => l.collections.some(c => c.key === key)); const col = lib.collections.find(c => c.key === key); return lib.variables.filter(v => v.variableCollectionId === col.id && !v.hiddenFromPublishing).map(v => ({ key: v.key, name: v.name, resolvedType: v.resolvedType })); }
      },
      variables: {
        async getLocalVariableCollectionsAsync() { return self.collections; },
        async getLocalVariablesAsync() { return self.variables; },
        async getVariableByIdAsync(vid) { return self.variables.find(v => v.id === vid) || (self.libs || []).flatMap(l => l.variables).find(v => v.id === vid) || null; },
        async getVariableCollectionByIdAsync(cid) { return self.collections.find(c => c.id === cid) || (self.libs || []).flatMap(l => l.collections).find(c => c.id === cid) || null; },
        async importVariableByKeyAsync(key) { const v = (self.libs || []).flatMap(l => l.variables).find(v => v.key === key); if (!v) throw new Error('not found'); return v; },
        setBoundVariableForPaint(paint, field, v) { const p = JSON.parse(JSON.stringify(paint)); p.boundVariables = { [field]: { type: 'VARIABLE_ALIAS', id: v.id } }; return p; }
      },
      async getLocalTextStylesAsync() { return self.textStyles; },
      async getStyleByIdAsync(sid) { return self.stylesById[sid] || null; },
      async getNodeByIdAsync(nid) { return self.nodesById[nid] || null; },
      async loadFontAsync() {}
    };
  }
}

module.exports = { File, node, add, solid, rgb, MIXED };
