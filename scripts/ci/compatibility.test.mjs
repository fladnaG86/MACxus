import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateCatalog } from '../compatibility/model.mjs';
import { generateDocuments, writeDocuments } from '../compatibility/generate.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../../docs/compatibility/reports.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(catalog);
const game = (data, id) => data.games.find(game => game.id === id);
const allReports = data => data.games.flatMap(game => game.reports);

test('migration retains different environments, limited scope, unknowns and controller evidence', () => {
  validateCatalog(catalog);
  assert.ok(catalog.games.length >= 14);
  assert.ok(allReports(catalog).length >= 17);
  const bond = game(catalog, '007-first-light').reports;
  assert.equal(bond[0].checks.gameplay, 'passed');
  assert.equal(bond[0].checks.online, 'issues');
  assert.equal(bond[0].graphics.version, '4.0b3');
  assert.equal(bond[1].layer, 'crossover-preview-arm');
  assert.equal(bond[1].checks.launch, 'failed');
  assert.equal(bond[1].chip, null, 'do not copy the Rosetta environment into the ARM report');
  const halo = game(catalog, 'halo-campaign-evolved').reports;
  assert.equal(halo[0].chip, 'M1 Max');
  assert.equal(halo[0].controllers[0].result, 'failed');
  assert.equal(halo[1].chip, 'M5 Max');
  assert.equal(halo[1].result, 'partial');
  assert.equal(halo[1].checks.gameplay, 'untested');
  assert.equal(halo[1].controllers.find(controller => controller.model === 'Steam Controller 2').connection, 'unknown');
  assert.equal(halo[1].controllers.find(controller => controller.model === 'Xbox Elite Series 2').connection, 'bluetooth');
  assert.match(halo[1].requirements[0].en, /No GameInput replacement/);
  const nineSols = game(catalog, 'nine-sols').reports[0];
  assert.equal(nineSols.layerVersion, '26.3');
  assert.equal(nineSols.macOS, null);
  assert.deepEqual(game(catalog, 'mad-king-redemption').reports[0].scope, ['not-reported']);
  assert.equal(game(catalog, 'gears-e-day').reports[0].result, 'blocked');
});

test('validation rejects ambiguous identities, missing metadata, invalid dates and untrusted evidence URLs', () => {
  for (const [mutate, expected] of [
    [data => data.games[0].id = '../escape', /game identity/],
    [data => data.games.push(structuredClone(data.games[0])), /game identity/],
    [data => data.games[0].reports[1].id = data.games[0].reports[0].id, /report identity/],
    [data => delete data.games[0].reports[0].macOS, /macOS/],
    [data => data.games[0].reports[0].testedAt = '2026-02-30', /invalid test date/],
    [data => data.games[0].reports[0].testedAt = '2026-99-99', /invalid test date/],
    [data => data.games[0].reports[0].sources = [], /missing evidence/],
    [data => data.games[0].reports[0].sources[0].url = 'javascript:alert(1)', /HTTPS/],
    [data => data.games[0].reports[0].sources[0].url = 'https://secret@example.com', /credentials/],
    [data => data.games[0].reports[0].sources[0].url = 'https://example.com/\nInjected', /HTTPS/],
    [data => data.games[0].reports[0].summary.it = '', /bilingual/],
    [data => data.games[0].reports[0].layer = '__proto__', /layer\/result/],
  ]) {
    const candidate = copy(); mutate(candidate);
    assert.throws(() => generateDocuments(candidate), expected);
  }
});

test('validation preserves missing architecture while rejecting contradictory result and coverage claims', () => {
  for (const [mutate, expected] of [
    [report => { report.result = 'works'; report.scope = ['controller-input']; }, /limited tests/],
    [report => { report.result = 'works'; report.checks.gameplay = 'failed'; }, /contradicts gameplay/],
    [report => { report.result = 'works'; report.checks.launch = 'blocked'; }, /contradicts launch/],
    [report => report.scope = ['not-reported', 'gameplay'], /unknown scope/],
    [report => report.layer = 'crossover-preview-arm', /architecture\/layer/],
  ]) {
    const candidate = copy(); mutate(candidate.games[0].reports[0]);
    assert.throws(() => validateCatalog(candidate), expected);
  }
  const candidate = copy(); candidate.games[0].reports[1].architecture = 'unknown';
  validateCatalog(candidate);
});

test('product identity is validated per store and cannot be duplicated within a store', () => {
  const candidate = copy();
  candidate.games[0].store = 'steam'; candidate.games[0].storeId = '123456';
  validateCatalog(candidate);
  candidate.games[1].store = 'steam'; candidate.games[1].storeId = '123456';
  assert.throws(() => validateCatalog(candidate), /duplicate Store ID/);
  candidate.games[1].store = 'microsoft-store';
  assert.throws(() => validateCatalog(candidate), /store identity/);
});

