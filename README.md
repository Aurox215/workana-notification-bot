# Workana Proposal Studio — Chrome extension 1.17.0

## 1.17.0 - Google Sheets bid log and JSON settings backups

- Settings now includes Google Sheets logging for confirmed bids, using the screenshot columns and Japan time (Asia/Tokyo). The default tab is Juberu. Delivery failures stay in a persistent retry queue, and hidden bid IDs prevent duplicate rows.
- Import and export all saved settings as JSON, with an option to include the OpenAI API key and restore its storage preference.
- Templates uses a single Proposal prompt instead of point count, icons and word-limit controls. The description language controls proposal language.
- Reload the extension and refresh Workana. Follow [GOOGLE-SHEETS-SETUP.md](GOOGLE-SHEETS-SETUP.md) to deploy the included receiver and connect your spreadsheet.
- Validation: `node --test *.test.cjs`; optional isolated Chromium check: `node browser-smoke.cjs`.


## 1.16.3 — IT-only feed and persistent search recovery

The reported installation was 1.16.1 with saved search **IT**. That build required both IT & Programming and Design & Multimedia to verify every named feed, so IT-only results could remain blocked with “search not verified”. This update verifies IT, Design and IT & Design against their own categories and keeps native saved-feed settings authoritative.

- Feed selections reset by a Workana rerender are retried up to three times within a bounded check. An open saved-search menu is left open while its choices load.
- Three consecutive transient failures replace only the inactive scanner. The active run, original activation time, Bid Limit count, submitted ledger, drafts, reservations and bid tabs are retained. Missing or incorrect saved-feed configuration remains blocked and is shown explicitly.
- Discarded, frozen or persistently loading search tabs are reloaded. A dashboard synchronization failure is reported separately and no longer blocks a scanner that has independently verified the configured feed.
- The exact failed-search reason remains visible during retries and clears after a successful verified scan. The header now displays the loaded extension version so a still-running old installation can be identified.
- Existing bright styling, manual/automatic bidding, two parallel submissions, portfolio restrictions, template, click-to-stop scrolling and duplicate safeguards remain in place.

Validation includes 296 regression tests, IT-only native UI checks, three injected scanner failures in real Chrome, a simulated 26-hour active run, full local submission workflows and Chrome service-worker restart recovery. The 26-hour check is accelerated simulation, not a claim that this release has already run for a real day. Test submissions and provider calls use local fixtures only.

After replacing files in the existing installed folder, Reload that extension in chrome://extensions and refresh Workana. Confirm **v1.17.0** in the panel header before starting Auto-Bid. Merely downloading or extracting a ZIP does not replace an already loaded content script.



## 1.16.2 — Saved-feed synchronization, smooth scrolling and bright interface

- Fixed the screenshot configuration where current-filter mode ignored a populated saved-search name. Existing configurations with a name now select that named feed. The mode checkbox and name field stay consistent while editing.
- A configured native feed is applied to both the visible search page and the background scanner. The extension uses Workana's own dropdown and preserves the feed's language/country settings. Missing or unsettled searches remain blocked; concurrent project/question tabs are never used for search navigation.
- Replaced 350 ms-separated instant jumps with 650 ms animated scroll segments and a 120 ms settling pause. The inactive scanner uses authorized worker timers to avoid Chrome's background-page timer throttling. Cards are still discovered before the scrolling pass completes. Scrolling continues down from the current position instead of jumping to the top.
- Physical clicks stop an active pass on the page, in the extension iframe or in another Workana tab. The page cancels its own animation immediately, and the worker cancels the scanner. Turning the setting off preserves scrolling. Cancellation does not disable Auto-Bid; the next scheduled check still runs.
- Added a bright interface with solid surfaces, readable slate text, violet actions, clearer selected tabs, input focus indicators, updated spacing and scrollbars. The update selects Day Mode once. Later Day/Night, opacity and font choices remain saved; existing bidding controls and draggable compact modes remain available.
- Portfolio authorization, matching, the single original template, Bid Limit, filters, duplicate protection, two parallel bid workflows and receipt checks remain in place.

