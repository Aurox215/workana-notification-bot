(function () {
  const VERSION = 3;
  if (globalThis.__workanaSearchRequests?.version === VERSION) return;
  const api = globalThis.WorkanaSearchAPI;
  if (!api) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrRequests = new WeakMap();
  let learned = null;
  function safeURL(value) {
    try { const url = new URL(value, location.href); return url.origin === location.origin && !url.username && !url.password ? url : null; } catch { return null; }
  }
  function readOnly(request) {
    const url = safeURL(request.url);
    if (!url || !/\/(?:jobs|projects|search|graphql)(?:\/|$)/i.test(url.pathname)) return false;
    if (/\/(?:related|recommended|recommendations|suggestions|clients|profiles)(?:\/|$)/i.test(url.pathname)) return false;
    if (request.method === 'GET') return /\/(?:jobs|projects)(?:\/(?:search|list|browse))?\/?$|\/(?:search|graphql)\/?$/i.test(url.pathname);
    if (request.method !== 'POST' || !/\/(?:search|graphql)(?:\/|$)/i.test(url.pathname)) return false;
    if (typeof request.body !== 'string' || request.body.length > 64000) return false;
    try { const body = JSON.parse(request.body); return typeof body.query !== 'string' ? /\/search\/?$/i.test(url.pathname) : !/\b(?:mutation|subscription)\b/i.test(body.query); } catch { return /\/search\/?$/i.test(url.pathname); }
  }
  function observe(request, responseText) {
    if (!/^\/(?:[a-z]{2}\/)?jobs\/?$/.test(location.pathname) || !readOnly(request) || !api.recognizable(responseText, location.href)) return;
    learned = { ...request, pageUrl: api.searchUrl(location.href), learnedAt: Date.now() };
  }
  const observedFetch = function (input, init = {}) {
    let request;
    try {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const headers = Object.fromEntries(new Headers(init.headers || input?.headers || {}).entries());
      const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
      request = { url: new URL(url, location.href).href, method: String(init.method || input?.method || 'GET').toUpperCase(), headers, body: typeof body === 'string' ? body : undefined };
      if (body === undefined && typeof input?.clone === 'function' && !['GET', 'HEAD'].includes(request.method)) request.bodyPromise = input.clone().text().catch(() => undefined);
    } catch {}
    const promise = nativeFetch(input, init);
    if (request && safeURL(request.url)) void promise.then(async response => {
      if (request.bodyPromise) { request.body = await request.bodyPromise; delete request.bodyPromise; }
      if (response.ok && readOnly(request)) observe(request, await response.clone().text());
    }).catch(() => {});
    return promise;
  };
  globalThis.fetch = observedFetch;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    try { xhrRequests.set(this, { method: String(method).toUpperCase(), url: new URL(url, location.href).href, headers: {} }); } catch {}
    return nativeOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const request = xhrRequests.get(this);
    if (request) request.headers[name] = value;
    return nativeHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const request = xhrRequests.get(this);
    if (request) {
      request.body = body instanceof URLSearchParams ? body.toString() : typeof body === 'string' ? body : undefined;
      if (readOnly(request)) this.addEventListener('load', () => {
        try { if (this.status >= 200 && this.status < 300) observe(request, this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText); } catch {}
      }, { once: true });
    }
    return nativeSend.call(this, body);
  };
  async function poll(options) {
    const canonical = api.searchUrl(options.url, location.href);
    if (new URL(canonical).origin !== location.origin) throw Error('Open a Workana tab on the same host as the saved search.');
    const recipe = learned && learned.pageUrl === canonical ? learned : { url: canonical, method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/html;q=0.9' } };
    const url = safeURL(recipe.url);
    if (!url || !readOnly(recipe)) throw Error('Workana search request is not a verified read-only request.');
    if (options.nextPage) {
      const next = safeURL(options.nextPage);
      if (!next || next.pathname !== url.pathname) throw Error('Workana returned an unrelated pagination endpoint.');
      url.search = next.search;
    } else if (recipe.method === 'GET' && (url.searchParams.has('page') || /^\/(?:[a-z]{2}\/)?jobs\/?$/.test(url.pathname))) url.searchParams.set('page', '1');
    const response = await nativeFetch(url.href, { method: recipe.method, headers: recipe.headers, ...(recipe.method === 'POST' ? { body: recipe.body } : {}), credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const finalURL = safeURL(response.url);
    if (!finalURL || /\/(?:login|signin|auth|challenge)(?:\/|$)/i.test(finalURL.pathname)) throw Error('Sign in to Workana and complete its verification, then retry the search request.');
    if (!response.ok) throw Error(`Workana search request failed (${response.status}). Open Workana and complete any requested verification.`);
    const text = await response.text();
    if (text.length > 6000000) throw Error('Workana search response is too large.');
    if (/captcha|Just a moment|cf-chl-|challenge-platform/i.test(text.slice(0, 20000))) throw Error('Workana returned a verification page instead of search data. Complete verification on Workana and retry.');
    return { text, url: canonical, requestUrl: url.href, endpoint: url.pathname, learnedRequest: !!learned && learned.pageUrl === canonical };
  }
  // Request headers and bodies stay in this page's memory; they are never exported
  // or written to extension storage. Only the response data is returned to the worker.
  async function project(options) {
    const identity = api.projectUrl(options.url, location.href);
    if (!identity || new URL(identity.url).origin !== location.origin) throw Error('Project detail requests must stay on the signed-in Workana host.');
    const response = await nativeFetch(identity.url, { method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json, text/html;q=0.9', 'X-Requested-With': 'XMLHttpRequest' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Workana project request failed (${response.status}).`);
    const returned = api.projectUrl(response.url, location.href);
    if (!returned || returned.id !== identity.id) throw Error('Workana project request redirected to sign-in or another project.');
    const text = await response.text();
    if (text.length > 6000000) throw Error('Workana project response is too large.');
    if (/Just a moment|cf-chl-|challenge-platform/i.test(text.slice(0, 20000))) throw Error('Workana returned a verification page for the project request.');
    return { text, url: identity.url, requestUrl: response.url };
  }
  globalThis.__workanaSearchRequests = { version: VERSION, poll, project };
})();
