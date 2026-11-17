(function () {
  const SHEET_HEADERS = ['Date', 'Time', 'Platform', 'Title', 'Client', 'Skills', 'Status', 'Url'];
  const BACKUP_FORMAT = 'workana-proposal-studio.settings';

  function sheetsDefaults() {
    return { enabled: false, webAppUrl: '', token: '', sheetName: 'Juberu', status: 'On Hold' };
  }

  function validateSheets(settings, requireConnection = false) {
    if (!settings || typeof settings.enabled !== 'boolean') throw Error('Choose valid Google Sheets settings.');
    for (const key of ['webAppUrl', 'token', 'sheetName', 'status']) {
      if (typeof settings[key] !== 'string' || settings[key].length > 2000) throw Error('Invalid Google Sheets settings.');
    }
    if (settings.webAppUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(settings.webAppUrl)) {
      throw Error('Use the deployed Apps Script web app URL ending in /exec.');
    }
    if (settings.enabled || requireConnection) {
      if (!settings.webAppUrl || !settings.token.trim() || !settings.sheetName.trim() || !settings.status.trim()) {
        throw Error('Enter the web app URL, shared token, sheet tab name and initial status.');
      }
    }
    if (settings.sheetName.length > 100 || /[\[\]:*?\/\\]/.test(settings.sheetName)) throw Error('Enter a valid Google Sheets tab name.');
    if (settings.status.length > 100) throw Error('Keep the sheet status under 100 characters.');
    return settings;
  }

  function bidEvent(project, settings) {
    const timestamp = project.sentAt;
    if (!Number.isFinite(timestamp)) throw Error('A confirmed bid timestamp is required.');
    const date = new Date(timestamp);
    return {
      id: `workana:${project.id}`,
      sentAt: timestamp,
      values: [
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(date),
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(date),
        'Workana', String(project.title || ''), String(project.client?.name || ''),
        (project.skills || []).join(', '), settings.status,
        String(project.conversationUrl || project.url || '')
      ]
    };
  }

  async function postToSheet(settings, event, fetcher = fetch) {
    validateSheets(settings, true);
    const response = await fetcher(settings.webAppUrl, {
      method: 'POST', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ action: event ? 'append' : 'test', token: settings.token, sheetName: settings.sheetName, event })
    });
    if (!response.ok) throw Error(`Google Sheets request failed (${response.status}).`);
    let result;
    try { result = await response.json(); } catch { throw Error('The receiver did not return JSON. Check the deployment access and /exec URL.'); }
    if (result?.ok !== true || (event && result.id !== event.id)) throw Error(String(result?.error || 'The sheet did not confirm this bid.').slice(0, 250));
    return result;
  }

  function exportSettings(config, credential) {
    const backup = { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), config: structuredClone(config) };
    if (credential?.apiKey) backup.credentials = { apiKey: credential.apiKey, remember: !!credential.remember };
    return backup;
  }

  function readSettingsBackup(backup, allowedKeys) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw Error('Choose a settings JSON object.');
    if (backup.format && (backup.format !== BACKUP_FORMAT || backup.version !== 1)) throw Error('Unsupported settings backup format or version.');
    const config = backup.config || backup;
    if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.templates) || !config.templates.length || typeof config.model !== 'string') {
      throw Error('This file does not contain extension settings.');
    }
    const clean = Object.fromEntries(allowedKeys.filter(key => Object.hasOwn(config, key)).map(key => [key, structuredClone(config[key])]));
    let credentials;
    if (Object.hasOwn(backup, 'credentials')) {
      const value = backup.credentials;
      if (!value || typeof value.apiKey !== 'string' || value.apiKey.trim().length < 10 || /\s/.test(value.apiKey) || typeof value.remember !== 'boolean') {
        throw Error('The backup contains invalid API credentials.');
      }
      credentials = { apiKey: value.apiKey, remember: value.remember };
    }
    return { config: clean, credentials };
  }

  function enqueueBid(previous, current, settings, outbox) {
    if (!settings.enabled || current.status !== 'sent' || previous?.status === 'sent' || previous?.sheetEventId) return null;
    const event = bidEvent(current, settings);
    return { eventId: event.id, outbox: { ...outbox, [event.id]: { event, attempts: 0, nextAttemptAt: 0 } } };
  }

  class SheetsDelivery {
    constructor(store, storage, fetcher) {
      this.store = store;
      this.storage = storage;
      this.fetcher = fetcher;
      this.pending = null;
    }

    flush() {
      if (!this.pending) this.pending = this.deliver().finally(() => { this.pending = null; });
      return this.pending;
    }

    async deliver() {
      const settings = (await this.store.config()).sheets;
      if (!settings.enabled) return;
      const outbox = (await this.storage.get('sheetsOutbox')).sheetsOutbox || {};
      for (const [id, entry] of Object.entries(outbox).filter(([, entry]) => entry.nextAttemptAt <= Date.now()).slice(0, 10)) {
        try {
          await postToSheet(settings, entry.event, this.fetcher);
          await this.store.mutate(async () => {
            const current = (await this.storage.get('sheetsOutbox')).sheetsOutbox || {};
            delete current[id];
            await this.storage.set({ sheetsOutbox: current, sheetsDeliveryStatus: { lastSuccessAt: Date.now(), lastError: '' } });
          });
        } catch (error) {
          const message = String(error.message || error).replaceAll(settings.token, '[token]').slice(0, 250);
          await this.store.mutate(async () => {
            const current = (await this.storage.get('sheetsOutbox')).sheetsOutbox || {};
            if (!current[id]) return;
            const attempts = (current[id].attempts || 0) + 1;
            current[id] = { ...current[id], attempts, lastError: message, nextAttemptAt: Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)) };
            const status = (await this.storage.get('sheetsDeliveryStatus')).sheetsDeliveryStatus || {};
            await this.storage.set({ sheetsOutbox: current, sheetsDeliveryStatus: { ...status, lastError: message, lastFailureAt: Date.now() } });
          });
          await this.store.log(`Google Sheets: ${message} Pending bid retained for retry.`);
          break;
        }
      }
    }

    async retry() {
      if (this.pending) await this.pending;
      await this.store.mutate(async () => {
        const outbox = (await this.storage.get('sheetsOutbox')).sheetsOutbox || {};
        for (const entry of Object.values(outbox)) entry.nextAttemptAt = 0;
        await this.storage.set({ sheetsOutbox: outbox });
      });
      await this.flush();
    }

    async status() {
      const values = await this.storage.get(['sheetsOutbox', 'sheetsDeliveryStatus']);
      return { pending: Object.keys(values.sheetsOutbox || {}).length, ...values.sheetsDeliveryStatus };
    }
  }

  async function handleAction(message, { store, storage, delivery, bootstrap, defaults, normalize, validate }) {
    if (message.kind === 'EXPORT_SETTINGS') {
      const key = message.includeApiKey ? await store.key() : '';
      const status = await store.keyStatus();
      return exportSettings(await store.config(), key ? { apiKey: key, remember: status.remembered } : null);
    }
    if (message.kind === 'IMPORT_SETTINGS') {
      const imported = readSettingsBackup(message.backup, Object.keys(defaults()));
      const config = validate(normalize(imported.config));
      await store.mutate(async () => {
        if ((await store.run())?.active) throw Error('Stop bidding before importing settings.');
        const current = await store.loadConfig();
        config.revision = current.revision + 1;
        const local = { config };
        const credential = imported.credentials;
        if (credential?.remember) local.apiKey = credential.apiKey;
        await storage.local.set(local);
        if (credential) {
          if (credential.remember) await storage.session.remove('apiKey');
          else {
            await storage.session.set({ apiKey: credential.apiKey });
            await storage.local.remove('apiKey');
          }
        }
      });
      void delivery.flush().catch(() => {});
      return bootstrap();
    }
    if (message.kind === 'SAVE_SHEETS' || message.kind === 'TEST_SHEETS') {
      const settings = Object.fromEntries(Object.keys(sheetsDefaults()).map(key => [key, typeof message.settings?.[key] === 'string' ? message.settings[key].trim() : message.settings?.[key]]));
      validateSheets(settings, message.kind === 'TEST_SHEETS');
      if (message.kind === 'TEST_SHEETS') return postToSheet(settings, null);
      const config = await store.config();
      await store.saveConfig({ ...config, sheets: settings }, config);
      void delivery.flush().catch(() => {});
      return bootstrap();
    }
    if (message.kind === 'RETRY_SHEETS') {
      if (!(await store.config()).sheets.enabled) throw Error('Enable and save Google Sheets logging before retrying.');
      await delivery.retry();
      return bootstrap();
    }
    throw Error('Unknown settings action.');
  }

  globalThis.WorkanaIntegrations = { SHEET_HEADERS, sheetsDefaults, validateSheets, bidEvent, postToSheet, exportSettings, readSettingsBackup, enqueueBid, SheetsDelivery, handleAction };
})();