Validation: 289 extension tests, TypeScript and lint checks, isolated real-Chrome feed/scroll tests, the full local bidding workflow, and a production-package load check. Browser fixtures use a fake provider and local projects; no live bids are submitted by these checks.



Runs in Chrome with your OpenAI API key and no application backend. Sign in to Workana before using it.

## Install or update

Extract `Workana File 1.zip` to a permanent folder. In `chrome://extensions`, enable Developer mode and use **Load unpacked** on the folder containing `manifest.json`.

For an update, replace files in the **same installed folder**, Reload the existing extension card, and refresh Workana. Check **1.17.0** on the extension card in Chrome. Templates, rules, portfolio entries, remembered keys, dashboard records and submission history are retained. Updating pauses the prior run; explicitly select a project or Start Auto-Bid again when ready.

In **OpenAI**, enter your key and choose a text-generation model. **Load available models** retrieves the IDs returned by OpenAI's [List models API](https://developers.openai.com/api/reference/resources/models/methods/list); custom IDs are also supported. **Remember API key** saves it in this Chrome profile. Unchecked keys remain in memory and are cleared when Chrome closes or the extension reloads. The Workana page cannot read extension-owned key storage. No key is included in the archive.

## Two distinct controls

- **Start Auto-Bid** enables continuous automatic search and submission. It remains enabled until Stop, Quit, closing the controlled tab/browser, or disabling the extension. It does not require approving each draft.
- **Bid on this Project** handles the project or question form currently open in the same tab. It is disabled on search pages and other pages without an open project. When Auto-Bid is off, this creates a single-project task and finishes after that task; it does not enable search or automatic bidding. During that task the UI says **Manual bid only · Auto-Bid off** and offers **Cancel manual bid**.

If Auto-Bid was already enabled, selecting a project explicitly adds that project to the existing run; it does not newly enable Auto-Bid. Use **Stop Auto-Bid** first when you want manual-only operation. Manual selection can target an older project missed by the initial baseline. One click starts one task: the button shows progress and is disabled while that task is starting or running. Further activation does not reset the phase or create another task. An explicit **Bid on this Project**, dashboard **Bid on project**, or manual Retry bypasses category, skill exclusion, budget, Client Filter and Specific Project eligibility criteria. Automatic discovery continues to enforce these filters. Closed projects, existing conversations and confirmed or ambiguous prior sends retain their duplicate/platform protections.

Selecting a manual project gives it priority in the shared queue. Two isolated project workflows can draft and Send concurrently; search detection continues in its own tab. Filter failures, exhausted draft retries and unconfirmed receipts are recorded without stopping automatic scanning or the remaining queue. Unconfirmed sends remain protected against duplicate submission. A previously stopped automatic run remains off. The automatic search keeps its configured refresh schedule independently of the bid queue.

## Parallel detection and native Workana search

One controlled Workana tab owns project navigation, Ask a Question, drafting, validation, Send and receipt confirmation. Auto-Bid also opens one inactive Workana search tab. This read-only worker uses the native saved-search widget; it cannot submit a bid. Stop or Quit closes it. If that search tab is closed while Auto-Bid remains active, it is recreated. The controlled tab is never reloaded by search refreshes.

In Bid Settings > Project Search, enter your native saved-search name (normally IT & Design; IT && Design is recognized) and choose the refresh interval. A nonempty saved-search name takes priority over the legacy current-filter option. It selects the matching native preset on the visible listing and scanner, retaining the language, country and other filters saved in that feed. The normal IT & Design feed verifies both visible categories before detection. To use the current page instead, enable current filters; that clears the saved-search name. Placeholder or unsettled results are not used. Settled cards are collected while scrolling, so new candidates can start preparation before the complete list finishes scrolling. A missing or unready preset waits for the configured interval before another reload.

Project filters run first. An excluded skill or conclusive category/pricing failure skips the project immediately. Only remaining candidates need a canonical project-document read, with up to three read-only inspections at once. Client Filter and enabled Specific Project use the same client snapshot: either may qualify the project. These small checks use synchronous short-circuit evaluation; scheduling promises adds overhead without speeding them up. The first qualifying result enters the bid queue immediately, even if another inspection is still waiting. Known failures never open a rendered project or repeat a 20-second retry cycle. Genuinely missing data stays pending for a later scan and cannot hold the bid queue.

