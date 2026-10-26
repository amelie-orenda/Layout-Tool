const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'layout-engine.js'), 'utf8');
const context = { window: {}, console };
vm.runInNewContext(source, context, { filename: 'layout-engine.js' });
const engine = context.window.PhotoLayoutEngine;
assert(engine && typeof engine.optimizeLayout === 'function', 'layout engine did not load');

const paper = { w: 210, h: 297 };
function photo(id, weight, width = 1200, height = 900) {
  return { id, weight, naturalWidth: width, naturalHeight: height, crop: { x: 0, y: 0, w: 1, h: 1 } };
}
function allItems(plan) { return plan.pages.flatMap((page) => page.items); }
function overlap(a, b) {
  return a.x < b.x - 0.0001 && a.x + a.w > b.x + 0.0001 && a.y < b.y - 0.0001 && a.y + a.h > b.y + 0.0001;
}
function assertGeometry(plan, expectedIds, margin = 5) {
  const items = allItems(plan);
  assert.strictEqual(new Set(items.map((item) => item.photoId)).size, expectedIds.length, 'photo ids must be unique');
  assert.deepStrictEqual([...new Set(items.map((item) => item.photoId))].sort(), [...expectedIds].sort(), 'all photos must be retained');
  for (const page of plan.pages) {
    for (const item of page.items) {
      assert(item.x >= margin - 0.001 && item.y >= margin - 0.001, 'item must stay inside the top-left margin');
      assert(item.x + item.w <= paper.w - margin + 0.001 && item.y + item.h <= paper.h - margin + 0.001, 'item must stay inside the printable area');
      assert(item.w > 0 && item.h > 0, 'item rectangles must be positive');
    }
    for (let i = 0; i < page.items.length; i += 1) for (let j = i + 1; j < page.items.length; j += 1) assert(!overlap(page.items[i], page.items[j]), 'photo rectangles must not overlap');
  }
}
function optimize(photos, extra = {}) {
  return engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 1, cropMode: 'cover', autoRotate: true, minPhotoEdge: 0, gap: 0, ...extra });
}
function area(plan, id) {
  const item = allItems(plan).find((entry) => entry.photoId === id);
  return item.w * item.h;
}

// High-weight photos should not be smaller than low-weight photos in a simple pair.
{
  const photos = [photo('important', 10), photo('minor', 1), photo('normal', 4), photo('normal-2', 4)];
  const plan = optimize(photos);
  assertGeometry(plan, photos.map((entry) => entry.id));
  assert(area(plan, 'important') >= area(plan, 'minor'), 'high weight photo was assigned a smaller area');
  assert.strictEqual(plan.metrics.areaRankingViolations, 0, 'weight ranking penalty did not control the area inversion');
}

// Equal-weight, compatible photos should produce a compact filled layout.
{
  const photos = [photo('a', 5), photo('b', 5), photo('c', 5), photo('d', 5)];
  const plan = optimize(photos, { cropMode: 'contain' });
  assertGeometry(plan, photos.map((entry) => entry.id));
  assert(plan.metrics.rectangleUtilization > 0.995, `no-gap rectangles left avoidable blank space: ${plan.metrics.rectangleUtilization}`);
  assert(plan.metrics.utilization <= plan.metrics.rectangleUtilization + 0.0001, 'actual coverage cannot exceed rectangle coverage');
}

// Landscape and portrait photos must remain rectangular and use rotation/cropping, never stretching.
{
  const photos = [photo('landscape', 7, 1800, 900), photo('portrait', 7, 900, 1800), photo('square', 4, 1200, 1200)];
  const plan = optimize(photos);
  assertGeometry(plan, photos.map((entry) => entry.id));
  allItems(plan).forEach((item) => assert([0, 90].includes(item.rotation), 'only quarter-turn rotations are allowed'));
  assert(plan.metrics.cropLoss >= 0 && plan.metrics.cropLoss <= 1, 'crop loss must be normalized');
}

