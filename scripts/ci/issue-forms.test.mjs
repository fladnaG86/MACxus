import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const yaml = createRequire(import.meta.url)('js-yaml');
const directory = '.github/ISSUE_TEMPLATE';
const read = async name => yaml.load(await fs.readFile(`${directory}/${name}.yml`, 'utf8'));
const fields = form => new Map(form.body.filter(field => field.type !== 'markdown').map(field => [field.id, field]));

test('MACxus issue chooser routes discussions to this fork and retains its macOS report form', async () => {
  const config = await read('config');
  // This fork deliberately permits blank issues as well as its macOS form.
  assert.equal(config.blank_issues_enabled, true);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['01-macos-problem.yml', 'config.yml']);
  for (const link of config.contact_links) {
    assert.ok(link.name && link.about);
    const url = new URL(link.url);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, '/fladnaG86/MACxus/discussions');
  }
});

test('macOS issue form uses valid fields without prefilled answers or duplicate identifiers', async () => {
  const form = await read('01-macos-problem');
  assert.ok(form.name && form.description && form.labels.includes('bug'));
  const allowed = new Set(['markdown', 'input', 'textarea', 'dropdown']);
  const ids = new Set(), labels = new Set();
  for (const field of form.body) {
    assert.ok(allowed.has(field.type), field.type);
    assert.ok(field.attributes && typeof field.attributes === 'object');
    if (field.type === 'markdown') { assert.equal(typeof field.attributes.value, 'string'); continue; }
    assert.match(field.id, /^[A-Za-z0-9_-]+$/);
    assert.ok(!ids.has(field.id)); ids.add(field.id);
    assert.ok(field.attributes.label && !labels.has(field.attributes.label)); labels.add(field.attributes.label);
    assert.equal(field.attributes.value, undefined);
    if (field.validations) assert.equal(typeof field.validations.required, 'boolean');
    if (field.type === 'dropdown') {
      assert.ok(field.attributes.options.length >= 2);
      assert.equal(new Set(field.attributes.options).size, field.attributes.options.length);
      assert.equal(field.attributes.default, undefined);
    }
  }
});

test('macOS report requires engine, Mac/system details and reproduction, with optional logs and privacy guidance', async () => {
  const form = await read('01-macos-problem'), items = fields(form);
  for (const [id, type] of [['engine', 'dropdown'], ['mac', 'input'], ['what', 'textarea']]) {
    assert.equal(items.get(id).type, type);
    assert.equal(items.get(id).validations.required, true);
  }
  assert.ok(items.get('engine').attributes.options.includes('CrossOver'));
  assert.ok(items.get('engine').attributes.options.includes('Highball'));
  for (const id of ['game', 'versions', 'log']) assert.ok(items.has(id));
  assert.notEqual(items.get('log').validations?.required, true, 'startup failures can have no log');
  const text = JSON.stringify(form);
  for (const guidance of ['Keychain', 'tokens', 'game files', 'Review it before posting', 'Verbose logs', 'macOS']) assert.ok(text.includes(guidance), guidance);
});
