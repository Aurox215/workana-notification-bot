(function () {
  globalThis.createWorkanaSettingsUI = function ({ F, I, L, R, B, V, getState, request, onSaved, onImported, report }) {
    let sheetEdit = null;
    let telegramEdit = null;
    const chatLookup = { message: '', chats: [], busy: false };
    let refreshChatLookup = () => {};
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
      document.querySelectorAll('[data-telegram-monitor-status]').forEach(element => { element.textContent = telegramStatus(); });
      document.querySelectorAll('[data-telegram-project-checks]').forEach(renderProjectChecks);
    }

    function telegramStatus() {
      const state = getState().telegram || {};
      if (!state.settings?.enabled) return 'Automatic notifications are OFF. Enable Telegram notifications and save settings. Sending a test alone does not start monitoring.';
      const summary = state.summary || 'Waiting for the first search check.';
      const status = state.lastError
        ? `Check failed: ${state.lastError}${summary === 'Project check interrupted.' ? '' : ' ' + summary}`
        : summary;
      const warning = state.discoveryWarning ? ` Search warning: ${state.discoveryWarning}` : '';
      const checked = state.lastCheckAt ? ` Last completed check: ${new Date(state.lastCheckAt).toLocaleString()}.` : '';
      return status + warning + checked;
    }
    function renderProjectChecks(container) {
      const checks = getState().telegram?.recentChecks || [];
      container.replaceChildren(...(checks.length ? checks.map(check => F('p', {},
        F('strong', {}, check.title), ` — ${check.result}: ${check.reason}${check.publishedLabel ? ' Published: ' + check.publishedLabel : ''}`
      )) : [F('p', {}, 'No individual project checks recorded yet.')]));
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
      const telegram = telegramEdit ||= structuredClone(getState().telegram?.settings || { enabled: false, botToken: '', chatId: '', searchUrl: '' });
      const telegramResult = F('p', { role: 'status', 'aria-live': 'polite', 'data-telegram-lookup-status': 'true' });
      const chatInput = R(telegram.chatId, value => { telegram.chatId = value; }, { id: 'telegram-chat-id', placeholder: '123456789 or -1001234567890' });
      const chatChoices = F('div', { 'aria-live': 'polite' });
      const chooseChat = chat => {
        telegram.chatId = chat.id;
        chatInput.value = chat.id;
        chatLookup.chats = [];
        chatLookup.message = `Chat selected: ${chat.name} (${chat.id}). Send a test notification, then save settings.`;
        refreshChatLookup();
      };
      const findChat = actionButton('Find my chat ID', async () => {
        if (chatLookup.busy) return;
        chatLookup.busy = true;
        chatLookup.message = 'Looking for chats... Send hello to your bot in Telegram now.';
        chatLookup.chats = [];
        refreshChatLookup();
        let deadline;
        try {
          const reply = await Promise.race([
            request('FIND_TELEGRAM_CHATS', { settings: { botToken: telegram.botToken } }),
            new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Chat lookup timed out. Reload the extension at chrome://extensions, refresh Workana, and try again.')), 25000); })
          ]);
          if (!Array.isArray(reply?.chats) || !reply.chats.length) throw Error('No chat found. Send hello to your bot in Telegram, then click Find my chat ID again.');
          if (reply.chats.length === 1) {
            telegram.chatId = reply.chats[0].id;
            chatLookup.message = `Chat selected: ${reply.chats[0].name} (${reply.chats[0].id}). Send a test notification, then save settings.`;
          }
          else {
            chatLookup.message = 'Choose the chat that should receive notifications:';
            chatLookup.chats = reply.chats;
          }
        } catch (error) { chatLookup.message = error.message || 'Chat lookup failed. Refresh Workana and try again.'; }
        finally { clearTimeout(deadline); chatLookup.busy = false; refreshChatLookup(); }
      });
      refreshChatLookup = () => {
        telegramResult.textContent = chatLookup.message;
        findChat.disabled = chatLookup.busy;
        findChat.textContent = chatLookup.busy ? 'Finding chat...' : 'Find my chat ID';
        chatInput.value = telegram.chatId;
        chatChoices.replaceChildren(...chatLookup.chats.map(chat => actionButton(`${chat.name} (${chat.type}, ${chat.id})`, () => chooseChat(chat))));
      };
      refreshChatLookup();
      const telegramSave = F('button', { type: 'submit', class: 'primary' }, 'Save Telegram settings');
      const projectChecks = F('div', { 'data-telegram-project-checks': 'true' });
      renderProjectChecks(projectChecks);
      const telegramForm = F('form', { class: 'editor-form', onsubmit: event => {
        event.preventDefault();
        void perform(telegramSave, async () => {
          const state = await request('SAVE_TELEGRAM', { settings: telegram });
          telegramEdit = null;
          onSaved(state);
          report('Telegram settings saved. The first search establishes a baseline; later matching projects trigger notifications.');
        });
      } },
      F('h3', {}, 'Telegram project notifications'),
      F('p', {}, 'Checks every minute while Chrome is running and you are signed in to Workana. Uses your saved Project Filter. A client qualifies with a rating above 3, verified payment, or a join date in 2024 or later. Auto-Bid and an OpenAI key are not required.'),
      B('Enable Telegram notifications', telegram.enabled, value => { telegram.enabled = value; }),
      L('Bot token from @BotFather', R(telegram.botToken, value => { telegram.botToken = value; }, { type: 'password', autoComplete: 'off' })),
      F('div', { class: 'field' },
        F('label', { htmlFor: 'telegram-chat-id' }, 'Telegram chat ID'),
        findChat, telegramResult, chatChoices, chatInput),
      F('small', {}, 'Paste your @BotFather token above. Open your bot in Telegram, press Start or send hello, then click Find my chat ID. Send a test notification, then enable and save. After reloading Workana, select your saved search once to bind its request. Fresh results are requested from Workana in the background, independently of the visible project cards. Keep one signed-in Workana tab open; the search page can remain unchanged.'),
      F('p', { 'data-telegram-monitor-status': 'true', role: 'status', 'aria-live': 'polite' }, telegramStatus()),
      F('details', {}, F('summary', {}, 'Recent project checks'), projectChecks),
      V(telegramSave, actionButton('Send test notification', event => perform(event.currentTarget, async () => {
        const reply = await request('TEST_TELEGRAM', { settings: telegram });
        telegramResult.textContent = `${reply.message} Automatic monitoring starts only after you enable Telegram notifications and save settings.`;
      })), actionButton('Check new projects now', event => perform(event.currentTarget, async () => {
        const state = await request('CHECK_TELEGRAM');
        onSaved(state);
        refreshStatus();
        report(state.telegram?.lastError || state.telegram?.summary || 'Project check completed.');
      }))));
      return F('div', { class: 'settings-integrations' }, telegramForm, sheetForm, backup);
    }

    return { render, refreshStatus, reset() { sheetEdit = null; telegramEdit = null; } };
  };
})();
