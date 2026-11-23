// Runs the actual unpacked extension in an isolated, temporary Edge profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const browser = process.env.WORKANA_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!fs.existsSync(browser)) throw Error('Set WORKANA_TEST_BROWSER to a Chromium browser executable.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'workana-browser-test-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--load-extension=${__dirname}`, '--disable-extensions-except=' + __dirname, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    const activePortFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(activePortFile); i++) await new Promise(resolve => setTimeout(resolve, 100));
    const port = Number(fs.readFileSync(activePortFile, 'utf8').split('\n')[0]);
    const base = `http://127.0.0.1:${port}`;
    await new Promise(resolve => setTimeout(resolve, 1500));
    let worker;
    for (let i = 0; i < 30; i++) {
      const targets = await (await fetch(`${base}/json/list`)).json();
      for (const candidate of targets.filter(target => target.type === 'service_worker' && target.url.endsWith('/background.js'))) {
        const connection = new WebSocket(candidate.webSocketDebuggerUrl);
        await new Promise(resolve => connection.addEventListener('open', resolve, { once: true }));
        const name = await new Promise(resolve => {
          connection.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message.result?.result?.value); });
          connection.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'globalThis.chrome?.runtime?.getManifest()?.name', returnByValue: true } }));
        });
        connection.close();
        if (name === 'Workana Proposal Studio') { worker = candidate; break; }
      }
      if (worker) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(worker, 'extension service worker must load');
    const extensionOrigin = new URL(worker.url).origin;
    // URL.origin is "null" for chrome-extension URLs in Node.
    const origin = extensionOrigin === 'null' ? worker.url.slice(0, worker.url.lastIndexOf('/')) : extensionOrigin;
    const target = await (await fetch(`${base}/json/new?${origin}/panel.html`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let nextId = 0;
    const waiting = new Map();
    const errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      const request = waiting.get(message.id);
      if (request) { waiting.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); }
    });
    function send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1050, height: 900, deviceScaleFactor: 1, mobile: false });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!![...document.querySelectorAll("button")].find(button => button.textContent === "Settings")')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(await evaluate('!![...document.querySelectorAll("button")].find(button => button.textContent === "Settings")'), 'Panel failed to bootstrap: ' + await evaluate('document.body.innerText') + '; errors: ' + errors.join(', '));
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Settings").click()');
    for (let i = 0; i < 30; i++) {
      if (await evaluate('document.body.innerText.includes("Google Sheets bid log")')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const content = await evaluate('document.body.innerText');
    assert.ok(content.includes('Google Sheets bid log'));
    assert.ok(content.includes('Import / export all settings'));
    assert.equal(await evaluate('[...document.querySelectorAll("label")].find(label => label.textContent.startsWith("Sheet tab name")).querySelector("input").value'), 'Juberu');
    assert.equal(await evaluate('document.querySelectorAll("form form").length'), 0);
    // Exercise the real button -> runtime message -> worker -> Telegram response path.
    // Intercept only the fake test bot; never contact Telegram or use real credentials.
    async function workerEvaluate(expression) {
      const connection = new WebSocket(worker.webSocketDebuggerUrl);
      await new Promise(resolve => connection.addEventListener('open', resolve, { once: true }));
      try {
        return await new Promise((resolve, reject) => {
          connection.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id !== 77) return;
            if (message.result?.exceptionDetails || message.error) reject(Error('Worker fixture failed'));
            else resolve(message.result?.result?.value);
          });
          connection.send(JSON.stringify({ id: 77, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        });
      } finally { connection.close(); }
    }
    await workerEvaluate(`globalThis.telegramFixture = 'success'; globalThis.originalFetch = globalThis.fetch; globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz/')) return originalFetch(url, options);
      if (telegramFixture === 'empty') return {ok:true,status:200,json:async()=>({ok:true,result:[]})};
      return {ok:true,status:200,json:async()=>({ok:true,result:[{message:{chat:{id:123456789,type:'private',first_name:'Fixture user'}}}]})};
    }; true`);
    async function clickLookup() {
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Find my chat ID').click()`);
      for (let i = 0; i < 100; i++) {
        if (!await evaluate(`document.querySelector('[data-telegram-lookup-status]').textContent.startsWith('Looking for chats')`)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error('Lookup did not finish');
    }
    await clickLookup();
    assert.match(await evaluate(`document.querySelector('[data-telegram-lookup-status]').textContent`), /token from BotFather/);
    await evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Bot token from')).querySelector('input');input.value='123456:abcdefghijklmnopqrstuvwxyz';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await clickLookup();
    assert.equal(await evaluate(`document.getElementById('telegram-chat-id').value`), '123456789');
    assert.match(await evaluate(`document.querySelector('[data-telegram-lookup-status]').textContent`), /Chat selected: Fixture user/);
    assert.equal(await evaluate(`document.querySelector('[data-telegram-lookup-status]').previousElementSibling.textContent`), 'Find my chat ID');
    assert.equal(await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Find my chat ID');const input=document.getElementById('telegram-chat-id');const label=document.querySelector('label[for="telegram-chat-id"]');return !!(label.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(button.compareDocumentPosition(input)&Node.DOCUMENT_POSITION_FOLLOWING)})()`), true);
    assert.equal(await evaluate(`document.body.innerText.includes('Workana search URL (optional)')`), false);
    await workerEvaluate(`globalThis.telegramFixture='empty'`);
    await clickLookup();
    assert.match(await evaluate(`document.querySelector('[data-telegram-lookup-status]').textContent`), /send it a new message/);
    await workerEvaluate(`globalThis.fetch=globalThis.originalFetch;true`);
    await workerEvaluate(`globalThis.telegramTabsCreated=0;globalThis.originalTabsCreate=chrome.tabs.create;chrome.tabs.create=async()=>{telegramTabsCreated++;throw Error('Notification must not create a tab')};true`);
    assert.equal(await evaluate(`(async()=>{const reply=await chrome.runtime.sendMessage({kind:'SAVE_TELEGRAM',settings:{enabled:true,botToken:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'123456789'}});if(!reply.ok)throw Error(reply.error);return reply.data.telegram.settings.enabled})()`), true);
    for (let i=0;i<50;i++) {
      if (await evaluate(`(async()=>!!(await chrome.storage.local.get('telegram')).telegram.lastError)()`)) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.match(await evaluate(`(async()=>(await chrome.storage.local.get('telegram')).telegram.lastError)()`), /search once/);
    assert.equal(await workerEvaluate('globalThis.telegramTabsCreated'), 0);
    await evaluate(`chrome.runtime.sendMessage({kind:'SAVE_TELEGRAM',settings:{enabled:false,botToken:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'123456789'}})`);
    await workerEvaluate(`chrome.tabs.create=globalThis.originalTabsCreate;true`);
    // Run the real content parser, background watcher and alarm against intercepted
    // Workana HTML. The fixture never submits a bid or makes a paid/network API call.
    const listingTarget = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
    const listingSocket = new WebSocket(listingTarget.webSocketDebuggerUrl);
    await new Promise(resolve => listingSocket.addEventListener('open', resolve, { once: true }));
    let fixtureId = 0, includeNew = false, blockApi = false, apiCalls = 0, includeComplete = false, blockProjects = false;
    const blockedProjectPaths = [];
    const fixtureWaiting = new Map();
    function fixtureSend(method, params = {}) {
      const id = ++fixtureId;
      return new Promise((resolve, reject) => { fixtureWaiting.set(id, { resolve, reject }); listingSocket.send(JSON.stringify({ id, method, params })); });
    }
    const card = id => `<article data-project-card><h2><a href="https://www.workana.com/job/${id}">${id} React project</a></h2><span data-project-category="it-programming"></span><span data-skill="React">React</span><span class="budget">USD 500 - 1,000</span>${id === 'baseline-project' ? `<time datetime="${new Date(Date.now() - 3600000).toISOString()}"></time>` : '<small>Published: 29 minutes ago Bids: 83</small>'}</article>`;
    listingSocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = fixtureWaiting.get(message.id);
      if (pending) { fixtureWaiting.delete(message.id); message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result); }
      if (message.method === 'Fetch.requestPaused') {
        const url = new URL(message.params.request.url);
        let body = url.pathname.includes('/job/')
          ? `<html><head><title>Project details</title></head><body><main><h1>${url.pathname.split('/').pop()} React project</h1><span data-project-category="it-programming">IT &amp; Programming</span><div class="last-reply"><time datetime="2026-01-01T00:00:00Z"></time></div><time itemprop="datePosted" datetime="${new Date(Date.now()-120000).toISOString()}"></time><div data-project-description>Build a React app.</div><div data-project-activity><span data-last-reply="just now"></span><span data-interested-count="0"></span></div><span data-skill="React">React</span><span class="budget">USD 500 - 1,000</span></main><aside data-client-profile><span data-client-name="Ana">Ana</span><span data-country="Brazil" data-country-code="BR"></span><span data-rating="4.8"></span><span data-payment-verified="false"></span><p>Projects published: 10</p><p>Projects paid: 8</p><p>Member since: January 2020</p></aside></body></html>`
          : `<html><head><title>Workana projects</title></head><body><div class="saved-search"><ul class="multi-select-selection-list"><li><span>All</span><button aria-label="Remove All">×</button></li></ul></div><main>${card('baseline-project')}</main><script>fetch('/api/projects/search?category=it-programming&page=1').then(r=>r.json()).catch(()=>{});</script></body></html>`;
        const isApi = url.pathname === '/api/projects/search';
        if (isApi) { apiCalls++; const secondPage = url.searchParams.get('page') === '2'; body = blockApi ? '<html><title>Just a moment...</title></html>' : JSON.stringify({ html: secondPage ? includeNew ? card('automatic-new-project') : '<div data-no-results>No projects</div>' : card('baseline-project'), projects: includeNew && secondPage ? [{ slug: 'client-filter-rejection', title: 'Ineligible client project', category_slug: 'it-programming', published_at: new Date(Date.now()-120000).toISOString(), client: { rating: 3, verified_payment: false, registered_at: '2023-12-31' } }, ...(includeComplete ? [{ slug: 'complete-api-only', title: 'Complete API project', category_slug: 'it-programming', published_at: new Date(Date.now()-120000).toISOString(), skills: ['React'], budget: 'USD 500', description: 'Build a React app.', bids_count: 0, interested_count: 0, client: { name: 'Ana', country: 'Brazil', rating: 5, paid_projects: 8, published_projects: 10, verified_payment: true, registered_at: '2024-01-01' } }] : [])] : [], links: { next: secondPage ? null : '?category=it-programming&page=2' } }); }
        if (url.pathname.includes('/job/') && blockProjects) { blockedProjectPaths.push(url.pathname); body = '<html><title>Forbidden</title></html>'; }
        void fixtureSend('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: isApi && blockApi || url.pathname.includes('/job/') && blockProjects ? 403 : 200, responseHeaders: [{ name: 'Content-Type', value: isApi && !blockApi ? 'application/json' : 'text/html;charset=utf-8' }], body: Buffer.from(body).toString('base64') });
      }
    });
    try {
      await fixtureSend('Fetch.enable', { patterns: [{ urlPattern: '*workana.com/*' }] });
      await fixtureSend('Page.navigate', { url: 'https://www.workana.com/jobs?category=it-programming' });
      await workerEvaluate(`globalThis.telegramSent=[];globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz/')){telegramSent.push(JSON.parse(options.body));return{ok:true,status:200,json:async()=>({ok:true})}}return originalFetch(url,options)};true`);
      await evaluate(`(async()=>{const initial=await chrome.runtime.sendMessage({kind:'BOOTSTRAP'});if(!initial.ok)throw Error(initial.error);const baseConfig=initial.data.config;const config=structuredClone(baseConfig);config.search={...config.search,savedSearchName:'All',useCurrentFilters:false};const reply=await chrome.runtime.sendMessage({kind:'SAVE_CONFIG',config,baseConfig});if(!reply.ok)throw Error(reply.error);})()`);
      await evaluate(`chrome.runtime.sendMessage({kind:'SAVE_TELEGRAM',settings:{enabled:true,botToken:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'123456789'}})`);
      for (let i=0;i<100;i++) {
        if (await evaluate(`(async()=>(await chrome.storage.local.get('telegram')).telegram.baseline)()`)) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(await evaluate(`(async()=>(await chrome.storage.local.get('telegram')).telegram.baseline)()`), 'Real search failed: '+await evaluate(`(async()=>(await chrome.storage.local.get('telegram')).telegram.lastError)()`));
      assert.equal(await workerEvaluate('telegramSent.length'), 0);
      await evaluate(`(async()=>{const {telegram}=await chrome.storage.local.get('telegram');await chrome.storage.local.set({telegram:{...telegram,startedAt:Date.now()-35*60000}})})()`);
      includeNew = true;
      await workerEvaluate(`chrome.alarms.create('workana-telegram',{when:Date.now()+100});true`);
      for (let i=0;i<150;i++) {
        if (await workerEvaluate('telegramSent.length')) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      const automatic = await workerEvaluate('telegramSent');
      assert.equal(automatic.length, 1, 'New project notification failed: '+await evaluate(`(async()=>JSON.stringify((await chrome.storage.local.get('telegram')).telegram))()`));
      assert.match(automatic[0].text, /automatic-new-project/);
      assert.match(automatic[0].text, /👤 Ana · ⭐ 4.8\/5 · 🇧🇷 Brazil/);
      assert.match(automatic[0].text, /10 published · 8 paid/);
      assert.match(automatic[0].text, /Member since: January 2020/);
      assert.match(automatic[0].text, /83 bids · 0 interested/);
      assert.match(automatic[0].text, /Published: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC · 💬 Last reply: just now/);
      assert.doesNotMatch(automatic[0].text, /Build a React app\./);
      assert.deepEqual(automatic[0].reply_markup.inline_keyboard, [[
        { text: 'Open job ↗️', url: 'https://www.workana.com/job/automatic-new-project' },
        { text: '📋 Copy link', copy_text: { text: 'https://www.workana.com/job/automatic-new-project' } }
      ]]);
      const check = await evaluate(`(async()=>{const reply=await chrome.runtime.sendMessage({kind:'CHECK_TELEGRAM'});if(!reply.ok)throw Error(reply.error);return reply.data.telegram.summary})()`);
      assert.match(check, /2 already seen/);
      assert.match(check, /1 filtered out/);
      assert.equal(await workerEvaluate('telegramSent.length'), 1, 'manual recheck must not duplicate notifications');
      assert.ok(apiCalls >= 2, 'fresh API requests must run after initial page rendering');
      const visibleNew = await fixtureSend('Runtime.evaluate', { expression: 'document.body.innerText.includes("automatic-new-project")', returnByValue: true });
      assert.equal(visibleNew.result.value, false, 'new project must be detected without updating the visible cards');
      const metadata = await evaluate(`(async()=>{const {telegramSearchBinding}=await chrome.storage.local.get('telegramSearchBinding');return chrome.tabs.sendMessage(telegramSearchBinding.tabId,{channel:'workana-studio',kind:'PARSE_API_SEARCH',payload:{url:telegramSearchBinding.url,text:JSON.stringify({projects:[{slug:'metadata-probe',title:'Metadata probe',published_at:new Date().toISOString(),budget:'USD 500',client:{member_since:'January 2020'}}]})}})})()`);
      assert.equal(metadata.projects[0].budget.label, 'USD 500');
      assert.equal(metadata.projects[0].client.registeredAt, '2020-01-01');
      const humanPublication = await evaluate(`(async()=>{const {telegramSearchBinding}=await chrome.storage.local.get('telegramSearchBinding');return chrome.tabs.sendMessage(telegramSearchBinding.tabId,{channel:'workana-studio',kind:'PARSE_API_PROJECT',payload:{url:'https://www.workana.com/job/human-date-project',text:'<html><title>Human date project</title><body><main><h1>Human date project</h1><p class="project-published">Published on the November 20, 2026 in IT &amp; Programming</p><span data-project-category="it-programming"></span></main></body></html>'}})})()`);
      assert.equal(humanPublication.publishedAt, Date.parse('2026-11-20T00:00:00Z'));
      assert.equal(humanPublication.publishedPrecision, 'day');
      includeComplete = true;
      blockProjects = true;
      const proven = await evaluate(`(async()=>{const reply=await chrome.runtime.sendMessage({kind:'CHECK_TELEGRAM'});if(!reply.ok)throw Error(reply.error);return reply.data.telegram})()`);
      assert.equal(proven.lastError, '');
      assert.equal(await workerEvaluate('telegramSent.length'), 2, 'complete search data must notify even when project pages would return 403');
      assert.ok(!blockedProjectPaths.includes('/job/complete-api-only'), 'complete API row fetched unnecessary details: '+blockedProjectPaths.join(', ')+'; '+proven.summary);
      blockApi = true;
      await fixtureSend('Runtime.evaluate', { expression: `document.querySelector('main').insertAdjacentHTML('beforeend',${JSON.stringify(card('visible-only-project'))})` });
      const fallback = await evaluate(`(async()=>{const reply=await chrome.runtime.sendMessage({kind:'CHECK_TELEGRAM'});if(!reply.ok)throw Error(reply.error);return reply.data.telegram})()`);
      assert.match(fallback.lastError, /Workana requires verification/);
      assert.equal(fallback.discoverySource, '', 'a blocked scan must not show the previous search source');
      assert.equal(await workerEvaluate('telegramSent.length'), 3, 'the blocked scan must send one verification alert');
      assert.match(await workerEvaluate('telegramSent[2].text'), /Workana requested verification/);
      await evaluate("chrome.runtime.sendMessage({kind:'CHECK_TELEGRAM'})");
      assert.equal(await workerEvaluate('telegramSent.length'), 3, 'a repeated blocked scan must not duplicate the alert or send visible cards');
      assert.equal((await fixtureSend('Runtime.evaluate', { expression: 'document.querySelectorAll(\'iframe[title="Workana notification search"]\').length', returnByValue: true })).result.value, 0, 'temporary render frames must be removed');
      await evaluate(`chrome.runtime.sendMessage({kind:'SAVE_TELEGRAM',settings:{enabled:false,botToken:'123456:abcdefghijklmnopqrstuvwxyz',chatId:'123456789'}})`);
      await workerEvaluate(`globalThis.fetch=globalThis.originalFetch;true`);
    } finally { listingSocket.close(); await fetch(`${base}/json/close/${listingTarget.id}`); }
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('label')].find(label => label.textContent.startsWith('Initial status')).querySelector('input');
      input.value = 'In Contact'; input.dispatchEvent(new Event('input', {bubbles:true}));
      [...document.querySelectorAll('button')].find(button => button.textContent === 'Save Google Sheets settings').click();
    })()`);
    for (let i = 0; i < 30; i++) {
      if (await evaluate('(async()=> (await chrome.storage.local.get("config")).config.sheets.status === "In Contact")()')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await evaluate('(async()=> (await chrome.storage.local.get("config")).config.sheets.status)()'), 'In Contact');
    const result = await evaluate(`(async()=> {
      const reply = await chrome.runtime.sendMessage({kind:'EXPORT_SETTINGS'});
      if (!reply.ok) throw Error(reply.error);
      const backup = reply.data;
      backup.config.templates[0].proposalPrompt = 'Browser smoke proposal prompt';
      backup.config.window.left = 42;
      const imported = await chrome.runtime.sendMessage({kind:'IMPORT_SETTINGS', backup});
      if (!imported.ok) throw Error(imported.error);
      const config = (await chrome.storage.local.get('config')).config;
      return { prompt:config.templates[0].proposalPrompt, left:config.window.left, credentialsIncluded:!!backup.credentials };
    })()`);
    assert.deepEqual(result, { prompt: 'Browser smoke proposal prompt', left: 42, credentialsIncluded: false });
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Bid Settings').click()`);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Project Filter').click()`);
    const filterContent = await evaluate('document.body.innerText');
    assert.ok(filterContent.includes('Exclude skills'));
    for (const label of ['Project pricing', 'Budget type', 'Minimum project budget', 'Maximum project budget', 'Workana budget ranges']) assert.ok(!filterContent.includes(label), label + ' must be removed');
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Client Filter').click()`);
    assert.ok(await evaluate(`document.body.innerText.includes('Minimum client rating (stars)')`));
    assert.deepEqual(errors, []);
    console.log('PASS: session-backed search and detail requests notify new projects absent from the visible page; complete API rows notify without project-page access; exact timestamps and API failures are handled correctly.');
    await send('Browser.close');
  } finally {
    if (socket) socket.close();
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null) child.kill();
    }
    // Remove only the exact temporary profile created by this script.
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('workana-browser-test-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
