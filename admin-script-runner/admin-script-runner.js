/*! admin-script-runner v0.1.3 — bsp-sp-parts
 *
 *  Runs small admin tasks when a page is visited, at most once per schedule slot,
 *  and shows their progress in a status panel pinned to the bottom of the screen.
 *
 *  THE PIECES
 *   - A TASK TYPE is a script that registers { type, label, due(ctx), run(ctx) }
 *     by pushing onto window.adminScriptTasks. Either load order works; a type
 *     that registers late picks up hosts already waiting for it.
 *   - A TASK INSTANCE is a web part stub on a page:
 *       <div data-admin-task="<type>" data-config="<url of its JSON config>"></div>
 *     One type, many instances: the same export on many lists and sites.
 *     Its key (for this browser's memory) is data-id, else the data-config URL.
 *   - THE RUNNER (this file) finds every instance, decides which are due, and
 *     runs those one after another behind the panel.
 *
 *  WHEN A TASK RUNS — three gates, cheapest first (see README "Scheduling"):
 *   1. Slot gate: config.schedule.slots are local hours (default 8,10,12,14,16,
 *      18) and schedule.until closes the day (default last slot + 2 = 20:00).
 *      Each browser checks an instance at most once per slot, deciding from its
 *      own memory (the stamp plus the schedule cached from the last config
 *      load) BEFORE any network. The attempt is stamped before the config is
 *      even fetched, so a failure — bad config, 403, 500 — waits for the next
 *      slot instead of retrying on every page load. Without working browser
 *      storage nothing can be remembered, so nothing runs automatically.
 *   2. task.due(ctx): the task's own, cheap "is there work?" (it never shows UI).
 *   3. Only if something is due does the panel appear and task.run(ctx) execute.
 *   ?adminTasks=force on the page URL skips gates 1 and 2 (testing, manual re-run).
 *
 *  Boot is delegated to dcsMountPart() (_shared/dcs-part-boot.js): host wait,
 *  multi-instance, edit-mode placeholder, SPA re-mount. Load it before this file.
 *  Plain DOM, no Alpine. Styling: bsp-design .card / .progress / .btn plus
 *  admin-script-runner.css.
 */
