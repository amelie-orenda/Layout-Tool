(function (root) {
  'use strict';

  function pagePoint(clientX, clientY, rect, paper) {
    return {
      x: (clientX - rect.left) / Math.max(1, rect.width) * paper.w,
      y: (clientY - rect.top) / Math.max(1, rect.height) * paper.h
    };
  }

  function dragPosition(clientX, clientY, rect, paper, item, grabOffset) {
    const point = pagePoint(clientX, clientY, rect, paper);
    const maxX = Math.max(0, paper.w - item.w);
    const maxY = Math.max(0, paper.h - item.h);
    return {
      x: Math.max(0, Math.min(maxX, point.x - grabOffset.x)),
      y: Math.max(0, Math.min(maxY, point.y - grabOffset.y))
    };
  }

  function fitContain(imageWidth, imageHeight, boundsWidth, boundsHeight) {
    const scale = Math.min(boundsWidth / imageWidth, boundsHeight / imageHeight);
    if (![imageWidth, imageHeight, boundsWidth, boundsHeight, scale].every(Number.isFinite) || scale <= 0) return { width: 0, height: 0 };
    return { width: imageWidth * scale, height: imageHeight * scale };
  }

  function visibleBounds(item, source, useCover) {
    if (useCover) return { x: item.x, y: item.y, w: item.w, h: item.h };
    const rotated = (item.rotation || 0) % 180 !== 0;
    const sourceRatio = rotated ? source.sh / source.sw : source.sw / source.sh;
    const targetRatio = item.w / item.h;
    let w = item.w, h = item.h;
    if (sourceRatio > targetRatio) h = item.w / sourceRatio;
    else w = item.h * sourceRatio;
    return { x: item.x + (item.w - w) / 2, y: item.y + (item.h - h) / 2, w, h };
  }

  const api = { pagePoint, dragPosition, fitContain, visibleBounds };
  if (root) root.ManualEditorGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
