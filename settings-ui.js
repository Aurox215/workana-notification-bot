(function () {
  globalThis.createWorkanaSettingsUI = function ({ F, I, L, R, B, V, getState, request, onSaved, onImported, report }) {
    let sheetEdit = null;
    let includeApiKey = false;
    let working = false;

    function actionButton(label, handler, attributes = {}) {
      return F('button', { type: 'button', onclick: handler, ...attributes }, label);
    }

    function statusText() {
      const state = getState().sheetSync || {};
      const success = state.lastSuccessAt ? ` Last saved: ${new Date(state.lastSuccessAt).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })} JST.` : '';
      return `${state.pending || 0} bid(s) waiting to sync.${success}${state.lastError ? ` Last error: ${state.lastError}` : ''}`;
    }

    function refreshStatus() {
      document.querySelectorAll('[data-sheet-sync-status]').forEach(element => { element.textContent = statusText(); });
    }

    async function perform(button, action) {
      if (working) return;
      working = true;
      button.disabled = true;
      try { await action(); } catch (error) { report(error.message); }
      finally { working = false; button.disabled = false; }
    }

    function render() {
      const settings = sheetEdit ||= structuredClone(getState().config.sheets);
      const result = F('p', { role: 'status', 'aria-live': 'polite' });
      const save = F('button', { type: 'submit', class: 'primary' }, 'Save Google Sheets settings');
      const test = actionButton('Test connection', event => perform(event.currentTarget, async () => {
        result.textContent = 'Testing connection...';
        const reply = await request('TEST_SHEETS', { settings });
        result.textContent = reply.message || 'Connected. No bid row was added.';
      }));
      const retry = actionButton('Retry pending rows', event => perform(event.currentTarget, async () => {
        result.textContent = 'Retrying pending rows...';
        const state = await request('RETRY_SHEETS');
        onSaved(state);
        refreshStatus();
        report(state.sheetSync?.lastError || 'Google Sheets retry completed.');
      }));
      const sheetForm = F('form', { class: 'editor-form', onsubmit: event => {
        event.preventDefault();
        void perform(save, async () => {
          const state = await request('SAVE_SHEETS', { settings });
          sheetEdit = null;
          onSaved(state);
          report('Google Sheets settings saved.');
        });
      } },
      F('h3', {}, 'Google Sheets bid log'),
      F('p', {}, 'Confirmed bids are saved as Date, Time, Platform, Title, Client, Skills, Status and Url. Date and time always use Japan time (Asia/Tokyo).'),
      F('a', { href: 'https://docs.google.com/spreadsheets/d/1pIY489l8H1d-nhXwiZf55CvW9QgE5K_6WC_5rk8OpK8/edit?gid=415237413', target: '_blank', rel: 'noopener noreferrer' }, 'Open your Juberu spreadsheet'),
      B('Enable Google Sheets logging', settings.enabled, value => { settings.enabled = value; }),
      L('Apps Script web app URL', R(settings.webAppUrl, value => { settings.webAppUrl = value; }, { type: 'url', placeholder: 'https://script.google.com/macros/s/.../exec' })),
      L('Shared token', R(settings.token, value => { settings.token = value; }, { type: 'password', autoComplete: 'off', maxLength: 2000 })),
      L('Sheet tab name', R(settings.sheetName, value => { settings.sheetName = value; }, { required: true, maxLength: 100 })),
      L('Initial status', R(settings.status, value => { settings.status = value; }, { required: true, maxLength: 100 })),
      F('small', {}, 'Setup: add google-sheets-receiver.gs from the extension folder to your spreadsheet Apps Script, set SHARED_TOKEN, then deploy as a web app. See GOOGLE-SHEETS-SETUP.md in the extension folder.'),
      F('p', { 'data-sheet-sync-status': 'true' }, statusText()),
      V(save, test, retry), result);

      const fileInput = F('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          if (file.size > 2097152) throw Error('Choose a JSON file smaller than 2 MB.');
          const backup = JSON.parse(await file.text());
          const state = await request('IMPORT_SETTINGS', { backup });
          sheetEdit = null;
          onImported(state);
          report('All settings imported successfully.');
        } catch (error) { report(error.message); }
        finally { fileInput.value = ''; }
      } });
      const backup = F('section', { class: 'editor-form' },
        F('h3', {}, 'Import / export all settings'),
        F('p', {}, 'Save or restore your proposal prompt, portfolio, bid requirements, filters, model, appearance, panel position and Google Sheets connection as JSON.'),
        B('Include OpenAI API key in exported JSON', includeApiKey, value => { includeApiKey = value; }),
        F('small', {}, 'The JSON includes your Google Sheets shared token. The OpenAI key is included only when checked. Importing a key restores its saved or session-only preference.'),
        V(actionButton('Export settings JSON', event => perform(event.currentTarget, async () => {
          const data = await request('EXPORT_SETTINGS', { includeApiKey });
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const link = F('a', { href: url, download: `workana-settings-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          report('Settings exported.');
        })), actionButton('Import settings JSON', () => fileInput.click(), { disabled: !!getState().run?.active })),
        F('small', {}, 'Import replaces saved settings. Stop bidding before importing a backup.'), fileInput);
      return F('div', { class: 'settings-integrations' }, sheetForm, backup);
    }

    return { render, refreshStatus, reset() { sheetEdit = null; } };
  };
})();