(function (window) {
  'use strict';

  var VERSION = '0.1.3';
  var LOG = '[admin-script-runner]';
  var DEFAULT_SLOTS = [8, 10, 12, 14, 16, 18];
  var STORE_KEY = 'adminScriptRunner.v2';
  var TYPE_WAIT_MS = 10000;    // how long a host waits for a late task script before it is an error
  var BATCH_MS = 400;          // hosts that mount together run as one batch
  var DONE_CLOSE_MS = 3000;

  /* ════════ Pure logic — exported on window.adminScriptRunner._pure for tests ════════ */

  /** Valid, sorted, de-duplicated whole hours 0–23. Anything else is dropped. */
  function normalizeSlots(slots) {
    var list = Array.isArray(slots) ? slots : DEFAULT_SLOTS;
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (h) {
      var n = Number(h);
      if (Number.isInteger(n) && n >= 0 && n <= 23 && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /** { slots, until } — until is the hour the day closes (exclusive, 1–24);
      default: two hours after the last slot. Accepts a bare slots array too. */
  function normalizeSchedule(raw) {
    var sch = Array.isArray(raw) ? { slots: raw } : (raw && typeof raw === 'object' ? raw : {});
    var slots = normalizeSlots(sch.slots);
    var last = slots.length ? slots[slots.length - 1] : 0;
    var until = Number(sch.until);
    if (!Number.isInteger(until) || until < 1 || until > 24) until = Math.min(24, last + 2);
    return { slots: slots, until: until };
  }

  /** Start of the slot `now` falls in (local time), or null outside the day's window. */
  function currentSlotStart(now, schedule) {
    var sch = normalizeSchedule(schedule);
    if (now.getHours() >= sch.until) return null;
    var current = -1;
    for (var i = 0; i < sch.slots.length; i++) { if (sch.slots[i] <= now.getHours()) current = sch.slots[i]; }
    if (current < 0) return null;
    var start = new Date(now.getTime());
    start.setHours(current, 0, 0, 0);
    return start;
  }

  /** Gate 1. lastCheckedMs is this browser's stamp for the instance (or undefined). */
  function slotGate(now, schedule, lastCheckedMs) {
    var slot = currentSlotStart(now, schedule);
    if (!slot) return { check: false, reason: 'outside-hours', slotStart: null };
    if (typeof lastCheckedMs === 'number' && lastCheckedMs >= slot.getTime()) {
      return { check: false, reason: 'checked-this-slot', slotStart: slot };
    }
    return { check: true, reason: 'due-check', slotStart: slot };
  }

  var pure = { normalizeSlots: normalizeSlots, normalizeSchedule: normalizeSchedule, currentSlotStart: currentSlotStart, slotGate: slotGate, DEFAULT_SLOTS: DEFAULT_SLOTS };

  /* ════════ Task type registry — window.adminScriptTasks is a push-queue ════════ */

  var types = Object.create(null);
  var parked = Object.create(null);   // type → hosts that mounted before their type registered
  var onLateType = null;              // set once the DOM side is up

  function defineType(def) {
    if (!def || !def.type || typeof def.due !== 'function' || typeof def.run !== 'function') {
      console.error(LOG + ' ignored a task registration: need { type, due(ctx), run(ctx) }.', def);
      return;
    }
    types[def.type] = def;
    if (parked[def.type] && onLateType) {
      var hosts = parked[def.type];
      delete parked[def.type];
      onLateType(hosts);
    }
  }

  var queued = window.adminScriptTasks;
  var registry = [];
  registry.push = function () {
    for (var i = 0; i < arguments.length; i++) defineType(arguments[i]);
    return 0;
  };
  window.adminScriptTasks = registry;
  if (Array.isArray(queued)) queued.forEach(defineType);

  var api = window.adminScriptRunner = {
    version: VERSION,
    _pure: pure,
    types: function () { return Object.keys(types); }
  };

  if (!window.document) return;   // Node tests stop here: pure logic + registry only
  var document = window.document;

  /* ════════ Per-browser memory — the ONLY localStorage toucher ════════ */

  /* { instances: { <key>: { checked: <ms>, schedule: { slots, until } } } }.
     Tabs share it without locking: two tabs racing on one instance can both
     run it once (identical output) — accepted, see docs/00-overview.md. */
  function readStore() {
    try { var doc = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); return doc && typeof doc === 'object' ? doc : {}; }
    catch (e) { return {}; }
  }
  function recall(key) {
    var doc = readStore();
    var entry = doc.instances && doc.instances[key];
    return entry && typeof entry.checked === 'number' ? entry : null;
  }
  /** Stamp an attempt. Returns false when it could not be stored (blocked, full). */
  function remember(key, entry) {
    try {
      var doc = readStore();
      doc.instances = doc.instances && typeof doc.instances === 'object' ? doc.instances : {};
      doc.instances[key] = entry;
      window.localStorage.setItem(STORE_KEY, JSON.stringify(doc));
      var back = recall(key);
      return !!back && back.checked === entry.checked;
    } catch (e) { return false; }
  }

  function forced() {
    try { return new URLSearchParams(window.location.search).get('adminTasks') === 'force'; }
    catch (e) { return false; }
  }

  function errText(e) { return String(e && e.message ? e.message : e); }

  /* ════════ Status panel ════════
     A bsp-design card: a slim design-system-blue header (text only — no controls
     on blue), a task list with per-task status, a thick progress bar, and a
     footer with the live status line and the one action. */

  var TEXT = {
    eyebrow: 'Site admin tasks',
    running: 'Updating this site',
    done: 'All done',
    failed: 'Needs attention',
    cancelled: 'Cancelled',
    lede: 'Running admin tasks for this site. Please do not close the page until complete.',
    ledeFinished: 'Admin tasks for this site have finished running.',
    doneStatus: 'Everything is up to date.',
    cancelling: 'Cancelling after the current step…',
    cancelledStatus: 'Remaining tasks will run at the next scheduled time.',
    foot: 'Starting…',
    retry: 'Failed tasks try again at the next scheduled time.'
  };

  var ROW_STATE = {
    queued: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Skipped'
  };

  /* Glyphs, inlined so the panel needs no sprite on the page. Copied, never
     invented: sprite symbols from bsp-design fluent-basic-icons.svg, and
     wrench-settings-24-regular from bsp-fluent-icon-library (fill → currentColor). */
  var GLYPH = {
    wrench: '<path d="M16.5002 2C13.4627 2 11.0002 4.46243 11.0002 7.5C11.0002 7.94322 11.0528 8.37496 11.1523 8.78899L2.84099 17.1003C1.71967 18.2216 1.71967 20.0396 2.84099 21.1609C3.96231 22.2823 5.78033 22.2823 6.90165 21.1609L11.0155 17.0471C11.0996 15.8257 11.5211 14.6971 12.1875 13.7538L5.84099 20.1003C5.30546 20.6358 4.43718 20.6358 3.90165 20.1003C3.36612 19.5648 3.36612 18.6965 3.90165 18.1609L12.5248 9.53783C12.7258 9.33677 12.7959 9.0393 12.7057 8.76964C12.5726 8.37169 12.5002 7.94506 12.5002 7.5C12.5002 5.29086 14.2911 3.5 16.5002 3.5C16.6415 3.5 16.781 3.5073 16.9183 3.52153L15.0737 5.36612C14.5855 5.85427 14.5855 6.64573 15.0737 7.13388L16.8666 8.92678C17.3547 9.41493 18.1462 9.41493 18.6344 8.92678L20.4787 7.08239C20.4929 7.21955 20.5002 7.35886 20.5002 7.5C20.5002 9.04643 19.6227 10.3879 18.3384 11.0536C18.9902 11.1375 19.6118 11.318 20.1883 11.5802C21.3011 10.5738 22.0002 9.11855 22.0002 7.5C22.0002 6.73337 21.8429 6.00153 21.5582 5.33652C21.4602 5.10771 21.2551 4.94241 21.0107 4.8953C20.7663 4.8482 20.5144 4.92542 20.3384 5.10142L17.7505 7.68934L16.3111 6.25L18.8991 3.66198C19.0751 3.48599 19.1524 3.23414 19.1053 2.98974C19.0582 2.74534 18.8929 2.54023 18.6641 2.44223C17.999 2.15735 17.267 2 16.5002 2ZM14.2772 13.9756C14.592 15.0659 13.9376 16.1993 12.836 16.4718L12.2518 16.6164C12.2069 16.9041 12.1836 17.1992 12.1836 17.5001C12.1836 17.8147 12.2091 18.1232 12.2582 18.4235L12.7976 18.5534C13.9102 18.8213 14.5715 19.9663 14.2476 21.0639L14.0613 21.6951C14.5005 22.0808 15.0009 22.3939 15.5455 22.6167L16.0388 22.098C16.8273 21.2687 18.1496 21.2689 18.9379 22.0985L19.4366 22.6232C19.9801 22.403 20.4801 22.0928 20.9194 21.7103L20.7214 21.0244C20.4066 19.9342 21.061 18.8007 22.1626 18.5282L22.7463 18.3838C22.7912 18.0961 22.8145 17.8009 22.8145 17.5001C22.8145 17.1853 22.789 16.8767 22.7399 16.5764L22.2009 16.4466C21.0884 16.1787 20.4271 15.0337 20.751 13.9362L20.9371 13.3053C20.498 12.9196 19.9975 12.6064 19.4529 12.3835L18.9598 12.9021C18.1713 13.7313 16.849 13.7311 16.0607 12.9016L15.5619 12.3767C15.0184 12.5969 14.5184 12.9071 14.0791 13.2894L14.2772 13.9756ZM17.4991 19.0001C16.6984 19.0001 16.0494 18.3285 16.0494 17.5001C16.0494 16.6716 16.6984 16.0001 17.4991 16.0001C18.2997 16.0001 18.9487 16.6716 18.9487 17.5001C18.9487 18.3285 18.2997 19.0001 17.4991 19.0001Z" fill="currentColor"/>',
    check: '<circle cx="12" cy="12" r="8.5" fill="currentColor"/><path d="M8.4 12.2l2.5 2.5 4.7-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    warning: '<path d="M11.1 5.2a1 1 0 0 1 1.8 0l8 14a1 1 0 0 1-.9 1.5H4a1 1 0 0 1-.9-1.5l8-14z" fill="currentColor"/><path d="M12 10v4M12 17h.01" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    // Outline forms for the header mark (white on blue): the filled ones cut their inner mark out in white.
    checkLine: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></g>',
    warningLine: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l8.5 14.5H3.5L12 5z"/><path d="M12 10.5v4M12 17h.01"/></g>',
    clock: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></g>',
    dismiss: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></g>'
  };

  function icon(name, size) {
    return '<svg class="icon icon--' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + GLYPH[name] + '</svg>';
  }

  var panel = null;
  var closeTimer = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function openPanel(taskNames, onCancel) {
    closePanel(true);
    var root = el('section', 'card card--flush asr-panel is-running');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', TEXT.eyebrow);

    var head = el('div', 'asr-panel__head');
    var mark = el('span', 'asr-panel__mark');
    mark.innerHTML = icon('wrench', 24);
    var titles = el('div', 'asr-panel__titles');
    titles.appendChild(el('p', 'asr-panel__eyebrow', TEXT.eyebrow));
    var title = el('h2', 'asr-panel__title', TEXT.running);
    titles.appendChild(title);
    head.appendChild(mark);
    head.appendChild(titles);
    root.appendChild(head);

    var body = el('div', 'asr-panel__body');
    var lede = el('p', 'asr-panel__lede', TEXT.lede);
    body.appendChild(lede);

    var list = el('ul', 'asr-tasks');
    list.setAttribute('aria-label', 'Tasks');
    var rows = taskNames.map(function (name) {
      var li = el('li', 'asr-task');
      var glyph = el('span', 'asr-task__glyph');
      var label = el('span', 'asr-task__name', name);
      var state = el('span', 'asr-task__state');
      li.appendChild(glyph);
      li.appendChild(label);
      li.appendChild(state);
      list.appendChild(li);
      var row = { li: li, glyph: glyph, state: state };
      paintRow(row, 'queued');
      return row;
    });
    body.appendChild(list);

    var progress = el('div', 'progress progress--thick progress--indeterminate');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-label', 'Overall progress');
    var meta = el('div', 'progress__meta');
    var label = el('span', 'progress__label', 'Starting…');
    var value = el('span', 'progress__value');
    meta.appendChild(label);
    meta.appendChild(value);
    var track = el('div', 'progress__track');
    var fill = el('div', 'progress__fill');
    track.appendChild(fill);
    progress.appendChild(meta);
    progress.appendChild(track);
    body.appendChild(progress);

    root.appendChild(body);

    // Footer: the live status line beside the one action.
    var foot = el('div', 'asr-panel__foot');
    var status = el('p', 'asr-panel__status', TEXT.foot);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    foot.appendChild(status);
    var button = el('button', 'btn btn--secondary btn--sm', 'Cancel');
    button.type = 'button';
    button.addEventListener('click', function () {
      if (panel && panel.state === 'running') onCancel();
      else closePanel(false);
    });
    foot.appendChild(button);
    root.appendChild(foot);

    document.body.appendChild(root);
    panel = {
      root: root, mark: mark, title: title, lede: lede, rows: rows, progress: progress,
      label: label, value: value, fill: fill, status: status, button: button,
      state: 'running'
    };
  }

  function paintRow(row, state) {
    row.li.className = 'asr-task is-' + state;
    row.glyph.innerHTML = state === 'running' ? '<span class="spinner spinner--16" aria-hidden="true"></span>'
      : state === 'done' ? icon('check', 20)
      : state === 'failed' ? icon('warning', 20)
      : state === 'cancelled' ? icon('dismiss', 20)
      : icon('clock', 20);
    row.state.textContent = ROW_STATE[state];
  }

  function setRow(i, state) {
    if (panel && panel.rows[i]) paintRow(panel.rows[i], state);
  }

  function setProgress(fraction) {
    if (!panel) return;
    if (typeof fraction !== 'number' || !isFinite(fraction)) {
      panel.progress.classList.add('progress--indeterminate');
      panel.progress.removeAttribute('aria-valuenow');
      panel.value.textContent = '';
      return;
    }
    var pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    panel.progress.classList.remove('progress--indeterminate');
    panel.progress.setAttribute('aria-valuenow', String(pct));
    panel.fill.style.width = pct + '%';   // the one sanctioned inline value (design system)
    panel.value.textContent = pct + '%';
  }

  function setLabel(text) { if (panel) panel.label.textContent = text; }
  function setStatus(text) { if (panel) panel.status.textContent = text || ''; }

  /* state: 'done' | 'error' | 'cancelled' */
  function finishPanel(state, statusText) {
    if (!panel) return;
    panel.state = state;
    panel.root.classList.remove('is-running');
    panel.root.classList.add('is-' + state);
    panel.progress.classList.remove('progress--indeterminate');
    if (state === 'done') { panel.progress.classList.add('progress--success'); setProgress(1); }
    if (state === 'error') panel.progress.classList.add('progress--danger');
    panel.mark.innerHTML = icon(state === 'done' ? 'checkLine' : state === 'error' ? 'warningLine' : 'dismiss', 24);
    panel.title.textContent = state === 'done' ? TEXT.done : state === 'error' ? TEXT.failed : TEXT.cancelled;
    panel.lede.textContent = TEXT.ledeFinished;
    setLabel(state === 'done' ? 'Done' : state === 'error' ? 'Finished with errors' : 'Cancelled');
    setStatus(statusText);
    if (state === 'error') {
      panel.button.textContent = 'Close';   // errors stay until dismissed
      panel.button.disabled = false;        // Cancel may have disabled it before the failure landed
    } else {
      panel.button.hidden = true;
      closeTimer = window.setTimeout(function () { closePanel(false); }, DONE_CLOSE_MS);
    }
  }

  function closePanel(immediate) {
    if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = null; }
    if (!panel) return;
    var root = panel.root;
    panel = null;
    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { root.remove(); return; }
    root.classList.add('asr-panel--leaving');
    window.setTimeout(function () { root.remove(); }, 250);
  }

  /* ════════ Instances ════════ */

  var pendingHosts = [];
  var batchTimer = null;
  var running = false;
  var lastResults = Object.create(null);   // key → { at, outcome, detail } for the console

  function record(key, outcome, detail) {
    lastResults[key] = { at: new Date().toISOString(), outcome: outcome, detail: detail };
  }

  function isMockHost(host) {
    return window.location.protocol === 'file:' || host.hasAttribute('data-mock');
  }

  function loadConfig(host, type, mock) {
    var url = host.getAttribute('data-config') || '';
    if (!url) {
      if (mock && type.mockConfig) return Promise.resolve(JSON.parse(JSON.stringify(type.mockConfig)));
      return Promise.reject(new Error('the web part has no data-config URL'));
    }
    return window.fetch(url, { credentials: 'same-origin', cache: 'no-cache', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('config ' + url + ' — HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        // From disk (file:) a fetch cannot succeed; mock mode falls back to the
        // type's sample config. Live pages never do: a bad URL is an error.
        if (mock && type.mockConfig) return JSON.parse(JSON.stringify(type.mockConfig));
        throw e;
      });
  }

  function onHostMounted(host) {
    pendingHosts.push(host);
    if (batchTimer) window.clearTimeout(batchTimer);
    batchTimer = window.setTimeout(function () { batchTimer = null; drain(); }, BATCH_MS);
  }

  onLateType = function (hosts) {
    hosts.forEach(function (h) { if (document.contains(h)) onHostMounted(h); });
  };

  function drain() {
    if (running || !pendingHosts.length) return;
    var hosts = pendingHosts.splice(0);
    running = true;
    runBatch(hosts).catch(function (e) {
      console.error(LOG + ' batch failed', e);
    }).then(function () {
      running = false;
      if (pendingHosts.length) drain();
    });
  }

  function hostKey(host, typeName) {
    return typeName + '|' + (host.getAttribute('data-id') || host.getAttribute('data-config') || 'inline');
  }

  /* A host whose type has not registered yet waits for it (see defineType);
     only if it is still missing after TYPE_WAIT_MS is that an error. */
  function park(host, typeName, key) {
    var list = parked[typeName] || (parked[typeName] = []);
    if (list.indexOf(host) < 0) list.push(host);
    record(key, 'waiting', 'task type not loaded yet');
    window.setTimeout(function () {
      if (types[typeName] || !parked[typeName]) return;
      console.error(LOG + ' no task type "' + typeName + '" is loaded — add its script tag to the web part.');
      record(key, 'error', 'task type not loaded');
    }, TYPE_WAIT_MS);
  }

  /* Gates 1 + 2 for one host → a runnable job, or null. Never shows UI. */
  function checkHost(host, force) {
    var typeName = host.getAttribute('data-admin-task') || '';
    var type = types[typeName];
    var key = hostKey(host, typeName);
    if (!type) { park(host, typeName, key); return Promise.resolve(null); }
    var mock = isMockHost(host);
    var now = new Date();
    var memory = force ? null : recall(key);

    if (!force) {
      // Checked before in this browser: decide from memory alone — no network.
      if (memory) {
        var early = slotGate(now, memory.schedule, memory.checked);
        if (!early.check) { record(key, 'skipped', early.reason); return Promise.resolve(null); }
      }
      // Stamp the ATTEMPT before anything can fail, config fetch included.
      if (!remember(key, { checked: now.getTime(), schedule: memory ? memory.schedule : null })) {
        console.warn(LOG + ' browser storage is unavailable, so attempts cannot be remembered — not running automatically (?adminTasks=force still works).');
        record(key, 'skipped', 'no-storage');
        return Promise.resolve(null);
      }
    }

    return loadConfig(host, type, mock).then(function (config) {
      var schedule = normalizeSchedule(config && config.schedule);
      var gate = { check: true, reason: 'forced', slotStart: null };
      if (!force) {
        remember(key, { checked: now.getTime(), schedule: schedule });   // cache it for the no-network gate
        gate = slotGate(now, schedule, memory ? memory.checked : undefined);
        if (!gate.check) { record(key, 'skipped', gate.reason); return null; }
      }

      var job = { key: key, type: type, config: config, host: host, mock: mock, force: force, slotStart: gate.slotStart };
      if (force) return job;
      return Promise.resolve(type.due(makeContext(job, null))).then(function (isDue) {
        record(key, isDue ? 'due' : 'not-due', gate.reason);
        return isDue ? job : null;
      });
    }).catch(function (e) {
      console.error(LOG + ' ' + typeName + ': could not check whether it is due — ' + errText(e));
      record(key, 'error', errText(e));
      return null;
    });
  }

  function makeContext(job, run) {
    return {
      config: job.config,
      mock: job.mock,
      force: job.force,
      host: job.host,
      slotStart: job.slotStart,
      log: function () {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(LOG + ' [' + job.type.type + ']');
        console.log.apply(console, args);
      },
      setStatus: function (text) { if (run) setStatus(text); },
      setProgress: function (fraction) { if (run) run.progress(fraction); },
      isCancelled: function () { return !!(run && run.cancelled); },
      throwIfCancelled: function () {
        if (run && run.cancelled) { var e = new Error('cancelled'); e.cancelled = true; throw e; }
      }
    };
  }

  function runBatch(hosts) {
    var force = forced();
    // Checks run one at a time: they are cheap, and serial keeps request bursts small.
    var jobs = [];
    var chain = Promise.resolve();
    hosts.forEach(function (host) {
      chain = chain.then(function () { return checkHost(host, force); })
        .then(function (job) { if (job) jobs.push(job); });
    });
    return chain.then(function () {
      if (!jobs.length) return;
      return runJobs(jobs);
    });
  }

  function runJobs(jobs) {
    var batch = { cancelled: false };
    var failures = [];
    var names = jobs.map(function (job) { return (job.config && job.config.label) || job.type.label || job.type.type; });
    openPanel(names, function () {
      batch.cancelled = true;
      setStatus(TEXT.cancelling);
      if (panel) panel.button.disabled = true;
    });

    var chain = Promise.resolve();
    jobs.forEach(function (job, i) {
      chain = chain.then(function () {
        if (batch.cancelled) { setRow(i, 'cancelled'); return; }
        var name = names[i];
        var run = {
          get cancelled() { return batch.cancelled; },
          progress: function (f) {
            setProgress(typeof f === 'number' ? (i + Math.max(0, Math.min(1, f))) / jobs.length : null);
          }
        };
        setRow(i, 'running');
        setLabel('Task ' + (i + 1) + ' of ' + jobs.length);
        setStatus('');
        run.progress(0);
        return Promise.resolve().then(function () { return job.type.run(makeContext(job, run)); })
          .then(function (result) {
            record(job.key, 'ran', result);
            setRow(i, 'done');
            console.log(LOG + ' ' + name + ' finished', result);
          })
          .catch(function (e) {
            if (e && e.cancelled) { record(job.key, 'cancelled', ''); setRow(i, 'cancelled'); return; }
            setRow(i, 'failed');
            console.error(LOG + ' ' + name + ' failed', e);
            record(job.key, 'failed', errText(e));
            failures.push(name + ': ' + errText(e));
          });
      });
    });

    return chain.then(function () {
      if (failures.length) finishPanel('error', failures.join(' · ') + ' — ' + TEXT.retry);
      else if (batch.cancelled) finishPanel('cancelled', TEXT.cancelledStatus);
      else finishPanel('done', TEXT.doneStatus);
    });
  }

  /* ════════ Boot ════════ */

  api.status = function () { return JSON.parse(JSON.stringify(lastResults)); };
  api.clearSchedule = function () {
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ }
  };
  /** Re-check every instance on the page now (still gated unless ?adminTasks=force). */
  api.run = function () {
    var hosts = document.querySelectorAll('[data-admin-task]');
    for (var i = 0; i < hosts.length; i++) pendingHosts.push(hosts[i]);
    drain();
  };

  if (typeof window.dcsMountPart !== 'function') {
    console.error(LOG + ' dcsMountPart is missing — load _shared/dcs-part-boot.js before admin-script-runner.js.');
    return;
  }
  window.dcsMountPart({
    id: 'admin-script-runner',
    selector: '[data-admin-task]',
    label: 'Admin tasks',
    editMode: 'placeholder',
    render: function () { return ''; },   // instances are invisible; the panel is the UI
    onMount: onHostMounted
  });
})(typeof window !== 'undefined' ? window : globalThis);