// More pages must preserve every photo and keep each page independently valid.
{
  const photos = Array.from({ length: 7 }, (_, index) => photo(`p${index}`, index === 0 ? 10 : 2, 1000 + index * 20, 800));
  const plan = optimize(photos, { pageCount: 3, minPhotoEdge: 30 });
  assert.strictEqual(plan.pages.length, 3);
  assertGeometry(plan, photos.map((entry) => entry.id));
  assert(plan.metrics.debug.pages.every((page) => page.utilization >= 0), 'page diagnostics must include utilization');
}

// White-border/gap space is explicit: a gap reduces usable coverage, while gap zero fills the partition.
{
  const photos = [photo('g1', 5), photo('g2', 5), photo('g3', 5), photo('g4', 5)];
  const tight = optimize(photos, { gap: 0 });
  const spaced = optimize(photos, { gap: 3 });
  assert(tight.metrics.utilization > spaced.metrics.utilization, 'adding a gap should be reflected in space utilization');
  assert(spaced.metrics.blankArea > tight.metrics.blankArea, 'gap should be reflected in blank area');
}

// Changing weights must change target areas, rather than only changing labels.
{
  const before = optimize([photo('focus', 2), photo('other', 8), photo('third', 5)]);
  const after = optimize([photo('focus', 20), photo('other', 8), photo('third', 5)]);
  assert(area(after, 'focus') > area(before, 'focus'), 'weight changes must affect final area');
  assert(after.metrics.debug.items.find((item) => item.id === 'focus').weightRank === 1, 'updated weight rank was not recorded');
}

// Priority modes must change the objective, and Space Priority should improve actual image coverage on mismatched ratios.
{
  const photos = [photo('wide', 10, 1800, 700), photo('tall', 1, 700, 1800), photo('mid', 5, 1200, 900), photo('mid-2', 5, 1200, 900)];
  const weightPlan = optimize(photos, { cropMode: 'contain', priority: 'weight' });
  const balancedPlan = optimize(photos, { cropMode: 'contain', priority: 'balanced' });
  const spacePlan = optimize(photos, { cropMode: 'contain', priority: 'space' });
  assert(area(weightPlan, 'wide') >= area(weightPlan, 'tall'), 'Weight Priority must keep the important photo larger');
  assert.notStrictEqual(Math.round(weightPlan.metrics.score * 1000), Math.round(spacePlan.metrics.score * 1000), 'priority modes must not collapse to one score');
  assert(spacePlan.metrics.utilization >= balancedPlan.metrics.utilization - 0.0001, 'Space Priority should not reduce actual coverage against Balanced');
  assert(weightPlan.metrics.targetAreaDeviation <= spacePlan.metrics.targetAreaDeviation + 0.0001, 'Weight Priority should stay closer to target areas');
  console.log(`mismatched ratios: Weight ${(weightPlan.metrics.utilization * 100).toFixed(1)}% · Balanced ${(balancedPlan.metrics.utilization * 100).toFixed(1)}% · Space ${(spacePlan.metrics.utilization * 100).toFixed(1)}%`);
}

// A contained photo can leave blank bands inside a rectangle; that must not be reported as 100% coverage.
{
  const plan = engine.optimizeLayout({ photos: [photo('letterbox', 5, 1600, 600)], paper: { w: 210, h: 100 }, margin: 5, pageCount: 1, cropMode: 'contain', autoRotate: false, minPhotoEdge: 0, gap: 0, priority: 'balanced' });
  assert(plan.metrics.rectangleUtilization > 0.99, 'the photo rectangle should occupy the printable area');
  assert(plan.metrics.utilization < 0.85, `contain blank bands were incorrectly counted as coverage: ${plan.metrics.utilization}`);
  assert(plan.metrics.blankArea > 0, 'debug blank area must include the contained image bands');
}

