const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.strictEqual(new Set(htmlIds).size, htmlIds.length, 'HTML IDs must be unique');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert(htmlIds.includes(match[1]), `${match[1]} is referenced in app.js but missing from HTML`);

for (const id of ['uploadZone', 'photoViewToggle', 'selectAllPhotos', 'photoList', 'pageThumbnails', 'candidatePages', 'paperSettingsToggle', 'paperSettingsBody', 'lockAspectRatio']) {
  assert.strictEqual((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must occur exactly once`);
}
assert(html.indexOf('id="uploadZone"') < html.indexOf('id="photoViewToggle"') && html.indexOf('id="photoViewToggle"') < html.indexOf('id="photoList"'), 'upload and view toggle belong above the photo list');
assert(html.indexOf('id="lockAspectRatio"') < html.indexOf('id="cropSelectedBtn"'), 'aspect-ratio lock belongs immediately before Crop in the canvas toolbar');
assert(html.indexOf('id="pageThumbnails"') > html.indexOf('id="canvasStage"'), 'page thumbnails belong below the main canvas');
assert(html.indexOf('id="candidatePages"') > html.indexOf('id="pageCountInput"'), 'candidate previews belong in the settings sidebar');
const paperBody = html.slice(html.indexOf('id="paperSettingsBody"'), html.indexOf('</section>', html.indexOf('id="paperSettingsBody"')));
assert(paperBody.includes('id="paperSelect"') && !paperBody.includes('id="marginInput"'), 'paper collapse must affect only paper selection');

assert(app.includes("photoView: 'list'"), 'existing list presentation must remain the default');
assert(app.includes("state.photoView === 'list' ? 'thumbnails' : 'list'"), 'four-square button must toggle in both directions');
assert(css.includes('.photo-list.thumbnail-view') && css.includes('.thumbnail-view .weight-control'), 'thumbnail presentation must show an editable weight on the photo');
assert(app.includes("row.querySelector('.weight-input').addEventListener('change'"), 'weight edits must still update the layout');
assert(app.includes("els.paperSettingsBody.hidden = expanded"), 'paper selection must collapse independently');
assert(app.includes('function drawCandidatePreview') && app.includes('drawItem(ctx, photo, item)'), 'candidate previews must use the same image geometry as the canvas and export');
assert(app.includes('drawCandidatePreview(canvas, page, p, 120)') && app.includes('renderThumbnails();'), 'page thumbnails must follow current page geometry');
assert(app.includes("els.candidatePages.addEventListener('click'"), 'candidate selection must remain interactive');
console.log('page layout structure tests passed');
