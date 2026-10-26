const assert = require('assert');
const fs = require('fs');
const path = require('path');
const geometry = require('../manual-editor-geometry.js');

const paper = { w: 210, h: 297 };
const itemSize = { w: 62, h: 88 };
function clientPoint(pagePoint, rect) {
  return { x: rect.left + pagePoint.x / paper.w * rect.width, y: rect.top + pagePoint.y / paper.h * rect.height };
}
function dragTo(item, point, rect, grabOffset = { x: 12, y: 16 }) {
  const client = clientPoint({ x: point.x + grabOffset.x, y: point.y + grabOffset.y }, rect);
  return geometry.dragPosition(client.x, client.y, rect, paper, { ...itemSize, ...item }, grabOffset);
}

// The same four page corners must be reachable regardless of each element's initial layout cell.
{
  const rect = { left: 35, top: 110, width: 420, height: 594 };
  const starts = [{ x: 0, y: 0 }, { x: 88, y: 24 }, { x: 148, y: 190 }, { x: 34, y: 209 }];
  const corners = [{ x: 0, y: 0 }, { x: 148, y: 0 }, { x: 0, y: 209 }, { x: 148, y: 209 }];
  starts.forEach((start) => corners.forEach((corner) => {
    const result = dragTo(start, corner, rect);
    assert(Math.abs(result.x - corner.x) < 0.001 && Math.abs(result.y - corner.y) < 0.001, `expected position ${corner.x},${corner.y} from start ${start.x},${start.y}; got ${result.x},${result.y}`);
  }));
}

// Re-reading the canvas rect after zoom/scroll keeps coordinates page-relative.
{
  const initialRect = { left: 28, top: 86, width: 420, height: 594 };
  const movedRect = { left: 28, top: 14, width: 840, height: 1188 };
  const start = { x: 104, y: 133 }, grabOffset = { x: 19, y: 21 };
  const down = clientPoint({ x: start.x + grabOffset.x, y: start.y + grabOffset.y }, initialRect);
  const startPoint = geometry.pagePoint(down.x, down.y, initialRect, paper);
  const target = { x: 51, y: 0 };
  const moved = clientPoint({ x: target.x + grabOffset.x, y: target.y + grabOffset.y }, movedRect);
  const result = geometry.dragPosition(moved.x, moved.y, movedRect, paper, { ...itemSize, ...start }, { x: startPoint.x - start.x, y: startPoint.y - start.y });
  assert(Math.abs(result.x - target.x) < 0.001 && result.y === 0, 'scroll/zoom changed the intended page coordinate');
}

// Oversize elements remain anchored at 0, and normal drags keep the whole rectangle on-page.
{
  const rect = { left: 0, top: 0, width: 420, height: 594 };
  const oversized = { x: 5, y: 5, w: 240, h: 330 };
  const result = geometry.dragPosition(-100, -100, rect, paper, oversized, { x: 0, y: 0 });
  assert.deepStrictEqual(result, { x: 0, y: 0 });
  const edge = geometry.dragPosition(420, 594, rect, paper, itemSize, { x: 0, y: 0 });
  assert.deepStrictEqual(edge, { x: paper.w - itemSize.w, y: paper.h - itemSize.h });
}

// Crop preview scaling fits complete landscape, portrait, and panorama originals without distortion.
{
  const sources = [[4000, 2000], [2000, 4000], [20000, 2000]];
  for (const [width, height] of sources) {
    const fitted = geometry.fitContain(width, height, 500, 300);
    assert(fitted.width <= 500 + 0.001 && fitted.height <= 300 + 0.001, 'crop preview exceeds its responsive viewport');
    assert(Math.abs(fitted.width / fitted.height - width / height) < 0.001, 'crop preview distorts the original aspect ratio');
  }
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert(app.includes('function startCropInteraction') && app.includes('normalizeCrop(next)'), 'the existing crop editing calculations must remain active');
  assert(html.includes('data-crop-shade="top"') && html.includes('data-crop-shade="bottom"'), 'crop mask must cover only the area outside the selection');
  assert(css.includes('.crop-preview') && css.includes('overflow: visible'), 'crop viewport must not clip the fitted original image');
  assert(css.includes('.crop-modal { max-height: calc(100vh - 24px); overflow-y: auto; }'), 'crop dialog must scroll on short screens');
}

// Selection bounds follow the rendered image, not a larger contain-mode allocation rectangle.
{
  const frame = { x: 30, y: 40, w: 100, h: 100, rotation: 0 };
  const landscape = geometry.visibleBounds(frame, { sw: 200, sh: 100 }, false);
  assert.deepStrictEqual(landscape, { x: 30, y: 65, w: 100, h: 50 });
  const portraitCrop = geometry.visibleBounds(frame, { sw: 80, sh: 160 }, false);
  assert.deepStrictEqual(portraitCrop, { x: 55, y: 40, w: 50, h: 100 });
  assert.deepStrictEqual(geometry.visibleBounds(frame, { sw: 200, sh: 100 }, true), { x: 30, y: 40, w: 100, h: 100 }, 'cover-mode photo should fill its visible frame');
  const manuallyCroppedLandscape = geometry.visibleBounds(frame, { sw: 1000, sh: 250 }, false);
  assert.deepStrictEqual(manuallyCroppedLandscape, { x: 30, y: 77.5, w: 100, h: 25 }, 'selection bounds must use the selected source crop aspect ratio');
  const manuallyCroppedRotated = geometry.visibleBounds({ ...frame, rotation: 90 }, { sw: 1000, sh: 250 }, false);
  assert.deepStrictEqual(manuallyCroppedRotated, { x: 67.5, y: 40, w: 25, h: 100 }, 'selection bounds must use the cropped aspect ratio after quarter-turn rotation');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(app.includes('manualGeometry.visibleBounds(item, source, useCover)'), 'selection and render bounds must share the same visible-bounds calculation');
  assert(app.includes('position.x - bounds.x') && app.includes('position.y - bounds.y'), 'drag clamp must preserve the image offset inside an old layout frame');
  assert(app.includes('const visible = visiblePhotoBounds(photo, item); if (Math.min(visible.w, visible.h) + .001 < state.minPhotoEdge)'), 'final export validation must enforce minimum visible physical size in manual and automatic edit states');
}

console.log('manual editor geometry tests passed');
