(() => {
  'use strict';

  const PAPER_GROUPS = {
    large: [
      ['A4', 210, 297], ['B5', 182, 257], ['B5 Half', 91, 257], ['A5', 148, 210], ['A5 Slim / PUO / TN 标准', 110, 210]
    ],
    medium: [
      ['B6', 125, 176], ['方方子 / HB×WA5', 148, 171], ['PW', 120, 171], ['FC', 108, 171], ['Personal', 95, 171], ['A6 Slim', 80, 171], ['A6 奇葩', 105, 148], ['奇葩 Slim', 80, 148], ['Weeks', 95, 188]
    ],
    small: [
      ['B7', 86, 128], ['TN 护照本', 88, 125], ['A7 高127', 80, 127], ['A7 标准', 80, 120], ['A7 大纸', 85, 127], ['A8(M5) 宽80', 80, 105], ['A8(M5) 宽74', 74, 105], ['A8(M5) 宽67', 67, 105], ['A8(M5) 宽62', 62, 105], ['M2.5', 42, 105], ['A9', 60, 80]
    ],
    print: [['小米打印相纸', 50, 76], ['5 寸', 89, 127], ['6 寸', 102, 152], ['7 寸', 127, 178]]
  };

  const state = {
    photos: [], pages: [], currentPage: 0, selectedPhotos: new Set(), photoView: 'list',
    paperGroup: 'large', paper: { name: 'A4', w: 210, h: 297 }, orientation: 'portrait',
    margin: 5, photoGap: 0, minPhotoEdge: 30, whiteBorders: false, whiteBorderWidth: 2, showCuttingGuides: false, debugMode: false,
    pageMode: 'auto', pageCount: 1, cropMode: 'contain', autoRotate: true, layoutPriority: 'balanced', layoutVariant: 0,
    recommendation: null, metrics: null, dirty: false, cropEditing: null, pngExporting: false, exportRevision: 0,
    editorMode: 'auto', manualDirty: false, selectedElementId: null, backgroundColor: '#ffffff', backgroundHistoryCaptured: false, lockAspectRatio: true,
    lastAutoPages: [], history: { undo: [], redo: [] }, elementSerial: 0
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    fileInput: $('fileInput'), uploadZone: $('uploadZone'), photoList: $('photoList'), emptyPhotos: $('emptyPhotos'), photoCount: $('photoCount'), photoViewToggle: $('photoViewToggle'), photoViewLabel: $('photoViewLabel'), selectAllPhotos: $('selectAllPhotos'),
    bulkTools: $('bulkTools'), selectedCount: $('selectedCount'), bulkWeight: $('bulkWeight'), applyWeightBtn: $('applyWeightBtn'), sampleBtn: $('sampleBtn'),
    canvasStage: $('canvasStage'), canvas: $('layoutCanvas'), overlays: $('canvasOverlays'), canvasEmpty: $('canvasEmpty'), canvasTitle: $('canvasTitle'), manualModeBtn: $('manualModeBtn'), editorModeLabel: $('editorModeLabel'), manualToolbar: $('manualToolbar'),
    pageSwitcher: $('pageSwitcher'), pageLabel: $('pageLabel'), prevPageBtn: $('prevPageBtn'), nextPageBtn: $('nextPageBtn'), canvasHint: $('canvasHint'), cropSelectedBtn: $('cropSelectedBtn'), thumbnails: $('pageThumbnails'),
    paperGroupTabs: $('paperGroupTabs'), paperSelect: $('paperSelect'), paperMeta: $('paperMeta'), customSize: $('customSize'), customWidth: $('customWidth'), customHeight: $('customHeight'), applyCustomSizeBtn: $('applyCustomSizeBtn'), paperSettingsToggle: $('paperSettingsToggle'), paperSettingsBody: $('paperSettingsBody'),
    orientation: $('orientationSelect'), margin: $('marginInput'), minPhotoEdge: $('minPhotoEdgeInput'), photoGap: $('photoGapInput'), whiteBorders: $('whiteBorders'), whiteBorderWidth: $('whiteBorderWidth'), showCuttingGuides: $('showCuttingGuides'),
    suggestionText: $('suggestionText'), candidatePages: $('candidatePages'), pageCountInput: $('pageCountInput'), layoutBtn: $('layoutBtn'), alternateBtn: $('alternateBtn'), actionTip: $('actionTip'), autoRotate: $('autoRotate'), debugMode: $('debugMode'), debugPanel: $('debugPanel'), backgroundColorInput: $('backgroundColorInput'), lockAspectRatio: $('lockAspectRatio'), undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), rotateSelectedBtn: $('rotateSelectedBtn'), duplicateBtn: $('duplicateBtn'), bringFrontBtn: $('bringFrontBtn'), sendBackBtn: $('sendBackBtn'), deleteBtn: $('deleteBtn'), resetCropBtn: $('resetCropBtn'), resetLayoutBtn: $('resetLayoutBtn'),
    exportPngBtn: $('exportPngBtn'), exportAllPngBtn: $('exportAllPngBtn'), printBtn: $('printBtn'), resetBtn: $('resetBtn'), toast: $('toast'), cropModal: $('cropModal'), cropPreview: $('cropPreview'), cropImage: $('cropImage'), cropFrame: $('cropFrame'), cropDimLayer: $('cropDimLayer'),
    cropX: $('cropX'), cropY: $('cropY'), cropW: $('cropW'), cropH: $('cropH'), closeCropBtn: $('closeCropBtn'), cancelCropBtn: $('cancelCropBtn'), saveCropBtn: $('saveCropBtn'), printRoot: $('printRoot')
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const mmToPx = (mm) => Math.max(1, Math.round(mm / 25.4 * 300));
  const manualGeometry = window.ManualEditorGeometry;
  const reversedPaper = () => state.orientation === 'portrait' ? state.paper : { ...state.paper, w: state.paper.h, h: state.paper.w };
  const currentPage = () => state.pages[state.currentPage];
  const selectedItem = () => {
    const page = currentPage();
    return page ? page.items.find((item) => item.elementId === state.selectedElementId) : null;
  };
  const findPhoto = (id) => state.photos.find((p) => p.id === id);

  function nextElementId(prefix = 'element') { state.elementSerial += 1; return `${prefix}-${Date.now().toString(36)}-${state.elementSerial}`; }

  function clonePages(pages) { return JSON.parse(JSON.stringify(pages || [])); }

  function normalizePages(pages) {
    return (pages || []).map((page, pageIndex) => ({ items: (page.items || []).map((item, itemIndex) => ({ ...item, elementId: item.elementId || nextElementId(`page${pageIndex}-item${itemIndex}`), zIndex: Number.isFinite(item.zIndex) ? item.zIndex : itemIndex })) }));
  }

  function orderedItems(page) { return page.items.map((item, index) => ({ item, index })).sort((a, b) => (Number(a.item.zIndex) || 0) - (Number(b.item.zIndex) || 0) || a.index - b.index).map((entry) => entry.item); }

  function updateHistoryButtons() {
    if (els.undoBtn) els.undoBtn.disabled = state.history.undo.length === 0;
    if (els.redoBtn) els.redoBtn.disabled = state.history.redo.length === 0;
  }

  function makeSnapshot() {
    return { pages: clonePages(state.pages), crops: state.photos.map((photo) => ({ id: photo.id, crop: { ...photo.crop } })), backgroundColor: state.backgroundColor, selectedElementId: state.selectedElementId, currentPage: state.currentPage };
  }

  function restoreSnapshot(snapshot) {
    state.pages = normalizePages(snapshot.pages);
    snapshot.crops.forEach((entry) => { const photo = findPhoto(entry.id); if (photo) photo.crop = { ...entry.crop }; });
    state.backgroundColor = snapshot.backgroundColor || '#ffffff'; state.backgroundHistoryCaptured = false; state.selectedElementId = snapshot.selectedElementId || null; state.currentPage = clamp(snapshot.currentPage || 0, 0, Math.max(0, state.pages.length - 1));
    els.backgroundColorInput.value = state.backgroundColor; els.canvasStage.style.setProperty('--canvas-background', state.backgroundColor); state.editorMode = 'manual'; state.manualDirty = true; state.metrics = null; state.dirty = true; render(); updateHistoryButtons();
  }

  function pushHistory() { state.history.undo.push(makeSnapshot()); state.history.redo = []; updateHistoryButtons(); }

  function undo() {
    if (!state.history.undo.length) return;
    state.history.redo.push(makeSnapshot()); restoreSnapshot(state.history.undo.pop());
  }

  function redo() {
    if (!state.history.redo.length) return;
    state.history.undo.push(makeSnapshot()); restoreSnapshot(state.history.redo.pop());
  }

  function updateEditorModeUi() {
    const manual = state.editorMode === 'manual';
    els.editorModeLabel.textContent = manual ? '手动编辑' : '自动排版';
    els.manualModeBtn.textContent = manual ? '手动编辑中' : '进入手动编辑';
    els.manualToolbar.hidden = !manual;
  }

  function enterManualMode() { state.editorMode = 'manual'; updateEditorModeUi(); }

  function confirmAutoRelayout() {
    if (!state.manualDirty) return true;
    const confirmed = window.confirm('重新自动排版会覆盖当前手动修改，是否继续？');
    if (!confirmed) return false;
    state.editorMode = 'auto'; state.manualDirty = false; state.history = { undo: [], redo: [] }; state.selectedElementId = null; updateHistoryButtons();
    return true;
  }

  function showToast(message) {
    els.toast.textContent = message; els.toast.classList.add('show');
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
  }

  function markDirty() { state.dirty = true; state.exportRevision += 1; els.printRoot.innerHTML = ''; updateExportState(); }

  function setPaperGroup(group) {
    state.paperGroup = group;
    [...els.paperGroupTabs.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.group === group));
    const options = PAPER_GROUPS[group];
    els.paperSelect.innerHTML = options.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('') + '<option value="custom">自定义尺寸</option>';
    state.paper = { name: options[0][0], w: options[0][1], h: options[0][2] };
    els.customSize.hidden = true;
    updatePaperMeta();
    if (state.photos.length) regenerateLayout(false);
  }

  function updatePaperMeta() {
    const p = reversedPaper();
    els.paperMeta.textContent = `${p.name} · ${p.w} × ${p.h} mm · 约 ${mmToPx(p.w)} × ${mmToPx(p.h)} px（300 DPI）`;
    els.canvasStage.style.setProperty('--paper-ratio', p.w / p.h);
    syncStageSize();
  }

  function syncStageSize() {
    const p = reversedPaper(); const ratio = p.w / p.h; const wrap = els.canvasStage.parentElement; if (!wrap) return;
    const availableWidth = Math.max(180, wrap.clientWidth - 20); const availableHeight = Math.max(240, window.innerHeight - 250); const width = Math.min(760, availableWidth, availableHeight * ratio);
    els.canvasStage.style.width = `${Math.max(180, width)}px`; els.canvasStage.style.height = `${Math.max(180, width / ratio)}px`;
  }

  function setSelectedPhoto(id, checked) {
    checked ? state.selectedPhotos.add(id) : state.selectedPhotos.delete(id);
    renderPhotoList();
  }

  function renderPhotoList() {
    els.emptyPhotos.hidden = state.photos.length > 0;
    els.photoCount.textContent = `${state.photos.length} / 20`;
    els.bulkTools.hidden = !state.photos.length;
    els.selectedCount.textContent = state.selectedPhotos.size;
    els.photoList.classList.toggle('thumbnail-view', state.photoView === 'thumbnails');
    els.photoViewToggle.setAttribute('aria-pressed', String(state.photoView === 'thumbnails'));
    els.photoViewToggle.setAttribute('aria-label', state.photoView === 'thumbnails' ? '切换为列表模式' : '切换为缩略图模式');
    els.photoViewLabel.textContent = state.photoView === 'thumbnails' ? '缩略图模式' : '列表模式';
    els.selectAllPhotos.disabled = !state.photos.length;
    els.selectAllPhotos.checked = !!state.photos.length && state.selectedPhotos.size === state.photos.length;
    els.selectAllPhotos.indeterminate = state.selectedPhotos.size > 0 && state.selectedPhotos.size < state.photos.length;
    els.photoList.querySelectorAll('.photo-row').forEach((n) => n.remove());
    state.photos.forEach((photo, index) => {
      const row = document.createElement('div'); row.className = `photo-row ${state.selectedPhotos.has(photo.id) ? 'selected' : ''}`;
      row.innerHTML = `<input type="checkbox" ${state.selectedPhotos.has(photo.id) ? 'checked' : ''} aria-label="选择 ${photo.name}">
        <img class="thumb" src="${photo.src}" alt="${photo.name}"><div class="photo-info"><span class="photo-name">${escapeHtml(photo.name)}</span><span class="photo-sub">${photo.naturalWidth} × ${photo.naturalHeight}px · 第 ${index + 1} 张</span></div>
        <label class="weight-control"><span class="weight-caption">权重</span><input class="weight-input" type="number" min="1" max="99" value="${photo.weight}" aria-label="${escapeHtml(photo.name)}的权重" title="权重"></label>
        <div class="row-actions"><button class="row-action replace" title="替换">↻</button><button class="row-action delete" title="删除">×</button></div>`;
      row.addEventListener('click', (e) => { if (!e.target.closest('input,button,label')) selectFirstOccurrence(photo.id); });
      row.querySelector('input[type=checkbox]').addEventListener('change', (e) => setSelectedPhoto(photo.id, e.target.checked));
      row.querySelector('.weight-input').addEventListener('change', (e) => { photo.weight = clamp(Number(e.target.value) || 1, 1, 99); markDirty(); regenerateLayout(false); });
      row.querySelector('.delete').addEventListener('click', () => removePhoto(photo.id));
      row.querySelector('.replace').addEventListener('click', () => replacePhoto(photo.id));
      els.photoList.appendChild(row);
    });
  }

  function escapeHtml(value) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }

  function selectFirstOccurrence(photoId) {
    const pageIndex = state.pages.findIndex((p) => p.items.some((i) => i.photoId === photoId));
    if (pageIndex >= 0) { state.currentPage = pageIndex; const item = state.pages[pageIndex].items.find((entry) => entry.photoId === photoId); state.selectedElementId = item?.elementId || null; render(); }
  }

  function addFiles(files) {
    if (state.manualDirty && !confirmAutoRelayout()) return;
    const list = [...files].filter((file) => file.type.startsWith('image/')).slice(0, 20 - state.photos.length);
    if (!list.length) return;
    list.forEach((file) => {
      const photo = { id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), file, name: file.name, src: URL.createObjectURL(file), naturalWidth: 0, naturalHeight: 0, weight: 5, crop: { x: 0, y: 0, w: 1, h: 1 }, image: null };
      const image = new Image(); photo.image = image; image.onload = () => { photo.naturalWidth = image.naturalWidth; photo.naturalHeight = image.naturalHeight; regenerateLayout(false); renderPhotoList(); }; image.src = photo.src;
      state.photos.push(photo);
    });
    markDirty(); renderPhotoList(); updateSuggestion(); regenerateLayout(true); showToast(`已导入 ${list.length} 张照片`);
  }

  function removePhoto(photoId) {
    if (state.manualDirty && !confirmAutoRelayout()) return;
    const index = state.photos.findIndex((p) => p.id === photoId); if (index < 0) return;
    URL.revokeObjectURL(state.photos[index].src); state.photos.splice(index, 1); state.selectedPhotos.delete(photoId); state.selectedElementId = null;
    markDirty(); renderPhotoList(); updateSuggestion(); regenerateLayout(true); showToast('已删除照片');
  }

  function replacePhoto(photoId) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const file = input.files[0]; if (!file) return; const photo = findPhoto(photoId); URL.revokeObjectURL(photo.src); photo.file = file; photo.name = file.name; photo.src = URL.createObjectURL(file); const image = new Image(); photo.image = image; image.onload = () => { photo.naturalWidth = image.naturalWidth; photo.naturalHeight = image.naturalHeight; refreshRotations(); renderPhotoList(); render(); }; image.src = photo.src; markDirty(); renderPhotoList(); };
    input.click();
  }

  function sampleImages() {
    if (state.photos.length) { showToast('请先清空项目再载入示例图'); return; }
    const colors = [['#f6c6a9','#a3452b','MORNING'], ['#b8c9ef','#304d9c','NOTES'], ['#d3e7cf','#3e7351','WEEKEND'], ['#f2d49b','#8b5c19','TRAVEL'], ['#d6c2e6','#694887','MOMENTS']];
    colors.forEach(([bg, fg, label], i) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const ctx = c.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = fg; ctx.font = '800 88px Arial'; ctx.fillText(label, 80, 140); ctx.font = '38px Arial'; ctx.fillText(`sample photo ${i + 1}`, 84, 205); ctx.globalAlpha = .35; ctx.fillRect(90, 330, 1000, 4); ctx.globalAlpha = 1; ctx.font = '120px Arial'; ctx.fillText(['☼','✎','✦','⌁','♡'][i], 520, 570); addFiles([dataURLToFile(c.toDataURL('image/jpeg', .92), `sample-${i + 1}.jpg`)]);
    });
  }

  function dataURLToFile(dataUrl, name) { const [head, body] = dataUrl.split(','); const bytes = atob(body); const arr = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i); return new File([arr], name, { type: head.match(/:(.*?);/)[1] }); }

  function getLayoutGap() { return state.photoGap + (state.whiteBorders ? state.whiteBorderWidth : 0); }

  function buildPlan(pageCount, variant = 0) {
    const p = reversedPaper();
    return window.PhotoLayoutEngine.optimizeLayout({
      photos: state.photos,
      paper: { w: p.w, h: p.h },
      margin: state.margin,
      pageCount,
      cropMode: state.cropMode,
      autoRotate: state.autoRotate,
      minPhotoEdge: state.minPhotoEdge,
      gap: getLayoutGap(),
      priority: state.layoutPriority,
      layoutVariant: variant
    });
  }

  function recommendPlan() {
    if (!state.photos.length) return null;
    const maxPages = Math.min(20, Math.max(1, state.photos.length)); const candidates = [];
    for (let pageCount = 1; pageCount <= maxPages; pageCount += 1) candidates.push(buildPlan(pageCount, 0));
    const feasible = candidates.filter((candidate) => candidate.metrics.hardConstraintsMet).sort((a, b) => a.metrics.score - b.metrics.score);
    const ranked = [...candidates].sort((a, b) => a.metrics.score - b.metrics.score);
    return { best: feasible[0] || ranked[0], candidates: ranked, feasible, needsMorePages: feasible.length === 0 };
  }

  function renderCandidatePages(recommendation) {
    if (!recommendation) { els.candidatePages.innerHTML = '<div class="candidate-empty">上传照片后查看候选方案</div>'; return; }
    const unique = []; recommendation.candidates.forEach((candidate) => { if (unique.length < 4 && !unique.some((item) => item.pageCount === candidate.pageCount)) unique.push(candidate); });
    const featured = recommendation.candidates.find((candidate) => candidate.pageCount === state.pageCount) || recommendation.best;
    const coverage = (candidate) => candidate.metrics.hardConstraintsMet ? `${Math.round(candidate.metrics.utilization * 100)}% 覆盖` : '尺寸不满足';
    els.candidatePages.innerHTML = `<div class="candidate-featured"><div class="candidate-featured-meta"><strong>${featured.pageCount} 页方案 · 第 1 页</strong><span>${coverage(featured)}</span></div><div class="candidate-featured-preview"><canvas data-featured-preview aria-label="候选方案第一页预览"></canvas></div></div><div class="candidate-hint">选择下方页数，可按该方案重新排版</div><div class="candidate-options">${unique.map((candidate) => `<button class="candidate-option ${candidate.pageCount === recommendation.best.pageCount ? 'recommended' : ''} ${candidate.pageCount === featured.pageCount ? 'active' : ''}" type="button" data-page-count="${candidate.pageCount}" aria-label="选择 ${candidate.pageCount} 页方案，${coverage(candidate)}"><span class="candidate-preview"><canvas data-preview-count="${candidate.pageCount}"></canvas></span><span class="candidate-option-label"><strong>${candidate.pageCount} 页</strong><span>${coverage(candidate)}</span></span></button>`).join('')}</div>`;
    const p = reversedPaper();
    drawCandidatePreview(els.candidatePages.querySelector('[data-featured-preview]'), featured.pages[0], p, 180);
    unique.forEach((candidate) => drawCandidatePreview(els.candidatePages.querySelector(`[data-preview-count="${candidate.pageCount}"]`), candidate.pages[0], p, 50));
  }

  function drawCandidatePreview(canvas, page, p, maxHeight) {
    canvas.height = maxHeight; canvas.width = Math.max(1, Math.round(maxHeight * p.w / p.h));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = state.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(canvas.width / mmToPx(p.w), canvas.height / mmToPx(p.h));
    if (page) orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); if (photo?.naturalWidth) drawItem(ctx, photo, item); });
    ctx.restore();
  }

  function updateSuggestion() {
    const recommendation = recommendPlan(); state.recommendation = recommendation;
    if (!recommendation) { els.suggestionText.textContent = '上传照片后计算'; renderCandidatePages(null); return; }
    const best = recommendation.best; const m = best.metrics; const minText = m.minViolations ? `${m.minViolations} 张低于最小尺寸` : `全部达到 ${state.minPhotoEdge} mm`;
    els.suggestionText.textContent = recommendation.needsMorePages
      ? `当前候选页数均无法满足最小短边 ${state.minPhotoEdge} mm，请增加页数或降低最小尺寸`
      : `${best.pageCount} 页 · 实际覆盖率 ${Math.round(m.utilization * 100)}% · ${minText}`;
    if (state.pageMode === 'auto') { state.pageCount = best.pageCount; els.pageCountInput.value = best.pageCount; }
    renderCandidatePages(recommendation);
    return recommendation;
  }

  function renderDebug() {
    if (!els.debugPanel || !state.metrics || !state.photos.length || !state.debugMode) {
      if (els.debugPanel) { els.debugPanel.hidden = true; els.debugPanel.textContent = ''; }
      return;
    }
    const m = state.metrics;
    const lines = [
      `模式 ${m.priority} · 硬约束 ${m.hardConstraintsMet ? '通过' : '失败'} · 权重质量底线 ${m.weightQualityFloorMet ? '通过' : '未通过'} · 照片 ${m.itemCount}/${state.photos.length} · 缺失 ${m.missing}`,
      `实际覆盖率 ${(m.utilization * 100).toFixed(1)}% · 矩形占用率 ${(m.rectangleUtilization * 100).toFixed(1)}% · 真空白 ${m.blankArea.toFixed(1)} mm² · 裁切损失 ${(m.cropLoss * 100).toFixed(1)}%`,
      `权重排序违例 ${m.weightRankingViolations} · 模式内排序惩罚 ${m.areaRankingViolations} · 排序惩罚 ${m.weightRankingPenalty.toFixed(2)} · 目标面积偏差 ${(m.targetAreaDeviation * 100).toFixed(1)}%`,
      `小照片分散度 ${(m.smallPhotoScattering * 100).toFixed(1)}%（越低越集中） · 权重面积下限缺口 ${(m.weightMinDeficit * 100).toFixed(1)}%`,
      `最小尺寸违例 ${m.minViolations} · 最小尺寸缺口 ${m.minDeficit.toFixed(2)} · 页面平衡 ${m.pageBalance.toFixed(2)}`,
      '',
      ...m.debug.items.map((item) => `#${String(item.id).slice(0, 8)}  权重 ${item.weight}  面积 ${item.area.toFixed(1)}mm²  面积排名 ${item.areaRank}  权重排名 ${item.weightRank}  ${item.rankingViolation ? '⚠面积倒挂' : '✓排序'}  短边 ${item.shortEdge.toFixed(1)}mm  裁切保留 ${(item.cropFraction * 100).toFixed(1)}%${item.minViolation ? '  ⚠低于最小尺寸' : ''}`),
      '',
      ...m.debug.pages.map((page) => `第${page.page}页  ${page.itemCount}张  利用率 ${(page.utilization * 100).toFixed(1)}%  空白 ${page.blankArea.toFixed(1)}mm²`)
    ];
    els.debugPanel.hidden = false; els.debugPanel.textContent = `红色遮罩 = 可打印区域内未被照片实际覆盖的区域\n${lines.join('\n')}`;
  }

  function bestRotation(photo, rect) {
    if (!state.autoRotate || !photo.naturalWidth || !photo.naturalHeight) return 0;
    const sourceRatio = (photo.naturalWidth * photo.crop.w) / (photo.naturalHeight * photo.crop.h);
    const targetRatio = rect.w / rect.h;
    const normalDistance = Math.abs(Math.log(sourceRatio / targetRatio));
    const rotatedDistance = Math.abs(Math.log((1 / sourceRatio) / targetRatio));
    return rotatedDistance + 0.015 < normalDistance ? 90 : 0;
  }

  function refreshRotations() {
    state.pages.forEach((page) => page.items.forEach((item) => { const photo = findPhoto(item.photoId); if (photo) item.rotation = bestRotation(photo, item); }));
  }

  function cropPlan(photo, item) {
    let sx = photo.crop.x * photo.naturalWidth, sy = photo.crop.y * photo.naturalHeight, sw = photo.crop.w * photo.naturalWidth, sh = photo.crop.h * photo.naturalHeight;
    const originalArea = sw * sh; const rotated = (item.rotation || 0) % 180 !== 0; const targetRatio = item.w / item.h; const sourceRatio = rotated ? sh / sw : sw / sh;
    if (item.cropMode !== 'cover' && !item.forceCover) return { sx, sy, sw, sh, fraction: 1, canCover: false };
    if (sourceRatio > targetRatio) {
      if (rotated) { const nextH = sw * targetRatio; sy += (sh - nextH) / 2; sh = nextH; } else { const nextW = sh * targetRatio; sx += (sw - nextW) / 2; sw = nextW; }
    } else if (rotated) {
      const nextW = sh / targetRatio; sx += (sw - nextW) / 2; sw = nextW;
    } else {
      const nextH = sw / targetRatio; sy += (sh - nextH) / 2; sh = nextH;
    }
    const fraction = (sw * sh) / originalArea;
    return { sx, sy, sw, sh, fraction, canCover: fraction >= .7 };
  }

  function regenerateLayout(resetPage) {
    if (!state.photos.length) { state.pages = []; render(); return; }
    if (!confirmAutoRelayout()) return false;
    const recommendation = updateSuggestion(); const pageCount = state.pageMode === 'auto' ? recommendation.best.pageCount : clamp(Number(els.pageCountInput.value) || 1, 1, 20); state.pageCount = pageCount;
    const plan = state.pageMode === 'auto' && state.layoutVariant === 0 ? recommendation.best : buildPlan(pageCount, state.layoutVariant); state.pages = normalizePages(plan.pages); state.metrics = plan.metrics; if (plan.metrics.hardConstraintsMet) state.lastAutoPages = clonePages(state.pages); state.editorMode = 'auto'; state.manualDirty = false; if (resetPage) state.currentPage = 0; state.currentPage = clamp(state.currentPage, 0, Math.max(0, state.pages.length - 1)); state.selectedElementId = null; state.history = { undo: [], redo: [] }; updateHistoryButtons(); updateEditorModeUi(); render(); if (!plan.metrics.hardConstraintsMet) showToast(`当前 ${pageCount} 页未找到满足最小短边的布局；请增加页数或降低最小尺寸`); return true;
  }

  function render() {
    const page = currentPage(); const p = reversedPaper(); updatePaperMeta();
    updateEditorModeUi(); els.canvasEmpty.hidden = !!page; els.pageSwitcher.hidden = !page; els.canvasHint.hidden = !page; els.exportPngBtn.disabled = !page || state.pngExporting; els.exportAllPngBtn.disabled = !page || state.pngExporting; els.printBtn.disabled = !page || state.pngExporting;
    els.canvasTitle.textContent = page ? `${state.paper.name} · ${p.w} × ${p.h} mm` : '等待照片';
    if (!page) { els.overlays.innerHTML = ''; els.thumbnails.innerHTML = ''; els.cropSelectedBtn.disabled = true; els.actionTip.textContent = '自动排版后，可在画布中继续微调'; renderDebug(); return; }
    if (state.editorMode === 'manual') {
      const undersized = state.pages.flatMap((candidate) => candidate.items).filter((item) => { const photo = findPhoto(item.photoId); if (!photo?.naturalWidth) return false; const bounds = visiblePhotoBounds(photo, item); return Math.min(bounds.w, bounds.h) + .001 < state.minPhotoEdge; }).length;
      els.actionTip.textContent = `手动编辑中：照片可自由移动、重叠、缩放和调整图层；重新排版会覆盖手动修改${undersized ? ` · ${undersized} 张低于最小短边，导出前需放大或调整最小尺寸` : ''}`;
    } else if (state.metrics) {
      const priorityName = { weight: 'Weight Priority', balanced: 'Balanced', space: 'Space Priority' }[state.layoutPriority] || 'Balanced';
      const validPage = state.recommendation?.feasible?.filter((candidate) => candidate.pageCount > state.pageCount).sort((a, b) => a.pageCount - b.pageCount)[0];
      els.actionTip.textContent = state.metrics.hardConstraintsMet
        ? `实际覆盖率 ${Math.round(state.metrics.utilization * 100)}% · ${priorityName} · 裁切损失 ${Math.round(state.metrics.cropLoss * 100)}% · ${state.layoutPriority === 'space' && !state.metrics.weightQualityFloorMet ? '覆盖率最高方案未同时满足权重质量底线' : (state.metrics.minViolations ? `${state.metrics.minViolations} 张低于最小尺寸` : '最小尺寸已满足')}`
        : `当前 ${state.pageCount} 页未满足硬约束（${state.metrics.minViolations} 张低于最小短边），建议至少 ${validPage ? validPage.pageCount : state.pageCount + 1} 页`;
    }
    els.pageLabel.textContent = `第 ${state.currentPage + 1} / ${state.pages.length} 页`; els.prevPageBtn.disabled = state.currentPage === 0; els.nextPageBtn.disabled = state.currentPage >= state.pages.length - 1;
    renderCanvas(); renderOverlays(); renderThumbnails(); renderDebug();
  }

  function renderCanvas() {
    const p = reversedPaper(); const canvas = els.canvas; canvas.width = mmToPx(p.w); canvas.height = mmToPx(p.h); const ctx = canvas.getContext('2d'); ctx.fillStyle = state.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    els.canvasStage.style.setProperty('--canvas-background', state.backgroundColor);
    const page = currentPage(); if (page) orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); if (photo && photo.naturalWidth) drawItem(ctx, photo, item); }); drawCoverageDebug(ctx, page, p); drawCuttingGuides(ctx, page, p);
  }

  function drawCuttingGuides(ctx, page, p) {
    if (!state.showCuttingGuides || !page) return;
    ctx.save(); ctx.strokeStyle = 'rgba(23,32,51,.34)'; ctx.lineWidth = Math.max(1, mmToPx(.18)); ctx.setLineDash([mmToPx(1.2), mmToPx(1.2)]);
    ctx.strokeRect(mmToPx(state.margin), mmToPx(state.margin), mmToPx(p.w - state.margin * 2), mmToPx(p.h - state.margin * 2));
    orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); if (!photo?.naturalWidth) return; const bounds = visiblePhotoBounds(photo, item); ctx.strokeRect(mmToPx(bounds.x), mmToPx(bounds.y), mmToPx(bounds.w), mmToPx(bounds.h)); }); ctx.restore();
  }

  function containedImageBounds(photo, item) {
    const bounds = visiblePhotoBounds(photo, item);
    return { x: mmToPx(bounds.x), y: mmToPx(bounds.y), w: mmToPx(bounds.w), h: mmToPx(bounds.h) };
  }

  function visiblePhotoBounds(photo, item) {
    const plan = cropPlan(photo, item); const useCover = (item.cropMode === 'cover' || item.forceCover) && (plan.canCover || item.forceCover);
    const source = useCover ? plan : { sw: photo.crop.w * photo.naturalWidth, sh: photo.crop.h * photo.naturalHeight };
    return manualGeometry.visibleBounds(item, source, useCover);
  }

  function drawCoverageDebug(ctx, page, p) {
    if (!state.debugMode || !page) return;
    const width = ctx.canvas.width; const height = ctx.canvas.height; const mask = document.createElement('canvas'); mask.width = width; mask.height = height; const maskCtx = mask.getContext('2d');
    maskCtx.fillStyle = '#fff'; orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); if (!photo || !photo.naturalWidth) return; const bounds = containedImageBounds(photo, item); maskCtx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h); });
    const overlay = document.createElement('canvas'); overlay.width = width; overlay.height = height; const overlayCtx = overlay.getContext('2d'); overlayCtx.fillStyle = 'rgba(224, 74, 74, .24)'; overlayCtx.fillRect(mmToPx(state.margin), mmToPx(state.margin), mmToPx(p.w - state.margin * 2), mmToPx(p.h - state.margin * 2)); overlayCtx.globalCompositeOperation = 'destination-out'; overlayCtx.drawImage(mask, 0, 0);
    ctx.save(); ctx.drawImage(overlay, 0, 0); ctx.restore();
  }

  function drawItem(ctx, photo, item) {
    const x = mmToPx(item.x), y = mmToPx(item.y), w = mmToPx(item.w), h = mmToPx(item.h); const plan = cropPlan(photo, item); const useCover = (item.cropMode === 'cover' || item.forceCover) && (plan.canCover || item.forceCover); const source = useCover ? plan : { sx: photo.crop.x * photo.naturalWidth, sy: photo.crop.y * photo.naturalHeight, sw: photo.crop.w * photo.naturalWidth, sh: photo.crop.h * photo.naturalHeight }; const bounds = visiblePhotoBounds(photo, item); const rotated = (item.rotation || 0) % 180 !== 0; const drawW = mmToPx(rotated ? bounds.h : bounds.w), drawH = mmToPx(rotated ? bounds.w : bounds.h); ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(mmToPx(bounds.x + bounds.w / 2), mmToPx(bounds.y + bounds.h / 2)); ctx.rotate((item.rotation || 0) * Math.PI / 180); ctx.drawImage(photoImage(photo), source.sx, source.sy, source.sw, source.sh, -drawW / 2, -drawH / 2, drawW, drawH); ctx.restore();
  }

  const imageCache = new Map();
  function photoImage(photo) { if (photo.image) return photo.image; if (!imageCache.has(photo.id)) { const img = new Image(); img.src = photo.src; imageCache.set(photo.id, img); } return imageCache.get(photo.id); }

  function renderOverlays() {
    const page = currentPage(); els.overlays.innerHTML = ''; els.cropSelectedBtn.disabled = !page || !selectedItem(); els.rotateSelectedBtn.disabled = !page || !selectedItem(); if (!page) return;
    const p = reversedPaper();
    orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); const bounds = photo?.naturalWidth ? visiblePhotoBounds(photo, item) : item; const box = document.createElement('div'); box.className = `photo-box ${state.selectedElementId === item.elementId ? 'selected' : ''}`; box.style.left = `${bounds.x / p.w * 100}%`; box.style.top = `${bounds.y / p.h * 100}%`; box.style.width = `${bounds.w / p.w * 100}%`; box.style.height = `${bounds.h / p.h * 100}%`; box.style.zIndex = String(10 + (Number(item.zIndex) || 0)); box.dataset.elementId = item.elementId; box.innerHTML = `<span class="box-label">${photo?.weight ?? ''}${item.rotation ? ` · ↻${item.rotation}°` : ''}</span><span class="resize-handle nw" data-resize-corner="nw"></span><span class="resize-handle n" data-resize-corner="n"></span><span class="resize-handle ne" data-resize-corner="ne"></span><span class="resize-handle e" data-resize-corner="e"></span><span class="resize-handle se" data-resize-corner="se"></span><span class="resize-handle s" data-resize-corner="s"></span><span class="resize-handle sw" data-resize-corner="sw"></span><span class="resize-handle w" data-resize-corner="w"></span>`; box.addEventListener('pointerdown', (event) => startInteraction(event, item.elementId, event.target.closest('.resize-handle') ? 'resize' : 'drag', event.target.closest('.resize-handle')?.dataset.resizeCorner)); els.overlays.appendChild(box); });
  }

  function startInteraction(event, elementId, mode, corner) {
    event.preventDefault(); event.stopPropagation(); enterManualMode(); state.selectedElementId = elementId; state.manualDirty = true; state.metrics = null; const page = currentPage(); const item = page?.items.find((entry) => entry.elementId === elementId); if (!item) return;
    pushHistory();
    const maxZ = page.items.reduce((max, entry) => Math.max(max, Number(entry.zIndex) || 0), 0); item.zIndex = maxZ + 1; renderCanvas(); renderOverlays();
    const p = reversedPaper(); const original = { ...item }; const photo = findPhoto(item.photoId); const bounds = photo?.naturalWidth ? visiblePhotoBounds(photo, item) : item; const startPoint = manualGeometry.pagePoint(event.clientX, event.clientY, els.canvasStage.getBoundingClientRect(), p); const grabOffset = { x: startPoint.x - bounds.x, y: startPoint.y - bounds.y }; const directions = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }; const [horizontal, vertical] = directions[corner] || [0, 0];
    const move = (e) => {
      const rect = els.canvasStage.getBoundingClientRect(); const point = manualGeometry.pagePoint(e.clientX, e.clientY, rect, p); const dx = point.x - startPoint.x; const dy = point.y - startPoint.y;
      if (mode === 'drag') {
        const position = manualGeometry.dragPosition(e.clientX, e.clientY, rect, p, bounds, grabOffset); item.x = original.x + position.x - bounds.x; item.y = original.y + position.y - bounds.y;
      } else {
        const minimum = Math.max(4, state.minPhotoEdge); let nextW = horizontal ? bounds.w + horizontal * dx : bounds.w; let nextH = vertical ? bounds.h + vertical * dy : bounds.h;
        if (state.lockAspectRatio) {
          const scaleW = horizontal ? nextW / bounds.w : 1, scaleH = vertical ? nextH / bounds.h : 1; let scale = horizontal && vertical ? (Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH) : (horizontal ? scaleW : scaleH);
          scale = Math.max(scale, minimum / Math.max(.001, Math.min(bounds.w, bounds.h))); nextW = bounds.w * scale; nextH = bounds.h * scale;
        } else { nextW = Math.max(minimum, nextW); nextH = Math.max(minimum, nextH); }
        item.x = horizontal < 0 ? bounds.x + bounds.w - nextW : horizontal > 0 ? bounds.x : bounds.x + (bounds.w - nextW) / 2; item.y = vertical < 0 ? bounds.y + bounds.h - nextH : vertical > 0 ? bounds.y : bounds.y + (bounds.h - nextH) / 2; item.w = nextW; item.h = nextH; item.forceCover = !state.lockAspectRatio;
      }
      state.manualDirty = true; state.metrics = null; renderCanvas(); renderOverlays(); markDirty();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); renderThumbnails(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  function renderThumbnails() {
    const p = reversedPaper(); els.thumbnails.innerHTML = '';
    state.pages.forEach((page, index) => {
      const wrap = document.createElement('button'); wrap.type = 'button'; wrap.className = `page-thumb ${index === state.currentPage ? 'active' : ''}`;
      const canvas = document.createElement('canvas'); drawCandidatePreview(canvas, page, p, 120);
      const scale = Math.min(52 / canvas.width, 52 / canvas.height);
      canvas.style.width = `${canvas.width * scale}px`; canvas.style.height = `${canvas.height * scale}px`;
      wrap.appendChild(canvas); wrap.appendChild(Object.assign(document.createElement('span'), { textContent: `第 ${index + 1} 页` }));
      wrap.title = `第 ${index + 1} 页`; if (index === state.currentPage) wrap.setAttribute('aria-current', 'page');
      wrap.addEventListener('click', () => { state.currentPage = index; state.selectedElementId = null; render(); });
      els.thumbnails.appendChild(wrap);
    });
  }

  function openCropModal() {
    const item = selectedItem(); if (!item) { showToast('请先点击画布中的照片'); return; } const photo = findPhoto(item.photoId); state.cropEditing = { photoId: photo.id, draft: { ...photo.crop } }; els.cropImage.src = photo.src; els.cropModal.hidden = false; syncCropControls(); requestAnimationFrame(() => { fitCropImage(); updateCropFrameFromDraft(); });
  }

  function fitCropImage() {
    if (!els.cropImage.naturalWidth || !els.cropImage.naturalHeight) return;
    const fitted = manualGeometry.fitContain(els.cropImage.naturalWidth, els.cropImage.naturalHeight, els.cropPreview.clientWidth, els.cropPreview.clientHeight);
    els.cropImage.style.width = `${fitted.width}px`; els.cropImage.style.height = `${fitted.height}px`;
  }

  function cropImageRect() {
    const image = els.cropImage.getBoundingClientRect(); const preview = els.cropPreview.getBoundingClientRect();
    return { left: image.left - preview.left, top: image.top - preview.top, width: image.width, height: image.height };
  }

  function normalizeCrop(draft) { const w = clamp(Number(draft.w) || 1, .05, 1); const h = clamp(Number(draft.h) || 1, .05, 1); return { x: clamp(Number(draft.x) || 0, 0, 1 - w), y: clamp(Number(draft.y) || 0, 0, 1 - h), w, h }; }

  function syncCropControls() {
    if (!state.cropEditing) return; const draft = normalizeCrop(state.cropEditing.draft); state.cropEditing.draft = draft; els.cropX.value = draft.x * 100; els.cropY.value = draft.y * 100; els.cropW.value = draft.w * 100; els.cropH.value = draft.h * 100; els.cropW.max = 100 - draft.x * 100; els.cropH.max = 100 - draft.y * 100;
  }

  function updateCropFrameFromDraft() {
    if (!state.cropEditing) return; syncCropControls(); const draft = state.cropEditing.draft; const rect = cropImageRect(); els.cropDimLayer.style.left = `${rect.left}px`; els.cropDimLayer.style.top = `${rect.top}px`; els.cropDimLayer.style.width = `${rect.width}px`; els.cropDimLayer.style.height = `${rect.height}px`; els.cropFrame.style.left = `${rect.left + draft.x * rect.width}px`; els.cropFrame.style.top = `${rect.top + draft.y * rect.height}px`; els.cropFrame.style.width = `${draft.w * rect.width}px`; els.cropFrame.style.height = `${draft.h * rect.height}px`;
    const frameLeft = draft.x * rect.width, frameTop = draft.y * rect.height, frameRight = (draft.x + draft.w) * rect.width, frameBottom = (draft.y + draft.h) * rect.height;
    const shades = { top: [0, 0, rect.width, frameTop], right: [frameRight, frameTop, rect.width - frameRight, frameBottom - frameTop], bottom: [0, frameBottom, rect.width, rect.height - frameBottom], left: [0, frameTop, frameLeft, frameBottom - frameTop] };
    Object.entries(shades).forEach(([side, bounds]) => { const shade = els.cropDimLayer.querySelector(`[data-crop-shade="${side}"]`); shade.style.left = `${bounds[0]}px`; shade.style.top = `${bounds[1]}px`; shade.style.width = `${Math.max(0, bounds[2])}px`; shade.style.height = `${Math.max(0, bounds[3])}px`; });
  }

  function updateCropFrame() {
    if (!state.cropEditing) return; state.cropEditing.draft = normalizeCrop({ x: Number(els.cropX.value) / 100, y: Number(els.cropY.value) / 100, w: Number(els.cropW.value) / 100, h: Number(els.cropH.value) / 100 }); updateCropFrameFromDraft();
  }

  function startCropInteraction(event) {
    if (!state.cropEditing) return; event.preventDefault(); event.stopPropagation(); const rect = cropImageRect(); const original = { ...state.cropEditing.draft }; const handle = event.target.closest('[data-crop-handle]')?.dataset.cropHandle || ''; const startX = event.clientX, startY = event.clientY;
    const move = (e) => {
      const dx = (e.clientX - startX) / Math.max(1, rect.width); const dy = (e.clientY - startY) / Math.max(1, rect.height); let next = { ...original };
      if (!handle) next = { ...original, x: clamp(original.x + dx, 0, 1 - original.w), y: clamp(original.y + dy, 0, 1 - original.h) };
      else {
        let left = original.x; let top = original.y; let right = original.x + original.w; let bottom = original.y + original.h;
        if (handle.includes('w')) left = clamp(original.x + dx, 0, right - .05); if (handle.includes('e')) right = clamp(original.x + original.w + dx, left + .05, 1);
        if (handle.includes('n')) top = clamp(original.y + dy, 0, bottom - .05); if (handle.includes('s')) bottom = clamp(original.y + original.h + dy, top + .05, 1);
        next = { x: left, y: top, w: right - left, h: bottom - top };
      }
      state.cropEditing.draft = normalizeCrop(next); updateCropFrameFromDraft();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  function closeCrop(save) { if (save && state.cropEditing) { pushHistory(); const photo = findPhoto(state.cropEditing.photoId); photo.crop = { ...normalizeCrop(state.cropEditing.draft) }; enterManualMode(); state.manualDirty = true; state.metrics = null; refreshRotations(); markDirty(); render(); showToast('已保存裁切'); } els.cropModal.hidden = true; state.cropEditing = null; }

  function selectedPageAndItem() { const page = currentPage(); const item = selectedItem(); return page && item ? { page, item } : null; }

  function mutateManual(message, mutation) {
    const selection = selectedPageAndItem(); if (!selection) { showToast('请先点击画布中的照片'); return; }
    pushHistory(); enterManualMode(); mutation(selection.page, selection.item); state.manualDirty = true; state.metrics = null; markDirty(); render(); if (message) showToast(message);
  }

  function bringSelectedToFront() {
    mutateManual('已置于顶层', (page, item) => { item.zIndex = page.items.reduce((max, entry) => Math.max(max, Number(entry.zIndex) || 0), 0) + 1; });
  }

  function rotateSelected() {
    mutateManual('已顺时针旋转 90°', (_page, item) => { item.rotation = ((Number(item.rotation) || 0) + 90) % 360; });
  }

  function sendSelectedToBack() {
    mutateManual('已置于底层', (page, item) => { item.zIndex = page.items.reduce((min, entry) => Math.min(min, Number(entry.zIndex) || 0), 0) - 1; });
  }

  function duplicateSelected() {
    mutateManual('已复制照片元素', (page, item) => { const copy = { ...item, elementId: nextElementId('duplicate'), x: item.x + 5, y: item.y + 5, zIndex: page.items.reduce((max, entry) => Math.max(max, Number(entry.zIndex) || 0), 0) + 1 }; page.items.push(copy); state.selectedElementId = copy.elementId; });
  }

  function deleteSelected() {
    mutateManual('已删除照片元素（原始照片仍保留）', (page, item) => { page.items = page.items.filter((entry) => entry.elementId !== item.elementId); state.selectedElementId = null; });
  }

  function resetSelectedCrop() {
    mutateManual('已恢复原始裁切', (_page, item) => { const photo = findPhoto(item.photoId); if (photo) photo.crop = { x: 0, y: 0, w: 1, h: 1 }; });
  }

  function resetToLastAutoLayout() {
    if (!state.lastAutoPages.length) { showToast('还没有可恢复的自动排版'); return; }
    pushHistory(); state.pages = normalizePages(clonePages(state.lastAutoPages)); state.editorMode = 'manual'; state.manualDirty = true; state.selectedElementId = null; state.metrics = null; markDirty(); render(); showToast('已恢复最近一次自动排版');
  }

  function validateCurrentLayout() {
    const p = reversedPaper(); const expected = new Set(state.photos.map((photo) => photo.id)); const seen = new Set();
    for (const page of state.pages) {
      for (const item of page.items) {
        if (!expected.has(item.photoId) || !item.elementId || seen.has(item.elementId) || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.w) || !Number.isFinite(item.h) || item.w <= 0 || item.h <= 0) return { valid: false, reason: '存在无效照片元素' };
        seen.add(item.elementId);
        const photo = findPhoto(item.photoId); if (!photo?.naturalWidth) return { valid: false, reason: '照片尚未加载完成' };
        const visible = visiblePhotoBounds(photo, item); if (Math.min(visible.w, visible.h) + .001 < state.minPhotoEdge) return { valid: false, reason: `照片实际显示短边小于 ${state.minPhotoEdge} mm` };
        if (state.editorMode === 'auto') {
          if (item.x < state.margin - .001 || item.y < state.margin - .001 || item.x + item.w > p.w - state.margin + .001 || item.y + item.h > p.h - state.margin + .001) return { valid: false, reason: '照片超出可打印区域' };
        }
      }
      if (state.editorMode === 'auto') for (let i = 0; i < page.items.length; i += 1) for (let j = i + 1; j < page.items.length; j += 1) {
        const a = page.items[i]; const b = page.items[j]; if (a.x < b.x + b.w - .001 && a.x + a.w > b.x + .001 && a.y < b.y + b.h - .001 && a.y + a.h > b.y + .001) return { valid: false, reason: '照片矩形发生重叠' };
      }
    }
    return { valid: true, reason: '' };
  }

  function renderPageToCanvas(pageIndex) { const page = state.pages[pageIndex]; const p = reversedPaper(); const c = document.createElement('canvas'); c.width = mmToPx(p.w); c.height = mmToPx(p.h); const ctx = c.getContext('2d'); ctx.fillStyle = state.backgroundColor; ctx.fillRect(0, 0, c.width, c.height); orderedItems(page).forEach((item) => { const photo = findPhoto(item.photoId); if (photo && photo.naturalWidth) drawItem(ctx, photo, item); }); drawCuttingGuides(ctx, page, p); return c; }

  function downloadCurrentPng() { const validation = validateCurrentLayout(); if (!validation.valid) return showToast(`无法导出：${validation.reason}`); const c = renderPageToCanvas(state.currentPage); const link = document.createElement('a'); link.download = `photo-layout-page-${state.currentPage + 1}.png`; link.href = c.toDataURL('image/png'); link.click(); state.dirty = false; showToast('当前页 PNG 已导出'); }

  async function downloadAllPng() {
    if (state.pngExporting) return;
    const validation = validateCurrentLayout(); if (!validation.valid) return showToast(`无法导出：${validation.reason}`);
    const pages = state.pages; const revision = state.exportRevision; const originalLabel = els.exportAllPngBtn.innerHTML;
    state.pngExporting = true; updateExportState();
    try {
      const entries = [];
      for (let index = 0; index < pages.length; index += 1) {
        if (state.pages !== pages || state.exportRevision !== revision) throw new Error('导出期间排版已更改，请重试');
        els.exportAllPngBtn.textContent = `正在生成第 ${index + 1} / ${pages.length} 页…`;
        const blob = await new Promise((resolve, reject) => renderPageToCanvas(index).toBlob((result) => result ? resolve(result) : reject(new Error('PNG 编码失败')), 'image/png'));
        entries.push({ name: `photo-layout-page-${String(index + 1).padStart(2, '0')}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (state.pages !== pages || state.exportRevision !== revision) throw new Error('导出期间排版已更改，请重试');
      const archive = window.PngZip.createZip(entries); const url = URL.createObjectURL(archive);
      const link = document.createElement('a'); link.href = url; link.download = 'photo-layout-all-pages.zip'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      state.dirty = false; showToast(`已保存 ${pages.length} 页 PNG（ZIP）`);
    } catch (error) { showToast(`无法导出：${error.message}`); }
    finally { state.pngExporting = false; els.exportAllPngBtn.innerHTML = originalLabel; updateExportState(); }
  }

  function printAll() { const validation = validateCurrentLayout(); if (!validation.valid) return showToast(`无法导出：${validation.reason}`); const p = reversedPaper(); els.printRoot.innerHTML = ''; state.pages.forEach((_, index) => { const page = document.createElement('div'); page.className = 'print-page'; page.style.width = `${p.w}mm`; page.style.height = `${p.h}mm`; const canvas = renderPageToCanvas(index); canvas.style.width = `${p.w}mm`; canvas.style.height = `${p.h}mm`; page.appendChild(canvas); els.printRoot.appendChild(page); }); state.dirty = false; window.print(); }

  function updateExportState() { const canExport = !!currentPage() && !state.pngExporting; els.exportPngBtn.disabled = !canExport; els.exportAllPngBtn.disabled = !canExport; els.printBtn.disabled = !canExport; }

  function resetProject() { if (state.photos.length && state.dirty && !confirm('当前项目还没有导出，确定要清空吗？')) return; state.photos.forEach((p) => URL.revokeObjectURL(p.src)); state.photos = []; state.pages = []; state.lastAutoPages = []; state.selectedElementId = null; state.currentPage = 0; state.selectedPhotos.clear(); state.dirty = false; state.manualDirty = false; state.editorMode = 'auto'; state.backgroundHistoryCaptured = false; state.history = { undo: [], redo: [] }; els.printRoot.innerHTML = ''; imageCache.clear(); updateHistoryButtons(); renderPhotoList(); render(); updateSuggestion(); showToast('项目已清空'); }

  function initEvents() {
    els.fileInput.addEventListener('change', (e) => addFiles(e.target.files)); ['dragenter', 'dragover'].forEach((type) => els.uploadZone.addEventListener(type, (e) => { e.preventDefault(); els.uploadZone.classList.add('dragover'); })); ['dragleave', 'drop'].forEach((type) => els.uploadZone.addEventListener(type, (e) => { e.preventDefault(); els.uploadZone.classList.remove('dragover'); })); els.uploadZone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files)); els.sampleBtn.addEventListener('click', sampleImages);
    els.photoViewToggle.addEventListener('click', () => { state.photoView = state.photoView === 'list' ? 'thumbnails' : 'list'; renderPhotoList(); });
    els.selectAllPhotos.addEventListener('change', () => { state.selectedPhotos = els.selectAllPhotos.checked ? new Set(state.photos.map((photo) => photo.id)) : new Set(); renderPhotoList(); });
    els.paperSettingsToggle.addEventListener('click', () => { const expanded = els.paperSettingsToggle.getAttribute('aria-expanded') === 'true'; els.paperSettingsBody.hidden = expanded; els.paperSettingsToggle.setAttribute('aria-expanded', String(!expanded)); els.paperSettingsToggle.textContent = expanded ? '展开' : '收起'; });
    els.applyWeightBtn.addEventListener('click', () => { const value = clamp(Number(els.bulkWeight.value) || 1, 1, 99); state.photos.forEach((p) => { if (state.selectedPhotos.has(p.id)) p.weight = value; }); markDirty(); renderPhotoList(); regenerateLayout(false); });
    els.paperGroupTabs.addEventListener('click', (e) => { if (e.target.matches('button')) setPaperGroup(e.target.dataset.group); }); els.paperSelect.addEventListener('change', () => { const value = els.paperSelect.value; if (value === 'custom') { els.customSize.hidden = false; return; } const p = PAPER_GROUPS[state.paperGroup][Number(value)]; state.paper = { name: p[0], w: p[1], h: p[2] }; els.customSize.hidden = true; updateSuggestion(); markDirty(); regenerateLayout(false); });
    els.applyCustomSizeBtn.addEventListener('click', () => { state.paper = { name: '自定义', w: clamp(Number(els.customWidth.value) || 80, 20, 1000), h: clamp(Number(els.customHeight.value) || 105, 20, 1000) }; updatePaperMeta(); updateSuggestion(); markDirty(); regenerateLayout(false); });
    els.orientation.addEventListener('change', () => { state.orientation = els.orientation.value; updateSuggestion(); markDirty(); regenerateLayout(false); }); els.margin.addEventListener('change', () => { state.margin = clamp(Number(els.margin.value) || 0, 0, 30); updateSuggestion(); markDirty(); regenerateLayout(false); });
    els.minPhotoEdge.addEventListener('change', () => { state.minPhotoEdge = clamp(Number(els.minPhotoEdge.value) || 30, 10, 100); els.minPhotoEdge.value = state.minPhotoEdge; markDirty(); regenerateLayout(true); });
    els.photoGap.addEventListener('change', () => { state.photoGap = clamp(Number(els.photoGap.value) || 0, 0, 10); els.photoGap.value = state.photoGap; markDirty(); regenerateLayout(false); });
    els.whiteBorders.addEventListener('change', () => { state.whiteBorders = els.whiteBorders.checked; els.whiteBorderWidth.disabled = !state.whiteBorders; markDirty(); regenerateLayout(false); });
    els.whiteBorderWidth.addEventListener('change', () => { state.whiteBorderWidth = clamp(Number(els.whiteBorderWidth.value) || 2, .5, 10); els.whiteBorderWidth.value = state.whiteBorderWidth; if (state.whiteBorders) { markDirty(); regenerateLayout(false); } });
    els.showCuttingGuides.addEventListener('change', () => { state.showCuttingGuides = els.showCuttingGuides.checked; markDirty(); render(); });
    els.debugMode.addEventListener('change', () => { state.debugMode = els.debugMode.checked; renderDebug(); });
    document.querySelectorAll('input[name=pageMode]').forEach((input) => input.addEventListener('change', () => { state.pageMode = input.value; els.pageCountInput.disabled = input.value !== 'manual'; updateSuggestion(); regenerateLayout(true); })); els.pageCountInput.addEventListener('change', () => { state.pageCount = clamp(Number(els.pageCountInput.value) || 1, 1, 20); regenerateLayout(true); });
    els.candidatePages.addEventListener('click', (event) => { const button = event.target.closest('[data-page-count]'); if (!button) return; state.pageMode = 'manual'; document.querySelector('input[name=pageMode][value=manual]').checked = true; els.pageCountInput.disabled = false; els.pageCountInput.value = button.dataset.pageCount; state.pageCount = Number(button.dataset.pageCount); state.layoutVariant = 0; regenerateLayout(true); });
    document.querySelectorAll('input[name=cropMode]').forEach((input) => input.addEventListener('change', () => { state.cropMode = input.value; state.pages.forEach((p) => p.items.forEach((i) => i.cropMode = state.cropMode)); state.layoutVariant = 0; markDirty(); regenerateLayout(false); }));
    document.querySelectorAll('input[name=layoutPriority]').forEach((input) => input.addEventListener('change', () => { state.layoutPriority = input.value; state.layoutVariant = 0; markDirty(); regenerateLayout(true); }));
    els.autoRotate.addEventListener('change', () => { state.autoRotate = els.autoRotate.checked; state.layoutVariant = 0; markDirty(); regenerateLayout(false); });
    els.layoutBtn.addEventListener('click', () => { if (!state.photos.length) return showToast('请先上传照片'); state.layoutVariant = 0; if (regenerateLayout(true)) showToast('已生成新的排版'); }); els.alternateBtn.addEventListener('click', () => { if (!state.photos.length) return showToast('请先上传照片'); state.layoutVariant++; if (regenerateLayout(false)) showToast('已切换到下一种排法'); });
    els.manualModeBtn.addEventListener('click', () => { if (!state.pages.length) return showToast('请先生成排版'); enterManualMode(); render(); showToast('已进入自由手动编辑'); });
    els.undoBtn.addEventListener('click', undo); els.redoBtn.addEventListener('click', redo); els.rotateSelectedBtn.addEventListener('click', rotateSelected); els.duplicateBtn.addEventListener('click', duplicateSelected); els.bringFrontBtn.addEventListener('click', bringSelectedToFront); els.sendBackBtn.addEventListener('click', sendSelectedToBack); els.deleteBtn.addEventListener('click', deleteSelected); els.resetCropBtn.addEventListener('click', resetSelectedCrop); els.resetLayoutBtn.addEventListener('click', resetToLastAutoLayout);
    els.backgroundColorInput.addEventListener('input', () => { if (!state.backgroundHistoryCaptured) { pushHistory(); state.backgroundHistoryCaptured = true; } state.backgroundColor = els.backgroundColorInput.value; els.canvasStage.style.setProperty('--canvas-background', state.backgroundColor); markDirty(); render(); renderCandidatePages(state.recommendation); }); els.backgroundColorInput.addEventListener('change', () => { state.backgroundHistoryCaptured = false; }); els.lockAspectRatio.addEventListener('change', () => { state.lockAspectRatio = els.lockAspectRatio.checked; });
    els.prevPageBtn.addEventListener('click', () => { state.currentPage = clamp(state.currentPage - 1, 0, state.pages.length - 1); state.selectedElementId = null; render(); }); els.nextPageBtn.addEventListener('click', () => { state.currentPage = clamp(state.currentPage + 1, 0, state.pages.length - 1); state.selectedElementId = null; render(); }); els.cropSelectedBtn.addEventListener('click', openCropModal);
    els.exportPngBtn.addEventListener('click', downloadCurrentPng); els.exportAllPngBtn.addEventListener('click', downloadAllPng); els.printBtn.addEventListener('click', printAll); els.resetBtn.addEventListener('click', resetProject); els.closeCropBtn.addEventListener('click', () => closeCrop(false)); els.cancelCropBtn.addEventListener('click', () => closeCrop(false)); els.saveCropBtn.addEventListener('click', () => closeCrop(true)); els.cropFrame.addEventListener('pointerdown', startCropInteraction); els.cropImage.addEventListener('load', () => { fitCropImage(); updateCropFrameFromDraft(); }); window.addEventListener('resize', () => { fitCropImage(); updateCropFrameFromDraft(); }); [els.cropX, els.cropY, els.cropW, els.cropH].forEach((input) => input.addEventListener('input', updateCropFrame));
    window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); } else if (event.key === 'Delete' && !event.target.matches('input,textarea,select')) { event.preventDefault(); deleteSelected(); } });
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  setPaperGroup('large'); initEvents(); window.addEventListener('resize', syncStageSize); renderPhotoList(); render();
})();