Prepared source data is reused briefly when opening an eligible project. Original posting language, current filters, project identity, native validation and exclusive Send authorization are still checked. Up to two isolated workflows may Send concurrently; each workflow has one Send reservation; only read-only work runs concurrently. An explicit manual Bid retains its existing eligibility override and does not start Auto-Bid if it was off.

Search refreshes follow their own configured deadline during drafting and Send. Dashboard enrichment uses a separate two-request pool and cannot occupy the three discovery readers. Success cards are added as soon as receipts are confirmed; missing client figures and conversation links can finish loading independently. Filter failures, missing data and draft failures do not disable the automatic run. Logs remains the separate activity view.

The dashboard records projects posted from the moment Start Auto-Bid is pressed. Recording days last 24 hours from that activation anchor; if Auto-Bid continues longer, subsequent days use the same anchor. Posts from before activation stay outside the collection. Captured records remain in local Chrome storage across manual bids, Stop/Start and browser or extension reloads. Starting again establishes a new recording anchor while preserving previously captured records. Only confirmed successfully sent projects appear on the dashboard; the former All posted / Sent project view buttons are removed. The footer still counts all recorded projects and confirmed sends. Ten cards appear per page. Each card follows the supplied layout: project title and publication time, client name, country, verification, rating, paid/published ratio, budget, Bid and Delete from Dashboard. Clear hides all currently recorded cards. Delete/Clear preserve the underlying receipt and duplicate history; newly discovered projects still appear afterward. Automatic bidding continues to distinguish new eligible posts from the activation baseline.

The expanded header places Logs beside Settings and shows the refresh time. Logs is a separate view with timestamps, Clear and ten entries per page. Dashboard cards do not display logs, filter explanations, skill chips or draft/receipt actions. A confirmed submission has a green border; an unconfirmed receipt retains its duplicate protection. Templates appears directly after Bid requirements in the header and opens template management. Bid style > Proposal Template also remains available. Reset size is in Settings.

## Draft format, warnings and portfolio

Proposal language follows the project title and description. English greeting examples and point instructions are translated while emojis, names and the signature are retained. A confident detected posting language is supplied explicitly to generation. Actual output text and greeting/closing are checked against it, so an English response labelled pt is revised before Send. Client country and site/browser language do not determine proposal language. Uncertain or unsupported language detection remains Auto rather than defaulting to English.

**Templates** defines the name, greeting, client-name inclusion, proposal prompt, closing and signature. The prompt controls body content, formatting and length without enforcing legacy point counts, icons or word ranges. Existing point instructions migrate into the prompt. **Bid requirements** remains a separate rules editor and applies where consistent with the prompt. The description language takes priority over the title; greeting and closing are translated naturally. Incorrect-language drafts are revised before Send.

The former Number of points, Use point icons, individual Point fields and Minimum/Maximum words controls have been removed. Put any desired paragraph, list, icon or length requirements directly in the Proposal prompt.

The extension opens **Ask a Question**, prepares the draft, waits for native validation and clicks **Send** when no system warning is present. No approval step is required. If Send navigates to the inbox, the active task checks that project conversation for the exact submitted text, confirms the receipt and resumes Auto-Bid. It does not reopen or resend the same message. If template settings change during form filling, the proposal is automatically revised and refilled.

Numeric versions are written without link-like dots: 1.0 becomes 1 dot 0. Technology names use Node JS and Next JS. Observed platform warnings are saved as prevention rules and recorded in Logs. Corrections happen in place without repeatedly reloading the question form. Failed drafts remain in the underlying history while Auto-Bid continues.

When the client requests a portfolio, the prompt includes relevant stored project names, descriptions, skills and actual roles. Requested stored links use the supplied format, for example `https : //example . com/`. Other links and contact information are not permitted. If Workana rejects a portfolio link's format, correction keeps the relevant project facts and omits the rejected link. Missing portfolio material does not prevent drafting or justify invented experience.