test('generated Markdown escapes report prose and does not turn a hostile title into markup', () => {
  const candidate = copy();
  candidate.games[0].title = '<img src=x onerror=alert(1)> [fake](https://evil.example) | **pass**';
  candidate.games[0].reports[0].summary.en = '</script>\n[unsafe](javascript:alert(1)) | `code`';
  candidate.games[0].reports[0].sources[0].url = 'https://example.com/path(with-parens)';
  const documents = generateDocuments(candidate);
  for (const contents of documents.values()) {
    assert.doesNotMatch(contents, /<img|<\/script>|\[fake\]|\[unsafe\]/);
  }
  assert.match(documents.get('docs/compatibility/games/007-first-light.md'), /&lt;\/script&gt;/);
  assert.match(documents.get('docs/compatibility/games/007-first-light.md'), /https:\/\/example.com\/path%28with-parens%29/);
});

test('all generated relative links point to real pages and bilingual anchors', () => {
  const documents = generateDocuments(catalog);
  const anchors = contents => new Set([
    ...[...contents.matchAll(/<a id="([^"]+)">/g)].map(match => match[1]),
    ...[...contents.matchAll(/^## (English|Italiano)$/gm)].map(match => match[1].toLowerCase()),
  ]);
  for (const [filename, contents] of documents) {
    for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (/^<?https:/.test(href)) continue;
      const [relative, fragment] = href.split('#');
      const target = relative ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), relative)) : filename;
      if (target.endsWith('MAINTAINING.md')) continue;
      assert.ok(documents.has(target), `${filename} -> ${target}`);
      if (fragment) assert.ok(anchors(documents.get(target)).has(fragment), `${filename} -> ${target}#${fragment}`);
    }
  }
  const preview = documents.get('docs/compatibility/layers/crossover-preview.md');
  assert.doesNotMatch(preview, /halo-highball-m1max/);
  const highball = documents.get('docs/compatibility/layers/highball.md');
  assert.doesNotMatch(highball, /halo-preview-m5max/);
  assert.match(preview, /\| macOS \| Chip \|/);
  assert.ok([...documents.keys()].every(filename => filename.endsWith('.md')));
});

test('generation checks missing/stale/obsolete views and removes only obsolete generated Markdown', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-compatibility-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const documents = generateDocuments(catalog);
  await assert.rejects(writeDocuments(root, documents, { check: true }), /stale/);
  await writeDocuments(root, documents);
  await writeDocuments(root, documents, { check: true });
  await fs.appendFile(path.join(root, 'docs/COMPATIBILITY.md'), 'stale');
  await assert.rejects(writeDocuments(root, documents, { check: true }), /stale/);
  await writeDocuments(root, documents);
  const obsolete = path.join(root, 'docs/compatibility/games/removed.md');
  const retained = path.join(root, 'docs/compatibility/games/keep.txt');
  await fs.writeFile(obsolete, 'old'); await fs.writeFile(retained, 'keep');
  await assert.rejects(writeDocuments(root, documents, { check: true }), /Obsolete/);
  await writeDocuments(root, documents);
  await assert.rejects(fs.access(obsolete), { code: 'ENOENT' });
  assert.equal(await fs.readFile(retained, 'utf8'), 'keep');
  await writeDocuments(root, documents, { check: true });
});

test('500 games with separate configurations produce a compact alphabetical index and complete layer tables', () => {
  const large = { schemaVersion: 1, games: Array.from({ length: 500 }, (_, index) => {
    const item = structuredClone(catalog.games[0]);
    item.id = `game-${index}`; item.title = `Game ${String(index).padStart(3, '0')}`;
    item.reports.forEach((report, reportIndex) => report.id = `report-${index}-${reportIndex}`);
    return item;
  }) };
  const documents = generateDocuments(large);
  assert.equal(documents.size, 503);
  const index = documents.get('docs/COMPATIBILITY.md');
  assert.equal((index.match(/\]\(compatibility\/games\/[^)]+#english\)/g) ?? []).length, 500);
  for (const layer of ['crossover-preview', 'crossover-preview-arm']) {
    const table = documents.get(`docs/compatibility/layers/${layer}.md`);
    assert.equal((table.match(/\.md#en-report-/g) ?? []).length, 500);
  }
  const reversed = { ...large, games: [...large.games].reverse() };
  assert.equal(generateDocuments(reversed).get('docs/COMPATIBILITY.md'), index);
});
