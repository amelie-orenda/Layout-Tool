const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const start = app.indexOf('function printAll()');
const end = app.indexOf('function updateExportState()', start);
assert(start >= 0 && end > start, 'print function is missing');

function element(tagName) {
  return { tagName, style: {}, children: [], appendChild(child) { this.children.push(child); },
    set innerHTML(value) { if (value === '') this.children = []; } };
}

const printRoot = element('root');
const printed = [];
const pages = [{}, {}];
const context = {
  validateCurrentLayout: () => ({ valid: true }),
  reversedPaper: () => ({ w: 210, h: 297 }),
  state: { pages, dirty: true },
  els: { printRoot },
  document: { createElement: element },
  renderPageToCanvas: (index) => ({ ...element('canvas'), pageIndex: index, toDataURL: () => 'data:image/png;base64,test' }),
  window: { print() { printed.push(printRoot.children.map((page) => page.children[0])); } },
  setTimeout: (callback) => callback(), // Simulate a dialog lasting past the old one-second cleanup.
  showToast: () => { throw new Error('Unexpected export failure'); }
};

vm.runInNewContext(`${app.slice(start, end)}\nprintAll()`, context);
assert.strictEqual(printed.length, 1, 'print dialog must open once');
assert.strictEqual(printed[0].length, 2, 'all pages must be present before opening print');
assert(printed[0].every((canvas) => canvas.tagName === 'canvas'), 'print must use fully rendered canvases, not asynchronous images');
assert.deepStrictEqual(printed[0].map((canvas) => canvas.pageIndex), [0, 1], 'pages must retain their order');
assert(printed[0].every((canvas) => canvas.style.width === '210mm' && canvas.style.height === '297mm'), 'print dimensions must match physical paper size');
assert.strictEqual(printRoot.children.length, 2, 'print pages must not disappear while the dialog is open');
vm.runInNewContext(`${app.slice(start, end)}\nprintAll()`, context);
assert.strictEqual(printed.length, 2, 'a later print must still open once');
assert.strictEqual(printRoot.children.length, 2, 'reprinting must replace, not duplicate, print pages');
assert(/function markDirty\(\) \{[^}]*els\.printRoot\.innerHTML = '';/.test(app), 'edits must clear a retained stale print snapshot');
assert(css.includes('.print-page canvas'), 'print stylesheet must size the rendered canvases');
console.log('print export tests passed');
