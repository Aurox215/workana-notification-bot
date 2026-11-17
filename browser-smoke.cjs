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
    assert.deepEqual(errors, []);
    console.log('PASS: actual unpacked extension loads; Settings renders; Juberu defaults and saving work; JSON settings round-trip preserves prompt and panel position.');
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
