(function () {
  const defaults = () => ({ enabled: false, botToken: '', chatId: '', searchUrl: '' });
  function validate(settings, connection = false) {
    if (!settings || typeof settings.enabled !== 'boolean') throw Error('Invalid Telegram settings.');
    for (const key of ['botToken', 'chatId', 'searchUrl']) if (typeof settings[key] !== 'string') throw Error('Invalid Telegram settings.');
    if (settings.enabled || connection) {
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(settings.botToken)) throw Error('Enter the bot token from BotFather.');
      if (!/^-?\d+$/.test(settings.chatId)) throw Error('Enter a numeric Telegram chat ID.');
    }
    if (settings.searchUrl && !/^https:\/\/(www\.)?workana\.com\/(?:[a-z]{2}\/)?jobs(?:[/?#]|$)/.test(settings.searchUrl)) throw Error('Choose a Workana project search URL.');
    return settings;
  }
  async function send(settings, text, fetcher = fetch) {
    validate(settings, true);
    let response, result;
    try {
      response = await fetcher(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ chat_id: settings.chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } })
      });
      result = await response.json();
    } catch { throw Error('Telegram request failed. Check your connection and bot token.'); }
    if (!response.ok || result?.ok !== true) {
      const error = Error(`Telegram rejected the message (${response.status}). Check the token, chat ID, and that you started the bot.`);
      error.retryAfter = Math.max(60, Math.min(86400, Number(result?.parameters?.retry_after) || 60));
      throw error;
    }
  }
  function projectMessage(project) {
    const shown = (value, limit = 200) => String(value ?? '').trim().slice(0, limit) || 'Not shown';
    const client = project.client || {};
    const budget = project.budget || {};
    const amounts = [budget.min, budget.max].filter(Number.isFinite);
    const range = amounts.length ? [...new Set(amounts)].join(' - ') : '';
    const budgetText = budget.label || (range ? `${budget.currency && budget.currency !== 'unknown' ? budget.currency + ' ' : ''}${range}${budget.contract === 'hourly' ? ' / hr' : ''}` : '');
    const stars = Number.isFinite(client.stars) ? `${client.stars} / 5` : client.unrated === true ? '0 / 5' : 'Not shown';
    return [
      'New matching Workana project',
      `Project: ${shown(project.title, 700)}`,
      `URL: ${shown(project.url, 1000)}`,
      `Budget: ${shown(budgetText, 300)}`,
      `Skills: ${shown((project.skills || []).join(', '), 700)}`,
      '',
      `Client: ${shown(client.name)}`,
      `Country: ${shown(client.country || client.nationality || client.countryCode)}`,
      `Star score: ${stars}`,
      `Projects paid: ${Number.isFinite(client.paid) ? client.paid : 'Not shown'}`
    ].join('\n');
  }
  class Watcher {
    constructor({ storage, config, scan, inspect, eligible, fetcher }) {
      Object.assign(this, { storage, config, scan, inspect, eligible, fetcher });
      this.pending = null;
    }
    async state() {
      return { settings: defaults(), ...(await this.storage.get('telegram')).telegram };
    }
    tick() {
      if (!this.pending) this.pending = this.poll().catch(async error => {
        const state = await this.state();
        await this.storage.set({ telegram: { ...state, lastError: String(error.message).replaceAll(state.settings.botToken || '\0', '[token]'), retryAt: Date.now() + (error.retryAfter || 60) * 1000 } });
      }).finally(() => { this.pending = null; });
      return this.pending;
    }
    async poll() {
      let state = await this.state();
      if (!state.settings.enabled || state.retryAt > Date.now()) return;
      const generation = state.generation;
      const settings = state.settings;
      const config = await this.config();
      const projects = await this.scan(settings, config);
      // A first successful search establishes the baseline, without sending old cards.
      if (!state.baseline) {
        const current = await this.state();
        if (current.generation !== generation) return;
        await this.storage.set({ telegram: { ...current, baseline: true, seen: Object.fromEntries(projects.map(p => [p.id, true])), lastCheckAt: Date.now(), lastError: '' } });
        return;
      }
      for (const candidate of projects) {
        state = await this.state();
        if (!state.settings.enabled || state.generation !== generation) return;
        if (state.seen?.[candidate.id]) continue;
        // Missing details are retried on the next poll; never assume eligibility.
        const project = await this.inspect(candidate);
        const freshConfig = await this.config();
        const verdict = this.eligible(project, freshConfig);
        if (verdict.state === 'waiting') continue;
        const current = await this.state();
        if (!current.settings.enabled || current.generation !== generation) return;
        if (verdict.state === 'pass' && (!Number.isFinite(project.publishedAt) || project.publishedAt >= state.startedAt || (project.publishedPrecision === 'relative' && project.publishedLatestAt >= state.startedAt))) {
          await send(settings, projectMessage(project), this.fetcher);
        }
        await this.storage.set({ telegram: { ...current, seen: { ...current.seen, [candidate.id]: true }, lastError: '', lastCheckAt: Date.now() } });
      }
      state = await this.state();
      if (state.generation === generation) await this.storage.set({ telegram: { ...state, lastCheckAt: Date.now(), lastError: '' } });
    }
    async action(message) {
      validate(message.settings, message.kind === 'TEST_TELEGRAM');
      if (message.kind === 'TEST_TELEGRAM') {
        await send(message.settings, 'Workana notifications connected. New projects matching your saved filters will appear here.', this.fetcher);
        return { message: 'Test notification sent.' };
      }
      // Serialize saves against polling so a completed send cannot overwrite edits.
      if (this.pending) await this.pending;
      const previous = await this.state();
      const settings = Object.fromEntries(Object.keys(defaults()).map(k => [k, typeof message.settings[k] === 'string' ? message.settings[k].trim() : message.settings[k]]));
      validate(settings);
      const reset = !previous.settings.enabled || previous.settings.searchUrl !== settings.searchUrl || previous.settings.chatId !== settings.chatId || previous.settings.botToken !== settings.botToken;
      await this.storage.set({ telegram: { ...previous, settings, generation: (previous.generation || 0) + 1, retryAt: 0, lastError: '', ...(reset ? { baseline: false, seen: {}, startedAt: Date.now() } : {}) } });
      void this.tick();
    }
  }
  globalThis.WorkanaTelegram = { defaults, validate, send, Watcher };
})();