No-experience disclaimers such as "I have no experience with GTX 745, but..." are prohibited by default, including when a portfolio is requested. Generation describes the concrete approach using verified facts and does not invent experience. Such output is automatically revised before Send.

Without a client portfolio request, stored portfolio examples are omitted from the drafting context and unsolicited disclaimers such as “Although I don't have an exact portfolio match” are blocked before Send. A targeted correction asks for the project-specific approach instead; it does not invent experience or silently delete the user's point instructions.

## Filters and settings

**Bid Settings** contains Project Search, Project Filter, Client Filter and **Specific Project**. The skill filter contains **Exclude skills** only. Include and Project Selection commands are removed, including their saved legacy behavior. Exclusion matching uses the selected project?s **Skills needed** tags; navigation, footer links, title and description do not supply extra skills. Additional unlisted skills are allowed. Existing category and pricing settings remain active. Client settings retain minimum stars, payment verification, paid/published ratio and registration dates.

Specific Project is an optional alternative client filter with payment verification, **one exact rating** (blank for any value), and its own **minimum paid / published project ratio (%)**. The ratio is paid projects divided by all published projects, multiplied by 100; two paid out of four published equals 50%. Zero or blank disables that ratio threshold. Explicit no-rating evidence matches zero; unreadable data is not assumed to be zero or unverified. For automatic bids, eligibility is **Project Filter AND (Client Filter OR enabled Specific Project)**, retaining excluded skills, categories and pricing. An explicit manual Bid bypasses these eligibility filters.

The project title is the first row of each card and opens a separate browser tab. Client name, country and payment verification appear below it; rating, paid/published percentage and budget occupy the next row beside Bid and Delete. Client metadata is read from the client card, including Spanish/Portuguese labels. A manual task opened directly on a question form reads fresh project details without navigating away.

Spanish Workana controls and metadata are supported: **Realiza una consulta → Consulta → Enviar**, **Proyectos publicados**, **Proyectos pagos**, **Miembro desde**, full/empty star glyphs, and payment-verification tooltips such as **Método de pago verificado**. Unknown payment status remains unknown when no evidence is present.

The panel remains resizable, movable and semi-transparent. **Settings → Operation** contains **Night Mode**, **Day Mode**, opacity and **Interface font size**. One font-size control scales the header, menus, settings, project details and status together; color options are removed. **Reset size** restores expanded bounds; minimizing does not overwrite those bounds. Portfolio editing retains exactly five fields: name, description, skills, link and role. Existing templates, import/export and duplicate history remain available.

The expanded header includes Dashboard and Logs. A successful Save displays a nonblocking confirmation for one second and disables until another edit. Failed saves retain edits. Settings saves stay on the selected page and preserve scroll. The compact panel measures its contents for the configured font. Its minus control shrinks it further to a 36-by-36-pixel expand button. That button restores the compact menu; the plus control opens the full dashboard. Expanded dimensions remain saved.

Question validation waits for delayed warnings to settle before Send. Observed warnings are corrected in place and kept in history; confirmed drafts show those warnings as resolved. A warning appearing after a Send click without a confirmed receipt leaves the project unconfirmed to prevent duplicate submissions. The extension never hides Workana's system messages or sends through an observed warning.

Provider/network failures retry with backoff without reloading the question form. Stop cancels pending work. An accepted message cannot be recalled; unknown Send receipts remain unconfirmed to prevent duplicates. Chrome may delay timers while tabs or the computer are suspended.

## Build and verification

Use `npm run build:extension`, then `npm run package:extension -- -ArchiveName "Workana File 1.zip"`. Output: `dist/workana-chrome-extension` and `dist/Workana File 1.zip`. Never distribute `.cache/extension-test`.

`npm test`, `npm run lint`, `npm run typecheck` and `npm run test:extension` cover the application and extension. The Chrome test uses local Workana fixtures and a fake OpenAI provider; no real messages or paid calls are made. `node scripts/extension-package-check.mjs` verifies the production build has no test endpoint or embedded key. Authenticated live Workana DOM and receipts remain unverified; an unrecognized or ambiguous control is not clicked.

