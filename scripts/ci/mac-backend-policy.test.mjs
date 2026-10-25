import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml');

test('native Mac checks cannot package or upload a distribution on a pull request', async () => {
  const workflow = yaml.load(await fs.readFile('.github/workflows/mac-backend.yml', 'utf8'));
  assert.ok(workflow.on.pull_request);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const steps = workflow.jobs.native.steps;
  assert.equal(workflow.jobs.native['runs-on'], 'macos-15');
  const check = steps.find(step => step.run === 'npm run build:mac-backend -- --check');
  assert.ok(check);
  assert.equal(check.if, "github.event_name != 'workflow_dispatch'");
  const candidate = steps.find(step => step.run?.includes('npm run dist:mac'));
  assert.equal(candidate.env.ELECTRON_SKIP_BINARY_DOWNLOAD, '');
  assert.ok(candidate.run.indexOf('node node_modules/electron/install.js') < candidate.run.indexOf('npm run build'));
  for (const step of steps.filter(step => step.run?.includes('npm run dist:mac') || step.uses?.startsWith('actions/upload-artifact'))) {
    assert.equal(step.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  }
  assert.doesNotMatch(JSON.stringify(workflow), /gh release|promote-candidate|contents.:.write/);
});

test('normal Mac distribution requires its backend and carries it outside ASAR', async () => {
  const config = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.match(config.scripts['dist:mac'], /^npm run build:mac-backend &&/);
  assert.deepEqual(config.build.mac.extraResources, [{ from: 'bundled/mac-backend', to: 'backend' }]);
  assert.ok(!config.build.extraResources.some(resource => resource.to === 'backend'), 'Linux packaging must not require a Mac backend');
  assert.ok((await fs.readFile('.gitignore', 'utf8')).split('\n').includes('bundled/'));
});
