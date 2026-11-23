const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('./workana-api.js');
const api = global.WorkanaSearchAPI;
const base = 'https://www.workana.com/jobs?category=it-programming&page=1';
const row = { slug: 'fresh-api-project', title: 'Fresh API project', published_at: '2026-11-18T12:03:42Z', skills: [{ name: 'React' }], category: { slug: 'it-programming' }, client: { name: 'Ana', rating: 4.8, verified_payment: true, published_projects: 10, paid_projects: 8, registered_at: '2020-01-01' } };
test('JSON search responses preserve exact publication timestamps and client evidence', () => {
  const result = api.parseResponse(JSON.stringify({ data: { projects: [row] }, links: { next: '/api/projects/search?page=2' } }), { url: base });
  assert.equal(result.projects[0].id, 'fresh-api-project');
  assert.equal(result.projects[0].publishedAt, Date.parse(row.published_at));
  assert.equal(result.projects[0].publishedPrecision, 'exact');
  assert.equal(result.projects[0].client.paid, 8);
  assert.equal(result.projects[0].client.verified, true);
  assert.deepEqual(result.projects[0].skills, ['React']);
  assert.equal(result.nextPage, 'https://www.workana.com/api/projects/search?page=2');
  const relative = api.parseResponse(JSON.stringify({ projects: [row], links: { next: '?page=2' } }), { url: base, requestUrl: 'https://www.workana.com/api/projects/search?page=1' });
  assert.equal(relative.nextPage, 'https://www.workana.com/api/projects/search?page=2');
});
test('generic account verification does not prove payment verification', () => {
  const project = { ...row, client: { verified: true, verified_payment: undefined } };
  const result = api.parseResponse(JSON.stringify({ projects: [project] }), { url: 'https://www.workana.com/jobs' });
  assert.equal(result.projects[0].client.verified, null);
});
test('empty responses must be explicit; challenges and unsupported payloads fail', () => {
  assert.equal(api.parseResponse('{"projects":[]}', { url: base }).projects.length, 0);
  assert.equal(api.recognizable('[]', base), true);
  assert.throws(() => api.parseResponse('<html><title>Just a moment</title></html>', { url: base }), /no recognizable/);
  assert.throws(() => api.parseResponse('{}', { url: base }), /no recognizable/);
  assert.throws(() => api.parseResponse('{"errors":["not authorized"]}', { url: base }), /no recognizable/);
  assert.equal(api.projectUrl('https://evil.example/job/fake', base), null);
  assert.equal(api.projectUrl(undefined, 'https://www.workana.com/job/known-project'), null);
  assert.throws(() => api.searchUrl('https://evil.example/jobs', base), /valid Workana/);
});
test('JSON responses containing escaped HTML project cards can teach the native request', () => {
  const body = JSON.stringify({ results: { html: '<article><a href="/job/fresh-api-project">New project</a></article>' } });
  assert.equal(api.recognizable(body, base), true);
  assert.equal(api.recognizable(JSON.stringify({ html: '<a href="https://evil.example/job/fake">Fake</a>' }), base), false);
});
test('relative API dates remain estimates and timezone-less values are not called exact', () => {
  assert.equal(api.publication('2 minutes ago').publishedPrecision, 'relative');
  assert.equal(api.publication('2026-11-18 12:03:42').publishedPrecision, 'day');
  assert.equal(api.publication('2026-11-18T12:03:42').publishedPrecision, 'day');
  assert.equal(api.publication('2026-11-18').publishedPrecision, 'day');
});
test('Workana human publication dates are parsed without inventing an exact time', () => {
  for (const text of ['Published on the November 20, 2026 in IT & Programming', 'Publicado el 20 de noviembre de 2026 en Programación', 'Publicado em 20 de novembro de 2026']) {
    const result = api.publication(text);
    assert.equal(result.publishedAt, Date.parse('2026-11-20T00:00:00Z'));
    assert.equal(result.publishedPrecision, 'day');
  }
  assert.equal(api.publication('November 2026').publishedAt, undefined);
  assert.equal(api.publication('2026-02-30').publishedAt, undefined);
});
test('project JSON can use its verified request URL and wrapped detail HTML', () => {
  const result = api.parseResponse(JSON.stringify({ project: { title: 'Requested project', category_slug: 'it-programming', published_at: '2026-11-20T12:30:00Z' } }), { url: 'https://www.workana.com/job/requested-project', project: true });
  assert.equal(result.projects[0].id, 'requested-project');
  let parsedHTML = false;
  const html = api.parseResponse(JSON.stringify({ html: '<main><h1>Requested project</h1></main>' }), { url: 'https://www.workana.com/job/requested-project', project: true, parseHTML: () => { parsedHTML = true; return { projects: [{ id: 'requested-project' }] }; } });
  assert.equal(parsedHTML, true);
  assert.equal(html.projects[0].id, 'requested-project');
});
test('observer replays learned search requests, resets pagination and never exports credentials', async () => {
  const requests = [];
  class FakeXHR { open() {} send() {} setRequestHeader() {} }
  const context = vm.createContext({ URL, URLSearchParams, Headers, Response, AbortSignal, XMLHttpRequest: FakeXHR, location: { href: base, origin: 'https://www.workana.com', pathname: '/jobs' }, fetch: async (url, options) => { requests.push({ url: String(url), options }); return new Response(JSON.stringify({ projects: [row] }), { status: 200 }); } });
  let body = JSON.stringify({ projects: [row] });
  let status = 200;
  let headers = {};
  // Responses from real fetch have a URL; preserve it in this fake without a network call.
  context.fetch = async (url, options) => { const address = typeof url === 'string' ? url : url.url; requests.push({ url: address, options }); const response = new Response(body, { status, headers }); Object.defineProperty(response, 'url', { value: new URL(address, base).href }); return response; };
  vm.runInContext(fs.readFileSync('workana-api.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('workana-api-observer.js', 'utf8'), context);
  await context.fetch('https://www.workana.com/api/projects/search?category=it-programming&page=2', { headers: { Authorization: 'session-test-secret' } });
  await new Promise(resolve => setImmediate(resolve));
  const result = await context.__workanaSearchRequests.poll({ url: base });
  assert.equal(result.learnedRequest, true);
  assert.match(requests.at(-1).url, /page=1/);
  assert.equal(requests.at(-1).options.credentials, 'include');
  assert.equal(requests.at(-1).options.cache, 'no-store');
  assert.ok(!JSON.stringify(result).includes('session-test-secret'));
  await context.fetch('https://www.workana.com/api/projects/123');
  await context.fetch('https://www.workana.com/api/graphql', { method: 'POST', body: JSON.stringify({ query: 'mutation DeleteProject { deleteProject(id:123) { id } }' }) });
  await new Promise(resolve => setImmediate(resolve));
  const stillSearch = await context.__workanaSearchRequests.poll({ url: base });
  assert.equal(stillSearch.endpoint, '/api/projects/search', 'detail and mutation requests must never replace the learned search');
  await context.fetch(new Request('https://www.workana.com/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query SearchProjects { projects { slug title } }' }) }));
  await new Promise(resolve => setTimeout(resolve, 10));
  const requestObject = await context.__workanaSearchRequests.poll({ url: base });
  assert.equal(requestObject.endpoint, '/api/graphql');
  assert.equal(requests.at(-1).options.method, 'POST');
  assert.match(requests.at(-1).options.body, /SearchProjects/);
  await assert.rejects(context.__workanaSearchRequests.poll({ url: base, nextPage: 'https://evil.example/api/projects/search?page=2' }), /unrelated/);
  body = JSON.stringify({ projects: [{ ...row, description: 'Integrate a CAPTCHA with our website' }] });
  const ordinary = await context.__workanaSearchRequests.poll({ url: base });
  assert.match(ordinary.text, /Integrate a CAPTCHA/);

  body = '<html><head><title>CAPTCHA integration jobs | Workana</title></head><body>Ordinary page</body></html>';
  assert.match((await context.__workanaSearchRequests.poll({ url: base })).text, /Ordinary page/);
  body = '<html><head><title>Just a moment...</title></head></html>';
  status = 403;
  await assert.rejects(context.__workanaSearchRequests.poll({ url: base }), /Workana requires verification/);
  body = 'Verification required';
  headers = { 'cf-mitigated': 'challenge' };
  await assert.rejects(context.__workanaSearchRequests.poll({ url: base }), /Workana requires verification/);
  headers = {};
  await assert.rejects(context.__workanaSearchRequests.poll({ url: base }), /search request failed \(403\)/);
});