## Release history

The following historical notes describe preceding releases. Current detection and dashboard behavior follows the 1.14.0 instructions above.

### Client figures and hourly budgets in 1.9.0

The Project Filter includes the three USD hourly presets: less than $15 / hr, $15 - $45 / hr, and over $45 / hr, alongside existing fixed-price ranges. Existing selections and numeric pricing limits are retained.

Every saved dashboard card, including filtered and submitted projects, loads missing client information from its canonical Workana project page without navigating the controlled tab or initiating a bid. Cards display the public client name, country, payment verification, rating, membership month, and paid/posted counts with a calculated percentage (up to two decimal places). For example, 4 paid out of 9 published is 44.44% (4 / 9). Zero counts remain visible; 0 / 0 has no defined percentage. Workana may only expose a public display name and country flag; the extension displays that evidence without inventing a private full name or citizenship.

Sparse listing and question-form snapshots no longer erase previously read client figures. Open project cards wait up to six seconds for delayed sidebar rendering. Missing historical details are read separately and retried on a later pass if unavailable. While reading, the card says Loading; if Workana does not expose a field, it says Not shown. Metadata refreshes preserve all drafts, Send ownership, receipts, deleted-card markers and automatic scheduling.

The new archive is Workana File 1.zip; the original Workana Chrome Extension.zip is retained unchanged.

### Dashboard recording and views in 1.10.0

The two buttons beside the Workana search chips select the same persistent recorded collection. All posted project shows all recorded post-activation projects, including filtered or unsuccessful ones. Sent bid successfully project shows only entries with a confirmed sent status; queued, drafting, uncertain and pre-existing conversations do not count as successful sends. Both views show ten cards per page. Changing view returns to page one; receipt updates refresh the selected view immediately. The footer shows the full collection total and its confirmed sent count in either view.

Recording uses the publication timestamp, not when an old listing was first discovered. The first window is [activation, activation + 24 hours); following windows continue at 24-hour boundaries from that anchor while automatic bidding continues. Stop, a manual task, refresh, midnight and a worker restart do not erase recorded cards or change their original recording windows. The automatic queue, filters, metadata enrichment, language matching, templates and Send protections remain available.

The updated archive remains Workana File 1.zip. The preceding v1.9.0 release is retained as Workana File 1 - v1.9.0.zip.

### Successful bids and conversation links in 1.11.0

Confirmed sent cards appear first, with the most recent sent receipt first. A stronger green border, tinted header and Bid sent successfully badge distinguish them from drafts, filtered projects and uncertain receipts. This indicates successful proposal submission; it does not claim that the client awarded or completed the work. The Sent bid successfully project view remains available.

A successful card title opens its Workana conversation in a separate tab. The extension stores the observed /inbox/project/freelancer address when the posted message is confirmed, including native inbox redirects and inline Send confirmations. Native Go to messages links can recover destinations for older receipts. Matching project IDs and Workana hosts are checked, while links in client-written descriptions or message bodies are excluded. Freelancer usernames are never guessed. If an older final inbox address is temporarily unavailable, the title uses Workana's native /messages/bid/project?tab=message conversation entry, and later observed inbox navigation updates the stored address.

Before-navigation scroll pauses were removed (250 ms on listing-title clicks and 200 ms before Ask a Question), and receipt checks now run immediately and then every 100 ms within the existing timeout. Background history enrichment yields while a bid batch is active. Template, posting-language, eligibility, duplicate, Stop, native validation, warning correction and final Send-authorization checks remain enforced. Generation and platform network time still depend on OpenAI and Workana.

The updated deliverable is Workana File 1.zip. The preceding v1.10.0 archive remains at Workana File 1 - v1.10.0.zip; earlier deliverables are retained.

### Original posting language in 1.12.0

Before drafting, both automatic and manual bidding read the canonical project document with the signed-in session. That fetch runs alongside the existing rendered-page readiness check. The original author title and description become the drafting context; browser-translated visible text, client country and site navigation do not choose the proposal language. The main original description takes priority over a short or bilingual title. The source language and project ID are retained with the draft for final Send authorization. An unavailable or mismatched original document follows the existing retry path rather than silently choosing English.