// Minimum Short Side is a hard constraint. A grouped 2-page arrangement can make
// a set of square photos feasible even when the one-page area lower bound cannot.
{
  const photos = Array.from({ length: 8 }, (_, index) => photo(`min-${index}`, index === 0 ? 10 : 2, 1000, 1000));
  const invalid = engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 1, cropMode: 'cover', autoRotate: true, minPhotoEdge: 90, gap: 0, priority: 'balanced' });
  assert.strictEqual(invalid.feasible, false, 'an area-infeasible manually specified page count must not be reported as feasible');
  assert(invalid.metrics.minViolations > 0, 'the minimum-size violation must be reported');
  ['weight', 'balanced', 'space'].forEach((priority) => {
    const valid = engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 2, cropMode: 'cover', autoRotate: true, minPhotoEdge: 90, gap: 0, priority });
    assert.strictEqual(valid.feasible, true, `${priority}: an adequate page count should satisfy the hard minimum`);
    assert.strictEqual(valid.metrics.minViolations, 0, `${priority}: valid layouts must have no minimum-size violations`);
    allItems(valid).forEach((item) => assert(Math.min(item.debug.shortEdge, item.w, item.h) >= 90 - 0.001, `${priority}: final printed photo size must satisfy the minimum in mm`));
  });
}

// Group repacking moves a large photo aside and packs four small, mixed-aspect
// photos into a compact local region instead of leaving undersized fragments.
{
  const photos = [photo('hero', 10, 1800, 1200), photo('small-a', 1, 600, 900), photo('small-b', 1, 900, 600), photo('small-c', 1, 650, 900), photo('small-d', 1, 900, 650)];
  const baseline = engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 1, cropMode: 'cover', autoRotate: true, minPhotoEdge: 0, gap: 0, priority: 'balanced', debugCandidates: true });
  const ungrouped = baseline.candidateDiagnostics.filter((candidate) => candidate.allocationStrategy === 'ungrouped').sort((a, b) => a.rawScore - b.rawScore)[0];
  assert(ungrouped && ungrouped.minShortEdge < 60, 'the fixed ungrouped reference should expose a small-photo minimum-size failure when checked at 60mm');
  const plans = ['weight', 'balanced', 'space'].map((priority) => engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 1, cropMode: 'cover', autoRotate: true, minPhotoEdge: 60, gap: 0, priority, debugCandidates: true }));
  plans.forEach((plan) => {
    assert.strictEqual(plan.feasible, true, `${plan.metrics.priority}: grouped repacking should find a hard-minimum-valid layout`);
    assert.strictEqual(plan.metrics.minimumShortSideViolations, 0, `${plan.metrics.priority}: grouped layout violated Minimum Short Side`);
    assert(Math.min(...plan.metrics.debug.items.map((item) => item.shortEdge)) >= 60 - 0.001, `${plan.metrics.priority}: physical short edge fell below 60mm`);
    assert(plan.candidateDiagnostics.some((candidate) => candidate.allocationStrategy !== 'ungrouped' && candidate.feasible), `${plan.metrics.priority}: shared candidate pool omitted valid group-repack layouts`);
  });
  assert(plans[2].metrics.coverage >= plans[1].metrics.coverage - 0.0001, 'Space Priority should not lose coverage against Balanced after group repacking');
  console.log(`small-photo group: ungrouped reference min ${ungrouped.minShortEdge.toFixed(1)}mm · grouped minimum ${Math.min(...plans[1].metrics.debug.items.map((item) => item.shortEdge)).toFixed(1)}mm · Balanced coverage ${(plans[1].metrics.coverage * 100).toFixed(1)}%`);
}

// Cross-page large-neighborhood reallocation and equal-weight mixed-aspect groups.
{
  const scenarios = [
    { name: '2-large-6-small', count: 8, pages: 2, min: 40, make: (index) => photo(`l6-${index}`, index < 2 ? 10 : 1, index % 2 ? 700 : 1600, index % 2 ? 1500 : 900) },
    { name: '10-equal-mixed', count: 10, pages: 1, min: 35, make: (index) => photo(`eq-${index}`, 5, index % 2 ? 900 : 1400, index % 2 ? 1400 : 900) }
  ];
  scenarios.forEach((scenario) => {
    const photos = Array.from({ length: scenario.count }, (_, index) => scenario.make(index));
    ['weight', 'balanced', 'space'].forEach((priority) => {
      const plan = engine.optimizeLayout({ photos, paper, margin: 5, pageCount: scenario.pages, cropMode: 'cover', autoRotate: true, minPhotoEdge: scenario.min, gap: 0, priority });
      assert.strictEqual(plan.feasible, true, `${scenario.name}/${priority}: repacking should preserve the hard minimum`);
      assert.strictEqual(plan.metrics.minimumShortSideViolations, 0, `${scenario.name}/${priority}: minimum-size violations`);
      assertGeometry(plan, photos.map((entry) => entry.id));
      console.log(`${scenario.name}/${priority}: pages ${plan.pageCount} · Coverage ${(plan.metrics.coverage * 100).toFixed(1)}% · min ${Math.min(...plan.metrics.debug.items.map((item) => item.shortEdge)).toFixed(1)}mm · spread ${plan.metrics.smallPhotoScattering.toFixed(3)}`);
    });
  });
}

