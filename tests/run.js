// Runs code.js's audit against small fixture files and checks what gets flagged.
// Usage: node tests/run.js   (from the "AI Ready Checker" folder, or anywhere: paths are resolved from this file)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { File, node, add, solid, MIXED } = require('./mock-figma');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'ai-ready', 'code.js'), 'utf8');
function load(file) {
  const ctx = { figma: file.figma(), __html__: '', console, Number, Math, JSON, Array, Object, String, Date, RegExp, Error, Promise, isFinite, parseInt, parseFloat, setTimeout };
  vm.createContext(ctx); vm.runInContext(CODE, ctx, { filename: 'code.js' }); return ctx;
}
async function audit(file, scope = 'selection') { const ctx = load(file); return ctx.runAudit(scope); }
function check(result, stepKey, checkKey) { const st = result.steps.find(s => s.key === stepKey); if (!st) throw new Error('no step ' + stepKey); const c = st.checks.find(c => c.key === checkKey); if (!c) throw new Error('no check ' + checkKey); return c; }
function names(c) { return c.items.map(i => i.name); }

let pass = 0, fail = 0; const failures = [];
function t(name, cond, detail) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; failures.push(name); console.log('  ✗ ' + name + (detail ? '   ' + detail : '')); } }
function section(s) { console.log('\n' + s); }

// ---------------------------------------------------------------------------
// Fixture: a small design system file with primitives, semantics, styles, and a Button set
// ---------------------------------------------------------------------------
function fixture() {
  const f = new File();
  const prim = f.collection('Primitives');
  const sem = f.collection('Semantic', ['Light', 'Dark']);
  const blue500 = f.variable(prim, 'color/blue/500', 'COLOR', '#2F6BFF', { hidden: true });
  const blue700 = f.variable(prim, 'color/blue/700', 'COLOR', '#1E4FCC', { hidden: true });
  const neutral200 = f.variable(prim, 'color/neutral/200', 'COLOR', '#E7E4DC', { hidden: true });
  const neutral900 = f.variable(prim, 'color/neutral/900', 'COLOR', '#16161D', { hidden: true });
  const white = f.variable(prim, 'color/neutral/white', 'COLOR', '#FFFFFF', { hidden: true });
  const space4 = f.variable(prim, 'space/4', 'FLOAT', 16, { hidden: true });
  const radius2 = f.variable(prim, 'radius/2', 'FLOAT', 8, { hidden: true });
  const bgBrand = f.variable(sem, 'color/background/brand', 'COLOR', [{ alias: blue500 }, { alias: blue700 }], { scopes: ['FRAME_FILL', 'SHAPE_FILL'], codeSyntax: { WEB: '--sds-color-background-brand' }, description: 'Primary actions.' });
  const border = f.variable(sem, 'color/border/subtle', 'COLOR', [{ alias: neutral200 }, { alias: neutral200 }], { scopes: ['STROKE_COLOR'], codeSyntax: { WEB: '--sds-color-border-subtle' } });
  const content = f.variable(sem, 'color/content/default', 'COLOR', [{ alias: neutral900 }, { alias: white }]); // unscoped, no code name, no description: should be flagged
  const inset = f.variable(sem, 'space/inset/md', 'FLOAT', [{ alias: space4 }, { alias: space4 }], { scopes: ['GAP'], codeSyntax: { WEB: '--sds-space-inset-md' } });
  const rad = f.variable(sem, 'radius/md', 'FLOAT', [{ alias: radius2 }, { alias: radius2 }], { scopes: ['CORNER_RADIUS'], codeSyntax: { WEB: '--sds-radius-md' } });
  const body = f.textStyle('typography/body-md', 'Inter', 'Semi Bold', 16);
  f.vars = { blue500, neutral200, bgBrand, border, content, inset, rad, space4, radius2 }; f.styles = { body };
  return f;
}
function bound(v) { return { type: 'VARIABLE_ALIAS', id: v.id }; }
function paintBound(hex, v) { return solid(hex, { boundVariables: { color: bound(v) } }); }

