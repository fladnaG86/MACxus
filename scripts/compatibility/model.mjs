// Shared labels and validation for the generated GitHub documentation.
export const layers = { highball: 'Highball', crossover: 'CrossOver', 'crossover-preview': 'CrossOver Preview (Rosetta)', 'crossover-preview-arm': 'CrossOver Preview (ARM64/FEX)', unknown: 'Not reported' };
export const results = {
  works: { symbol: '✅', en: 'Works (reported)', it: 'Funziona (segnalato)' },
  'works-offline': { symbol: '✅', en: 'Works (offline)', it: 'Funziona (offline)' },
  issues: { symbol: '⚠️', en: 'Works with limits', it: 'Funziona con limiti' },
  partial: { symbol: '◐', en: 'Limited test', it: 'Prova limitata' },
  fails: { symbol: '❌', en: 'Fails', it: 'Non funziona' },
  blocked: { symbol: '⛔', en: 'Blocked', it: 'Bloccato' },
};
export const scopes = {
  'not-reported': { en: 'Not reported', it: 'Non riportato' },
  cinematics: { en: 'Later cinematics', it: 'Filmati successivi' }, online: { en: 'Online features', it: 'Funzioni online' },
  gameplay: { en: 'Gameplay', it: 'Gioco' }, menu: { en: 'Menu', it: 'Menu' }, launch: { en: 'Launch', it: 'Avvio' },
  'startup-movies': { en: 'Startup movies', it: 'Filmati iniziali' }, 'controller-input': { en: 'Controller input', it: 'Input controller' },
  'limitation-note': { en: 'Limitation note', it: 'Nota sui limiti' },
};
export const checks = { passed: { en: 'Passed', it: 'Verificato' }, issues: { en: 'Issues', it: 'Problemi' }, failed: { en: 'Failed', it: 'Non funziona' }, blocked: { en: 'Blocked', it: 'Bloccato' }, untested: { en: 'Not tested', it: 'Non provato' }, unknown: { en: 'Not reported', it: 'Non riportato' } };
export const architectures = { 'x86_64-rosetta': 'x86_64 / Rosetta', 'arm64-fex': 'ARM64 / FEX', unknown: 'Not reported' };
export const graphics = { d3dmetal: 'D3DMetal', dxmt: 'DXMT', dxvk: 'DXVK', wined3d: 'WineD3D', unknown: 'Not reported' };
export const connections = { bluetooth: 'Bluetooth', usb: 'USB', puck: 'Puck / receiver', adapter: 'Wireless adapter', 'not-applicable': '—', unknown: 'Not reported' };
export const textValue = (value, language = 'en') => value ?? (language === 'it' ? 'Non riportato' : 'Not reported');
export const resultLabel = (value, language = 'en') => `${results[value].symbol} ${results[value][language]}`;
export function validateCatalog(catalog) {
  const fail = message => { throw Error(`Compatibility data: ${message}`); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2400 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
  const optional = value => value === null || text(value);
  const translated = value => object(value) && text(value.en) && text(value.it);
  const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
  const member = (value, set) => typeof value === 'string' && Object.hasOwn(set, value);
  if (!object(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.games)) fail('unsupported schema');
  const gameIds = new Set(), reportIds = new Set(), storeIds = new Set();
  for (const game of catalog.games) {
    if (!object(game) || !slug(game.id) || gameIds.has(game.id) || !text(game.title)) fail('invalid or duplicate game identity');
    gameIds.add(game.id);
    if (!['microsoft-store', 'steam', 'other', 'not-reported'].includes(game.store)) fail(`${game.id}: store identity`);
    const productId = game.store === 'microsoft-store' ? /^[A-Z0-9]{12}$/ : game.store === 'steam' ? /^[1-9][0-9]*$/ : /^[A-Za-z0-9._-]{1,100}$/;
    if (!(game.storeId === null || typeof game.storeId === 'string' && productId.test(game.storeId)) || game.store === 'not-reported' && game.storeId !== null) fail(`${game.id}: store identity`);
    const identity = `${game.store}:${game.storeId}`;
    if (game.storeId && storeIds.has(identity)) fail(`${game.id}: duplicate Store ID`);
    if (game.storeId) storeIds.add(identity);
    if (!Array.isArray(game.reports) || !game.reports.length) fail(`${game.id}: no reports`);
    for (const report of game.reports) {
      if (!object(report) || !slug(report.id) || reportIds.has(report.id)) fail(`${game.id}: invalid or duplicate report identity`);
      reportIds.add(report.id);
      if (!member(report.layer, layers) || !member(report.result, results) || !member(report.architecture, architectures)) fail(`${report.id}: layer/result/architecture`);
      if (report.layer === 'crossover-preview-arm' && report.architecture === 'x86_64-rosetta' || report.architecture === 'arm64-fex' && !['crossover-preview-arm', 'unknown'].includes(report.layer)) fail(`${report.id}: architecture/layer mismatch`);
      for (const field of ['layerVersion', 'macOS', 'chip', 'macModel', 'macxusVersion', 'gameVersion', 'runtimeVersion']) if (!optional(report[field])) fail(`${report.id}: ${field} must be a value or null`);
      if (report.testedAt !== null && (typeof report.testedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(report.testedAt) || !Number.isFinite(Date.parse(report.testedAt)) || new Date(report.testedAt).toISOString().slice(0, 10) !== report.testedAt)) fail(`${report.id}: invalid test date`);
      if (!object(report.graphics) || !member(report.graphics.backend, graphics) || !optional(report.graphics.version)) fail(`${report.id}: graphics`);
      if (!Array.isArray(report.scope) || !report.scope.length || new Set(report.scope).size !== report.scope.length || report.scope.some(scope => !member(scope, scopes))) fail(`${report.id}: test scope`);
      if (report.scope.includes('not-reported') && report.scope.length !== 1) fail(`${report.id}: unknown scope must stand alone`);
      const working = ['works', 'works-offline'].includes(report.result);
      if (working && !report.scope.some(scope => ['gameplay', 'not-reported'].includes(scope))) fail(`${report.id}: limited tests cannot claim overall working gameplay`);
      if (!object(report.checks) || ['launch','gameplay','video','audio','online'].some(key => !member(report.checks[key], checks))) fail(`${report.id}: feature checks`);
      if (working && ['failed', 'blocked', 'issues'].includes(report.checks.gameplay)) fail(`${report.id}: working result contradicts gameplay check`);
      if (working && ['failed', 'blocked'].includes(report.checks.launch)) fail(`${report.id}: working result contradicts launch check`);
      if (report.result === 'works-offline' && !['issues', 'failed', 'blocked'].includes(report.checks.online)) fail(`${report.id}: offline result requires a reported online limitation`);
      if (!translated(report.summary) || !Array.isArray(report.requirements) || report.requirements.some(note => !translated(note))) fail(`${report.id}: bilingual summary/requirements`);
      if (!Array.isArray(report.controllers)) fail(`${report.id}: controllers`);
      for (const controller of report.controllers) if (!object(controller) || !text(controller.model) || !member(controller.connection, connections) || !member(controller.result, checks) || !translated(controller.scope) || !translated(controller.notes)) fail(`${report.id}: controller evidence`);
      if (!Array.isArray(report.sources) || !report.sources.length) fail(`${report.id}: missing evidence source`);
      for (const source of report.sources) {
        if (!object(source) || !['historical','maintainer','community'].includes(source.kind) || typeof source.url !== 'string') fail(`${report.id}: source`);
        let url; try { url = new URL(source.url); } catch { fail(`${report.id}: source URL`); }
        if (url.protocol !== 'https:' || url.username || url.password || /[\s<>]/.test(source.url)) fail(`${report.id}: source URL must use HTTPS without credentials`);
      }
    }
  }
  return catalog;
}