The first generation request instructs the model to compose the greeting, every point and the closing in the posting language while preserving template intent, emojis, client name, technology names and signature. Each section and sentence is checked independently, so a majority-Portuguese draft cannot hide one English paragraph or sentence. Wrong-language sections are automatically revised before filling and Send. Existing unsent English drafts are regenerated against the original posting; already submitted messages keep their receipt and duplicate protection. Portuguese pt-BR/pt_BR output codes are normalized to pt, including localized numeric-version wording.

The reported Portuguese Delphi project is covered by generation and worker regressions. The Chrome fixture simulates an English rendered project page over the Portuguese source document, then deliberately returns an English draft, an English point and an English closing before a fully Portuguese result. Successful Send still resumes the previous Auto-Bid state. The saved English template itself remains unchanged.

The updated deliverable is Workana File 1.zip. The preceding v1.11.0 release is preserved as Workana File 1 - v1.11.0.zip.


## 1.14.0 — Bid Limit, concurrent drafting and long-session fixes

Bid Settings > Project Search includes Bid Limit below the saved-search name.
Zero means unlimited; positive whole numbers cap confirmed automatic submissions
in the current run. Manual bids do not count. A new automatic run resets the
counter. Reaching the limit stops automatic discovery and queued automatic bids;
explicitly queued manual tasks may finish. Unknown receipts never count as
confirmed successes and remain protected against duplicate submission.

Two project preparation/drafting tasks can overlap while the read-only search
continues. A manual selection from another Workana tab joins the active queue
without navigating away from the current question form. Actual Send operations
remain sequential. Prefetched drafts are revalidated against current source,
template and rules, and cancelled on Stop.

Drag the 36-by-36 minimized button to move it; a click without dragging expands
it. Stale settings panels no longer overwrite unrelated saved settings. Removed
panel hosts recover after page DOM replacement, stopped queued projects can be
selected again, and completed Send command tracking is bounded.


## 1.15.0 — Parallel submissions and session stability

Two complete bidding workflows now run concurrently, including native Send and
receipt confirmation. Each has its own project, token, draft, retry state and
question tab. A separate background tab continues saved-search discovery. A free
submission slot immediately takes another queued task; it does not wait for the
other receipt. Temporary submission tabs close after completion. The original
controlled tab remains open. Stop cancels both workflows and the scanner.

Automatic Bid Limit slots are reserved atomically before Send across both
workflows. Confirmed receipts increment the counter once. Unknown receipts retain
their slots until checked, so an ambiguous Send cannot cause the limit to be
exceeded. Manual bids remain outside the automatic limit.

Recovery preserves per-project state across a service-worker restart. Interrupted
tab allocations return to the queue. Page messages have deadlines, unrelated
unresponsive tabs cannot block broadcasts, obsolete search attempts are rejected,
and failed eligibility caches expire after five minutes or a changed listing.
Nested settings saved from separate panels merge at individual property level.
Run updates preserve active editor controls and unsaved text.

Validation uses local fixture pages and a fake AI provider, including overlapping
native submission requests, a real service-worker stop/restart, missing-search
recovery, manual multi-tab selection, shared-limit races, and 500 consecutive UI
updates. No live Workana bids or paid API requests are made by these tests.

To update, extract Workana File 1.zip into the same unpacked-extension directory,
click Reload on chrome://extensions, and refresh open Workana pages. Existing
settings and history remain in the same Chrome extension profile. The extension
stops active automation during an update; explicitly start it again when ready.


## 1.16.0 — Native-filter discovery and interruptible scrolling

Auto-Bid defaults to the current Workana search filters. Open the desired Workana
project listing, select native filters, and start Auto-Bid. A background scanner
copies that search URL and scrolls its results. No named saved-search widget is
required in this mode. For a named saved search, turn off "Use current Workana
search filters" and enter its name. Default polling is five seconds; existing
configured refresh intervals remain saved. Newly appearing cards in the scanner
are also processed between scheduled reloads, without waiting for a full scroll
pass or the next refresh. There is no server push subscription: projects must
first become available in Workana's search results.