// A large allocation frame cannot disguise an undersized contain-mode image; the final visible short side is the hard constraint.
{
  const wide = photo('wide-contained', 5, 2000, 1000);
  const contained = engine.optimizeLayout({ photos: [wide], paper, margin: 8, pageCount: 1, cropMode: 'contain', autoRotate: false, minPhotoEdge: 120, gap: 0, priority: 'balanced' });
  assert.strictEqual(contained.feasible, false, 'an image letterboxed below the minimum must be rejected even if its allocation frame is large');
  assert.strictEqual(contained.metrics.minimumShortSideViolations, 1);
  assert(contained.metrics.debug.items[0].shortEdge < 120, 'minimum diagnostics must report the visible image bounds');
}

// Every priority uses the same geometry pool; Space Priority selects by real coverage but keeps a weight-quality floor.
{
  const photos = Array.from({ length: 8 }, (_, index) => photo(`shared-${index}`, index === 0 ? 10 : 2, index % 2 ? 700 : 1500, index % 2 ? 1700 : 800));
  const plans = ['weight', 'balanced', 'space'].map((priority) => engine.optimizeLayout({ photos, paper, margin: 5, pageCount: 2, cropMode: 'contain', autoRotate: true, minPhotoEdge: 40, gap: 0, priority }));
  assert.strictEqual(plans[0].candidatePoolSignature, plans[1].candidatePoolSignature, 'Weight and Balanced must share the candidate pool');
  assert.strictEqual(plans[1].candidatePoolSignature, plans[2].candidatePoolSignature, 'Balanced and Space must share the candidate pool');
  plans.forEach((plan) => { assert.strictEqual(plan.feasible, true, `${plan.metrics.priority} must satisfy hard constraints`); assert.strictEqual(plan.metrics.minViolations, 0, `${plan.metrics.priority} violated minimum size`); assertGeometry(plan, photos.map((entry) => entry.id)); });
  assert(plans[2].metrics.utilization >= Math.max(plans[0].metrics.utilization, plans[1].metrics.utilization) - 0.0001, 'Space Priority selected lower actual coverage from the shared pool');
  assert(area(plans[2], 'shared-0') >= area(plans[2], 'shared-1'), 'Space Priority must retain a basic high-weight area floor');
  plans.forEach((plan) => console.log(`${plan.metrics.priority}: Coverage ${(plan.metrics.utilization * 100).toFixed(1)}% · min violations ${plan.metrics.minViolations} · ranking violations ${plan.metrics.areaRankingViolations}`));
}

