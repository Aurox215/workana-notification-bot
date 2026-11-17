const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function load(fetch) {
  const source = fs.readFileSync(`${__dirname}/background.js`, 'utf8').replace('import "./integrations.js";', '').replace('import "./telegram.js";', '');
  const context = vm.createContext({ structuredClone, AbortSignal, URL, fetch });
  vm.runInContext(fs.readFileSync(`${__dirname}/integrations.js`, 'utf8'), context);
  vm.runInContext(source.slice(0, source.indexOf('let I=new Ue')) +
    ';globalThis.api={defaults:O,migrate:de,validate:pe,generate:Ke,language:ne};})();', context);
  return context.api;
}

test('old templates migrate their instructions without losing the saved prompt', () => {
  const api = load();
  const config = api.defaults();
  delete config.templates[0].proposalPrompt;
  config.templates[0].points = ['First instruction.', 'Second instruction.'];
  const migrated = api.migrate(config);
  assert.equal(migrated.templates[0].proposalPrompt, 'First instruction.\nSecond instruction.');
  migrated.templates[0].proposalPrompt = 'Write two short paragraphs.';
  assert.equal(api.migrate(migrated).templates[0].proposalPrompt, 'Write two short paragraphs.');
  assert.throws(() => api.validate({ ...migrated, templates: [{ ...migrated.templates[0], proposalPrompt: ' ' }] }), /proposal prompt/);
});

test('description language takes priority over an English title', () => {
  const api = load();
  assert.equal(api.language({ title: 'Build a website for my project', description: 'Preciso de um desenvolvedor para criar uma aplicação profissional. O projeto precisa garantir qualidade e desempenho.' }), 'pt');
});

test('generation uses the saved prompt and retains formatting without legacy limits', async () => {
  let request;
  const api = load(async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ eligible: true, reason: '', language: 'en', clientName: null, greeting: '', closing: '', points: ['First paragraph.', '- Second paragraph.\n- Keep this list.'] }) }] }] }) };
  });
  const config = api.defaults();
  config.rules = '';
  config.templates[0].proposalPrompt = 'Write two paragraphs with a list. Omit greeting and closing.';
  config.templates[0].signature = '';
  config.templates[0].includeClientName = true;
  const result = await api.generate({ key: 'test-key', config, project: { id: 'test', title: 'Website', description: 'I need a website for my business. The project should deliver a professional website with clear requirements.', skills: [] } });
  assert.equal(result.text, 'First paragraph.\n\n- Second paragraph.\n- Keep this list.');
  assert.equal(result.issues.length, 0);
  assert.ok(request.input[0].content.includes(config.templates[0].proposalPrompt));
  assert.ok(!request.input[0].content.includes('AUTHORITATIVE LENGTH:'));
  assert.equal(request.max_output_tokens, 6000);
});

test('an English response to a Portuguese description is rejected for revision', async () => {
  const api = load(async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ eligible: true, reason: '', language: 'en', greeting: 'Hello', closing: 'Thank you', points: ['I will build your website and deliver the project with testing and clear communication.'] }) }] }] }) }));
  const config = api.defaults();
  config.templates[0].proposalPrompt = 'Write a concise proposal.';
  const result = await api.generate({ key: 'test-key', config, project: { id: 'test', title: 'Build a website', description: 'Preciso de um desenvolvedor para criar uma aplicação profissional. O projeto precisa garantir qualidade e desempenho.', skills: [] } });
  assert.equal(result.language, 'pt');
  assert.ok(result.issues.some(issue => issue.includes('language=pt')));
  assert.ok(result.issues.some(issue => issue.includes('Translate')));
});