Background HTML may omit client details populated later by Workana. Those
candidates now enter the regular native UI workflow, where automatic eligibility
is checked before Ask a Question and before Send. Manual Bid on this Project
retains its existing explicit eligibility override. Two submissions may overlap,
while each project retains its own state and Send reservation.

"Stop auto-scrolling when I click anywhere" is enabled by default. A real click
on a Workana page or the extension panel stops the current scanner pass. Already
discovered candidates remain eligible for processing, and scheduled search checks
continue. It does not cancel pending bids. Synthetic clicks used by the bidding
workflow do not interrupt scanning.

Newly detected relative timestamps such as "just now" use their publication
interval. Cards captured before activation and conclusively older projects still
remain excluded. Failed search reasons are written to Logs.

The extension now contains one Original default template. Updating an older
multiple-template configuration resets that collection once to the original
default structure, greeting, signature, and word limits. Later edits to this
single template persist. Portfolio data, eligibility settings, API credentials,
and submission history remain saved.

Requested portfolio examples are checked in generation and again before native
Send. Text must contain a stored example name and at least one supplied link when
available. If Workana rejects links, the existing correction path may omit the
link while retaining the named example. Unrequested portfolio links are not added.

Verification: 272 extension tests, type and lint checks, full local Chrome
workflow including actual overlapping Send requests and worker restart, and a
dedicated native-filter Chrome test with a physical click interrupting scrolling.
In that fixture, a live "just now" card reached native Ask and Send in 3.023
seconds with a 60-second refresh and missing background client data. These are
local fixture results; no live bids or paid AI requests were made.


## 1.16.1 — Requested, relevant portfolio items only

This correction is limited to portfolio selection, request detection, drafting
instructions and the final portfolio validation before Send. Existing automatic
and manual bidding, parallel submissions, Bid Limit, search, scroll interruption,
the single editable template, saved settings and UI controls keep their behavior.

Portfolio examples are supplied only when the project description explicitly
asks for them. Title-only mentions, portfolio website deliverables and explicit
instructions not to include a portfolio do not authorize examples. A stored item
must share a matching skill or technology tag with the project. At most two
matching examples are selected; unmatched items no longer fill unused slots. If
no matching stored work exists, the bid describes the proposed approach without
portfolio examples or invented experience. Missing skill evidence does not count
as a match.

The final Send guard rejects unrelated or unrequested stored items and uses the
current allowed links, including when an older draft carries stale permissions.
A requested example name must be paired with its own supplied link. The existing
Workana warning-correction path can still omit a rejected link and retain the
matching project name. Portfolio metadata and other saved settings are preserved.

Verification includes 281 extension tests, AI-request facts for requested/matched,
requested/unmatched, unrequested/matched and explicitly excluded cases, and native
Send authorization tests with deleted/stale portfolio links. Local Chrome checks
exercise current-filter discovery, physical click-to-stop scrolling, portfolio
insertion, parallel Sends, worker recovery and existing UI controls. No live bids
or paid AI calls are used for these checks.
## Current project filtering

Budget filters have been removed from Project Filter. Previously saved or imported
budget type, currency, minimum, maximum and range restrictions are ignored for
notifications and automatic bids. Budget details remain visible in project cards
and Telegram messages. Native filters saved on Workana still control its search results.

## Telegram project notifications

Reload the unpacked extension in `chrome://extensions` and refresh Workana.
In Settings, find **Telegram project notifications**. Create a bot with
@BotFather, press Start in your bot's Telegram chat, and enter its token and
click **Find my chat ID** to fill in your numeric ID. If nothing appears, send
your bot a fresh `hello` message and click again. If multiple chats appear, choose
your destination. For groups, add the bot and send `/start@YourBotUsername` in
the group before finding its ID. Manual entry remains available.
Use **Send test notification**, enable notifications, then save.

