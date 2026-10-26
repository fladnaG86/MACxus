import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './model.mjs';
import { renderIndex, renderGame } from './documents.mjs';

export function generateDocuments(catalog) {
  validateCatalog(catalog);
  const outputs = new Map([['docs/COMPATIBILITY.md', renderIndex(catalog)]]);
  for (const game of catalog.games) outputs.set(`docs/compatibility/games/${game.id}.md`, renderGame(game));
  return outputs;
}

export async function writeDocuments(project, outputs, { check = false } = {}) {
  for (const [relative, contents] of outputs) {
    const target = path.join(project, relative);
    if (check) {
      let before;
      try { before = await fs.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (before !== contents) throw Error(`Generated compatibility view is stale: ${relative}. Run npm run compatibility:generate.`);
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents);
    }
  }
  // Keep game pages current and remove obsolete layer pages from the earlier layout.
  // Both directories are owned generated Markdown; keep hand-authored guides elsewhere.
  for (const directory of ['games', 'layers']) {
    const root = path.join(project, 'docs/compatibility', directory);
    let entries;
    try { entries = await fs.readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    for (const entry of entries) {
      const relative = `docs/compatibility/${directory}/${entry}`;
      if (!entry.endsWith('.md') || outputs.has(relative)) continue;
      if (check) throw Error(`Obsolete generated compatibility page: ${relative}`);
      await fs.unlink(path.join(root, entry));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = fileURLToPath(new URL('../../', import.meta.url));
  const catalog = JSON.parse(await fs.readFile(path.join(project, 'docs/compatibility/reports.json'), 'utf8'));
  const outputs = generateDocuments(catalog);
  const check = process.argv.includes('--check');
  await writeDocuments(project, outputs, { check });
  console.log(`${check ? 'Verified' : 'Generated'} ${catalog.games.length} games / ${catalog.games.reduce((n, game) => n + game.reports.length, 0)} configuration reports and ${outputs.size} Markdown views.`);
}
