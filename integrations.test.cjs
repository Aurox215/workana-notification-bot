const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function load() {
  const context = vm.createContext({ structuredClone, AbortSignal, URL, Intl, queueMicrotask() {} });
  vm.runInContext(fs.readFileSync(`${__dirname}/integrations.js`, 'utf8'), context);
  const source = fs.readFileSync(`${__dirname}/background.js`, 'utf8').replace('import "./integrations.js";', '').replace('import "./telegram.js";', '');
  vm.runInContext(source.slice(0, source.indexOf('let I=new Ue')) + ';globalThis.background={defaults:O,normalize:de,validate:pe,Store:Ue};})();', context);
  return { ...context.WorkanaIntegrations, ...context.background };
}

function memoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, structuredClone(values[key])]));
    },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
  };
}

function fixture() {
  const api = load();
  const config = api.defaults();
  config.sheets = { enabled: true, webAppUrl: 'https://script.google.com/macros/s/test-id/exec', token: 'private-test-token', sheetName: 'Juberu', status: 'On Hold' };
  const storage = { local: memoryStorage({ config }), session: memoryStorage() };
  const store = new api.Store(storage);
  return { api, config, storage, store };
}

test('bid rows match all eight columns and use the Japan date across UTC midnight', () => {
  const { api, config } = fixture();
  const event = api.bidEvent({ id: 'project-1', sentAt: Date.parse('2026-11-09T15:00:00Z'), title: 'Build an app', client: { name: 'Fernando' }, skills: ['React', 'Node JS'], url: 'https://www.workana.com/job/project-1' }, config.sheets);
  assert.deepEqual(Array.from(event.values), ['11/10/2026', '12:00:00 AM', 'Workana', 'Build an app', 'Fernando', 'React, Node JS', 'On Hold', 'https://www.workana.com/job/project-1']);
  assert.equal(api.bidEvent({ id: 'x', sentAt: Date.parse('2026-11-10T08:33:00Z') }, config.sheets).values[1], '5:33:00 PM');
});

test('the real ledger hook queues confirmed bids once, and skips drafts and uncertain receipts', async () => {
  const { store, storage } = fixture();
  await store.record('project-1', { status: 'drafting', title: 'App', url: 'https://www.workana.com/job/project-1' });
  await store.record('project-1', { status: 'uncertain' });
  assert.equal(storage.local.values.sheetsOutbox, undefined);
  await store.record('project-1', { status: 'sent', sentAt: Date.parse('2026-11-10T08:33:00Z') });
  assert.equal(Object.keys(storage.local.values.sheetsOutbox).length, 1);
  assert.equal(storage.local.values.ledger['project-1'].sheetEventId, 'workana:project-1');
  const original = structuredClone(storage.local.values.sheetsOutbox);
  await store.record('project-1', { status: 'sent', sentAt: Date.now() });
  assert.deepEqual(storage.local.values.sheetsOutbox, original);
});

test('logging disabled at confirmation does not queue historical bids', async () => {
  const { store, storage } = fixture();
  storage.local.values.config.sheets.enabled = false;
  await store.record('x', { status: 'sent', sentAt: Date.now() });
  storage.local.values.config.sheets.enabled = true;
  await store.record('x', { status: 'sent', sentAt: Date.now() });
  assert.equal(storage.local.values.sheetsOutbox, undefined);
});

test('failed delivery survives a new worker and successful retry clears the queue', async () => {
  const { api, store, storage } = fixture();
  await store.record('x', { status: 'sent', sentAt: Date.now() });
  const failing = new api.SheetsDelivery(store, storage.local, async () => { throw Error('Network offline'); });
  await failing.flush();
  assert.equal(storage.local.values.sheetsOutbox['workana:x'].attempts, 1);
  assert.match(storage.local.values.sheetsDeliveryStatus.lastError, /offline/);
  let requests = 0;
  const restored = new api.SheetsDelivery(new api.Store(storage), storage.local, async (_url, options) => {
    requests++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.sheetName, 'Juberu');
    assert.equal(payload.token, 'private-test-token');
    return { ok: true, json: async () => ({ ok: true, id: payload.event.id, duplicate: true }) };
  });
  await restored.flush();
  assert.equal(requests, 0, 'backoff must survive a worker restart');
  await restored.retry();
  assert.equal(requests, 1);
  assert.equal((await restored.status()).pending, 0);
});

