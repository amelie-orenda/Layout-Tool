const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'layout-engine.js'), 'utf8');
const context = { window: {}, console };
vm.runInNewContext(source, context, { filename: 'layout-engine.js' });
const engine = context.window.PhotoLayoutEngine;
const paper = { w: 210, h: 297 };
const photos = [
  { id: 'hero', weight: 10, naturalWidth: 1800, naturalHeight: 1200 },
  { id: 'small-a', weight: 1, naturalWidth: 600, naturalHeight: 900 },
  { id: 'small-b', weight: 1, naturalWidth: 900, naturalHeight: 600 },
  { id: 'small-c', weight: 1, naturalWidth: 650, naturalHeight: 900 },
  { id: 'small-d', weight: 1, naturalWidth: 900, naturalHeight: 650 }
].map((photo) => ({ ...photo, crop: { x: 0, y: 0, w: 1, h: 1 } }));
const common = { photos, paper, margin: 5, pageCount: 1, cropMode: 'cover', autoRotate: true, gap: 0, priority: 'balanced', debugCandidates: true };
const ungroupedPlan = engine.optimizeLayout({ ...common, minPhotoEdge: 0 });
const baseline = ungroupedPlan.candidateDiagnostics
  .filter((candidate) => candidate.allocationStrategy === 'ungrouped' && candidate.searchPriority === 'seed')
  .sort((a, b) => a.rawScore - b.rawScore)[0];
const groupedPlan = engine.optimizeLayout({ ...common, minPhotoEdge: 60 });
if (!baseline || !groupedPlan.feasible) throw new Error('The fixed visual fixture failed to produce both comparison layouts.');

const minimum = 60;
const baselineMin = Math.min(...baseline.items.map((item) => item.shortEdge));
const groupedMin = Math.min(...groupedPlan.metrics.debug.items.map((item) => item.shortEdge));
const baselineViolations = baseline.items.filter((item) => item.shortEdge < minimum - 0.001).length;
const baselineCropLoss = baseline.items.reduce((sum, item) => sum + 1 - item.cropFraction, 0) / baseline.items.length;
const baselineBlank = (1 - baseline.coverage) * (paper.w - 10) * (paper.h - 10);
const grouped = groupedPlan.metrics.debug.items;

const left = 52;
const right = 408;
const top = 96;
const pageScale = 0.92;
const pageW = paper.w * pageScale;
const pageH = paper.h * pageScale;
const colors = { hero: '#f6bd60', small: '#7bb6d9' };
const drawLayout = (items, x, tag) => {
  const sorted = [...items].sort((a, b) => a.area - b.area);
  return sorted.map((item) => {
    const px = x + item.x * pageScale;
    const py = top + item.y * pageScale;
    const w = item.w * pageScale;
    const h = item.h * pageScale;
    const invalid = item.shortEdge < minimum - 0.001;
    const color = item.id === 'hero' ? colors.hero : colors.small;
    const label = item.id.replace('small-', 'S');
    const dimension = `${item.w.toFixed(0)}×${item.h.toFixed(0)} mm`;
    return `<g><rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="2" fill="${color}" fill-opacity="0.84" stroke="${invalid ? '#c2413b' : '#31546b'}" stroke-width="${invalid ? 2.4 : 1.1}" ${invalid ? 'stroke-dasharray="5 3"' : ''}/><text x="${(px + w / 2).toFixed(2)}" y="${(py + h / 2 - 2).toFixed(2)}" text-anchor="middle" font-size="${Math.max(8, Math.min(13, Math.min(w, h) * 0.12)).toFixed(1)}" font-weight="700" fill="#172b3a">${label}</text><text x="${(px + w / 2).toFixed(2)}" y="${(py + h / 2 + 11).toFixed(2)}" text-anchor="middle" font-size="8.5" fill="#294657">${dimension}</text></g>`;
  }).join('');
};

const baselineStats = `min ${baselineMin.toFixed(1)} mm · ${baselineViolations} below 60 mm · coverage ${(baseline.coverage * 100).toFixed(1)}%`;
const groupedStats = `min ${groupedMin.toFixed(1)} mm · 0 violations · coverage ${(groupedPlan.metrics.coverage * 100).toFixed(1)}%`;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="430" viewBox="0 0 760 430">
<rect width="760" height="430" fill="#f4f7fa"/>
<text x="28" y="34" font-family="Arial, Microsoft YaHei, sans-serif" font-size="21" font-weight="700" fill="#193247">小照片分组重排 · 几何示意对比</text>
<text x="28" y="58" font-family="Arial, Microsoft YaHei, sans-serif" font-size="11" fill="#516575">同一组 1 张高权重照片 + 4 张混合宽高比小照片；页面 A4，边距 5 mm，目标最小短边 60 mm。</text>
<text x="${left}" y="82" font-family="Arial, Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#193247">普通分区候选（60 mm 后验检查）</text>
<text x="${left}" y="${top + pageH + 24}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="10" fill="#8c302b">${baselineStats}</text>
<text x="${right}" y="82" font-family="Arial, Microsoft YaHei, sans-serif" font-size="13" font-weight="700" fill="#193247">全局搜索结果（小照片紧凑成组）</text>
<text x="${right}" y="${top + pageH + 24}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="10" fill="#25624b">${groupedStats}</text>
<rect x="${left}" y="${top}" width="${pageW}" height="${pageH}" fill="#fff" stroke="#60798a" stroke-width="1.2"/>
<rect x="${right}" y="${top}" width="${pageW}" height="${pageH}" fill="#fff" stroke="#60798a" stroke-width="1.2"/>
${drawLayout(baseline.items, left, 'base')}
${drawLayout(grouped, right, 'grouped')}
<rect x="29" y="395" width="12" height="12" fill="#f6bd60"/><text x="47" y="405" font-family="Arial, Microsoft YaHei, sans-serif" font-size="10" fill="#41596a">高权重照片</text>
<rect x="135" y="395" width="12" height="12" fill="#7bb6d9"/><text x="153" y="405" font-family="Arial, Microsoft YaHei, sans-serif" font-size="10" fill="#41596a">小照片</text>
<rect x="223" y="395" width="12" height="12" fill="none" stroke="#c2413b" stroke-width="2" stroke-dasharray="4 2"/><text x="241" y="405" font-family="Arial, Microsoft YaHei, sans-serif" font-size="10" fill="#41596a">低于 60 mm 的违规矩形</text>
<text x="28" y="425" font-family="Arial, Microsoft YaHei, sans-serif" font-size="9" fill="#6d7f8b">示意图显示打印矩形边界，不代表原始照片内容。后验基线空白约 ${baselineBlank.toFixed(0)} mm²，裁切损失 ${(baselineCropLoss * 100).toFixed(1)}%；重排裁切损失 ${(groupedPlan.metrics.cropLoss * 100).toFixed(1)}%。</text>
</svg>`;

const outDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'small-photo-grouping-comparison.svg');
fs.writeFileSync(outPath, svg, 'utf8');
console.log(JSON.stringify({ output: outPath, baseline: { coverage: baseline.coverage, minShortEdge: baselineMin, minViolations: baselineViolations, cropLoss: baselineCropLoss }, grouped: { coverage: groupedPlan.metrics.coverage, minShortEdge: groupedMin, minViolations: groupedPlan.metrics.minimumShortSideViolations, cropLoss: groupedPlan.metrics.cropLoss, strategy: groupedPlan.allocationStrategy } }, null, 2));
