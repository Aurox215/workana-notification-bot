const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./telegram.js');
const { Watcher, validate, send, findChats, notificationEligibility, publishedAge, publishedTime, selectPublication, projectMessage } = global.WorkanaTelegram;
const fs = require('node:fs');
const vm = require('node:vm');
const settings = { enabled: true, botToken: '123456:abcdefghijklmnopqrstuvwxyz', chatId: '1234', searchUrl: '' };
test('notification publication ages are calculated at send time', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(publishedAge({ publishedAt: now - 120000 }, now), '2 minutes ago');
  assert.equal(publishedAge({ publishedAt: now - 3600000 }, now), '1 hour ago');
  assert.equal(publishedAge({ publishedAt: now - 86400000 }, now), '1 day ago');
  assert.equal(publishedAge({ publishedAt: null }, now), 'Not shown');
    const message = projectMessage({ title: 'React app', publishedAt: Date.parse('2026-11-18'), publishedPrecision: 'day', description: 'Private draft' }, { now });
  assert.match(message, /Published: November 18, 2026/);
  assert.doesNotMatch(message, /Private draft|hours ago/);
  assert.equal(publishedTime({ publishedAt: now - 120000, publishedPrecision: 'exact' }), '2026-11-18 11:58:00 UTC');
  assert.match(publishedTime({ publishedAt: now - 120000, publishedPrecision: 'relative' }), /Exact time not provided/);
  const exact = { publishedAt: now - 120000, publishedPrecision: 'exact' };
  assert.equal(selectPublication(exact, { publishedAt: now - 180000, publishedPrecision: 'relative' }).publishedPrecision, 'exact');
  assert.equal(selectPublication({}, exact).publishedAt, exact.publishedAt);
  const conflictingRelative = { publishedPrecision: 'relative', publishedAt: now - 7 * 86400000, publishedLatestAt: now - 6 * 86400000 };
  assert.equal(selectPublication(conflictingRelative, { publishedPrecision: 'day', publishedAt: Date.parse('2026-11-18') }).publishedPrecision, 'day');
});
test('legacy budget restrictions do not block projects in worker or page eligibility', () => {
  const context = vm.createContext({ structuredClone, AbortSignal, URL });
  vm.runInContext(fs.readFileSync('integrations.js', 'utf8'), context);
  const source = fs.readFileSync('background.js', 'utf8').replace('import "./integrations.js";', '').replace('import "./telegram.js";', '');
  vm.runInContext(source.slice(0, source.indexOf('let I=new Ue')) + ';globalThis.worker={defaults:O,normalize:de,eligible:ot};})();', context);
  const content = fs.readFileSync('content.js', 'utf8');
  vm.runInContext(content.slice(0, content.indexOf('function xe(){')) + ';globalThis.page={eligible:he,publication:te};})();', context);
  const now = Date.now();
  const card = { innerText: 'Published: 2 minutes ago', ownerDocument: { defaultView: { performance: { timeOrigin: now } } }, querySelector: () => null, querySelectorAll: () => [] };
  const initialPublication = context.page.publication(card, now);
  const stalePublication = context.page.publication(card, now + 3600000);
  assert.equal(stalePublication.publishedAt, initialPublication.publishedAt, 'unchanged labels must not create newer publication times');
  const config = context.worker.defaults();
  config.budget = { contract: 'hourly', currency: 'EUR', minimum: 9999, maximum: 99999, bands: ['hourly|EUR|9999|99999'] };
  const normalized = context.worker.normalize(config);
  assert.equal(normalized.budget.contract, 'any');
  assert.equal(normalized.budget.minimum, null);
  assert.equal(normalized.budget.bands.length, 0);
  for (const budget of [undefined, { contract: 'fixed', currency: 'USD', min: 10, max: 20, key: 'fixed|USD|10|20' }]) {
    const project = { category: 'it-programming', skills: ['React'], budget, client: {} };
    assert.equal(context.worker.eligible(project, config).state, 'pass');
    assert.equal(context.page.eligible(project, config).state, 'pass');
    config.project.excludeSkills = ['React'];
    assert.equal(context.worker.eligible(project, config).state, 'fail');
    assert.equal(context.page.eligible(project, config).state, 'fail');
    config.project.excludeSkills = [];
  }
});
test('notification scanner fetches through an existing search tab without creating or navigating tabs', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const start = source.indexOf('async function telegramScan(');
  const end = source.indexOf('async function Q(){', start);
  const calls = [];
  let tabs = [{ id: 6, url: 'https://www.workana.com/my-projects' }, { id: 7, url: 'https://www.workana.com/jobs?language=en' }];
  let binding;
  const injections = [];
  const context = vm.createContext({ URL, chrome: { tabs: { query: async () => tabs }, storage: { local: { get: async () => ({ telegramSearchBinding: binding }), set: async value => { binding = value.telegramSearchBinding; } } }, scripting: { executeScript: async options => { injections.push(options.target.tabId); return options.files ? [] : [{ result: { text: '{"projects":[]}', url: binding.url, endpoint: '/api/projects/search' } }]; } } }, E: url => url.startsWith('https://www.workana.com/'), U: async (id, message) => { calls.push({ id, message }); return message.kind === 'SEARCH_CONTEXT' ? { url: 'https://www.workana.com/jobs?language=en&page=1' } : { kind: 'list', projects: [{ id: 'new' }] }; } });
  vm.runInContext(source.slice(start, end) + ';globalThis.scan=telegramScan;', context);
  const result = await context.scan({ searchUrl: 'https://www.workana.com/jobs?old=1' }, { search: { useCurrentFilters: true } });
  assert.equal(result.projects[0].id, 'new');
  assert.equal(calls[0].id, 7);
  assert.equal(calls[0].message.kind, 'SEARCH_CONTEXT');
  assert.equal(calls[1].message.kind, 'PARSE_API_SEARCH');
  assert.ok(injections.every(id => id === 7), 'must use the tab holding the learned request, not the first Workana tab');
  tabs = [];
  await assert.rejects(context.scan({}, { search: {} }), /search once/);
});
test('chat discovery needs only the token, deduplicates chats and retains negative group IDs', async () => {
  const f = fixture();
  const watcher = new Watcher({ ...f.options, fetcher: async (url, options) => {
    assert.ok(url.endsWith('/getUpdates'));
    const body = JSON.parse(options.body);
    assert.equal(body.timeout, 10);
    assert.ok(body.allowed_updates.includes('message'));
    assert.equal(body.offset, undefined, 'lookup must not acknowledge or discard updates');
    return { ok: true, json: async () => ({ ok: true, result: [
      { message: { chat: { id: 1234, type: 'private', first_name: 'Ana' } } },
      { message: { chat: { id: 1234, type: 'private', first_name: 'Ana' } } },
      { message: { chat: { id: -1001234567890, type: 'supergroup', title: 'Projects' } } }
    ] }) };
  } });
  const reply = await watcher.action({ kind: 'FIND_TELEGRAM_CHATS', settings: { botToken: settings.botToken } });
  assert.deepEqual(reply.chats.map(c => c.id), ['1234', '-1001234567890']);
  assert.equal(reply.chats[1].name, 'Projects');
});
test('chat discovery explains empty results, conflicts and token failures without exposing credentials', async () => {
  await assert.rejects(findChats('bad'), /token/);
  await assert.rejects(findChats(settings.botToken, async () => ({ ok: true, json: async () => ({ ok: true, result: [] }) })), /send it a new message/);
  await assert.rejects(findChats(settings.botToken, async () => ({ ok: false, status: 409, json: async () => ({ ok: false }) })), /another app or webhook/);
  await assert.rejects(findChats(settings.botToken, async () => { throw Error(settings.botToken); }), e => !e.message.includes(settings.botToken));
});
test('Find my chat ID fills the input and preserves it in the test notification request', async () => {
  const context = vm.createContext({ structuredClone, setTimeout, clearTimeout, document: { querySelectorAll: () => [] } });
  vm.runInContext(fs.readFileSync('settings-ui.js', 'utf8'), context);
  const F = (tag, attributes = {}, ...children) => ({ tag, attributes, children: children.flat(Infinity), replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); } });
  const requests = [];
  let resolveLookup;
  const lookup = new Promise(resolve => { resolveLookup = resolve; });
  const ui = context.createWorkanaSettingsUI({ F, L: (label, input) => F('label', {}, label, input), R: (value, callback, attributes) => F('input', { value, callback, ...attributes }), B: label => F('label', {}, label), V: (...children) => F('div', {}, children), getState: () => ({ config: { sheets: {} }, telegram: { settings: { ...settings, chatId: '' } } }), request: async (kind, payload) => { requests.push({ kind, payload }); return kind === 'FIND_TELEGRAM_CHATS' ? lookup : { message: 'Test sent' }; }, report: assert.fail });
  let tree = ui.render();
  function find(node, predicate) { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of node.children || []) { const match = find(child, predicate); if (match) return match; } }
  const button = find(tree, n => n.tag === 'button' && n.children[0] === 'Find my chat ID');
  const pending = button.attributes.onclick({ currentTarget: button });
  tree = ui.render(); // A background update replaces the form during the request.
  const status = find(tree, n => n.attributes['data-telegram-lookup-status']);
  assert.match(status.textContent, /Looking for chats/);
  resolveLookup({ chats: [{ id: '1234', name: 'Ana' }] });
  await pending;
  assert.match(status.textContent, /Chat selected: Ana/);
  const input = find(tree, n => n.attributes.placeholder === '123456789 or -1001234567890');
  assert.equal(input.value, '1234');
  const testButton = find(tree, n => n.tag === 'button' && n.children[0] === 'Send test notification');
  await testButton.attributes.onclick({ currentTarget: testButton });
  assert.equal(requests[1].payload.settings.chatId, '1234');
});
function fixture() {
  const values = { telegram: { settings, generation: 1, startedAt: Date.now(), seen: {} } };
  let projects = [{ id: 'old', title: 'Old' }], requests = [], verdict = 'pass';
  const options = { storage: { get: async () => structuredClone(values), set: async update => Object.assign(values, structuredClone(update)) }, config: async () => ({}), scan: async () => projects, inspect: async p => ({ publishedAt: Date.now(), publishedPrecision: 'exact', ...p }), eligible: () => ({ state: verdict }), fetcher: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; } };
  return { values, requests, options, watcher: new Watcher(options), projects: p => { projects = p; }, verdict: v => { verdict = v; } };
}
test('a verification alert is retried on Telegram failure and sent once until a successful scan', async () => {
  const f = fixture();
  let scanError = 'Workana requires verification. Open Workana and retry.';
  let rejectMessage = true;
  f.options.scan = async () => {
    if (scanError) throw Error(scanError);
    return [];
  };
  const fetcher = f.options.fetcher;
  f.options.fetcher = async (...args) => rejectMessage ? { ok: false, status: 429, json: async () => ({ ok: false, parameters: { retry_after: 120 } }) } : fetcher(...args);
  const check = () => new Watcher(f.options).action({ kind: 'CHECK_TELEGRAM' });

  await check();
  assert.match(f.values.telegram.lastError, /Could not send the Telegram verification alert/);
  assert.ok(f.values.telegram.retryAt > Date.now() + 60000);
  rejectMessage = false;
  await check();
  await check();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].chat_id, settings.chatId);
  assert.match(f.requests[0].text, /project alerts are paused because Workana requested verification/);
  scanError = 'Workana search request failed (500).';
  await check();
  assert.equal(f.requests.length, 1);
  scanError = '';
  await check();
  scanError = 'Workana requires verification.';
  await check();
  assert.equal(f.requests.length, 2);
});
test('a delayed first scan notifies a project published after enabling instead of baselining it', async () => {
  const f = fixture();
  const now = Date.now();
  f.values.telegram.startedAt = now - 35 * 60000;
  f.projects([
    { id: 'old', publishedAt: now - 3600000 },
    { id: 'renovation', title: 'Comprehensive Renovation and Ai Integration for Factory Management', publishedAt: now - 30 * 60000, publishedLatestAt: now - 29 * 60000, publishedPrecision: 'relative' }
  ]);
  await f.watcher.tick();
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].text, /Comprehensive Renovation/);
  assert.equal(f.values.telegram.seen.old, true);
  assert.equal(f.values.telegram.recentChecks[0].result, 'notified');
  await f.watcher.tick();
  assert.equal(f.requests.length, 1);
});
test('a filter rejection is rechecked after filters change, without resending delivered projects', async () => {
  const f = fixture();
  let config = { project: { excludeSkills: ["React"] } };
  f.options.config = async () => config;
  f.options.eligible = (_project, current) => ({ state: current.project.excludeSkills.length > 0 ? 'fail' : 'pass', issues: ['Excluded skill.'] });
  const watcher = new Watcher(f.options);
  await watcher.tick();
  f.projects([{ id: 'newly-eligible', title: 'New project' }]);
  await watcher.tick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.values.telegram.seen['newly-eligible'], undefined);
  assert.equal(f.values.telegram.recentChecks[0].result, 'filtered');
  config = { project: { excludeSkills: [] } };
  await watcher.tick();
  assert.equal(f.requests.length, 1);
  await watcher.tick();
  assert.equal(f.requests.length, 1);
});
test('baseline skips old listings, only matching new projects notify, restart deduplicates', async () => {
  const f = fixture();
  await f.watcher.tick();
  assert.equal(f.requests.length, 0);
  f.projects([{ id: 'new', title: '<React>', url: 'https://www.workana.com/job/new', publishedAt: Date.now(), publishedPrecision: 'exact', budget: { label: 'USD 500 - 1,000' }, skills: ['React', 'Node.js'], client: { name: 'Ana', country: 'Brazil', stars: 4.8, paid: 12 } }]);
  await Promise.all([f.watcher.tick(), f.watcher.tick()]);
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].text, /New Workana job\n\n<React>\n💰 USD 500 - 1,000/);
  assert.match(f.requests[0].text, /🛠️ React, Node.js\nClient\n👤 Ana · ⭐ 4.8\/5 · Brazil/);
  assert.deepEqual(f.requests[0].reply_markup.inline_keyboard, [[
    { text: 'Open job ↗️', url: 'https://www.workana.com/job/new' },
    { text: '📋 Copy link', copy_text: { text: 'https://www.workana.com/job/new' } }
  ]]);
  await new Watcher(f.options).tick();
  assert.equal(f.requests.length, 1);
  f.projects([{ id: 'excluded' }]); f.verdict('fail');
  await f.watcher.tick();
  assert.equal(f.requests.length, 1);
});
test('notification preserves zero client figures and distinguishes missing details', async () => {
  const f = fixture(); await f.watcher.tick();
  f.projects([{ id: 'zero', budget: { min: 15, max: 45, currency: 'USD', contract: 'hourly' }, client: { countryCode: 'BR', unrated: true, paid: 0 } }, { id: 'unknown' }]);
  await f.watcher.tick();
  assert.match(f.requests[0].text, /💰 USD 15 - 45 \/ hr/);
  assert.match(f.requests[0].text, /⭐ 0.0\/5 · 🇧🇷 BR\n📊 — published · 0 paid/);
  assert.match(f.requests[1].text, /💰 —\n📅 Posted:/);
  assert.match(f.requests[1].text, /Client\n👤 — · ⭐ — · —\n📊 — published · — paid/);
});
test('missing client details wait; failures retain candidate and retry after restart', async () => {
  const f = fixture(); await f.watcher.tick();
  f.projects([{ id: 'new' }]); f.verdict('waiting');
  await f.watcher.tick(); assert.equal(f.values.telegram.seen.new, undefined);
  f.verdict('pass');
  const failed = new Watcher({ ...f.options, fetcher: async () => { throw Error(settings.botToken); } });
  await failed.tick();
  assert.equal(f.values.telegram.seen.new, undefined);
  assert.ok(!f.values.telegram.lastError.includes(settings.botToken));
  const restored = new Watcher(f.options);
  await restored.tick(); assert.equal(f.requests.length, 0);
  f.values.telegram.retryAt = 0;
  await restored.tick(); assert.equal(f.requests.length, 1);
});
test('one failed detail request cannot block later projects and remains retryable', async () => {
  const f = fixture();
  await f.watcher.tick();
  let unavailable = true;
  f.options.eligible = project => ({ state: project.id === 'unavailable' && !project.client ? 'waiting' : 'pass', issues: ['Client details unavailable.'] });
  f.options.inspect = async project => {
    if (project.id === 'unavailable' && unavailable) throw Error('Details temporarily unavailable');
    return { publishedAt: Date.now(), publishedPrecision: 'exact', ...project, client: { verified: true } };
  };
  f.projects([{ id: 'unavailable' }, { id: 'matching', title: 'New React project' }]);
  const watcher = new Watcher(f.options);
  await watcher.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.values.telegram.seen.unavailable, undefined);
  assert.equal(f.values.telegram.seen.matching, true);
  assert.match(f.values.telegram.lastError, /temporarily unavailable/);
  assert.match(f.values.telegram.summary, /1 notified.*1 required-detail errors/);
  unavailable = false;
  await watcher.tick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.values.telegram.seen.unavailable, true);
  assert.equal(f.values.telegram.lastError, '');
});
test('complete search evidence notifies without making a project-page request', async () => {
  const f = fixture(); await f.watcher.tick();
  f.options.inspect = async () => assert.fail('complete search matches must not depend on project-page access');
  f.projects([{ id: 'complete-api', title: 'API project', category: 'it-programming', publishedAt: Date.now(), publishedPrecision: 'exact', skills: ['React'], budget: { label: 'USD 500' }, client: { name: 'Ana', country: 'Brazil', stars: 5, paid: 0, verified: true, published: 1, registeredAt: "2024-01-01" }, description: "Build an app", bids: 0, interested: 0 }]);
  await new Watcher(f.options).tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.values.telegram.lastError, '');
});
test('403 on optional details cannot block proven matches or bypass missing client filters', async () => {
  const f = fixture(); await f.watcher.tick();
  f.options.config = async () => ({ client: { minStars: 4, payment: 'verified' } });
  f.options.eligible = project => ({ state: Number.isFinite(project.client?.stars) && project.client.verified === true ? 'pass' : 'waiting', stage: 'client', issues: ['Client rating is missing.'] });
  f.options.inspect = async () => { throw Error('Workana project request failed (403).'); };
  f.projects([
    { id: 'proven', publishedAt: Date.now(), publishedPrecision: 'exact', client: { name: 'Ana', country: 'Brazil', stars: 5, verified: true } },
    { id: 'needs-rating', publishedAt: Date.now(), publishedPrecision: 'exact', client: { verified: true } }
  ]);
  await new Watcher(f.options).tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.values.telegram.seen.proven, true);
  assert.equal(f.values.telegram.seen['needs-rating'], undefined);
  assert.match(f.values.telegram.lastError, /403.*rating is missing/);
  assert.match(f.values.telegram.summary, /1 matched using search evidence/);
});
test('API scan results retain coverage warnings and deliver matching projects', async () => {
  const f = fixture();
  await f.watcher.tick();
  f.options.scan = async () => ({ projects: [{ id: 'api-new', title: 'API project' }], warning: 'More API pages are available.' });
  await new Watcher(f.options).tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.values.telegram.discoveryWarning, 'More API pages are available.');
  assert.equal(f.values.telegram.recentChecks[0].result, 'notified');
});
test('matching listings without proof of publication after monitoring wait for better evidence', async () => {
  const f = fixture();
  const startedAt = Date.parse('2026-11-18T12:00:00Z');
  f.values.telegram.startedAt = startedAt;
  await f.watcher.tick();
  f.projects([
    { id: 'unknown', publishedAt: null },
    { id: 'calendar-day', publishedAt: Date.parse('2026-11-18'), publishedPrecision: 'day' },
    { id: 'overlapping-relative', publishedAt: startedAt - 1000, publishedLatestAt: startedAt + 1000, publishedPrecision: 'relative' },
    { id: 'older', publishedAt: startedAt - 86400000, publishedPrecision: 'exact' }
  ]);
  await f.watcher.tick();
  assert.equal(f.requests.length, 0);
  for (const id of ['unknown', 'calendar-day', 'overlapping-relative']) {
    assert.equal(f.values.telegram.recentChecks.find(p => p.id === id).result, 'waiting');
  }
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'older').result, 'older');
  f.projects([{ id: 'unknown', publishedAt: startedAt + 60000, publishedPrecision: 'exact' }]);
  await f.watcher.tick();
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].text, /Published: 2026-11-18 12:01:00 UTC/);
});
test('disabled watcher does not scan, validates credentials and honors Telegram errors', async () => {
  const f = fixture(); f.values.telegram.settings = { ...settings, enabled: false };
  f.options.scan = async () => assert.fail('disabled scan');
  await new Watcher(f.options).tick();
  await assert.rejects(new Watcher(f.options).action({ kind: 'CHECK_TELEGRAM' }), /Enable Telegram notifications/);
  assert.throws(() => validate({ ...settings, chatId: 'bad' }), /chat ID/);
  await assert.rejects(send(settings, 'test', async () => ({ ok: false, status: 429, json: async () => ({ ok: false, parameters: { retry_after: 120 } }) })), e => e.retryAfter === 120);
});
test('manual project check bypasses backoff and reports actual discovery without resetting baseline', async () => {
  const f = fixture();
  await f.watcher.tick();
  f.values.telegram.retryAt = Date.now() + 3600000;
  f.projects([{ id: 'new-manual', title: 'New project' }]);
  await f.watcher.action({ kind: 'CHECK_TELEGRAM' });
  assert.equal(f.requests.length, 1);
  assert.match(f.values.telegram.summary, /1 notified/);
  assert.ok(f.values.telegram.lastAttemptAt);
  assert.equal(f.values.telegram.baseline, true);
});
test('unavailable payment cannot block a qualifying rating or join date, even if optional details lose search evidence', async () => {
  const f = fixture();
  f.options.eligible = (project, config) => notificationEligibility(project, config, item => ({
    state: item.closed ? 'fail' : 'pass', stage: 'project', issues: []
  }));
  f.options.inspect = async project => ({
    ...project,
    client: project.id === 'conflicting' ? { stars: 0, registeredAt: '2024-01-01', verified: null } : { verified: null },
    closed: project.id === 'closed'
  });
  const watcher = new Watcher(f.options);
  await watcher.tick();
  const publication = { publishedAt: Date.now(), publishedPrecision: 'exact' };
  f.projects([
    { ...publication, id: 'rating', title: 'Rating alone', client: { stars: 4, registeredAt: '2024-01-01' } },
    { ...publication, id: 'joined', title: 'Join date alone', client: { stars: 0, registeredAt: '2023-12-31' } },
    { ...publication, id: 'conflicting', client: { stars: 4, registeredAt: '2024-01-01' } },
    { ...publication, id: 'closed', client: { stars: 4 } },
    { ...publication, id: 'unconfirmed', client: { stars: 3, registeredAt: '2024-01-01' } }
  ]);
  await watcher.tick();
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[0].text, /Rating alone/);
  assert.match(f.requests[1].text, /Join date alone/);
  assert.match(f.values.telegram.recentChecks.find(p => p.id === 'rating').reason, /Client matched: rating/);
  assert.match(f.values.telegram.recentChecks.find(p => p.id === 'joined').reason, /Client matched: join date/);
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'conflicting').result, 'waiting');
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'closed').result, 'filtered');
  assert.match(f.values.telegram.recentChecks.find(p => p.id === 'unconfirmed').reason, /No client criterion confirmed yet. Unavailable: payment verification/);
});
test('watcher requires the real project filter and any one client criterion', async () => {
  const context = vm.createContext({ structuredClone, AbortSignal, URL });
  vm.runInContext(fs.readFileSync('integrations.js', 'utf8'), context);
  const source = fs.readFileSync('background.js', 'utf8').replace('import "./integrations.js";', '').replace('import "./telegram.js";', '');
  vm.runInContext(source.slice(0, source.indexOf('let I=new Ue')) + ';globalThis.filters={defaults:O,project:it};})();', context);
  const config = context.filters.defaults();
  config.project.excludeSkills = ['WordPress'];
  const f = fixture();
  f.options.config = async () => config;
  f.options.eligible = (project, current) => notificationEligibility(project, current, context.filters.project);
  const watcher = new Watcher(f.options);
  await watcher.tick();
  const client = { stars: 3, verified: false, registeredAt: '2024-01-01' };
  const project = { category: 'it-programming', skills: ['React'] };
  f.projects([
    { ...project, id: 'excluded', skills: ['WordPress'], client: { stars: 5 } },
    { ...project, id: 'missing-skills', skills: [], client: { stars: 5 } },
    { ...project, id: 'wrong-category', category: 'legal', client: { stars: 5 } },
    { ...project, id: 'no-match', client },
    { ...project, id: 'unknown', client: {} },
    { ...project, id: 'rating', client: { ...client, stars: 3.1 } },
    { ...project, id: 'verified', client: { verified: true } },
    { ...project, id: 'joined', client: { ...client, registeredAt: '2023-12-31' } },
    { ...project, id: 'out-of-range-rating', client: { ...client, stars: 6 } },
    { ...project, id: 'future-date', client: { ...client, registeredAt: '2099-01-01' } },
    { ...project, id: 'invalid-date', client: { ...client, registeredAt: '2024-02-30' } }
  ]);
  await watcher.tick();
  assert.equal(f.requests.length, 3);
  for (const id of ['rating', 'verified', 'joined']) assert.equal(f.values.telegram.seen[id], true);
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'no-match').result, 'filtered');
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'missing-skills').result, 'waiting');
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'unknown').result, 'waiting');
  assert.equal(f.values.telegram.recentChecks.find(p => p.id === 'invalid-date').result, 'waiting');
});