(async function main() {
  // -------------------------------------------------------------------------
  section('Text styles');
  {
    const f = fixture();
    const set = add(f.page, node('COMPONENT_SET', 'Button', { strokes: [solid('#752C9F')], cornerRadius: 5, layoutMode: 'NONE', componentPropertyDefinitions: { 'label#1:0': { type: 'TEXT' }, variant: { type: 'VARIANT', variantOptions: ['primary', 'secondary'] } }, description: 'Button: the main action. Use once per view. Not for navigation.' }));
    const v1 = add(set, node('COMPONENT', 'variant=primary', { layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, itemSpacing: 0, boundVariables: { paddingLeft: bound(f.vars.inset), paddingRight: bound(f.vars.inset), paddingTop: bound(f.vars.inset), paddingBottom: bound(f.vars.inset) }, fills: [paintBound('#2F6BFF', f.vars.bgBrand)], cornerRadius: 8, }));
    v1.boundVariables.topLeftRadius = bound(f.vars.rad);
    // the detached label: style removed, size and weight still bound
    const detached = add(v1, node('TEXT', 'label', { fontName: { family: 'Inter', style: 'Semi Bold' }, fontSize: 16, textStyleId: '', boundVariables: { fills: [bound(f.vars.content)], fontSize: bound(f.vars.space4), fontWeight: bound(f.vars.space4) }, fills: [paintBound('#FFFFFF', f.vars.content)] }));
    const v2 = add(set, node('COMPONENT', 'variant=secondary', { layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, boundVariables: { paddingLeft: bound(f.vars.inset), paddingRight: bound(f.vars.inset), paddingTop: bound(f.vars.inset), paddingBottom: bound(f.vars.inset) }, fills: [paintBound('#FFFFFF', f.vars.content)], strokes: [paintBound('#E7E4DC', f.vars.border)] }));
    const styled = add(v2, node('TEXT', 'label', { fontName: { family: 'Inter', style: 'Semi Bold' }, fontSize: 16, textStyleId: f.styles.body.id, fills: [paintBound('#16161D', f.vars.content)] }));
    f.select(set);
    const r = await audit(f);
    const c = check(r, 'layers', 'text');
    t('detached label (style removed, size+weight still bound) is flagged', c.items.some(i => i.id === detached.id), JSON.stringify(names(c)));
    t('label with a text style passes', !c.items.some(i => i.id === styled.id));
    t('flagged label gets the matching style offered', (c.items.find(i => i.id === detached.id) || { candidates: [] }).candidates.some(x => x.id === f.styles.body.id));
    t('the row says the style was detached', /detached/.test((c.items.find(i => i.id === detached.id) || {}).value || ''));
    t('component set frame itself is not flagged for its purple stroke', !check(r, 'layers', 'colors').items.some(i => i.id === set.id));
    t('component set radius 5 is not flagged', !check(r, 'layers', 'radius').items.some(i => i.id === set.id));
    t('set description present: not flagged', !check(r, 'components', 'desc').items.length);
    t('real prop names (label, variant) are not flagged', !check(r, 'components', 'props').items.length);
    t('Layers score is below 100 when a label lost its style', r.steps.find(s => s.key === 'layers').score < 100, 'score ' + r.steps.find(s => s.key === 'layers').score);
  }
  {
    const f = new File(); // no styles anywhere in the file
    const c1 = f.collection('Tokens');
    const fs16 = f.variable(c1, 'font-size/400', 'FLOAT', 16); const fam = f.variable(c1, 'font-family/sans', 'STRING', 'Inter'); const w = f.variable(c1, 'font-weight/semibold', 'FLOAT', 600);
    const frame = add(f.page, node('FRAME', 'Card / Body', { layoutMode: 'VERTICAL' }));
    const full = add(frame, node('TEXT', 'title', { boundVariables: { fontSize: bound(fs16), fontFamily: bound(fam), fontWeight: bound(w) } }));
    const partial = add(frame, node('TEXT', 'caption', { boundVariables: { fontSize: bound(fs16) } }));
    f.select(frame);
    const r = await audit(f);
    const c = check(r, 'layers', 'text');
    t('no styles in file: fully bound type variables pass', !c.items.some(i => i.id === full.id));
    t('no styles in file: partially bound text is flagged', c.items.some(i => i.id === partial.id));
  }
  {
    const f = new File();
    const remote = f.textStyle('lib/body', 'Inter', 'Regular', 14, { remote: true }); // from a library, not local
    const frame = add(f.page, node('FRAME', 'Card', { layoutMode: 'VERTICAL' }));
    add(frame, node('TEXT', 'a', { textStyleId: remote.id }));
    const loose = add(frame, node('TEXT', 'b', { fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14, boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'x' }, fontFamily: { type: 'VARIABLE_ALIAS', id: 'y' }, fontWeight: { type: 'VARIABLE_ALIAS', id: 'z' } } }));
    f.select(frame);
    const r = await audit(f);
    t('library text styles count as styles: "Text styles exist" passes', !check(r, 'styles', 'text-styles-exist').items.length);
    t('with a library style in use, a fully bound loose text is still flagged', check(r, 'layers', 'text').items.some(i => i.id === loose.id));
    t('library style is offered as the match', (check(r, 'layers', 'text').items.find(i => i.id === loose.id) || { candidates: [] }).candidates.some(x => x.id === remote.id));
  }

  // -------------------------------------------------------------------------
  section('Colours');
  {
    const f = fixture();
    const frame = add(f.page, node('FRAME', 'Card', { layoutMode: 'VERTICAL', fills: [solid('#2F6BFF')] })); // raw, matches blue500 and bgBrand
    const chip = add(frame, node('FRAME', 'Chip', { layoutMode: 'HORIZONTAL', fills: [paintBound('#2F6BFF', f.vars.blue500)] })); // primitive bound directly
    const ok = add(frame, node('RECTANGLE', 'Divider', { strokes: [paintBound('#E7E4DC', f.vars.border)] }));
    const odd = add(frame, node('RECTANGLE', 'Odd', { fills: [solid('#123456')] }));
    const styled = add(frame, node('RECTANGLE', 'Styled', { fills: [solid('#123456')], fillStyleId: 'S:abc' }));
    const inst = add(frame, node('INSTANCE', 'Button', { fills: [solid('#FF0000')] })); add(inst, node('RECTANGLE', 'inner', { fills: [solid('#00FF00')] }));
    f.select(frame);
    const r = await audit(f);
    const col = check(r, 'layers', 'colors'), prim = check(r, 'layers', 'semantic-on-layers');
    t('raw fill is flagged', col.items.some(i => i.id === frame.id));
    t('raw fill offers the semantic token first', (col.items.find(i => i.id === frame.id) || { candidates: [{}] }).candidates[0].id === f.vars.bgBrand.id, JSON.stringify((col.items.find(i => i.id === frame.id) || {}).candidates));
    t('raw fill with no matching token says so (no candidates)', (col.items.find(i => i.id === odd.id) || { candidates: ['x'] }).candidates.length === 0);
    t('fill with a colour style passes', !col.items.some(i => i.id === styled.id));
    t('stroke bound to a semantic token passes', !col.items.some(i => i.id === ok.id));
    t('fill bound to a primitive is flagged in "semantic on layers"', prim.items.some(i => i.id === chip.id));
    t('and gets the semantic alias offered', (prim.items.find(i => i.id === chip.id) || { candidates: [] }).candidates.some(x => x.id === f.vars.bgBrand.id));
    t('instance root with a raw override is flagged', col.items.some(i => i.id === inst.id));
    t('layers inside an instance are skipped', !col.items.some(i => i.name === 'inner'));
  }

  // -------------------------------------------------------------------------
  section('Radius, spacing, layout, names');
  {
    const f = fixture();
    const card = add(f.page, node('FRAME', 'Card', { layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, itemSpacing: 12, cornerRadius: 8 }));
    const boundCard = add(card, node('FRAME', 'Card / Header', { layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, paddingTop: 0, paddingBottom: 0, itemSpacing: 0, cornerRadius: 8, boundVariables: { paddingLeft: bound(f.vars.inset), paddingRight: bound(f.vars.inset), topLeftRadius: bound(f.vars.rad) } }));
    const loose = add(card, node('FRAME', 'Frame 12', { layoutMode: 'NONE' })); add(loose, node('TEXT', 'Title')); add(loose, node('RECTANGLE', 'Rectangle 4')); add(loose, node('ELLIPSE', 'Ellipse 2'));
    const single = add(card, node('FRAME', 'Wrapper', { layoutMode: 'NONE' })); add(single, node('RECTANGLE', 'Image'));
    f.select(card);
    const r = await audit(f);
    const rad = check(r, 'layers', 'radius'), sp = check(r, 'layers', 'spacing'), lay = check(r, 'layers', 'layout'), nm = check(r, 'layers', 'names');
    t('raw radius 8 is flagged and offers radius/md', rad.items.some(i => i.id === card.id) && rad.items.find(i => i.id === card.id).candidates.some(x => x.id === f.vars.rad.id));
    t('bound radius passes', !rad.items.some(i => i.id === boundCard.id));
    t('raw padding 16 and gap 12 are flagged', sp.items.some(i => i.id === card.id));
    t('padding 16 offers space/inset/md, gap 12 offers nothing', (() => { const it = sp.items.find(i => i.id === card.id); const p = it.fields.find(x => x.field === 'paddingLeft'), g = it.fields.find(x => x.field === 'itemSpacing'); return p.candidates.some(x => x.id === f.vars.inset.id) && g.candidates.length === 0; })());
    t('fully bound spacing passes', !sp.items.some(i => i.id === boundCard.id));
    t('frame with text and shapes and no auto-layout is flagged', lay.items.some(i => i.id === loose.id));
    t('frame with 1 child is not flagged for layout', !lay.items.some(i => i.id === single.id));
    t('default names Frame 12, Rectangle 4, Ellipse 2 are flagged', ['Frame 12', 'Rectangle 4', 'Ellipse 2'].every(n => names(nm).indexOf(n) >= 0), JSON.stringify(names(nm)));
    t('"Card / Header" and "Wrapper" are not flagged', !names(nm).some(n => n === 'Card / Header' || n === 'Wrapper'));
  }

  // -------------------------------------------------------------------------
  section('Components');
  {
    const f = fixture();
    const set = add(f.page, node('COMPONENT_SET', 'Input', { componentPropertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['Default', 'Variant2'] }, 'Boolean#2:1': { type: 'BOOLEAN' }, 'Has icon#2:2': { type: 'BOOLEAN' } }, description: '' }));
    const v = add(set, node('COMPONENT', 'Property 1=Default', { layoutMode: 'HORIZONTAL' })); add(v, node('TEXT', 'label')); add(v, node('RECTANGLE', 'leftover', { visible: false }));
    const dismiss = add(v, node('FRAME', 'dismiss', { visible: false, componentPropertyReferences: { visible: 'onDismiss#3:1' } })); add(dismiss, node('INSTANCE', 'close icon', { visible: false }));
    const badge = add(f.page, node('COMPONENT', 'Badge', { description: 'Badge', layoutMode: 'HORIZONTAL', documentationLinks: [{ uri: 'https://example.com/badge' }] })); add(badge, node('TEXT', 'text')); add(badge, node('TEXT', 'count'));
    const card = add(f.page, node('COMPONENT', 'Card', { description: 'Card: groups one item. Use in lists and grids. Not for page sections.', layoutMode: 'NONE' })); add(card, node('TEXT', 'a')); add(card, node('TEXT', 'b'));
    f.select(set, badge, card);
    const r = await audit(f);
    t('empty description is flagged', check(r, 'components', 'desc').items.some(i => i.id === set.id));
    t('one-word description is flagged as thin', check(r, 'components', 'desc-rich').items.some(i => i.id === badge.id));
    t('a real description passes both', !check(r, 'components', 'desc').items.some(i => i.id === card.id) && !check(r, 'components', 'desc-rich').items.some(i => i.id === card.id));
    t('"Property 1" and "Boolean" are flagged, "Has icon" is not', (() => { const p = check(r, 'components', 'props').items.map(i => i.propName); return p.indexOf('Property 1') >= 0 && p.indexOf('Boolean') >= 0 && p.indexOf('Has icon') < 0; })(), JSON.stringify(check(r, 'components', 'props').items.map(i => i.propName)));
    t('variant value "Variant2" is flagged, "Default" is not', (() => { const vals = check(r, 'components', 'values').items.map(i => i.value); return vals.indexOf('Variant2') >= 0 && vals.indexOf('Default') < 0; })());
    t('interactive component (Input) without a State axis is flagged', check(r, 'components', 'states').items.some(i => i.id === set.id));
    t('missing docs link flagged on set, present on Badge passes', check(r, 'components', 'docs-link').items.some(i => i.id === set.id) && !check(r, 'components', 'docs-link').items.some(i => i.id === badge.id));
    t('hidden layer inside a component is flagged', check(r, 'components', 'hidden').items.some(i => i.name === 'leftover'));
    t('layer hidden by a boolean property (onDismiss) is not flagged', !check(r, 'components', 'hidden').items.some(i => i.name === 'dismiss' || i.name === 'close icon'));
    t('component without auto-layout (2 children) is flagged', check(r, 'components', 'comp-layout').items.some(i => i.id === card.id));
    const icon = add(f.page, node('COMPONENT', 'icon/alert-octagon', { layoutMode: 'NONE', description: 'Alert icon. Use in banners and toasts.' })); add(icon, node('VECTOR', 'Vector')); add(icon, node('VECTOR', 'Vector'));
    const illo = add(f.page, node('FRAME', 'Illustration / Empty state', { layoutMode: 'NONE' })); add(illo, node('ELLIPSE', 'Ellipse 1')); add(illo, node('BOOLEAN_OPERATION', 'Union')); const g = add(illo, node('GROUP', 'Group 3')); add(g, node('VECTOR', 'Vector'));
    f.select(set, badge, card, icon, illo);
    const r2 = await audit(f);
    t('icon component (only vectors inside) is not flagged for auto-layout', !check(r2, 'components', 'comp-layout').items.some(i => i.id === icon.id));
    t('illustration frame (shapes and a group of vectors) is not flagged for auto-layout', !check(r2, 'layers', 'layout').items.some(i => i.id === illo.id));
  }

  // -------------------------------------------------------------------------
  section('Variables');
  {
    const f = fixture();
    add(f.page, node('FRAME', 'x')); f.select(f.page.children[0]);
    const r = await audit(f);
    const sc = check(r, 'variables', 'scopes'), syn = check(r, 'variables', 'code-syntax'), desc = check(r, 'variables', 'var-desc'), hid = check(r, 'variables', 'hide-primitives');
    t('unscoped semantic token is flagged with a suggestion', sc.items.some(i => i.id === f.vars.content.id && i.suggest && i.suggest.indexOf('TEXT_FILL') >= 0), JSON.stringify(sc.items));
    t('scoped semantic tokens are not flagged', !sc.items.some(i => i.id === f.vars.bgBrand.id));
    t('primitives are not in the scope check at all', !sc.items.some(i => /blue|neutral|space\/4|radius\/2/.test(i.name)));
    t('semantic token without code syntax is flagged, with a suggestion', syn.items.some(i => i.id === f.vars.content.id && i.suggest === '--color-content-default'), JSON.stringify(syn.items.map(i => [i.name, i.suggest])));
    t('primitives are not in the code-name check', !syn.items.some(i => /blue|neutral/.test(i.name)));
    t('semantic token without description is flagged; with description passes', desc.items.some(i => i.id === f.vars.content.id) && !desc.items.some(i => i.id === f.vars.bgBrand.id));
    t('hidden primitives pass the hide check', hid.items.length === 0, JSON.stringify(names(hid)));
    t('primitive and semantic collections are recognised as separate', check(r, 'variables', 'split').items.length === 0);
    t('"Mode 1" on a single-mode collection is not flagged', !check(r, 'variables', 'modes').items.length);
  }
  {
    const f = new File();
    const col = f.collection('Colors', ['Mode 1', 'Mode 2']);
    const a = f.variable(col, 'blue/500', 'COLOR', ['#2F6BFF', '#2F6BFF']);
    const b = f.variable(col, 'bg/primary', 'COLOR', [{ alias: a }, { alias: a }]);
    add(f.page, node('FRAME', 'x')); f.select(f.page.children[0]);
    const r = await audit(f);
    t('mixed collection is flagged in "separate"', check(r, 'variables', 'split').items.some(i => i.id === col.id));
    t('default mode names "Mode 1 / Mode 2" are flagged', check(r, 'variables', 'modes').items.some(i => i.id === col.id));
    t('visible primitive (alias target) is flagged in hide check', check(r, 'variables', 'hide-primitives').items.some(i => i.id === a.id));
  }
  {
    const f = new File(); // flat file: raw tokens only, no semantic layer
    const col = f.collection('Tokens');
    const a = f.variable(col, 'primary', 'COLOR', '#2F6BFF');
    add(f.page, node('FRAME', 'x')); f.select(f.page.children[0]);
    const r = await audit(f);
    t('file without semantics: raw variables get the scope check', check(r, 'variables', 'scopes').items.some(i => i.id === a.id));
    t('file without semantics: raw variables get the code-name check', check(r, 'variables', 'code-syntax').items.some(i => i.id === a.id));
  }

  // -------------------------------------------------------------------------
  section('Library variables (a product file that uses a published library)');
  {
    const f = new File(); // no local variables at all
    const lib = f.library('Design system');
    const prim = lib.collection('Primitives'); const sem = lib.collection('Semantic', ['Light', 'Dark']);
    const blue = lib.variable(prim, 'color/blue/500', 'COLOR', '#2F6BFF', { hidden: true }); // hidden primitive: not published, only reachable as an alias target
    const grey = lib.variable(prim, 'color/neutral/200', 'COLOR', '#E7E4DC', { hidden: true });
    const brand = lib.variable(sem, 'color/background/brand', 'COLOR', [{ alias: blue }, { alias: blue }], { scopes: ['FRAME_FILL'], codeSyntax: { WEB: '--sds-color-background-brand' } });
    const border = lib.variable(sem, 'color/border/subtle', 'COLOR', [{ alias: grey }, { alias: grey }], { scopes: ['STROKE_COLOR'] });
    const space = lib.variable(sem, 'space/inset/md', 'FLOAT', [16, 16], { scopes: ['GAP'] });
    const card = add(f.page, node('FRAME', 'Card', { layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, itemSpacing: 0, fills: [solid('#2F6BFF')] }));
    const boundRow = add(card, node('FRAME', 'Card / Header', { layoutMode: 'HORIZONTAL', fills: [paintBound('#2F6BFF', brand)], strokes: [paintBound('#E7E4DC', border)] }));
    f.select(card);
    const r = await audit(f);
    const vs = r.steps.find(s => s.key === 'variables');
    t('variables step names the library instead of "no variables"', /Design system/.test(vs.note), vs.note);
    t('library tokens are not run through the local-only checks (scopes, code names)', check(r, 'variables', 'scopes').total === 0 && check(r, 'variables', 'code-syntax').total === 0);
    t('layer bound to a library token counts as tokenised', !check(r, 'layers', 'colors').items.some(i => i.id === boundRow.id));
    const raw = check(r, 'layers', 'colors').items.find(i => i.id === card.id);
    t('raw fill gets the library token offered, resolved through its hidden primitive', !!raw && raw.candidates.some(x => x.id === brand.id), JSON.stringify(raw && raw.candidates));
    const sp = check(r, 'layers', 'spacing').items.find(i => i.id === card.id);
    t('raw padding 16 gets the library spacing token offered', !!sp && sp.fields.some(x => x.candidates.some(c => c.id === space.id)));
  }

  // -------------------------------------------------------------------------
  section('Contrast and scope handling');
  {
    const f = fixture();
    const card = add(f.page, node('FRAME', 'Card', { layoutMode: 'VERTICAL', fills: [solid('#FFFFFF')] }));
    const low = add(card, node('TEXT', 'hint', { fontSize: 12, fills: [solid('#BBBBBB')] }));
    const fine = add(card, node('TEXT', 'body', { fontSize: 12, fills: [solid('#222222')] }));
    f.select(card);
    const r = await audit(f);
    t('low-contrast text is reported (not scored)', check(r, 'layers', 'contrast').items.some(i => i.id === low.id) && check(r, 'layers', 'contrast').scored === false);
    t('good contrast passes', !check(r, 'layers', 'contrast').items.some(i => i.id === fine.id));
    f.select();
    const e = await audit(f);
    t('empty selection returns the empty-selection error', e.error === 'empty-selection');
    const p = await audit(f, 'page');
    t('page scope works without a selection', p.overall !== undefined && !p.error);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? '\n  ' + failures.join('\n  ') : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
