const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createZip } = require('../png-zip.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = app.indexOf('async function downloadAllPng()');
const end = app.indexOf('function printAll()', start);
assert(start >= 0 && end > start, 'all-page PNG export is missing');
assert(html.includes('id="exportPngBtn"') && html.includes('id="exportAllPngBtn"'), 'both PNG save choices must be visible');
assert(html.indexOf('png-zip.js') < html.indexOf('app.js'), 'ZIP helper must load before the app');
assert(app.includes("els.exportAllPngBtn.addEventListener('click', downloadAllPng)"), 'all-page save button is not connected');

{
  const currentStart = app.indexOf('function downloadCurrentPng()');
  const downloads = [];
  const state = { currentPage: 1, dirty: true };
  const context = {
    state, validateCurrentLayout: () => ({ valid: true }), showToast: () => {},
    renderPageToCanvas: (index) => ({ toDataURL: () => `data:image/png;page=${index}` }),
    document: { createElement: () => ({ click() { downloads.push({ name: this.download, href: this.href }); } }) }
  };
  vm.runInNewContext(`${app.slice(currentStart, start)}\ndownloadCurrentPng()`, context);
  assert.deepStrictEqual(downloads, [{ name: 'photo-layout-page-2.png', href: 'data:image/png;page=1' }], 'current-page save must download only the selected page');
}

function setup(valid = true, mutateAfterFirst = false) {
  const state = { pages: [{}, {}], exportRevision: 0, pngExporting: false, dirty: true };
  const button = { innerHTML: '<span>↓</span> 保存全部页面 PNG（ZIP）', disabled: false, textContent: '' };
  const downloads = []; const messages = []; const updates = []; let archive;
  const context = {
    state,
    els: { exportAllPngBtn: button },
    validateCurrentLayout: () => ({ valid, reason: '尺寸不足' }),
    showToast: (message) => messages.push(message),
    updateExportState: () => { button.disabled = state.pngExporting; updates.push(state.pngExporting); },
    renderPageToCanvas: (index) => ({ toBlob(callback) { callback(new Blob([Uint8Array.from([137, 80, 78, 71, index])])); if (mutateAfterFirst && index === 0) state.exportRevision += 1; } }),
    window: { PngZip: { createZip(entries) { archive = createZip(entries); return archive; } } },
    URL: { createObjectURL: () => 'blob:pages', revokeObjectURL: () => {} },
    document: { body: { appendChild: (link) => downloads.push(link) }, createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }) },
    setTimeout: () => {}
  };
  const downloadAllPng = vm.runInNewContext(`${app.slice(start, end)}\ndownloadAllPng`, context);
  return { downloadAllPng, state, button, downloads, messages, updates, getArchive: () => archive };
}

(async () => {
  const run = setup();
  await run.downloadAllPng();
  assert.strictEqual(run.downloads.length, 1, 'all pages must trigger a single ZIP download');
  assert.strictEqual(run.downloads[0].download, 'photo-layout-all-pages.zip');
  assert(run.downloads[0].clicked && run.downloads[0].removed, 'ZIP link must be clicked and removed');
  assert.strictEqual(run.state.pngExporting, false, 'exporting state must reset');
  assert.strictEqual(run.button.disabled, false, 'save button must be available again');
  assert.strictEqual(run.state.dirty, false, 'successful save must mark export complete');
  const zip = Buffer.from(await run.getArchive().arrayBuffer());
  assert.strictEqual(zip.readUInt16LE(zip.length - 12), 2, 'ZIP must contain both pages');
  assert(zip.includes(Buffer.from('photo-layout-page-01.png')) && zip.includes(Buffer.from('photo-layout-page-02.png')), 'ZIP must name every page');
  assert(zip.includes(Buffer.from([137, 80, 78, 71, 0])) && zip.includes(Buffer.from([137, 80, 78, 71, 1])), 'ZIP must contain each page render');

  const invalid = setup(false);
  await invalid.downloadAllPng();
  assert.strictEqual(invalid.downloads.length, 0, 'invalid layouts must not download');
  assert(invalid.messages[0].includes('尺寸不足'), 'invalid layout reason must be shown');

  const changed = setup(true, true);
  await changed.downloadAllPng();
  assert.strictEqual(changed.downloads.length, 0, 'a changed layout must not produce a mixed ZIP');
  assert(changed.messages.some((message) => message.includes('排版已更改')), 'changed layout must explain why export stopped');
  console.log('PNG export tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