A project must match your saved Project Filter. The client must meet at least
one of these criteria: rating above 3 out of 5, verified payment, or a Workana
join date before January 1, 2024. Alerts include job and client details where Workana
provides them, with **Open job** and **Copy link** buttons.

The test button checks Telegram delivery only; it does not enable automatic
monitoring. The Telegram settings show whether monitoring is off, whether its
baseline is ready, and the latest scan counts, filter reasons or errors. These
details update automatically as checks run. Search and detail requests bypass
the browser cache. A failed detail request leaves that project available for
retry without blocking notifications for other projects.

Use **Check new projects now** to run an immediate discovery check with the saved
settings. Its summary distinguishes already-seen projects, older postings, filter
rejections and missing details. It does not reset the baseline or resend previously
notified projects. Saved-search chips are matched without their remove icons.
Expand **Recent project checks** for the title and exact baseline, filter,
missing-detail or delivery reason for each of the latest 30 checked projects.

After updating to 1.19.2, reload Workana and select the saved search once. Its
filter URL is retained in extension storage. A page-world observer learns native
read-only search fetch/XHR requests; credentials and request headers stay in the
page's memory. The scanner reissues fresh authenticated requests with browser
caching disabled. A native AJAX GET to the saved `/jobs` URL is used when no
learned request is available. Responses may contain JSON lists or HTML fragments.
JSON-wrapped HTML cards and fetch `Request` objects are supported. Polling prefers
the exact tab that bound the search, so a different Workana tab cannot accidentally
replace its learned request with an unbound fallback.

Project detail enrichment also uses the signed-in page's request context. Complete
API rows that already prove every active filter and publication time do not need
a project-page request. A blocked optional detail request cannot suppress a proven
match; missing display-only fields remain "Not shown". Required filter evidence
is never waived: those entries remain retryable with the HTTP error and missing
fields recorded. Definite rejections and conclusively old projects avoid redundant
detail requests. Structured budgets and client join dates are parsed with their
data helpers, independently of similarly named UI functions.

New projects need not appear in the visible page. No hidden frames, temporary
tabs, visible-card scraping or page refreshes are used for notification discovery.
Keep a signed-in Workana tab open so requests can use its browser session. The
status identifies HTTP/API requests as the source. Authentication failures,
verification pages and unrecognized response schemas stop the check and show an
error; they never fall back to stale cards. If request learning is unavailable,
reload Workana once and select the saved search again. Up to three linked result
pages are checked per pass, with an explicit coverage warning if more remain.
Notifications apply the existing project and client eligibility rules. Missing
details are retried rather than treated as matches. Auto-Bid and an OpenAI API
key are not required.

The first successful search records pre-existing cards without notifying, while
still checking projects known to have been published after monitoring was enabled.
Rejected projects are retried after filter changes or after five minutes. Subsequent
checks notify for new matching projects. Missing fields are shown as an em dash,
and known zero scores and counts remain visible. Checks run about once a minute
while Chrome runs with your Workana login. The message shows the Workana publication time or date at the precision provided. If the publication data cannot establish that the job was posted after monitoring began, the extension waits for stronger evidence before sending an alert.
Workana's human-readable publication dates in English, Spanish and Portuguese are
recognized as calendar dates. The baseline prevents existing projects with unclear publication dates from generating alerts.
Settings and seen IDs live only in extension storage; no backend or database is
needed. Telegram credentials are separate from the JSON settings backup. Changing
the bot or destination establishes a new baseline.

Failed requests retry after a delay, including Telegram rate limits. When Workana requires verification during a search, the extension sends one Telegram alert per interruption. A successful search clears the interruption. Seen IDs
survive worker restarts. A connection loss after Telegram accepts a message can
cause a duplicate on retry. Only results returned by the search are checked, so
projects that disappear between checks may be missed. Notifications do not bid.

Verification: `node verify-notifications.cjs` runs the unit and isolated browser
checks, including a new project that exists only on page two of the API response
while the visible page remains unchanged. No live Telegram messages, bids or paid
AI calls are made by verification. Live authenticated Workana API behavior still
requires verification in the user's session; a mocked endpoint is not proof that
Workana will accept every session request.
