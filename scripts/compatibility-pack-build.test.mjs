import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { compatibilityPackConfigure } from './compatibility-pack-build.mjs';

const compiler = 'x86_64-w64-mingw32-gcc', strip = 'x86_64-w64-mingw32-strip';
const available = name => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0;

test('Wine configure keeps the original relative source reference across temporary roots', () => {
  for (const root of ['/tmp/short-build-A', '/private/var/folders/longer-random-build-B']) {
    const build = path.join(root, 'build'), source = path.join(root, 'sources/wine');
    assert.equal(compatibilityPackConfigure(build, source), '../sources/wine/configure');
    assert.equal(compatibilityPackConfigure(path.join(root, 'wine-build'), path.join(root, 'wine-src')), '../wine-src/configure');
    assert.equal(compatibilityPackConfigure(path.join(root, 'vkd3d-build'), path.join(root, 'vkd3d-src')), '../vkd3d-src/configure');
  }
  assert.throws(() => compatibilityPackConfigure('/tmp/build', '/tmp/build'), /separate/);
});

test('stripped PE __FILE__ strings and bytes reproduce across different absolute build paths', {
  skip: !available(compiler) || !available(strip) ? 'MinGW compiler/strip unavailable; full Wine rebuilds are a separate maintainer check' : false,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macxus-pe-path-'));
  try {
    const timestamp = 1792989507;
    const env = { ...process.env, SOURCE_DATE_EPOCH: String(timestamp) };
    for (const layout of ['pack', 'runtime']) {
      const outputs = [];
      for (const name of ['short', 'a-much-longer-and-different-build-directory']) {
        const work = path.join(root, layout, name);
        const build = path.join(work, layout === 'runtime' ? 'wine-build' : 'build');
        const source = path.join(work, layout === 'runtime' ? 'wine-src' : 'sources/wine');
        await fs.mkdir(path.join(source, 'libs/strmbase'), { recursive: true }); await fs.mkdir(build);
        // Configure's source spelling survives stripping through __FILE__.
        await fs.writeFile(path.join(source, 'libs/strmbase/seeking.c'), 'const char *source_name = __FILE__ ": SourceSeeking.cs";\nint main(void) { return source_name[0] == 0; }\n');
        const configure = compatibilityPackConfigure(build, source);
        const input = path.join(path.dirname(configure), 'libs/strmbase/seeking.c');
        execFileSync(compiler, ['-g', '-O2', input, '-o', 'probe.exe'], { cwd: build, env, stdio: 'pipe' });
        execFileSync(strip, ['--strip-debug', 'probe.exe'], { cwd: build, env, stdio: 'pipe' });
        const bytes = await fs.readFile(path.join(build, 'probe.exe'));
        const embeddedTimestamp = bytes.readUInt32LE(bytes.readUInt32LE(0x3c) + 8);
        assert.ok(embeddedTimestamp === 0 || embeddedTimestamp === timestamp,
          `unexpected non-deterministic PE timestamp: ${embeddedTimestamp}`);
        assert.ok(bytes.includes(Buffer.from(`${input}: SourceSeeking.cs`)));
        assert.ok(!bytes.includes(Buffer.from(root)));
        outputs.push(createHash('sha256').update(bytes).digest('hex'));
      }
      assert.equal(outputs[0], outputs[1], `${layout} stripped PE hashes differ between source roots`);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
