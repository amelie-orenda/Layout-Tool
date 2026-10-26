(function (root) {
  'use strict';

  const EPSILON = 0.0001;
  const MIN_RECT = 0.5;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function weightScore(photo) { return Math.pow(clamp(Number(photo && photo.weight) || 1, 1, 99), 0.7); }
  function cropOf(photo) { return photo && photo.crop ? photo.crop : { x: 0, y: 0, w: 1, h: 1 }; }
  function priorityOf(priority) { return priority === 'weight' || priority === 'space' ? priority : 'balanced'; }
  function photoRatio(photo) {
    const crop = cropOf(photo);
    const width = (Number(photo && photo.naturalWidth) || 1) * Math.max(EPSILON, crop.w || 1);
    const height = (Number(photo && photo.naturalHeight) || 1) * Math.max(EPSILON, crop.h || 1);
    return width / height;
  }

  function getCropPlan(photo, item) {
    const crop = cropOf(photo);
    let sx = crop.x * (Number(photo && photo.naturalWidth) || 1);
    let sy = crop.y * (Number(photo && photo.naturalHeight) || 1);
    let sw = crop.w * (Number(photo && photo.naturalWidth) || 1);
    let sh = crop.h * (Number(photo && photo.naturalHeight) || 1);
    const originalArea = Math.max(EPSILON, sw * sh);
    if (item.cropMode !== 'cover') return { sx, sy, sw, sh, fraction: 1, canCover: false };
    const rotated = (item.rotation || 0) % 180 !== 0;
    const targetRatio = Math.max(EPSILON, item.w / Math.max(EPSILON, item.h));
    const sourceRatio = rotated ? sh / Math.max(EPSILON, sw) : sw / Math.max(EPSILON, sh);
    if (sourceRatio > targetRatio) {
      if (rotated) { const nextH = sw * targetRatio; sy += (sh - nextH) / 2; sh = nextH; }
      else { const nextW = sh * targetRatio; sx += (sw - nextW) / 2; sw = nextW; }
    } else if (rotated) {
      const nextW = sh / targetRatio; sx += (sw - nextW) / 2; sw = nextW;
    } else {
      const nextH = sw / targetRatio; sy += (sh - nextH) / 2; sh = nextH;
    }
    const fraction = clamp((sw * sh) / originalArea, 0, 1);
    return { sx, sy, sw, sh, fraction, canCover: fraction >= 0.7 };
  }

  function visiblePhotoBounds(photo, item) {
    const crop = getCropPlan(photo, item);
    if (item.cropMode === 'cover' && crop.canCover) return { x: item.x, y: item.y, w: item.w, h: item.h };
    const sourceCrop = cropOf(photo); const rotated = (item.rotation || 0) % 180 !== 0;
    const sourceWidth = (Number(photo && photo.naturalWidth) || 1) * Math.max(EPSILON, sourceCrop.w || 1);
    const sourceHeight = (Number(photo && photo.naturalHeight) || 1) * Math.max(EPSILON, sourceCrop.h || 1);
    const sourceRatio = rotated ? sourceHeight / sourceWidth : sourceWidth / sourceHeight;
    const targetRatio = Math.max(EPSILON, item.w / Math.max(EPSILON, item.h));
    let w = item.w, h = item.h;
    if (sourceRatio > targetRatio) h = item.w / sourceRatio;
    else w = item.h * sourceRatio;
    return { x: item.x + (item.w - w) / 2, y: item.y + (item.h - h) / 2, w, h };
  }

  function bestRotation(photo, rect, autoRotate) {
    if (!autoRotate) return 0;
    const sourceRatio = photoRatio(photo);
    const targetRatio = Math.max(EPSILON, rect.w / Math.max(EPSILON, rect.h));
    const normalDistance = Math.abs(Math.log(sourceRatio / targetRatio));
    const rotatedDistance = Math.abs(Math.log((1 / sourceRatio) / targetRatio));
    return rotatedDistance + 0.015 < normalDistance ? 90 : 0;
  }

  function allocatePhotos(photos, pageCount, seed) {
    const mode = Math.abs(seed) % 6;
    const order = orderItems(photos, seed);
    const buckets = Array.from({ length: pageCount }, () => []);
    const totals = Array(pageCount).fill(0);
    order.forEach((photo, index) => {
      if (mode === 1) {
        const target = (index + seed) % pageCount;
        buckets[target].push(photo); totals[target] += weightScore(photo); return;
      }
      const choices = totals.map((total, page) => ({ page, total, count: buckets[page].length }));
      choices.sort((a, b) => (mode === 3 ? a.count - b.count || a.total - b.total : a.total - b.total || a.count - b.count) || ((a.page + seed + index) % pageCount) - ((b.page + seed + index) % pageCount));
      const target = choices[0].page;
      buckets[target].push(photo);
      totals[target] += weightScore(photo);
    });
    return buckets;
  }

  function allocateGroupedPhotos(photos, pageCount, seed, variant = 0) {
    const strategy = Math.abs(variant) % 4;
    const stableOrder = (a, b) => String(a.id).localeCompare(String(b.id));
    const ordered = [...photos].sort((a, b) => {
      if (strategy === 0) return weightScore(a) - weightScore(b) || stableOrder(a, b);
      if (strategy === 1) return Math.log(photoRatio(a)) - Math.log(photoRatio(b)) || weightScore(a) - weightScore(b) || stableOrder(a, b);
      if (strategy === 2) {
        const difficulty = (photo) => Math.abs(Math.log(photoRatio(photo))) + 0.18 / weightScore(photo);
        return difficulty(b) - difficulty(a) || weightScore(a) - weightScore(b) || stableOrder(a, b);
      }
      return weightScore(b) - weightScore(a) || Math.abs(Math.log(photoRatio(b))) - Math.abs(Math.log(photoRatio(a))) || stableOrder(a, b);
    });
    if (strategy < 3) {
      const buckets = Array.from({ length: pageCount }, () => []);
      let cursor = 0;
      for (let page = 0; page < pageCount; page += 1) {
        const remaining = ordered.length - cursor;
        const pagesLeft = pageCount - page;
        const count = Math.ceil(remaining / pagesLeft);
        buckets[page] = ordered.slice(cursor, cursor + count);
        cursor += count;
      }
      return buckets;
    }

    // Large-neighborhood page repack: rebuild every page assignment from scratch,
    // placing difficult/high-area photos first and balancing weight, count and aspect.
    const buckets = Array.from({ length: pageCount }, () => []);
    const loads = Array.from({ length: pageCount }, () => ({ weight: 0, count: 0, aspect: 0 }));
    ordered.forEach((photo) => {
      const bestPage = loads.map((load, page) => {
        const nextCount = load.count + 1;
        const nextWeight = load.weight + weightScore(photo);
        const aspectAffinity = load.count ? Math.abs(load.aspect / load.count - Math.log(photoRatio(photo))) : 0;
        const score = Math.abs(nextCount - photos.length / pageCount) * 2.4
          + Math.abs(nextWeight - photos.reduce((sum, entry) => sum + weightScore(entry), 0) / pageCount) * 0.35
          + aspectAffinity * 0.12;
        return { page, score };
      }).sort((a, b) => a.score - b.score || ((a.page + seed) % pageCount) - ((b.page + seed) % pageCount))[0].page;
      buckets[bestPage].push(photo);
      loads[bestPage].weight += weightScore(photo);
      loads[bestPage].count += 1;
      loads[bestPage].aspect += Math.log(photoRatio(photo));
    });
    return buckets;
  }

  function deterministicKey(item, seed) {
    const text = String(item.id); let hash = seed * 17 + text.length;
    for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 1000003;
    return hash;
  }

  function orderItems(items, seed) {
    const mode = Math.abs(seed) % 6; const copy = [...items];
    if (mode === 0) return copy.sort((a, b) => weightScore(b) - weightScore(a) || String(a.id).localeCompare(String(b.id)));
    if (mode === 1) return copy.sort((a, b) => weightScore(a) - weightScore(b) || String(a.id).localeCompare(String(b.id)));
    if (mode === 2) return copy.sort((a, b) => photoRatio(b) - photoRatio(a) || String(a.id).localeCompare(String(b.id)));
    if (mode === 3) return copy.sort((a, b) => photoRatio(a) - photoRatio(b) || String(a.id).localeCompare(String(b.id)));
    if (mode === 4) return copy.sort((a, b) => deterministicKey(a, seed) - deterministicKey(b, seed));
    const byWeight = copy.sort((a, b) => weightScore(b) - weightScore(a) || String(a.id).localeCompare(String(b.id))); const interleaved = [];
    for (let left = 0, right = byWeight.length - 1; left <= right; left += 1, right -= 1) { interleaved.push(byWeight[left]); if (right !== left) interleaved.push(byWeight[right]); }
    return interleaved;
  }

  function photoGroupSplits(items) {
    if (items.length < 4) return [];
    const byWeight = [...items].sort((a, b) => weightScore(a) - weightScore(b) || String(a.id).localeCompare(String(b.id)));
    let largestWeightGap = 0; let weightCut = 0;
    for (let index = 0; index < byWeight.length - 1; index += 1) {
      const gap = weightScore(byWeight[index + 1]) / Math.max(EPSILON, weightScore(byWeight[index]));
      if (gap > largestWeightGap) { largestWeightGap = gap; weightCut = index + 1; }
    }
    if (largestWeightGap < 1.5) weightCut = clamp(Math.round(items.length * 0.4), 2, items.length - 2);
    const weightGroups = [byWeight.slice(0, weightCut), byWeight.slice(weightCut)];

    const byAspect = [...items].sort((a, b) => Math.log(photoRatio(a)) - Math.log(photoRatio(b)) || String(a.id).localeCompare(String(b.id)));
    let largestAspectGap = 0; let aspectCut = Math.floor(items.length / 2);
    for (let index = 0; index < byAspect.length - 1; index += 1) {
      const gap = Math.log(photoRatio(byAspect[index + 1]) / photoRatio(byAspect[index]));
      if (gap > largestAspectGap) { largestAspectGap = gap; aspectCut = index + 1; }
    }
    if (largestAspectGap < 0.35) aspectCut = clamp(Math.round(items.length / 2), 2, items.length - 2);
    const aspectGroups = [byAspect.slice(0, aspectCut), byAspect.slice(aspectCut)];
    return [weightGroups, aspectGroups];
  }

  function splitGroups(items, seed, depth) {
    if (items.length < 2) return [items, []];
    const ordered = orderItems(items, seed + depth * 7); const method = Math.abs(seed * 3 + depth) % 10; const groups = [[], []];
    if (method === 7 || method === 8) {
      const grouped = photoGroupSplits(items);
      if (grouped.length) return grouped[method - 7];
    }
    if (method === 9 && items.length >= 4) {
      const byWeight = [...items].sort((a, b) => weightScore(a) - weightScore(b) || String(a.id).localeCompare(String(b.id)));
      const cut = clamp(Math.ceil(items.length * 0.4), 2, items.length - 2);
      return [byWeight.slice(0, cut), byWeight.slice(cut)];
    }
    if (method === 1) {
      const cut = clamp(Math.round(ordered.length * (0.35 + ((seed + depth) % 4) * 0.1)), 1, ordered.length - 1);
      groups[0] = ordered.slice(0, cut); groups[1] = ordered.slice(cut); return groups;
    }
    if (method === 2) {
      const total = ordered.reduce((sum, item) => sum + weightScore(item), 0); let running = 0; let cut = 1;
      for (let index = 0; index < ordered.length - 1; index += 1) { running += weightScore(ordered[index]); if (running >= total / 2) { cut = index + 1; break; } }
      groups[0] = ordered.slice(0, cut); groups[1] = ordered.slice(cut); return groups;
    }
    if (method === 3) {
      ordered.forEach((item, index) => groups[(index + seed + depth) % 2].push(item)); return groups;
    }
    if (method === 5) {
      const byAspect = [...items].sort((a, b) => photoRatio(a) - photoRatio(b)); const cut = clamp(Math.ceil(byAspect.length / 2) + ((seed + depth) % 3) - 1, 1, byAspect.length - 1);
      groups[0] = byAspect.slice(0, cut); groups[1] = byAspect.slice(cut); return groups;
    }
    if (method === 6) {
      const randomized = [...items].sort((a, b) => deterministicKey(a, seed + depth * 11) - deterministicKey(b, seed + depth * 11)); const cut = clamp(1 + ((seed + depth) % (items.length - 1)), 1, items.length - 1);
      groups[0] = randomized.slice(0, cut); groups[1] = randomized.slice(cut); return groups;
    }
    const sums = [0, 0];
    ordered.forEach((item, index) => {
      let target = sums[0] <= sums[1] ? 0 : 1;
      if (method === 4 && index % 3 === 0) target = 1 - target;
      groups[target].push(item); sums[target] += weightScore(item);
    });
    if (!groups[0].length || !groups[1].length) { groups[0] = ordered.slice(0, Math.ceil(ordered.length / 2)); groups[1] = ordered.slice(Math.ceil(ordered.length / 2)); }
    return groups;
  }

  function layoutRects(items, rect, options, seed, depth) {
    if (!items.length) return [];
    if (items.length === 1) {
      const w = Math.max(MIN_RECT, rect.w); const h = Math.max(MIN_RECT, rect.h); const minimum = Math.max(MIN_RECT, options.minPhotoEdge || 0);
      const candidate = { photoId: items[0].id, x: rect.x, y: rect.y, w, h, cropMode: options.cropMode, rotation: bestRotation(items[0], rect, options.autoRotate) };
      const visible = visiblePhotoBounds(items[0], candidate);
      if (options.hardMinimum && Math.min(visible.w, visible.h) + EPSILON < minimum) return null;
      return [candidate];
    }
    const groups = splitGroups(items, seed, depth);
    const first = groups[0]; const second = groups[1];
    const firstWeight = first.reduce((sum, item) => sum + weightScore(item), 0);
    const totalWeight = items.reduce((sum, item) => sum + weightScore(item), 0);
    // Candidate geometry is deliberately priority-neutral. All modes must choose
    // from the same pool before applying their own objective function.
    const biasList = [1, 0.76, 1.24, 0.9, 1.1, 0.68, 1.32, 0.84, 1.16];
    const desiredRatio = firstWeight / Math.max(EPSILON, totalWeight);
    const ratio = clamp(desiredRatio * biasList[(seed + depth * 2) % biasList.length], 0.16, 0.84);
    const gap = clamp(Number(options.gap) || 0, 0, Math.min(rect.w, rect.h) * 0.35);
    const usableWidth = Math.max(MIN_RECT * 2, rect.w - gap);
    const usableHeight = Math.max(MIN_RECT * 2, rect.h - gap);
    const wide = rect.w >= rect.h;
    const preferredHorizontal = ((wide ? 1 : 0) ^ ((seed + depth) % 2)) === 1;
    const minimum = Math.max(MIN_RECT, options.minPhotoEdge || 0);
    const ratios = [...new Set([ratio, 0.5, 1 - ratio])];
    for (const horizontal of [preferredHorizontal, !preferredHorizontal]) {
      if (horizontal && options.hardMinimum && (rect.h + EPSILON < minimum || usableWidth + EPSILON < minimum * 2)) continue;
      if (!horizontal && options.hardMinimum && (rect.w + EPSILON < minimum || usableHeight + EPSILON < minimum * 2)) continue;
      for (const splitRatio of ratios) {
        if (horizontal) {
          const firstWidth = clamp(usableWidth * splitRatio, MIN_RECT, usableWidth - MIN_RECT);
          const firstRect = { x: rect.x, y: rect.y, w: firstWidth, h: rect.h };
          const secondRect = { x: rect.x + firstWidth + gap, y: rect.y, w: usableWidth - firstWidth, h: rect.h };
          const firstItems = layoutRects(first, firstRect, options, seed + 1, depth + 1);
          if (!firstItems) continue;
          const secondItems = layoutRects(second, secondRect, options, seed + 2, depth + 1);
          if (secondItems) return firstItems.concat(secondItems);
        } else {
          const firstHeight = clamp(usableHeight * splitRatio, MIN_RECT, usableHeight - MIN_RECT);
          const firstRect = { x: rect.x, y: rect.y, w: rect.w, h: firstHeight };
          const secondRect = { x: rect.x, y: rect.y + firstHeight + gap, w: rect.w, h: usableHeight - firstHeight };
          const firstItems = layoutRects(first, firstRect, options, seed + 1, depth + 1);
          if (!firstItems) continue;
          const secondItems = layoutRects(second, secondRect, options, seed + 2, depth + 1);
          if (secondItems) return firstItems.concat(secondItems);
        }
      }
    }
    return null;
  }

  function layoutGroupedRects(items, rect, options, seed, depth = 0) {
    const splits = photoGroupSplits(items);
    if (!splits.length) return null;
    const [first, second] = splits[Math.abs(seed + depth) % splits.length];
    const gap = clamp(Number(options.gap) || 0, 0, Math.min(rect.w, rect.h) * 0.35);
    const splitX = ((seed + depth) % 2) === 0;
    const usable = Math.max(MIN_RECT * 2, (splitX ? rect.w : rect.h) - gap);
    const cross = splitX ? rect.h : rect.w;
    const minimum = Math.max(MIN_RECT, options.minPhotoEdge || 0);
    if (options.hardMinimum && cross + EPSILON < minimum) return null;
    const totalWeight = items.reduce((sum, item) => sum + weightScore(item), 0);
    const weightShare = first.reduce((sum, item) => sum + weightScore(item), 0) / Math.max(EPSILON, totalWeight);
    const countShare = first.length / items.length;
    const mode = Math.abs(Math.floor(seed / 2) + depth) % 3;
    const desired = mode === 0 ? weightShare : mode === 1 ? countShare : 0.5;
    // A group's minimum area is not a valid linear split ratio. Derive the
    // minimum extent from how many minimum-size tiles fit across the cross-axis.
    const minimumExtent = (count, crossExtent) => {
      const slotsAcross = Math.floor((crossExtent + gap + EPSILON) / (minimum + gap));
      if (slotsAcross < 1) return Infinity;
      const tracks = Math.ceil(count / slotsAcross);
      return tracks * minimum + Math.max(0, tracks - 1) * gap;
    };
    const firstMinimumExtent = options.hardMinimum ? minimumExtent(first.length, cross) : MIN_RECT;
    const secondMinimumExtent = options.hardMinimum ? minimumExtent(second.length, cross) : MIN_RECT;
    const minShare = options.hardMinimum ? firstMinimumExtent / usable : 0.12;
    const maxShare = options.hardMinimum ? 1 - secondMinimumExtent / usable : 0.88;
    if (minShare > maxShare) return null;
    const ratio = clamp(desired, minShare, maxShare);
    const firstExtent = usable * ratio;
    const secondExtent = usable - firstExtent;
    const firstRect = splitX ? { x: rect.x, y: rect.y, w: firstExtent, h: rect.h } : { x: rect.x, y: rect.y, w: rect.w, h: firstExtent };
    const secondRect = splitX ? { x: rect.x + firstExtent + gap, y: rect.y, w: secondExtent, h: rect.h } : { x: rect.x, y: rect.y + firstExtent + gap, w: rect.w, h: secondExtent };
    const firstItems = layoutRects(first, firstRect, options, seed + 1, depth + 1);
    const secondItems = layoutRects(second, secondRect, options, seed + 2, depth + 1);
    return firstItems && secondItems ? firstItems.concat(secondItems) : null;
  }

  function rectanglesOverlap(a, b) {
    return a.x < b.x + b.w - EPSILON && a.x + a.w > b.x + EPSILON && a.y < b.y + b.h - EPSILON && a.y + a.h > b.y + EPSILON;
  }

  function validGeometry(items, inner, minPhotoEdge = 0) {
    return items.every((item) => item.x >= inner.x - EPSILON && item.y >= inner.y - EPSILON && item.x + item.w <= inner.x + inner.w + EPSILON && item.y + item.h <= inner.y + inner.h + EPSILON && item.w >= Math.max(MIN_RECT, minPhotoEdge) - EPSILON && item.h >= Math.max(MIN_RECT, minPhotoEdge) - EPSILON) && items.every((item, index) => items.slice(index + 1).every((other) => !rectanglesOverlap(item, other)));
  }

  function pageWeightTotal(page) { return page.items.reduce((sum, item) => sum + weightScore(item.photo), 0); }

  function evaluatePlan(pages, options, inner) {
    const allItems = []; const pageTotals = []; const pageAreas = []; const pageCoverageAreas = [];
    const photoFor = (item) => item.photo || (options.photoMap && options.photoMap.get(item.photoId));
    let rectangleArea = 0; let visibleArea = 0; let cropLoss = 0; let aspectLoss = 0; let minViolations = 0; let minDeficit = 0; let missing = 0;
    pages.forEach((page, pageIndex) => {
      let pageTotal = 0; let pageArea = 0; let pageCoverageArea = 0;
      page.items.forEach((item) => {
        const photo = photoFor(item);
        if (!photo) return;
        const area = item.w * item.h; const crop = getCropPlan(photo, item); const visible = visiblePhotoBounds(photo, item); const coverageArea = visible.w * visible.h; const fit = Math.min(1, coverageArea / Math.max(EPSILON, area)); const shortEdge = Math.min(visible.w, visible.h);
        item.debug = { id: item.photoId, weight: Number(photo.weight) || 1, area: coverageArea, rectangleArea: area, coverageArea, shortEdge, cropFraction: crop.fraction, fitFraction: fit, rotation: item.rotation || 0, x: item.x, y: item.y, w: item.w, h: item.h, page: pageIndex };
        allItems.push(item); pageTotal += weightScore(photo); pageArea += area; pageCoverageArea += coverageArea; rectangleArea += area; visibleArea += coverageArea; cropLoss += 1 - crop.fraction; aspectLoss += 1 - fit;
        if (shortEdge + EPSILON < options.minPhotoEdge) { minViolations += 1; minDeficit += (options.minPhotoEdge - shortEdge) / Math.max(EPSILON, options.minPhotoEdge); }
      });
      pageTotals.push(pageTotal); pageAreas.push(pageArea); pageCoverageAreas.push(pageCoverageArea);
    });
    const expectedCount = options.photos.length; missing += Math.max(0, expectedCount - allItems.length);
    const totalWeight = options.photos.reduce((sum, photo) => sum + weightScore(photo), 0);
    const capacity = Math.max(EPSILON, inner.w * inner.h * Math.max(1, pages.length));
    const utilization = Math.min(1, visibleArea / capacity);
    const rectangleUtilization = Math.min(1, rectangleArea / capacity);
    const blankArea = Math.max(0, capacity - visibleArea);
    let targetAreaDeviation = 0; let weightMinDeficit = 0;
    allItems.forEach((item) => {
      const targetArea = capacity * weightScore(photoFor(item)) / Math.max(EPSILON, totalWeight);
      const relativeDeviation = Math.abs(item.debug.area - targetArea) / Math.max(EPSILON, targetArea);
      targetAreaDeviation += Math.min(4, relativeDeviation);
      const minimumArea = targetArea * 0.62;
      weightMinDeficit += Math.max(0, minimumArea - item.debug.area) / Math.max(EPSILON, minimumArea);
    });
    targetAreaDeviation /= Math.max(1, allItems.length);
    weightMinDeficit /= Math.max(1, allItems.length);
    const smallCount = Math.min(allItems.length, Math.max(2, Math.ceil(allItems.length * 0.35)));
    const smallItems = [...allItems].sort((a, b) => weightScore(photoFor(a)) - weightScore(photoFor(b)) || String(a.photoId).localeCompare(String(b.photoId))).slice(0, smallCount);
    const smallPositions = pages.flatMap((page, pageIndex) => page.items.filter((item) => smallItems.some((small) => small.photoId === item.photoId)).map((item) => {
      const visible = visiblePhotoBounds(photoFor(item), item);
      return { pageIndex, x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 };
    }));
    let smallPhotoScattering = 0; let smallPairCount = 0;
    for (let i = 0; i < smallPositions.length; i += 1) for (let j = i + 1; j < smallPositions.length; j += 1) {
      const a = smallPositions[i]; const b = smallPositions[j];
      smallPhotoScattering += a.pageIndex === b.pageIndex ? Math.hypot((a.x - b.x) / inner.w, (a.y - b.y) / inner.h) / Math.SQRT2 : 1;
      smallPairCount += 1;
    }
    smallPhotoScattering /= Math.max(1, smallPairCount);
    const priority = options.priority;
    const prioritySettings = priority === 'weight'
      ? { ranking: 300, target: 8, minimum: 32, coverage: 8, crop: 7, aspect: 3, similarityThreshold: 0.08, areaTolerance: 0.1, inversionTolerance: 0.04 }
      : priority === 'space'
        ? { ranking: 65, target: 1.5, minimum: 12, coverage: 30, crop: 6, aspect: 8, similarityThreshold: 0.2, areaTolerance: 0.35, inversionTolerance: 0.12 }
        : { ranking: 180, target: 4.5, minimum: 25, coverage: 16, crop: 9, aspect: 4, similarityThreshold: 0.2, areaTolerance: 0.25, inversionTolerance: 0.08 };
    let areaRankingViolations = 0; let weightRankingViolations = 0; let weightRankingPenalty = 0; const rankingViolationIds = new Set();
    for (let i = 0; i < allItems.length; i += 1) {
      for (let j = i + 1; j < allItems.length; j += 1) {
        const a = allItems[i]; const b = allItems[j]; const photoA = photoFor(a); const photoB = photoFor(b); const wa = weightScore(photoA); const wb = weightScore(photoB);
        const high = wa >= wb ? a : b; const low = wa >= wb ? b : a; const highWeight = Math.max(wa, wb); const lowWeight = Math.min(wa, wb); const highArea = high.debug.area; const lowArea = low.debug.area;
        const rawHighWeight = Math.max(Number(photoA.weight) || 1, Number(photoB.weight) || 1); const rawLowWeight = Math.min(Number(photoA.weight) || 1, Number(photoB.weight) || 1);
        const weightGap = highWeight / Math.max(EPSILON, lowWeight) - 1; const areaInversion = lowArea / Math.max(EPSILON, highArea) - 1;
        const meaningfulWeightGap = weightGap > prioritySettings.similarityThreshold; const excessiveAreaGap = areaInversion > prioritySettings.areaTolerance;
        if (highWeight > lowWeight + EPSILON && highArea + EPSILON < lowArea && (excessiveAreaGap || (meaningfulWeightGap && areaInversion > prioritySettings.inversionTolerance))) {
          areaRankingViolations += 1;
          weightRankingPenalty += (Math.max(0.05, weightGap - prioritySettings.similarityThreshold) + Math.max(0, areaInversion - prioritySettings.areaTolerance)) * (1 + areaInversion);
        }
        if (rawHighWeight / Math.max(EPSILON, rawLowWeight) > 1.2 && highArea < lowArea * 0.8) { weightRankingViolations += 1; rankingViolationIds.add(high.photoId); }
      }
    }
    const averagePageTotal = pageTotals.reduce((sum, value) => sum + value, 0) / Math.max(1, pageTotals.length);
    const pageBalance = pageTotals.reduce((sum, value) => sum + Math.abs(value - averagePageTotal), 0) / Math.max(EPSILON, averagePageTotal * pageTotals.length);
    const averagePageArea = pageCoverageAreas.reduce((sum, value) => sum + value, 0) / Math.max(1, pageCoverageAreas.length);
    const visualBalance = pageCoverageAreas.reduce((sum, value) => sum + Math.abs(value - averagePageArea), 0) / Math.max(EPSILON, averagePageArea * pageCoverageAreas.length);
    const invalid = pages.some((page) => !validGeometry(page.items, inner, options.minPhotoEdge));
    const hardConstraintsMet = missing === 0 && !invalid && minViolations === 0;
    const score = missing * 1500 + (invalid ? 1500 : 0) + minViolations * 55 + minDeficit * 28 + weightRankingPenalty * prioritySettings.ranking + weightMinDeficit * prioritySettings.minimum + cropLoss / Math.max(1, allItems.length) * prioritySettings.crop + aspectLoss / Math.max(1, allItems.length) * prioritySettings.aspect + targetAreaDeviation * prioritySettings.target + smallPhotoScattering * 0.18 + pageBalance * 2 + visualBalance * 0.8 + Math.max(0, 0.92 - utilization) * prioritySettings.coverage + pages.length * 0.32;
    const debugItems = allItems.map((item) => ({ ...item.debug }));
    const sortedAreas = [...allItems].sort((a, b) => b.debug.area - a.debug.area);
    const areaRank = new Map(sortedAreas.map((item, index) => [item.photoId, index + 1]));
    debugItems.forEach((debug) => { debug.areaRank = areaRank.get(debug.id) || null; debug.weightRank = null; });
    const sortedWeights = [...allItems].sort((a, b) => weightScore(photoFor(b)) - weightScore(photoFor(a)));
    sortedWeights.forEach((item, index) => { const debug = debugItems.find((entry) => entry.id === item.photoId); if (debug) debug.weightRank = index + 1; });
    debugItems.forEach((debug) => { debug.rankingViolation = rankingViolationIds.has(debug.id); debug.minViolation = debug.shortEdge < options.minPhotoEdge; });
    const metrics = { score: score + (hardConstraintsMet ? 0 : 100000), rawScore: score, utilization, coverage: utilization, coverageArea: visibleArea, rectangleArea, rectangleUtilization, blankArea, cropLoss: cropLoss / Math.max(1, allItems.length), aspectLoss: aspectLoss / Math.max(1, allItems.length), minViolations, minimumShortSideViolations: minViolations, minDeficit, weightMinDeficit, weightRankingPenalty, areaRankingViolations, weightRankingViolations, smallPhotoScattering, targetAreaDeviation, targetAreaError: targetAreaDeviation, pageBalance, visualBalance, missing, itemCount: allItems.length, invalid, hardConstraintsMet, priority, weightSimilarityThreshold: prioritySettings.similarityThreshold, areaDifferenceTolerance: prioritySettings.areaTolerance, debug: { items: debugItems, pages: pages.map((page, index) => ({ page: index + 1, utilization: pageCoverageAreas[index] / Math.max(EPSILON, inner.w * inner.h), rectangleUtilization: pageAreas[index] / Math.max(EPSILON, inner.w * inner.h), coverageArea: pageCoverageAreas[index], rectangleArea: pageAreas[index], blankArea: Math.max(0, inner.w * inner.h - pageCoverageAreas[index]), itemCount: page.items.length })) } };
    return metrics;
  }

  function shiftBoundary(page, first, second, delta, gap, inner, minPhotoEdge) {
    const a = page.items[first]; const b = page.items[second];
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const vertical = overlapY > MIN_RECT && (Math.abs((a.x + a.w + gap) - b.x) < 0.02 || Math.abs((b.x + b.w + gap) - a.x) < 0.02);
    const horizontal = overlapX > MIN_RECT && (Math.abs((a.y + a.h + gap) - b.y) < 0.02 || Math.abs((b.y + b.h + gap) - a.y) < 0.02);
    if (!vertical && !horizontal) return null;
    const next = page.items.map((item) => ({ ...item }));
    if (vertical) {
      if (Math.abs((a.x + a.w + gap) - b.x) < 0.02) {
        if (delta > a.w - MIN_RECT || -delta > b.w - MIN_RECT) return null;
        next[first].w += delta; next[second].x += delta; next[second].w -= delta;
      } else {
        if (delta > b.w - MIN_RECT || -delta > a.w - MIN_RECT) return null;
        next[second].w += delta; next[first].x += delta; next[first].w -= delta;
      }
    } else {
      if (Math.abs((a.y + a.h + gap) - b.y) < 0.02) {
        if (delta > a.h - MIN_RECT || -delta > b.h - MIN_RECT) return null;
        next[first].h += delta; next[second].y += delta; next[second].h -= delta;
      } else {
        if (delta > b.h - MIN_RECT || -delta > a.h - MIN_RECT) return null;
        next[second].h += delta; next[first].y += delta; next[first].h -= delta;
      }
    }
    return validGeometry(next, inner, minPhotoEdge) ? next : null;
  }

  function swapPhotoRegions(page, first, second, options) {
    const next = page.items.map((item) => ({ ...item })); const firstId = next[first].photoId; next[first].photoId = next[second].photoId; next[second].photoId = firstId;
    const firstPhoto = options.photoMap.get(next[first].photoId); const secondPhoto = options.photoMap.get(next[second].photoId);
    if (firstPhoto) next[first].rotation = bestRotation(firstPhoto, next[first], options.autoRotate);
    if (secondPhoto) next[second].rotation = bestRotation(secondPhoto, next[second], options.autoRotate);
    return next;
  }

  function rankPhotosIntoRegions(pages, options) {
    const nextPages = pages.map((page) => ({ items: page.items.map((item) => ({ ...item })) }));
    const slots = nextPages.flatMap((page, pageIndex) => page.items.map((item, itemIndex) => ({ pageIndex, itemIndex, area: item.w * item.h })));
    const rankedSlots = [...slots].sort((a, b) => b.area - a.area || a.pageIndex - b.pageIndex || a.itemIndex - b.itemIndex);
    const rankedPhotos = [...options.photos].sort((a, b) => weightScore(b) - weightScore(a) || String(a.id).localeCompare(String(b.id)));
    rankedSlots.forEach((slot, index) => {
      const item = nextPages[slot.pageIndex].items[slot.itemIndex];
      const photo = rankedPhotos[index];
      item.photoId = photo.id;
      item.rotation = bestRotation(photo, item, options.autoRotate);
    });
    return nextPages;
  }

  function swapAcrossPages(pages, firstPageIndex, firstIndex, secondPageIndex, secondIndex, options) {
    const nextPages = pages.map((page) => ({ items: page.items.map((item) => ({ ...item })) }));
    const first = nextPages[firstPageIndex].items[firstIndex];
    const second = nextPages[secondPageIndex].items[secondIndex];
    const firstId = first.photoId;
    first.photoId = second.photoId;
    second.photoId = firstId;
    const firstPhoto = options.photoMap.get(first.photoId);
    const secondPhoto = options.photoMap.get(second.photoId);
    if (firstPhoto) first.rotation = bestRotation(firstPhoto, first, options.autoRotate);
    if (secondPhoto) second.rotation = bestRotation(secondPhoto, second, options.autoRotate);
    return nextPages;
  }

  function postOptimize(pages, options, inner) {
    let current = { pages, metrics: evaluatePlan(pages, options, inner) };
    const magnitudes = [0.25, 0.5, 1, 2, 4, 8, 12, 18, 24].filter((value) => value < Math.min(inner.w, inner.h) * 0.35);
    const deltas = magnitudes.flatMap((value) => [-value, value]);
    for (let pass = 0; pass < 6; pass += 1) {
      let improved = false;
      for (let pageIndex = 0; pageIndex < current.pages.length; pageIndex += 1) {
        const page = current.pages[pageIndex];
        for (let i = 0; i < page.items.length; i += 1) {
          for (let j = i + 1; j < page.items.length; j += 1) {
            for (const delta of deltas) {
              const nextItems = shiftBoundary(page, i, j, delta, options.gap, inner, options.minPhotoEdge);
              if (!nextItems) continue;
              const nextPages = current.pages.map((candidatePage, index) => index === pageIndex ? { items: nextItems } : { items: candidatePage.items.map((item) => ({ ...item })) });
              const nextMetrics = evaluatePlan(nextPages, options, inner);
              if (nextMetrics.score + 0.001 < current.metrics.score) { current = { pages: nextPages, metrics: nextMetrics }; improved = true; break; }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) {
        for (let pageIndex = 0; pageIndex < current.pages.length; pageIndex += 1) {
          const page = current.pages[pageIndex];
          for (let i = 0; i < page.items.length; i += 1) for (let j = i + 1; j < page.items.length; j += 1) {
            const nextItems = swapPhotoRegions(page, i, j, options); const nextPages = current.pages.map((candidatePage, index) => index === pageIndex ? { items: nextItems } : { items: candidatePage.items.map((item) => ({ ...item })) }); const nextMetrics = evaluatePlan(nextPages, options, inner);
            if (nextMetrics.score + 0.001 < current.metrics.score) { current = { pages: nextPages, metrics: nextMetrics }; improved = true; break; }
          }
          if (improved) break;
        }
      }
      if (!improved && current.pages.length > 1) {
        for (let firstPage = 0; firstPage < current.pages.length && !improved; firstPage += 1) {
          for (let secondPage = firstPage + 1; secondPage < current.pages.length && !improved; secondPage += 1) {
            for (let i = 0; i < current.pages[firstPage].items.length && !improved; i += 1) {
              for (let j = 0; j < current.pages[secondPage].items.length; j += 1) {
                const nextPages = swapAcrossPages(current.pages, firstPage, i, secondPage, j, options);
                const nextMetrics = evaluatePlan(nextPages, options, inner);
                if (nextMetrics.score + 0.001 < current.metrics.score) { current = { pages: nextPages, metrics: nextMetrics }; improved = true; break; }
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    return current;
  }

  function buildCandidatePool(photos, pageCount, options, inner) {
    const candidateCount = Math.min(12, Math.max(6, photos.length > 12 ? 10 : photos.length));
    const create = (hardMinimum, startSeed = 0, seedCount = candidateCount) => {
      const pool = [];
      for (let offset = 0; offset < seedCount; offset += 1) {
        const seed = startSeed + offset;
        const assignments = [
          { buckets: allocatePhotos(photos, pageCount, seed), strategy: 'ungrouped' },
          ...[0, 1, 2, 3].map((variant) => ({ buckets: allocateGroupedPhotos(photos, pageCount, seed, variant), strategy: ['group-weight', 'group-aspect', 'group-minimum-first', 'group-lns'][variant] }))
        ];
        assignments.forEach((assignment, assignmentIndex) => {
          const { buckets, strategy } = assignment;
          const generationOptions = { ...options, hardMinimum, priority: 'balanced' };
          const pageItems = buckets.map((bucket, pageIndex) => {
            if (assignmentIndex === 1) {
              const grouped = layoutGroupedRects(bucket, inner, generationOptions, seed + pageIndex * 3, 0);
              if (grouped) return grouped;
            } else if (assignmentIndex > 1) {
              const grouped = layoutGroupedRects(bucket, inner, generationOptions, seed + pageIndex * 3 + assignmentIndex, 0);
              if (grouped) return grouped;
            }
            return layoutRects(bucket, inner, generationOptions, seed + pageIndex, 0);
          });
          if (pageItems.some((items) => items === null)) return;
          const basePages = pageItems.map((items) => ({ items }));
          const baseSeed = seed * 100 + assignmentIndex * 10;
          const allocationStrategy = strategy;
          pool.push({ pages: basePages.map((page) => ({ items: page.items.map((item) => ({ ...item })) })), seed: baseSeed - 1, baseSeed: seed, searchPriority: assignmentIndex ? 'group-seed' : 'seed', allocationStrategy });
          const rankedPages = rankPhotosIntoRegions(basePages, options);
          pool.push({ pages: rankedPages, seed: baseSeed + 3, baseSeed: seed, searchPriority: 'weight-ranked-repack', allocationStrategy });
          ['balanced', 'space', 'weight'].forEach((searchPriority, variant) => {
            const candidateOptions = { ...options, hardMinimum, priority: searchPriority };
            const pages = basePages.map((page) => ({ items: page.items.map((item) => ({ ...item })) })); const optimized = postOptimize(pages, candidateOptions, inner);
            pool.push({ pages: optimized.pages, seed: baseSeed + variant, baseSeed: seed, searchPriority, allocationStrategy });
          });
        });
      }
      return pool;
    };
    const strictPool = create(true);
    if (strictPool.some((candidate) => evaluatePlan(candidate.pages, options, inner).hardConstraintsMet)) return { pool: strictPool, hardMinimumUsed: true };
    if (options.minPhotoEdge > 0) {
      const repairPool = create(true, candidateCount, Math.max(12, Math.ceil(candidateCount / 2)));
      const expandedPool = strictPool.concat(repairPool);
      if (expandedPool.some((candidate) => evaluatePlan(candidate.pages, options, inner).hardConstraintsMet)) return { pool: expandedPool, hardMinimumUsed: true };
    }
    return { pool: create(false), hardMinimumUsed: false };
  }

  function weightQualityPass(metrics) {
    const items = metrics.debug?.items || [];
    const pairCount = items.length * (items.length - 1) / 2;
    const allowedViolations = Math.max(1, Math.ceil(pairCount * 0.05));
    if (metrics.weightRankingViolations > allowedViolations || metrics.weightMinDeficit > 0.45 || metrics.targetAreaDeviation > 0.8) return false;
    return true;
  }

  function candidatePoolSignature(pool) {
    return pool.map((candidate) => `${candidate.seed}:${candidate.pages.flatMap((page) => page.items).map((item) => `${item.photoId},${item.x.toFixed(2)},${item.y.toFixed(2)},${item.w.toFixed(2)},${item.h.toFixed(2)}`).join(';')}`).join('|');
  }

  function optimizeLayout(input) {
    const photos = Array.isArray(input.photos) ? input.photos : []; const paper = input.paper || { w: 210, h: 297 }; const pageCount = Math.max(1, Math.round(Number(input.pageCount) || 1));
    const margin = clamp(Number(input.margin) || 0, 0, Math.min(paper.w, paper.h) / 2 - MIN_RECT); const inner = { x: margin, y: margin, w: Math.max(MIN_RECT, paper.w - margin * 2), h: Math.max(MIN_RECT, paper.h - margin * 2) };
    const options = { photos, photoMap: new Map(photos.map((photo) => [photo.id, photo])), cropMode: input.cropMode === 'cover' ? 'cover' : 'contain', autoRotate: input.autoRotate !== false, minPhotoEdge: Math.max(0, Number(input.minPhotoEdge) || 0), gap: clamp(Number(input.gap) || 0, 0, Math.min(inner.w, inner.h) * 0.35), priority: priorityOf(input.priority) };
    if (!photos.length) return { pages: [], metrics: evaluatePlan([], options, inner), pageCount, feasible: true, candidateCount: 0 };
    const candidateResult = buildCandidatePool(photos, pageCount, options, inner); const pool = candidateResult.pool;
    const candidates = pool.map((candidate) => {
      candidate.pages.forEach((page) => page.items.forEach((item) => { item.cropMode = options.cropMode; }));
      return { ...candidate, metrics: evaluatePlan(candidate.pages, options, inner) };
    });
    const feasible = candidates.filter((candidate) => candidate.metrics.hardConstraintsMet);
    const qualityCandidates = feasible.filter((candidate) => weightQualityPass(candidate.metrics));
    const weightPool = qualityCandidates.length ? qualityCandidates : feasible;
    const selectable = options.priority === 'space' ? (qualityCandidates.length ? qualityCandidates : feasible) : options.priority === 'weight' ? weightPool : feasible;
    const ranked = [...(selectable.length ? selectable : candidates)];
    if (options.priority === 'space') {
      ranked.sort((a, b) => b.metrics.utilization - a.metrics.utilization || a.metrics.weightRankingPenalty - b.metrics.weightRankingPenalty || a.metrics.targetAreaDeviation - b.metrics.targetAreaDeviation || a.metrics.rawScore - b.metrics.rawScore || a.seed - b.seed);
    } else if (options.priority === 'weight') {
      ranked.sort((a, b) => {
        const rankingDifference = qualityCandidates.length ? 0 : a.metrics.weightRankingViolations - b.metrics.weightRankingViolations;
        return rankingDifference || a.metrics.targetAreaDeviation - b.metrics.targetAreaDeviation || a.metrics.weightMinDeficit - b.metrics.weightMinDeficit || a.metrics.weightRankingViolations - b.metrics.weightRankingViolations || a.metrics.areaRankingViolations - b.metrics.areaRankingViolations || a.metrics.weightRankingPenalty - b.metrics.weightRankingPenalty || b.metrics.utilization - a.metrics.utilization || a.metrics.rawScore - b.metrics.rawScore || a.seed - b.seed;
      });
    } else {
      ranked.sort((a, b) => a.metrics.score - b.metrics.score || a.seed - b.seed);
    }
    const requestedRank = Math.min(Math.max(0, Number(input.layoutVariant) || 0), Math.min(2, ranked.length - 1)); const chosen = ranked[requestedRank] || ranked[0];
    chosen.metrics.weightQualityFloorMet = qualityCandidates.length > 0;
    chosen.metrics.selectionReason = options.priority === 'space'
      ? (qualityCandidates.length ? 'coverage-with-weight-floor' : 'coverage-without-weight-floor')
      : options.priority === 'weight' ? (qualityCandidates.length ? 'weight-area-quality-pool' : 'weight-best-available') : 'priority-score';
    return { pages: chosen.pages, metrics: chosen.metrics, pageCount, candidateCount: candidates.length, chosenSeed: chosen.seed, allocationStrategy: chosen.allocationStrategy, feasible: chosen.metrics.hardConstraintsMet, weightQualityFloorMet: qualityCandidates.length > 0, candidatePoolSignature: candidatePoolSignature(pool), hardMinimumUsed: candidateResult.hardMinimumUsed, candidateDiagnostics: input.debugCandidates ? candidates.map((candidate) => ({ seed: candidate.seed, baseSeed: candidate.baseSeed, allocationStrategy: candidate.allocationStrategy, searchPriority: candidate.searchPriority, feasible: candidate.metrics.hardConstraintsMet, coverage: candidate.metrics.coverage, smallPhotoScattering: candidate.metrics.smallPhotoScattering, rankingViolations: candidate.metrics.areaRankingViolations, weightRankingViolations: candidate.metrics.weightRankingViolations, targetAreaError: candidate.metrics.targetAreaDeviation, weightMinDeficit: candidate.metrics.weightMinDeficit, rawScore: candidate.metrics.rawScore, minShortEdge: Math.min(...candidate.metrics.debug.items.map((item) => item.shortEdge), Infinity), minimumShortSideViolations: candidate.metrics.minimumShortSideViolations, items: candidate.metrics.debug.items })) : undefined };
  }

  const api = { optimizeLayout, evaluatePlan, getCropPlan };
  if (root) root.PhotoLayoutEngine = api;
  if (typeof globalThis !== 'undefined') globalThis.PhotoLayoutEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
