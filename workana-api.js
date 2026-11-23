(function () {
  const hosts = new Set(['www.workana.com', 'workana.com']);
  function searchUrl(value, base) {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || !/^\/(?:[a-z]{2}\/)?jobs\/?$/.test(url.pathname)) throw Error('Choose a valid Workana project search.');
    url.hash = '';
    url.searchParams.delete('_wstudio_check');
    url.searchParams.set('page', '1');
    return url.href;
  }
  function projectUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      const match = url.pathname.match(/^\/(?:[a-z]{2}\/)?job\/([^/]+)\/?$/);
      if (!match || url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password) return null;
      url.search = ''; url.hash = '';
      return { id: decodeURIComponent(match[1]), url: url.href };
    } catch { return null; }
  }
  const first = (...values) => values.find(v => v !== null && v !== undefined && v !== '');
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
    return Number(value.replace(',', '.'));
  }
  const boolean = value => value === true || value === 'true' || value === '1' || value === 1 ? true : value === false || value === 'false' || value === '0' || value === 0 ? false : null;
  function publication(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const stamp = value < 1e12 ? value * 1000 : value;
      return stamp > 946684800000 && stamp < Date.now() + 86400000 ? { publishedAt: stamp, publishedPrecision: 'exact', publishedLabel: new Date(stamp).toISOString() } : {};
    }
    if (typeof value !== 'string') return {};
    const text = value.trim();
    if (/^\d{10}(?:\d{3})?$/.test(text)) return publication(Number(text));
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) && Number.isFinite(Date.parse(text))) return { publishedAt: Date.parse(text), publishedPrecision: 'exact', publishedLabel: text };
    const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T]\d{2}:\d{2})/)?.[1];
    if (dateOnly && Number.isFinite(Date.parse(dateOnly)) && new Date(dateOnly).toISOString().slice(0,10) === dateOnly) return { publishedAt: Date.parse(dateOnly), publishedPrecision: 'day', publishedLabel: text };
    const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const relative = normalized.match(/(\d+)\s*(seconds?|segundos?|minutes?|minutos?|hours?|horas?|days?|dias?)/);
    if (relative) {
      const unit = /second|segundo/.test(relative[2]) ? 1000 : /minute|minuto/.test(relative[2]) ? 60000 : /hour|hora/.test(relative[2]) ? 3600000 : 86400000;
      const now = Date.now(), count = Number(relative[1]);
      return { publishedAt: now - (count + 1) * unit, publishedLatestAt: now - count * unit, publishedPrecision: 'relative', publishedLabel: text };
    }
    if (/just now|a moment|moments ago|agora|hace un momento|less than a minute/.test(normalized)) return { publishedAt: Date.now() - 60000, publishedLatestAt: Date.now(), publishedPrecision: 'relative', publishedLabel: text };
    const months = ['january|enero|janeiro|janvier|januar','february|febrero|fevereiro|fevrier|februar','march|marzo|marco|mars|marz','april|abril|avril','may|mayo|maio|mai','june|junio|junho|juin|juni','july|julio|julho|juillet|juli','august|agosto|aout','september|septiembre|setembro|septembre','october|octubre|outubro|octobre|oktober','november|noviembre|novembro|novembre','december|diciembre|dezembro|decembre|dezember'];
    const year = Number(normalized.match(/\b(20\d{2})\b/)?.[1]);
    if (year) for (let month=0;month<months.length;month++) {
      const match = new RegExp(`\\b(?:${months[month]})\\b`).exec(normalized);
      if (!match) continue;
      const before = normalized.slice(0,match.index), after = normalized.slice(match.index + match[0].length);
      const day = Number(before.match(/(\d{1,2})(?:\s+de)?\s*$/)?.[1] || after.match(/^\s*(\d{1,2})(?:st|nd|rd|th)?(?=\s*,|\s+20\d{2})/)?.[1]);
      if (day < 1 || day > 31 || !day) continue;
      const stamp = Date.UTC(year,month,day), date = new Date(stamp);
      if (date.getUTCFullYear()===year && date.getUTCMonth()===month && date.getUTCDate()===day) return { publishedAt: stamp, publishedPrecision: 'day', publishedLabel: text };
    }
    return { publishedLabel: text };
  }
  function canonicalRow(row, base, parseBudget) {
    if (!row || typeof row !== 'object') return null;
    row = row.node || row;
    const slug = first(row.slug, row.project_slug, row.job_slug);
    const identity = projectUrl(first(row.url, row.jobUrl, row.project_url, row.permalink, typeof slug === 'string' ? '/job/' + encodeURIComponent(slug) : null), base);
    const title = first(row.title, row.name);
    if (!identity || typeof title !== 'string' || !title.trim()) return null;
    const owner = first(row.client, row.author, row.employer) || {};
    const country = first(owner.country, owner.location?.country);
    const projectCountry = first(row.country, row.location?.country);
    const rating = number(first(owner.stars, owner.rating?.average, owner.rating?.score, owner.rating, owner.score));
    const category = first(row.category?.slug, row.category_slug, row.category?.name, typeof row.category === 'string' ? row.category : null);
    const published = publication(first(row.published_at, row.publishedAt, row.datePosted, row.datePublished, row.published_date, row.publication_date, row.publishedDate, row.postedDate, row.published));
    const skills = first(row.skills, row.required_skills, row.tags) || [];
    const rawBudget = first(row.budget?.label, row.budget_label, row.budgetLabel, typeof row.budget === 'string' ? row.budget : null);
    const budget = parseBudget && rawBudget ? parseBudget(rawBudget) : row.budget && typeof row.budget === 'object' ? row.budget : { label: rawBudget || '' };
    return {
      ...identity, title: title.trim(), description: String(first(row.description, row.description_text) || '').slice(0, 24000), category: category || '',
      skills: Array.isArray(skills) ? skills.map(s => typeof s === 'string' ? s : first(s.name, s.title, s.slug)).filter(s => typeof s === 'string') : [], budget,
      country: typeof projectCountry === 'string' ? projectCountry : first(projectCountry?.name, projectCountry?.label) || '',
      countryCode: first(row.country_code, row.countryCode, projectCountry?.code) || '',
      lastReply: first(row.last_reply_label, row.lastReplyLabel, row.last_reply_at, row.lastReplyAt, typeof row.lastReply === 'string' ? row.lastReply : null) || '',
      bids: number(first(row.bids_count, row.bid_count, row.bidsCount, row.proposals_count, row.proposalsCount, row.bids)),
      interested: number(first(row.interested_count, row.interestedCount, row.interested)),
      publishedAt: null, publishedPrecision: 'unknown', ...published,
      client: {
        name: first(owner.name, owner.display_name, owner.displayName, owner.initials) || '',
        country: typeof country === 'string' ? country : first(country?.name, country?.label) || '',
        countryCode: first(owner.country_code, owner.countryCode, country?.code) || '',
        stars: rating, unrated: rating === 0 || owner.unrated === true ? true : rating !== null ? false : null,
        verified: boolean(first(owner.verified_payment, owner.hasVerifiedPaymentMethod, owner.payment_verified, owner.paymentVerified)),
        published: number(first(owner.published_projects, owner.publishedProjects, owner.published)),
        paid: number(first(owner.paid_projects, owner.paidProjects, owner.paid)),
        registeredAt: first(owner.registered_at, owner.registeredAt, owner.member_since, owner.memberSince, owner.joined_at, owner.joinedAt) || null
      },
      closed: ['closed', 'cancelled', 'canceled', 'completed'].includes(String(row.status || '').toLowerCase()),
      publicationSource: 'Workana response'
    };
  }
  function mergeEvidence(fallback, preferred) {
    const fields = Object.entries(preferred || {}).filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length));
    return { ...fallback, ...Object.fromEntries(fields) };
  }
  function parseResponse(text, options) {
    const { url, parseHTML, parseBudget } = options;
    let json;
    try { json = JSON.parse(text); } catch {}
    const projects = new Map(), html = [], lists = [];
    function visit(value, depth = 0, key = '') {
      if (depth > 9 || value === null || value === undefined) return;
      if (typeof value === 'string') {
        if (value.length < 4000000 && /<(?:a|article|div|section|main)\b/i.test(value) && (options.project === true || /\/job\/|no-results|empty-results|data-no-results/.test(value))) html.push(value);
        return;
      }
      if (Array.isArray(value)) {
        if (/^(?:projects|jobs|results|items|nodes|edges|data)$/.test(key)) lists.push(value);
        for (const item of value.slice(0, 1000)) visit(item, depth + 1);
        return;
      }
      if (typeof value !== 'object') return;
      const project = canonicalRow(value, url, parseBudget);
      if (project) projects.set(project.id, project);
      for (const [name, item] of Object.entries(value).slice(0, 100)) {
        if (['client', 'author', 'employer', 'skills', 'tags', 'related_projects', 'recommended_projects'].includes(name)) continue;
        visit(item, depth + 1, name);
      }
    }
    if (json !== undefined) visit(json);
    else html.push(text);
    if (options.project && !projects.size && json && typeof json === 'object') {
      const row = first(json.project, json.job, json.data?.project, json.data?.job, json.data, json);
      if (row && typeof row === 'object' && !first(row.slug, row.project_slug, row.job_slug, row.url, row.jobUrl, row.project_url, row.permalink)) {
        const project = canonicalRow({ ...row, url }, url, parseBudget);
        if (project) projects.set(project.id, project);
      }
    }
    let empty = Array.isArray(json) && json.length === 0, nextPage = null;
    for (const fragment of html) {
      if (!parseHTML) continue;
      const result = parseHTML(fragment, url);
      for (const project of result.projects || []) {
        const existing = projects.get(project.id);
        if (!existing) {
          projects.set(project.id, project);
          continue;
        }
        const merged = mergeEvidence(project, existing);
        merged.closed = project.closed || existing.closed;
        merged.client = mergeEvidence(project.client, existing.client);
        if (!Number.isFinite(existing.publishedAt) && Number.isFinite(project.publishedAt)) {
          for (const field of ['publishedAt', 'publishedPrecision', 'publishedLatestAt', 'publishedLabel']) merged[field] = project[field];
        }
        projects.set(project.id, merged);
      }
      empty ||= result.empty === true;
      nextPage ||= result.nextPage || null;
    }
    empty ||= lists.some(list => list.length === 0);
    if (!projects.size && !empty) throw Error('Workana search request returned no recognizable project data. Refresh Workana once and select the saved search so its native search request can be learned.');
    const next = first(json?.next_page_url, json?.links?.next, json?.pagination?.next, json?.data?.next_page_url, json?.data?.links?.next);
    if (typeof next === 'string' && next) nextPage = next;
    if (nextPage) nextPage = new URL(nextPage, options.requestUrl || url).href;
    return { kind: 'list', projects: [...projects.values()], source: 'Workana search HTTP/API request', empty, nextPage };
  }
  function isVerificationTitle(title) {
    return /^(?:just a moment\b|attention required\b|access denied\b|captcha(?:\s+verification)?(?:$|\s*[-|])|security (?:check|verification)\b|verify (?:you are|that you are)\b|(?:workana\s*[-|]\s*)?(?:sign in|log in|login)(?:$|\s*[-|]|\s+to\s+workana\b))/i.test(title.trim());
  }
  function recognizable(text, base) {
    try { const parsed = parseResponse(text, { url: base }); return parsed.projects.length > 0 || parsed.empty === true; }
    catch {
      function containsCards(value, depth = 0) {
        if (depth > 9 || !value) return false;
        if (typeof value === 'string') return [...value.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*\/job\/[^"']*)["']/gi)].some(match => !!projectUrl(match[1], base));
        if (Array.isArray(value)) return value.slice(0, 1000).some(item => containsCards(item, depth + 1));
        if (typeof value === 'object') return Object.values(value).slice(0, 100).some(item => containsCards(item, depth + 1));
        return false;
      }
      try { return containsCards(JSON.parse(text)); } catch { return containsCards(text); }
    }
  }
  globalThis.WorkanaSearchAPI = { searchUrl, projectUrl, publication, parseResponse, recognizable, isVerificationTitle };
})();