test('overlapping flushes share one network request and require an event acknowledgement', async () => {
  const { api, store, storage } = fixture();
  await store.record('x', { status: 'sent', sentAt: Date.now() });
  let complete;
  let requests = 0;
  const delivery = new api.SheetsDelivery(store, storage.local, async () => {
    requests++;
    await new Promise(resolve => { complete = resolve; });
    return { ok: true, json: async () => ({ ok: true, id: 'wrong-id' }) };
  });
  const first = delivery.flush();
  const second = delivery.flush();
  assert.equal(first, second);
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  complete();
  await first;
  assert.equal(requests, 1);
  assert.equal((await delivery.status()).pending, 1);
});

test('connection test sends no bid event and only accepts deployed Apps Script URLs', async () => {
  const { api, config } = fixture();
  const result = await api.postToSheet(config.sheets, null, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.action, 'test');
    assert.equal(body.event, null);
    return { ok: true, json: async () => ({ ok: true, message: 'Connected' }) };
  });
  assert.equal(result.ok, true);
  assert.throws(() => api.validateSheets({ ...config.sheets, webAppUrl: 'https://example.com/exec' }), /web app URL/);
});

test('settings backup round-trip restores all saved config including the prompt and panel position', async () => {
  const { api, config, store, storage } = fixture();
  config.templates[0].proposalPrompt = 'Write a concise project-specific proposal.';
  config.window = { ...config.window, width: 900, left: 33, top: 50 };
  config.portfolio[0].name = 'Custom portfolio';
  config.rules = 'Use direct language.';
  config.appearance.fontSize = 18;
  const backup = api.exportSettings(config);
  const delivery = { flush: async () => {} };
  await api.handleAction({ kind: 'IMPORT_SETTINGS', backup }, { store, storage, delivery, bootstrap: async () => ({}), defaults: api.defaults, normalize: api.normalize, validate: api.validate });
  const saved = storage.local.values.config;
  assert.equal(saved.templates[0].proposalPrompt, config.templates[0].proposalPrompt);
  assert.equal(saved.window.left, 33);
  assert.equal(saved.window.width, 900);
  assert.equal(saved.portfolio[0].name, 'Custom portfolio');
  assert.equal(saved.rules, config.rules);
  assert.equal(saved.appearance.fontSize, 18);
  assert.deepEqual(saved.sheets, config.sheets);
  assert.equal(backup.credentials, undefined);
});

test('API credential backups restore storage preference; keyless import preserves the current key', async () => {
  const { api, config, store, storage } = fixture();
  const dependencies = { store, storage, delivery: { flush: async () => {} }, bootstrap: async () => ({}), defaults: api.defaults, normalize: api.normalize, validate: api.validate };
  storage.local.values.apiKey = 'old-persistent-key';
  await api.handleAction({ kind: 'IMPORT_SETTINGS', backup: api.exportSettings(config) }, dependencies);
  assert.equal(await store.key(), 'old-persistent-key');
  await api.handleAction({ kind: 'IMPORT_SETTINGS', backup: api.exportSettings(config, { apiKey: 'new-session-key', remember: false }) }, dependencies);
  assert.equal(storage.local.values.apiKey, undefined);
  assert.equal(storage.session.values.apiKey, 'new-session-key');
  await api.handleAction({ kind: 'IMPORT_SETTINGS', backup: api.exportSettings(config, { apiKey: 'new-persistent-key', remember: true }) }, dependencies);
  assert.equal(storage.session.values.apiKey, undefined);
  assert.equal(storage.local.values.apiKey, 'new-persistent-key');
});

test('invalid backups and imports during bidding leave saved settings unchanged', async () => {
  const { api, config, store, storage } = fixture();
  const dependencies = { store, storage, delivery: { flush: async () => {} }, bootstrap: async () => ({}), defaults: api.defaults, normalize: api.normalize, validate: api.validate };
  const previous = structuredClone(storage.local.values.config);
  const backup = api.exportSettings(config);
  backup.config.templates[0].proposalPrompt = '';
  await assert.rejects(api.handleAction({ kind: 'IMPORT_SETTINGS', backup }, dependencies), /proposal prompt/);
  assert.deepEqual(storage.local.values.config, previous);
  storage.session.values.run = { active: true };
  await assert.rejects(api.handleAction({ kind: 'IMPORT_SETTINGS', backup: api.exportSettings(config) }, dependencies), /Stop bidding/);
  assert.deepEqual(storage.local.values.config, previous);
  assert.throws(() => api.readSettingsBackup({ format: 'other', version: 1, config }, Object.keys(config)), /Unsupported/);
});