// Fixed acceptance datasets: 5 pronounced weights, 10 equal weights, and 20 mixed photos across A4 pages.
{
  const scenarios = [
    { name: '5-weighted', count: 5, pages: 1, margin: 8, gap: 0, min: 20, make: (index) => photo(`s5-${index}`, [10, 7, 4, 2, 1][index], index % 2 ? 900 : 1800, index % 2 ? 1400 : 900) },
    { name: '10-equal', count: 10, pages: 2, margin: 8, gap: 2, min: 20, make: (index) => photo(`s10-${index}`, 5, index % 2 ? 700 : 1500, index % 3 ? 1200 : 800) },
    { name: '20-mixed', count: 20, pages: 4, margin: 8, gap: 3, min: 20, make: (index) => photo(`s20-${index}`, [10, 8, 6, 4, 2][index % 5], index % 2 ? 700 : 1600, index % 3 ? 1500 : 800) }
  ];
  scenarios.forEach((scenario) => {
    const photos = Array.from({ length: scenario.count }, (_, index) => scenario.make(index));
    const plans = {};
    ['weight', 'balanced', 'space'].forEach((priority) => {
      const plan = engine.optimizeLayout({ photos, paper, margin: scenario.margin, pageCount: scenario.pages, cropMode: 'cover', autoRotate: true, minPhotoEdge: scenario.min, gap: scenario.gap, priority });
      plans[priority] = plan;
      assert.strictEqual(plan.feasible, true, `${scenario.name}/${priority} must satisfy all hard constraints`);
      assert.strictEqual(plan.metrics.minimumShortSideViolations, 0, `${scenario.name}/${priority} violated minimum size`);
      assertGeometry(plan, photos.map((entry) => entry.id), scenario.margin);
      console.log(`${scenario.name}/${priority}: pages ${plan.pageCount} · Coverage ${(plan.metrics.coverage * 100).toFixed(1)}% · Target Error ${(plan.metrics.targetAreaError * 100).toFixed(1)}% · Crop Loss ${(plan.metrics.cropLoss * 100).toFixed(1)}% · min violations ${plan.metrics.minimumShortSideViolations} · ranking violations ${plan.metrics.weightRankingViolations}`);
    });
    if (scenario.count >= 10) assert(plans.space.candidateCount > 36, `${scenario.name}: candidate search did not expand beyond the old 12-start pool`);
    assert(plans.space.metrics.coverage >= plans.balanced.metrics.coverage - 0.0001, `${scenario.name}: Space Priority reduced actual coverage`);
    assert(plans.weight.metrics.targetAreaError <= plans.space.metrics.targetAreaError + 0.0001, `${scenario.name}: Weight Priority drifted farther from target areas`);
    if (scenario.name === '20-mixed') {
      assert.strictEqual(plans.space.metrics.weightQualityFloorMet, true, 'Space Priority should retain a weight-acceptable candidate when one exists');
      assert(plans.space.metrics.weightRankingViolations <= Math.ceil((scenario.count * (scenario.count - 1) / 2) * 0.05), 'Space Priority exceeded the pairwise weight-quality floor');
    }
  });
}

// Space Priority keeps the best coverage found among candidates that satisfy its weight-quality floor.
{
  const photos = Array.from({ length: 10 }, (_, index) => photo(`search-${index}`, [10, 8, 6, 4, 2][index % 5], index % 2 ? 700 : 1600, index % 3 ? 1500 : 800));
  const input = { photos, paper, margin: 8, pageCount: 2, cropMode: 'cover', autoRotate: true, minPhotoEdge: 20, gap: 2, priority: 'space', debugCandidates: true };
  const first = engine.optimizeLayout(input);
  const repeated = engine.optimizeLayout(input);
  assert.strictEqual(first.candidatePoolSignature, repeated.candidatePoolSignature, 'multi-start candidate generation must be repeatable');
  assert.deepStrictEqual(first.pages, repeated.pages, 'a repeat run must not replace a better result with a worse random start');
  const acceptable = first.candidateDiagnostics.filter((candidate) => {
    const allowedViolations = Math.max(1, Math.ceil((photos.length * (photos.length - 1) / 2) * 0.05));
    if (!candidate.feasible || candidate.weightRankingViolations > allowedViolations || candidate.weightMinDeficit > 0.45 || candidate.targetAreaError > 0.8) return false;
    return true;
  });
  const eligible = acceptable.length ? acceptable : first.candidateDiagnostics.filter((candidate) => candidate.feasible);
  if (!acceptable.length) {
    assert.strictEqual(first.metrics.weightQualityFloorMet, false, 'the UI-facing metrics must disclose when no searched candidate met the weight floor');
    assert.strictEqual(first.metrics.selectionReason, 'coverage-without-weight-floor', 'fallback selection must explain why the weight floor was unavailable');
  }
  const bestCoverage = Math.max(...eligible.map((candidate) => candidate.coverage));
  assert(first.metrics.coverage >= bestCoverage - 0.0001, 'Space Priority failed to keep the best valid coverage candidate');
}

console.log('layout-engine tests passed');
