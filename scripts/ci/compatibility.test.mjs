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
  assert.equal(bond[0].result, 'works-offline');
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
    [report => { report.result = 'works-offline'; report.scope = ['menu']; }, /limited tests/],
    [report => { report.result = 'works-offline'; report.checks.gameplay = 'failed'; }, /contradicts gameplay/],
    [report => { report.result = 'works-offline'; report.checks.online = 'passed'; }, /online limitation/],
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
  const halo = documents.get('docs/compatibility/games/halo-campaign-evolved.md');
  assert.match(halo, /\| macOS \| Chip \|/);
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

test('500 games across different initials produce one continuous alphabetical table per language', () => {
  const large = { schemaVersion: 1, games: Array.from({ length: 500 }, (_, index) => {
    const item = structuredClone(catalog.games[0]);
    item.id = `game-${index}`; item.title = `${['007', 'Alpha', 'Bravo', 'Étoile', 'Zeta'][index % 5]} ${String(index).padStart(3, '0')}`;
    item.reports.forEach((report, reportIndex) => report.id = `report-${index}-${reportIndex}`);
    return item;
  }) };
  const documents = generateDocuments(large);
  assert.equal(documents.size, 501);
  const index = documents.get('docs/COMPATIBILITY.md');
  for (const title of ['Game', 'Gioco']) {
    const lines = index.split('\n');
    const header = `| ${title} | Highball |`;
    assert.equal(lines.filter(line => line.startsWith(header)).length, 1, 'one table header per language');
    const start = lines.findIndex(line => line.startsWith(header));
    assert.ok(lines.slice(start + 2, start + 502).every(line => line.startsWith('| [')), 'all 500 games remain in the same uninterrupted table');
  }
  assert.equal((index.match(/\]\(compatibility\/games\/[^)]+#english\)/g) ?? []).length, 500);
  for (const suffix of ['0', '1']) {
    assert.equal((index.match(new RegExp(`\\.md#en-report-[0-9]+-${suffix}\\)`, 'g')) ?? []).length, 500);
  }
  const reversed = { ...large, games: [...large.games].reverse() };
  assert.equal(generateDocuments(reversed).get('docs/COMPATIBILITY.md'), index);
});


test('matrix shows a failure beside a working alternative and never treats absent or unknown layers as failure', () => {
  const candidate = copy();
  const item = candidate.games[0];
  const failure = structuredClone(item.reports[1]);
  failure.id = 'highball-launch-failure'; failure.layer = 'highball'; failure.architecture = 'unknown';
  item.reports.push(failure);
  const unknown = structuredClone(failure);
  unknown.id = 'unreported-layer-failure'; unknown.layer = 'unknown';
  item.reports.push(unknown);
  const index = generateDocuments(candidate).get('docs/COMPATIBILITY.md');
  const row = index.split('\n').find(line => line.startsWith('| [007 First Light]'));
  const columns = row.split(' | ');
  assert.match(index, /\| Game \| Highball \| CrossOver \| Preview Rosetta \| Preview ARM64\/FEX \| Layer not reported \|/);
  assert.match(columns[1], /❌ Fails.*#en-highball-launch-failure/);
  assert.equal(columns[2], '—', 'no CrossOver report is not a failure');
  assert.match(columns[3], /✅ Works \(offline\).*#en-bond-preview-rosetta-m5max/);
  assert.match(columns[4], /❌ Fails.*#en-bond-preview-arm-launch/);
  assert.match(columns[5], /#en-unreported-layer-failure/);
  assert.doesNotMatch(columns.slice(1, 5).join(' '), /unreported-layer-failure/);
});

test('matrix preserves conflicting outcomes on the same layer and links duplicate outcomes to all configurations', () => {
  const candidate = copy();
  const item = candidate.games[0];
  const working = structuredClone(item.reports[0]);
  working.id = 'preview-working-again'; item.reports.push(working);
  const failure = structuredClone(item.reports[1]);
  failure.id = 'preview-failure'; failure.layer = 'crossover-preview'; failure.architecture = 'x86_64-rosetta';
  item.reports.push(failure);
  const documents = generateDocuments(candidate);
  const row = documents.get('docs/COMPATIBILITY.md').split('\n').find(line => line.startsWith('| [007 First Light]'));
  const preview = row.split(' | ')[3];
  assert.match(preview, /✅ Works \(offline\) \(2\).*\.md#english/);
  assert.match(preview, /❌ Fails.*#en-preview-failure/);
  const details = documents.get('docs/compatibility/games/007-first-light.md');
  assert.match(details, /id="en-bond-preview-rosetta-m5max"/);
  assert.match(details, /id="en-preview-working-again"/);
});
