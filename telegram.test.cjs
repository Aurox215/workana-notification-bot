const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./telegram.js');
const { Watcher, validate, send } = global.WorkanaTelegram;
const fs = require('node:fs');
const vm = require('node:vm');
const settings = { enabled: true, botToken: '123456:abcdefghijklmnopqrstuvwxyz', chatId: '1234', searchUrl: '' };
function fixture() {
  const values = { telegram: { settings, generation: 1, startedAt: Date.now(), seen: {} } };
  let projects = [{ id: 'old', title: 'Old' }], requests = [], verdict = 'pass';
  const options = { storage: { get: async () => structuredClone(values), set: async update => Object.assign(values, structuredClone(update)) }, config: async () => ({}), scan: async () => projects, inspect: async p => p, eligible: () => ({ state: verdict }), fetcher: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; } };
  return { values, requests, options, watcher: new Watcher(options), projects: p => { projects = p; }, verdict: v => { verdict = v; } };
}
test('baseline skips old listings, only matching new projects notify, restart deduplicates', async () => {
  const f = fixture();
  await f.watcher.tick();
  assert.equal(f.requests.length, 0);
  f.projects([{ id: 'new', title: '<React>', url: 'https://www.workana.com/job/new', budget: { label: 'USD 500 - 1,000' }, skills: ['React', 'Node.js'], client: { name: 'Ana', country: 'Brazil', stars: 4.8, paid: 12 } }]);
  await Promise.all([f.watcher.tick(), f.watcher.tick()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].text, [
    'New matching Workana project', 'Project: <React>',
    'URL: https://www.workana.com/job/new', 'Budget: USD 500 - 1,000',
    'Skills: React, Node.js', '', 'Client: Ana', 'Country: Brazil',
    'Star score: 4.8 / 5', 'Projects paid: 12'
  ].join('\n'));
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
  assert.match(f.requests[0].text, /Budget: USD 15 - 45 \/ hr/);
  assert.match(f.requests[0].text, /Country: BR\nStar score: 0 \/ 5\nProjects paid: 0/);
  assert.match(f.requests[1].text, /Budget: Not shown\nSkills: Not shown/);
  assert.match(f.requests[1].text, /Client: Not shown\nCountry: Not shown\nStar score: Not shown\nProjects paid: Not shown/);
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
test('disabled watcher does not scan, validates credentials and honors Telegram errors', async () => {
  const f = fixture(); f.values.telegram.settings = { ...settings, enabled: false };
  f.options.scan = async () => assert.fail('disabled scan');
  await new Watcher(f.options).tick();
  assert.throws(() => validate({ ...settings, chatId: 'bad' }), /chat ID/);
  await assert.rejects(send(settings, 'test', async () => ({ ok: false, status: 429, json: async () => ({ ok: false, parameters: { retry_after: 120 } }) })), e => e.retryAfter === 120);
});
test('watcher uses the real project and client filters, including excluded skills and unknown ratings', async () => {
  const context = vm.createContext({ structuredClone, AbortSignal, URL });
  vm.runInContext(fs.readFileSync('integrations.js', 'utf8'), context);
  const source = fs.readFileSync('background.js', 'utf8').replace('import "./integrations.js";', '').replace('import "./telegram.js";', '');
  vm.runInContext(source.slice(0, source.indexOf('let I=new Ue')) + ';globalThis.filters={defaults:O,eligible:ot};})();', context);
  const config = context.filters.defaults();
  config.project.excludeSkills = ['WordPress'];
  config.client.minStars = 4;
  const f = fixture();
  f.options.config = async () => config;
  f.options.eligible = context.filters.eligible;
  const watcher = new Watcher(f.options);
  await watcher.tick();
  f.projects([
    { id: 'excluded', category: 'it-programming', skills: ['WordPress'], client: { stars: 5 } },
    { id: 'low', category: 'it-programming', skills: ['React'], client: { stars: 2 } },
    { id: 'missing', category: 'it-programming', skills: ['React'], client: {} },
    { id: 'match', category: 'it-programming', skills: ['React'], client: { stars: 5 } }
  ]);
  await watcher.tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.values.telegram.seen.match, true);
  assert.equal(f.values.telegram.seen.missing, undefined);
});