test('receiver writes Japan time, escapes formulas, preserves rows and deduplicates retries', () => {
  const data = [['Date', 'Time', 'Platform', 'Title', 'Client', 'Skills', 'Status', 'Url', ''], ['11/9/2026', '5:00:00 PM', 'Workana', 'Existing', '', '', 'In Contact', '', '']];
  function range(row, column, rows = 1, columns = 1) {
    return {
      getDisplayValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j) => String(data[row - 1 + i]?.[column - 1 + j] || ''))),
      setValues(values) { values.forEach((valuesRow, i) => valuesRow.forEach((value, j) => { (data[row - 1 + i] ||= [])[column - 1 + j] = value; })); },
      setValue(value) { this.setValues([[value]]); },
      createTextFinder(value) { return { matchEntireCell() { return this; }, findNext: () => data.slice(row - 1, row - 1 + rows).find(values => values[column - 1] === value) || null }; }
    };
  }
  const sheet = { getRange: range, getMaxColumns: () => 9, getLastRow: () => data.length, hideColumns() {}, setFrozenRows() {} };
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SHARED_TOKEN' ? 'secret' : null }) },
    SpreadsheetApp: { openById: id => { assert.equal(id, '1pIY489l8H1d-nhXwiZf55CvW9QgE5K_6WC_5rk8OpK8'); return { getSheetByName: () => sheet }; }, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: (date, zone, format) => new Intl.DateTimeFormat('en-US', format === 'M/d/yyyy' ? { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' } : { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(date) }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/google-sheets-receiver.gs`, 'utf8'), context);
  const event = { id: 'workana:project-1', sentAt: Date.parse('2026-11-09T15:00:00Z'), values: ['wrong date', 'wrong time', 'other', '=IMPORTXML()', 'Client', 'React', 'On Hold', 'https://www.workana.com/job/project-1'] };
  const send = token => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action: 'append', token, sheetName: 'Juberu', event }) } }).text);
  assert.equal(send('wrong').ok, false);
  assert.equal(data.length, 2);
  assert.equal(send('secret').ok, true);
  assert.equal(data.length, 3);
  assert.equal(data[2][0], '11/10/2026');
  assert.equal(data[2][1], '12:00:00 AM');
  assert.equal(data[2][3], "'=IMPORTXML()");
  data[2][6] = 'In Contact';
  assert.equal(send('secret').duplicate, true);
  assert.equal(data.length, 3);
  assert.equal(data[2][6], 'In Contact');
  assert.equal(data[1][3], 'Existing');
});

test('Settings connection button passes its event and reports the receiver response', async () => {
  const context = vm.createContext({ structuredClone, document: { querySelectorAll: () => [] } });
  vm.runInContext(fs.readFileSync(`${__dirname}/settings-ui.js`, 'utf8'), context);
  const { config } = fixture();
  const F = (tag, attributes = {}, ...children) => ({ tag, attributes, children: children.flat(Infinity), replaceChildren(...nodes) { this.children = nodes; } });
  const ui = context.createWorkanaSettingsUI({ F, L: (label, input) => F('label', {}, label, input), R: (value, callback, attributes) => F('input', { value, callback, ...attributes }), B: label => F('label', {}, label), V: (...children) => F('div', {}, children), getState: () => ({ config }), request: async kind => { assert.equal(kind, 'TEST_SHEETS'); return { message: 'Connected to Juberu' }; }, report: message => assert.fail(message), onSaved() {} });
  const tree = ui.render();
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
  }
  const button = find(tree, node => node.tag === 'button' && node.children[0] === 'Test connection');
  await button.attributes.onclick({ currentTarget: button });
  const result = find(tree, node => node.attributes.role === 'status' && node.textContent === 'Connected to Juberu');
  assert.equal(result.textContent, 'Connected to Juberu');
  assert.equal(button.disabled, false);
});
