import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareFH5CompatHome } from './fh5-compat-home.js';

async function fixture(run: (source: string, root: string, base: string) => Promise<void>) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'FH5 signed cache '));
  const source = path.join(base, 'vendor'), root = path.join(base, 'managed');
  await fs.mkdir(source); await fs.mkdir(root);
  try { await run(source, root, base); } finally { await fs.rm(base, { recursive: true, force: true }); }
}
it('snapshots complete pairs only, without credentials or source mutation; new data gets a new home', () => fixture(async (source, root) => {
  await fs.writeFile(path.join(source, 'compatdb-27.dat'), 'signed data fixture');
  await fs.writeFile(path.join(source, 'compatdb-27.dat.sha256'), 'signature fixture');
  await fs.writeFile(path.join(source, 'compatdb-26.dat'), 'incomplete pair');
  await fs.writeFile(path.join(source, 'license.sig'), 'private');
  await fs.writeFile(path.join(source, 'account.json'), 'private');
  const first = await prepareFH5CompatHome(source, root);
  expect(first.pairs).toBe(1);
  expect((await fs.readdir(first.home)).sort()).toEqual(['compatdb-27.dat', 'compatdb-27.dat.sha256']);
  expect(await prepareFH5CompatHome(source, root)).toEqual(first);
  await fs.writeFile(path.join(source, 'compatdb-27.dat'), 'updated signed fixture');
  const second = await prepareFH5CompatHome(source, root);
  expect(second.home).not.toBe(first.home);
  expect(await fs.readFile(path.join(first.home, 'compatdb-27.dat'), 'utf8')).toBe('signed data fixture');
  expect(await fs.readFile(path.join(source, 'license.sig'), 'utf8')).toBe('private');
}));
it('isolates a missing optional cache in an empty private home', () => fixture(async (source, root) => {
  await fs.rmdir(source);
  const result = await prepareFH5CompatHome(source, root);
  expect(result.pairs).toBe(0); expect(await fs.readdir(result.home)).toEqual([]);
}));
it.each(['source-link', 'data-link', 'signature-link', 'oversize', 'too-many', 'cache-link', 'cache-tamper'])('rejects %s without touching outside files', kind => fixture(async (source, root, base) => {
  const outside = path.join(base, 'sentinel'); await fs.writeFile(outside, 'preserve');
  await fs.writeFile(path.join(source, 'compatdb-27.dat'), 'data');
  await fs.writeFile(path.join(source, 'compatdb-27.dat.sha256'), 'signature');
  if (kind === 'source-link') { await fs.rename(source, source + '.saved'); await fs.symlink(source + '.saved', source); }
  if (kind === 'data-link' || kind === 'signature-link') {
    const file = path.join(source, 'compatdb-27.dat' + (kind === 'signature-link' ? '.sha256' : ''));
    await fs.unlink(file); await fs.symlink(outside, file);
  }
  if (kind === 'oversize') await fs.writeFile(path.join(source, 'compatdb-27.dat'), Buffer.alloc(1024 * 1024 + 1));
  if (kind === 'too-many') for (let i = 0; i < 9; i++) await fs.writeFile(path.join(source, `compatdb-${i}.dat`), 'data');
  if (kind.startsWith('cache-')) {
    const { home } = await prepareFH5CompatHome(source, root);
    const target = path.join(home, 'compatdb-27.dat');
    if (kind === 'cache-tamper') await fs.writeFile(target, 'bad!');
    else { await fs.unlink(target); await fs.symlink(outside, target); }
  }
  await expect(prepareFH5CompatHome(source, root)).rejects.toThrow();
  expect(await fs.readFile(outside, 'utf8')).toBe('preserve');
}));
