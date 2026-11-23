(function () {
  const defaults = () => ({ enabled: false, botToken: '', chatId: '' });
  function validate(settings, connection = false) {
    if (!settings || typeof settings.enabled !== 'boolean') throw Error('Invalid Telegram settings.');
    for (const key of ['botToken', 'chatId']) if (typeof settings[key] !== 'string') throw Error('Invalid Telegram settings.');
    if (settings.enabled || connection) {
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(settings.botToken)) throw Error('Enter the bot token from BotFather.');
      if (!/^-?\d+$/.test(settings.chatId)) throw Error('Enter a numeric Telegram chat ID.');
    }
    return settings;
  }
  async function findChats(botToken, fetcher = fetch) {
    botToken = String(botToken || '').trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw Error('Enter the bot token from BotFather first.');
    let response, result;
    try {
      response = await fetcher(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000), body: JSON.stringify({ timeout: 10, limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] })
      });
      result = await response.json();
    } catch { throw Error('Could not reach Telegram. Check your connection and bot token.'); }
    if (response.status === 409) throw Error('This bot is connected to another app or webhook. Use a dedicated bot for this extension, or enter the chat ID manually.');
    if (response.status === 401 || response.status === 404) throw Error('Telegram rejected this bot token. Copy the full token from BotFather and try again.');
    if (!response.ok || result?.ok !== true || !Array.isArray(result.result)) throw Error('Telegram could not find chats. Check the bot token and try again.');
    const chats = new Map();
    for (const update of result.result) {
      const chat = (update.message || update.edited_message || update.channel_post || update.edited_channel_post || update.my_chat_member)?.chat;
      if (!chat || !Number.isSafeInteger(chat.id) || !['private', 'group', 'supergroup', 'channel'].includes(chat.type)) continue;
      const id = String(chat.id);
      chats.set(id, { id, name: String(chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || id).slice(0, 200), type: chat.type });
    }
    if (!chats.size) throw Error('No chat found yet. Open your bot in Telegram, send it a new message such as hello, then click Find my chat ID again. For a group, send /start@YourBotUsername in that group.');
    return { chats: [...chats.values()] };
  }
  async function send(settings, text, fetcher = fetch, replyMarkup) {
    validate(settings, true);
    let response, result;
    try {
      response = await fetcher(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ chat_id: settings.chatId, text: text.slice(0, 4000), reply_markup: replyMarkup, link_preview_options: { is_disabled: true } })
      });
      result = await response.json();
    } catch { throw Error('Telegram request failed. Check your connection and bot token.'); }
    if (!response.ok || result?.ok !== true) {
      const error = Error(`Telegram rejected the message (${response.status}). Check the token, chat ID, and that you started the bot.`);
      error.retryAfter = Math.max(60, Math.min(86400, Number(result?.parameters?.retry_after) || 60));
      throw error;
    }
  }
  function publishedAge(project, now = Date.now()) {
    const timestamp = project.publishedPrecision === 'relative' && Number.isFinite(project.publishedLatestAt) ? project.publishedLatestAt : project.publishedAt;
    if (!Number.isFinite(timestamp)) return 'Not shown';
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  function publishedTime(project) {
    if (!Number.isFinite(project.publishedAt)) return 'Not provided by Workana';
    if (project.publishedPrecision === 'exact') return new Date(project.publishedAt).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    if (project.publishedPrecision === 'day') return new Date(project.publishedAt).toISOString().slice(0, 10) + ' (exact time not provided by Workana)';
    return 'Exact time not provided by Workana (relative age only)';
  }
  function publicationDisplay(project, now) {
    if (!Number.isFinite(project.publishedAt)) return '—';
    if (project.publishedPrecision === 'exact') return publishedTime(project);
    if (project.publishedPrecision === 'day') {
      return new Date(project.publishedAt).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    return 'about ' + publishedAge(project, now);
  }
  function calendarBounds(project) {
    // A calendar date without a timezone can span UTC-12 through UTC+14.
    const hour = 3600000;
    return { earliest: project.publishedAt - 14 * hour, end: project.publishedAt + 36 * hour };
  }
  function selectPublication(candidate, details) {
    const rank = project => !Number.isFinite(project?.publishedAt) ? 0 : ({ exact: 3, relative: 2, day: 1 }[project.publishedPrecision] || 0);
    let source = rank(details) >= rank(candidate) && rank(details) > 0 ? details : candidate;
    const other = source === candidate ? details : candidate;
    if (source.publishedPrecision === 'relative' && other?.publishedPrecision === 'day' && Number.isFinite(other.publishedAt)) {
      const { earliest, end } = calendarBounds(other);
      if (source.publishedLatestAt < earliest || source.publishedAt >= end) source = other;
    }
    return { publishedAt: source.publishedAt, publishedPrecision: source.publishedPrecision, publishedLatestAt: source.publishedLatestAt, publishedLabel: source.publishedLabel };
  }
  function registrationDate(value) {
    const day = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/)?.[1];
    if (!day) return null;
    const date = new Date(day);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date : null;
  }
  function notificationEligibility(project, config, projectFilter) {
    const verdict = projectFilter(project, config);
    if (verdict.state !== 'pass') return verdict;
    if (config.project?.excludeSkills?.length && !project.skills?.length) {
      return { state: 'waiting', stage: 'project', issues: ['Project skills are unavailable for the exclusion check.'] };
    }

    const client = project.client || {};
    const rating = Number.isFinite(client.stars) && client.stars >= 0 && client.stars <= 5 ? client.stars : client.unrated === true ? 0 : null;
    const joined = registrationDate(client.registeredAt);
    const criteria = [
      ['rating', rating === null ? null : rating > 3],
      ['payment verification', typeof client.verified === 'boolean' ? client.verified : null],
      ['join date', joined && joined.getTime() <= Date.now() ? joined.getUTCFullYear() < 2024 : null]
    ];
    const matched = criteria.filter(([, passed]) => passed === true).map(([name]) => name);
    if (matched.length) return { state: 'pass', stage: 'client', issues: [], matched };

    const missing = criteria.filter(([, passed]) => passed === null).map(([field]) => field);
    return missing.length
      ? { state: 'waiting', stage: 'client', issues: [`No client criterion confirmed yet. Unavailable: ${missing.join(', ')}.`] }
      : { state: 'fail', stage: 'client', issues: ['Client meets none of the notification criteria.'] };
  }
  function projectMessage(project, { now } = {}) {
    const shown = (value, limit = 200) => String(value ?? '').trim().slice(0, limit) || '—';
    const count = value => Number.isFinite(value) ? value : '—';
    const client = project.client || {};
    const country = (name, code) => {
      const region = String(code || '').toUpperCase();
      const flag = /^[A-Z]{2}$/.test(region) ? String.fromCodePoint(...[...region].map(letter => 127397 + letter.charCodeAt(0))) : '';
      return [flag, shown(name || region)].filter(Boolean).join(' ');
    };
    const budget = project.budget || {};
    const amounts = [...new Set([budget.min, budget.max].filter(Number.isFinite))];
    const budgetText = budget.label || (amounts.length ? `${budget.currency && budget.currency !== 'unknown' ? budget.currency + ' ' : ''}${amounts.join(' - ')}${budget.contract === 'hourly' ? ' / hr' : ''}` : '');
    const stars = Number.isFinite(client.stars) ? client.stars : client.unrated === true ? 0 : null;
    const joined = registrationDate(client.registeredAt);
    const memberSince = joined ? joined.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
    return [
      '🆕 New Workana job',
      '',
      shown(project.title, 700),
      `💰 ${shown(budgetText, 300)}`,
      `📅 Posted: Published: ${publicationDisplay(project, now)} · 💬 Last reply: ${shown(project.lastReply)}${project.country || project.countryCode ? ' · ' + country(project.country, project.countryCode) : ''}`,
      `🛠️ ${shown((project.skills || []).join(', '), 700)}`,
      'Client',
      `👤 ${shown(client.name)} · ⭐ ${stars === null ? '—' : stars.toFixed(stars % 1 === 0 ? 1 : 2).replace(/(\.\d)0$/, '$1') + '/5'} · ${country(client.country || client.nationality, client.countryCode)}`,
      `📊 ${count(client.published)} published · ${count(client.paid)} paid`,
      `📅 Member since: ${memberSince}`,
      `📈 ${count(project.bids)} bids · ${count(project.interested)} interested`,
      ...(project.url?.length > 256 ? [project.url] : []),
    ].join('\n');
  }
  function projectKeyboard(url) {
    if (!url) return undefined;
    const buttons = [{ text: 'Open job ↗️', url }];
    if (url.length <= 256) buttons.push({ text: '📋 Copy link', copy_text: { text: url } });
    return { inline_keyboard: [buttons] };
  }
  function publishedSince(project, startedAt) {
    if (!Number.isFinite(project.publishedAt)) return null;
    if (!Number.isFinite(startedAt)) return false;
    if (project.publishedPrecision === 'day') {
      const { earliest, end } = calendarBounds(project);
      if (earliest >= startedAt) return true;
      return end <= startedAt ? false : null;
    }
    if (project.publishedAt > Date.now()) return null;
    if (project.publishedAt >= startedAt) return true;
    if (project.publishedPrecision === 'relative') {
      return Number.isFinite(project.publishedLatestAt) && project.publishedLatestAt < startedAt ? false : null;
    }
    return false;
  }
  function filterFingerprint(config) {
    return JSON.stringify([4, config.search, config.project]);
  }
  class Watcher {
    constructor({ storage, config, scan, inspect, eligible, fetcher }) {
      Object.assign(this, { storage, config, scan, inspect, eligible, fetcher });
      this.pending = null;
    }
    async state() {
      return { settings: defaults(), ...(await this.storage.get('telegram')).telegram };
    }
    async remember(project, result, reason, generation, updates = {}) {
      const state = await this.state();
      if (state.generation !== generation || !state.settings.enabled) return false;
      const entry = { id: project.id, title: String(project.title || project.id).slice(0, 300), result, reason: String(reason || '').slice(0, 600), at: Date.now(), publishedLabel: String(project.publishedLabel || '').slice(0, 150) };
      await this.storage.set({ telegram: { ...state, ...updates, recentChecks: [entry, ...(state.recentChecks || []).filter(p => p.id !== project.id)].slice(0, 30) } });
      return true;
    }
    tick() {
      if (!this.pending) this.pending = this.poll().catch(async error => {
        const state = await this.state();
        const lastError = String(error.message).replaceAll(state.settings.botToken || '\0', '[token]');
        let verificationAlertSent = state.verificationAlertSent;
        let verificationAlertError = '';
        let retryAfter = error.retryAfter || 60;
        const verificationRequired = /^(?:Workana requires verification\b|Sign in to Workana and complete its verification\b|Workana returned a (?:sign-in or )?verification page instead of search data\b)/i.test(lastError);
        if (state.settings.enabled && verificationRequired && !verificationAlertSent) {
          try {
            await send(state.settings, 'Workana project alerts are paused because Workana requested verification. Open your signed-in Workana tab and complete any verification shown. The extension will retry automatically.', this.fetcher);
            verificationAlertSent = true;
          } catch (deliveryError) {
            verificationAlertError = ' Could not send the Telegram verification alert. Delivery will be retried.';
            retryAfter = Math.max(retryAfter, deliveryError.retryAfter || 0);
          }
        }
        await this.storage.set({ telegram: { ...state, verificationAlertSent, summary: 'Project check interrupted.', lastError: lastError + verificationAlertError, retryAt: Date.now() + retryAfter * 1000 } });
      }).finally(() => { this.pending = null; });
      return this.pending;
    }
    async poll() {
      let state = await this.state();
      if (!state.settings.enabled || state.retryAt > Date.now()) return;
      const generation = state.generation;
      if (!Number.isFinite(state.startedAt)) state.startedAt = Date.now();
      const settings = state.settings;
      await this.storage.set({ telegram: { ...state, lastAttemptAt: Date.now(), lastError: '', discoveryWarning: '', discoverySource: '', searchEndpoint: '', summary: 'Requesting fresh Workana search results now...' } });
      const config = await this.config();
      const scan = await this.scan(settings, config);
      const projects = Array.isArray(scan) ? scan : scan?.projects;
      if (!Array.isArray(projects)) throw Error('Workana did not return a readable project list.');
      const scannedState = await this.state();
      if (scannedState.generation !== generation) return;
      await this.storage.set({ telegram: { ...scannedState, verificationAlertSent: false, discoveryWarning: Array.isArray(scan) ? '' : scan.warning || '', discoverySource: Array.isArray(scan) ? '' : scan.source || '', searchEndpoint: Array.isArray(scan) ? '' : scan.endpoint || '' } });
      // Seed only projects that were already present when monitoring began.
      // A delayed first successful scan must still deliver newer publications.
      const searchScope = Array.isArray(scan) ? undefined : scan.scope;
      const scopeChanged = searchScope && state.searchScope !== searchScope;
      if (!state.baseline || scopeChanged) {
        const current = await this.state();
        if (current.generation !== generation) return;
        const existing = projects.filter(p => publishedSince(p, state.startedAt) !== true);
        await this.storage.set({ telegram: { ...current, baseline: true, searchScope, seen: { ...current.seen, ...Object.fromEntries(existing.map(p => [p.id, true])) }, lastCheckAt: Date.now(), lastError: '', summary: `Baseline ready: ${existing.length} existing projects. Watching for new projects.`, recentChecks: existing.slice(0, 30).map(p => ({ id: p.id, title: String(p.title || p.id).slice(0, 300), result: 'baseline', reason: 'Present before monitoring started, or publication time unavailable on the initial scan.', at: Date.now(), publishedLabel: p.publishedLabel || '' })) } });
        if (existing.length === projects.length) return;
      }
      let sent = 0, filtered = 0, waiting = 0, alreadySeen = 0, older = 0;
      let optionalDetailsUnavailable = 0;
      const failures = [], reasons = new Set();
      for (const candidate of projects) {
        state = await this.state();
        if (!state.settings.enabled || state.generation !== generation) return;
        if (state.seen?.[candidate.id]) { alreadySeen++; continue; }
        const fingerprint = filterFingerprint(await this.config());
        const rejected = state.rejected?.[candidate.id];
        if (rejected?.fingerprint === fingerprint && rejected.retryAt > Date.now()) { filtered++; continue; }
        if (publishedSince(candidate, state.startedAt) === false) {
          older++;
          await this.remember(candidate, 'older', 'Search response proves this was published before monitoring started.', generation, { seen: { ...state.seen, [candidate.id]: true } });
          continue;
        }
        // A project-page request is enrichment, not an unconditional gate. Search
        // evidence may already prove every enabled filter and the publication time.
        const preConfig = await this.config();
        const preVerdict = this.eligible(candidate, preConfig);
        const owner = candidate.client || {};
        const complete = candidate.publishedPrecision === 'exact' && owner.name && (owner.country || owner.countryCode) && Number.isFinite(owner.stars) && Number.isFinite(owner.paid) && Number.isFinite(owner.published) && owner.registeredAt && candidate.skills?.length && candidate.budget?.label && Number.isFinite(candidate.bids) && Number.isFinite(candidate.interested);
        let project = candidate, detailError = '';
        if (preVerdict.state !== 'fail' && (preVerdict.state !== 'pass' || !complete)) {
          try { project = await this.inspect(candidate); }
          catch (error) { detailError = String(error.message || 'Details unavailable').replaceAll(settings.botToken || '\0', '[token]').slice(0, 250); }
        }
        const freshConfig = await this.config();
        const client = { ...project.client };
        for (const key of ['verified', 'registeredAt']) {
          if (client[key] == null || client[key] === '') client[key] = candidate.client?.[key];
        }
        if (!Number.isFinite(client.stars) && client.unrated !== true) {
          client.stars = candidate.client?.stars;
          client.unrated = candidate.client?.unrated;
        }
        project = { ...project, client };
        const verdict = this.eligible(project, freshConfig);
        if (detailError && (verdict.state !== 'pass' || publishedSince(project, state.startedAt) !== true)) {
          const reason = `${detailError} Required evidence: ${(verdict.issues || []).join(' ') || 'publication time'}`;
          failures.push(`Project ${candidate.id}: ${reason}`);
          await this.remember(candidate, 'retry', reason, generation);
          continue;
        }
        if (detailError) optionalDetailsUnavailable++;
        if (verdict.state === 'waiting') { waiting++; for (const issue of verdict.issues || []) reasons.add(issue); await this.remember(project, 'waiting', (verdict.issues || []).join(' '), generation); continue; }
        if (verdict.state === 'fail') {
          filtered++; for (const issue of verdict.issues || []) reasons.add(issue);
          const current = await this.state();
          await this.remember(project, 'filtered', (verdict.issues || []).join(' '), generation, { rejected: { ...current.rejected, [project.id]: { fingerprint: filterFingerprint(freshConfig), retryAt: Date.now() + 300000 } } });
          continue;
        }
        const current = await this.state();
        if (!current.settings.enabled || current.generation !== generation) return;
        const recency = publishedSince(project, state.startedAt);
        if (recency === null) {
          waiting++;
          await this.remember(project, 'waiting', 'Workana publication time does not confirm this project was posted after monitoring began.', generation);
          continue;
        }
        if (recency === true) {
          await send(settings, projectMessage(project), this.fetcher, projectKeyboard(project.url));
          sent++;
          const match = verdict.matched?.length ? ` Client matched: ${verdict.matched.join(', ')}.` : '';
          await this.remember(project, 'notified', `Telegram confirmed delivery.${match} Published: ${publicationDisplay(project)}`, generation, { seen: { ...current.seen, [project.id]: true }, lastNotificationAt: Date.now() });
          continue;
        }
        older++;
        await this.remember(project, 'older', 'Published before monitoring started.', generation, { seen: { ...current.seen, [candidate.id]: true } });
      }
      state = await this.state();
      if (state.generation === generation) await this.storage.set({ telegram: { ...state, lastCheckAt: Date.now(), lastError: failures.join(' ').slice(0, 500), summary: `Checked ${projects.length} projects: ${sent} notified, ${filtered} filtered out, ${waiting} waiting for details, ${failures.length} required-detail errors, ${alreadySeen} already seen, ${older} published before monitoring started.${optionalDetailsUnavailable ? ` ${optionalDetailsUnavailable} matched using search evidence despite unavailable optional details.` : ''}${reasons.size ? ' ' + [...reasons].join(' ').slice(0, 500) : ''}`, ...(sent ? { lastNotificationAt: Date.now() } : {}) } });
    }
    async action(message) {
      if (message.kind === 'FIND_TELEGRAM_CHATS') return findChats(message.settings?.botToken, this.fetcher);
      if (message.kind === 'CHECK_TELEGRAM') {
        if (this.pending) await this.pending;
        const state = await this.state();
        if (!state.settings.enabled) throw Error('Enable Telegram notifications and save settings before checking for projects.');
        await this.storage.set({ telegram: { ...state, retryAt: 0 } });
        await this.tick();
        return;
      }
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
      const reset = !previous.settings.enabled || previous.settings.chatId !== settings.chatId || previous.settings.botToken !== settings.botToken;
      await this.storage.set({ telegram: { ...previous, settings, generation: (previous.generation || 0) + 1, retryAt: 0, lastError: '', ...(reset ? { baseline: false, verificationAlertSent: false, seen: {}, rejected: {}, recentChecks: [], startedAt: Date.now() } : {}) } });
      void this.tick();
    }
  }
  globalThis.WorkanaTelegram = { defaults, validate, send, findChats, notificationEligibility, publishedAge, publishedTime, selectPublication, projectMessage, Watcher };
})();
