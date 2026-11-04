import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('npm rebuild reaches both pack builders and a failed first build stops preparation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-prepare-dispatch-'));
  try {
    await fs.copyFile(new URL('../prepare-mac-media-packs.mjs', import.meta.url), path.join(root, 'prepare.mjs'));
    const record = `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(path.join(root, 'calls.jsonl'))}, JSON.stringify([process.argv[1].split('/').pop(), ...process.argv.slice(2)])+'\\n');`;
    await fs.writeFile(path.join(root, 'prepare-compatibility-packs.mjs'), record + 'if(process.env.TEST_FIRST_FAIL) process.exit(1);');
    await fs.writeFile(path.join(root, 'prepare-runtime-pack.mjs'), record);
    const command = [path.join(root, 'prepare.mjs'), '--rebuild', '--pack', 'fixture'];
    execFileSync(process.execPath, command);
    const calls = (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls, [['prepare-compatibility-packs.mjs', '--rebuild', '--pack', 'fixture'], ['prepare-runtime-pack.mjs', '--rebuild']]);
    await fs.unlink(path.join(root, 'calls.jsonl'));
    assert.throws(() => execFileSync(process.execPath, command, { env: { ...process.env, TEST_FIRST_FAIL: '1' }, stdio: 'pipe' }));
    assert.equal((await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
