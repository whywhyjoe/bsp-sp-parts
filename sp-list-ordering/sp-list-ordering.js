/*! sp-list-ordering v0.1.0 — bsp-sp-parts
 *  Drag-to-reorder editor for a numeric SortOrder field on SharePoint lists.
 *
 *  Delivery: a custom script web part loads sp-list-ordering.webpart.html (a tiny
 *  per-instance stub). This file is the shared, environment-agnostic engine: it
 *  waits for every <div data-sp-part="list-ordering" data-config="…"> host, mounts
 *  the UI into each, and reads that instance's own config JSON. All environment
 *  URLs live in the stub + config, never here.
 *
 *  Persistence model: drag freely in local state; "Save order" renumbers the
 *  visible (filtered) scope to gapped integers (10, 20, 30…) and writes only the
 *  changed items in one batched round-trip. Items with a missing or duplicated
 *  sort value surface at the top ("Needs placement") and are normalized by the
 *  next Save — which is also what self-heals collisions created when items move
 *  between filter categories. Consuming apps should sort by SortOrder asc, ID asc.
 *
 *  Data layer: PnPjs v2 (self-hosted pnp2.bundle.js → global `pnp`). When `pnp`
 *  is absent (or the page is opened from disk) a mock adapter with canned data
 *  takes over, so the tool is fully exercisable outside SharePoint.
 */
(function () {
  'use strict';

  var MOUNT_SELECTOR = '[data-sp-part="list-ordering"]';
  var SPRITE_WRAP_ID = 'bsp-sprite-sp-parts';
  var GAP = 10;      // Save renumbers the visible scope to GAP, 2*GAP, 3*GAP …
  var FETCH_TOP = 500;
  var seq = 0;       // per-instance id counter (aria-describedby targets)

  /* ════════ Icon sprite — the canonical bsp-design sprite, inlined once per
     document, plus ic-fluent-re-order-dots-vertical-24-regular copied from the
     bsp-fluent-icon-library (real Fluent glyph, fill normalized to currentColor). */
  var SPRITE =
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true"><defs>' +
    '<symbol id="ic-fluent-add-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></g></symbol>' +
    '<symbol id="ic-fluent-alert-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a5 5 0 0 1 5 5c0 5 2 6 2 6H5s2-1 2-6a5 5 0 0 1 5-5zM10.3 19a1.8 1.8 0 0 0 3.4 0"/></g></symbol>' +
    '<symbol id="ic-fluent-arrow-down-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13M6 12l6 6 6-6"/></g></symbol>' +
    '<symbol id="ic-fluent-arrow-export-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5M14 5h5v5M19 5l-8 8"/></g></symbol>' +
    '<symbol id="ic-fluent-arrow-right-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 6l6 6-6 6"/></g></symbol>' +
    '<symbol id="ic-fluent-arrow-up-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></g></symbol>' +
    '<symbol id="ic-fluent-attach-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 8.5l-6 6a2 2 0 1 0 2.8 2.8l6-6a3.5 3.5 0 0 0-5-5l-6.5 6.5a5 5 0 0 0 7 7l5.5-5.5"/></g></symbol>' +
    '<symbol id="ic-fluent-calendar-ltr-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7zM5 10h14M9 4v3M15 4v3"/></g></symbol>' +
    '<symbol id="ic-fluent-checkmark-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></g></symbol>' +
    '<symbol id="ic-fluent-checkmark-circle-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/></g></symbol>' +
    '<symbol id="ic-fluent-chevron-down-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></g></symbol>' +
    '<symbol id="ic-fluent-chevron-left-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l-5 5 5 5"/></g></symbol>' +
    '<symbol id="ic-fluent-chevron-right-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7l5 5-5 5"/></g></symbol>' +
    '<symbol id="ic-fluent-clock-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></g></symbol>' +
    '<symbol id="ic-fluent-closed-caption-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="M10.8 10.6a2 2 0 1 0 0 2.8M16.6 10.6a2 2 0 1 0 0 2.8"/></g></symbol>' +
    '<symbol id="ic-fluent-data-bar-vertical-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h16M7 19v-6M12 19V6M17 19v-9"/></g></symbol>' +
    '<symbol id="ic-fluent-delete-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12M9.5 8V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M8 8l.8 11a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9L16 8M10.5 11.5v5M13.5 11.5v5"/></g></symbol>' +
    '<symbol id="ic-fluent-dismiss-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></g></symbol>' +
    '<symbol id="ic-fluent-dismiss-circle-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></g></symbol>' +
    '<symbol id="ic-fluent-document-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 4v4h4"/></g></symbol>' +
    '<symbol id="ic-fluent-document-pdf-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 4v4h4"/><path d="M8.5 15.5h7"/></g></symbol>' +
    '<symbol id="ic-fluent-edit-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19l1-4 9-9 3 3-9 9-4 1zM14 6l3 3"/></g></symbol>' +
    '<symbol id="ic-fluent-filter-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14l-5.5 7v5l-3-2v-3L5 6z"/></g></symbol>' +
    '<symbol id="ic-fluent-folder-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z"/></g></symbol>' +
    '<symbol id="ic-fluent-full-screen-maximize-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9V6a1 1 0 0 1 1-1h3M15 5h3a1 1 0 0 1 1 1v3M19 15v3a1 1 0 0 1-1 1h-3M9 19H6a1 1 0 0 1-1-1v-3"/></g></symbol>' +
    '<symbol id="ic-fluent-grid-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/></g></symbol>' +
    '<symbol id="ic-fluent-home-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5L12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-7.5z"/></g></symbol>' +
    '<symbol id="ic-fluent-info-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 11.5v4.5"/><path d="M12 8.2h.01"/></g></symbol>' +
    '<symbol id="ic-fluent-mail-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM4.5 8l7.5 5 7.5-5"/></g></symbol>' +
    '<symbol id="ic-fluent-mail-inbox-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.8-6.2a1 1 0 0 1 1-.8h8.4a1 1 0 0 1 1 .8L19 13v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4zM5 13h4a3 3 0 0 0 6 0h4"/></g></symbol>' +
    '<symbol id="ic-fluent-money-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="10" rx="1.5"/><circle cx="12" cy="12" r="2.3"/><path d="M7 12h.01M17 12h.01"/></g></symbol>' +
    '<symbol id="ic-fluent-more-horizontal-24-regular" viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></g></symbol>' +
    '<symbol id="ic-fluent-open-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5M14 5h5v5M19 5l-8 8"/></g></symbol>' +
    '<symbol id="ic-fluent-person-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></g></symbol>' +
    '<symbol id="ic-fluent-person-add-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="8.5" r="3.3"/><path d="M3.5 19a6 6 0 0 1 11-3.3M18 8v6M15 11h6"/></g></symbol>' +
    '<symbol id="ic-fluent-phone-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5l3 .8 1 3.2-1.9 1.4a10 10 0 0 0 4.6 4.6l1.4-1.9 3.2 1 .8 3a1 1 0 0 1-1 1.1A13.5 13.5 0 0 1 5.4 5.5a1 1 0 0 1 1.1-1z"/></g></symbol>' +
    '<symbol id="ic-fluent-pause-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9.2 6v12M14.8 6v12"/></g></symbol>' +
    '<symbol id="ic-fluent-play-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5.5l10 6.5-10 6.5z"/></g></symbol>' +
    '<symbol id="ic-fluent-question-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.6c-.7.3-1.1 1-1.1 1.8"/><path d="M11.8 16.5h.01"/></g></symbol>' +
    '<symbol id="ic-fluent-re-order-dots-vertical-24-regular" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 17C16.3284 17 17 17.6716 17 18.5C17 19.3284 16.3284 20 15.5 20C14.6716 20 14 19.3284 14 18.5C14 17.6716 14.6716 17 15.5 17ZM8.5 17C9.32843 17 10 17.6716 10 18.5C10 19.3284 9.32843 20 8.5 20C7.67157 20 7 19.3284 7 18.5C7 17.6716 7.67157 17 8.5 17ZM15.5 10C16.3284 10 17 10.6716 17 11.5C17 12.3284 16.3284 13 15.5 13C14.6716 13 14 12.3284 14 11.5C14 10.6716 14.6716 10 15.5 10ZM8.5 10C9.32843 10 10 10.6716 10 11.5C10 12.3284 9.32843 13 8.5 13C7.67157 13 7 12.3284 7 11.5C7 10.6716 7.67157 10 8.5 10ZM15.5 3C16.3284 3 17 3.67157 17 4.5C17 5.32843 16.3284 6 15.5 6C14.6716 6 14 5.32843 14 4.5C14 3.67157 14.6716 3 15.5 3ZM8.5 3C9.32843 3 10 3.67157 10 4.5C10 5.32843 9.32843 6 8.5 6C7.67157 6 7 5.32843 7 4.5C7 3.67157 7.67157 3 8.5 3Z"/></symbol>' +
    '<symbol id="ic-fluent-receipt-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3V4zM9 8h6M9 11.5h6M9 15h4"/></g></symbol>' +
    '<symbol id="ic-fluent-search-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l4 4"/></g></symbol>' +
    '<symbol id="ic-fluent-settings-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 4v2.2M12 17.8V20M5 7.5l1.9 1.1M17.1 15.4L19 16.5M5 16.5l1.9-1.1M17.1 8.6L19 7.5"/></g></symbol>' +
    '<symbol id="ic-fluent-shield-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l7 2.5v5c0 5-3.5 8-7 9.5-3.5-1.5-7-4.5-7-9.5v-5L12 4zM9 12l2 2 4-4"/></g></symbol>' +
    '<symbol id="ic-fluent-speaker-2-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l4.5 3.5v-11L7 10H4z"/><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7.5a7 7 0 0 1 0 9"/></g></symbol>' +
    '<symbol id="ic-fluent-star-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L6.5 10l5.2-.8L12 4.5z"/></g></symbol>' +
    '<symbol id="ic-fluent-warning-24-regular" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l8.5 14.5H3.5L12 5z"/><path d="M12 10.5v4M12 17h.01"/></g></symbol>' +
    '<symbol id="ic-fluent-checkmark-circle-24-filled" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="currentColor"/><path d="M8.4 12.2l2.5 2.5 4.7-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="ic-fluent-warning-24-filled" viewBox="0 0 24 24"><path d="M11.1 5.2a1 1 0 0 1 1.8 0l8 14a1 1 0 0 1-.9 1.5H4a1 1 0 0 1-.9-1.5l8-14z" fill="currentColor"/><path d="M12 10v4M12 17h.01" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '</defs></svg>';

  /* ════════ Component markup (one copy injected per host div; each is its own
     Alpine root). Composed from the canonical bsp-design vocabulary. */
  var MARKUP =
    '<div class="spinner-row" data-lro-boot><span class="spinner spinner--16" aria-hidden="true"></span> Loading list ordering…</div>' +
    '<div class="lro" x-data="listReorderTool()" x-cloak>' +

    '  <div class="filterbar">' +
    '    <div class="filterbar__group">' +
    '      <span class="filterbar__label">List</span>' +
    '      <select class="select" style="width:auto" aria-label="Choose a list" x-model="listKey" @change="onListChange()" :disabled="loading || saving">' +
    '        <template x-for="l in (config ? config.lists : [])" :key="l.title">' +
    '          <option :value="l.title" x-text="l.label || l.title"></option>' +
    '        </template>' +
    '      </select>' +
    '    </div>' +
    '    <div class="filterbar__group" x-show="filterField" x-cloak>' +
    '      <span class="filterbar__label" x-text="filterField ? (filterField.label || filterField.internalName) : \'Filter\'"></span>' +
    '      <select class="select" style="width:auto" aria-label="Filter items" x-model="filterValue" :disabled="loading || saving">' +
    '        <option value="">All</option>' +
    '        <template x-for="c in filterChoices" :key="c"><option :value="c" x-text="c"></option></template>' +
    '      </select>' +
    '    </div>' +
    '    <span class="filterbar__spacer"></span>' +
    '    <span class="badge badge--warning" x-show="orderChanged" x-cloak>Unsaved order</span>' +
    '    <button class="btn btn--subtle" type="button" @click="reset()" :disabled="!orderChanged || saving">Reset</button>' +
    '    <button class="btn btn--primary" type="button" @click="save()" :disabled="!dirty || saving || loading">' +
    '      <span class="spinner spinner--16 spinner--on-accent" x-show="saving" x-cloak aria-hidden="true"></span>' +
    '      <span x-text="saving ? \'Saving…\' : \'Save order\'"></span>' +
    '    </button>' +
    '  </div>' +

    '  <div class="msgbar msgbar--danger" style="margin-top:var(--space-160)" x-show="error" x-cloak role="alert">' +
    '    <svg class="icon icon--20 msgbar__icon" aria-hidden="true"><use href="#ic-fluent-dismiss-circle-24-regular"></use></svg>' +
    '    <div class="msgbar__body" x-text="error"></div>' +
    '    <button class="icon-btn msgbar__close" type="button" aria-label="Dismiss error" @click="error = \'\'">' +
    '      <svg class="icon"><use href="#ic-fluent-dismiss-24-regular"></use></svg>' +
    '    </button>' +
    '  </div>' +
    '  <div class="msgbar msgbar--warning" style="margin-top:var(--space-160)" x-show="!loading && !error && warnText" x-cloak role="status">' +
    '    <svg class="icon icon--20 msgbar__icon" aria-hidden="true"><use href="#ic-fluent-warning-24-regular"></use></svg>' +
    '    <div class="msgbar__body" x-text="warnText"></div>' +
    '  </div>' +
    '  <div class="msgbar msgbar--info" style="margin-top:var(--space-160)" x-show="mock" x-cloak role="status">' +
    '    <svg class="icon icon--20 msgbar__icon" aria-hidden="true"><use href="#ic-fluent-info-24-regular"></use></svg>' +
    '    <div class="msgbar__body"><strong>Sample data.</strong> SharePoint isn’t reachable here, so the tool is running on built-in demo lists. Nothing is saved anywhere.</div>' +
    '  </div>' +

    '  <div class="card card--flush" style="margin-top:var(--space-160)">' +
    '    <div class="toolbar" style="border-radius:var(--radius-large) var(--radius-large) 0 0">' +
    '      <span class="toolbar__title" x-text="listCfg ? (listCfg.label || listCfg.title) : \'Items\'"></span>' +
    '      <span class="badge" x-show="!loading" x-text="visible.length + (visible.length === 1 ? \' item\' : \' items\')"></span>' +
    '      <span class="toolbar__spacer"></span>' +
    '      <span style="font:var(--type-caption1); color:var(--fg-secondary)">Drag rows or use the arrows, then Save</span>' +
    '    </div>' +
    '    <div class="lro__scroll">' +
    '    <table class="grid grid--reorder" :aria-describedby="hid">' +
    '      <thead><tr>' +
    '        <th class="grid__drag-handle"><span class="u-sr-only">Reorder handle</span></th>' +
    '        <th>Title</th>' +
    '        <template x-for="f in displayFields" :key="f.internalName">' +
    '          <th :class="f.type === \'Number\' ? \'num\' : null" x-text="f.label || f.internalName"></th>' +
    '        </template>' +
    '        <th class="num">Sort order</th>' +
    '        <th class="grid__move-cell"><span class="u-sr-only">Move</span></th>' +
    '      </tr></thead>' +
    '      <tbody>' +
    '        <tr x-show="loading" x-cloak><td :colspan="colCount"><div class="spinner-row"><span class="spinner spinner--16" aria-hidden="true"></span> Loading items…</div></td></tr>' +
    '        <tr x-show="!loading && !error && visible.length === 0" x-cloak><td :colspan="colCount">' +
    '          <div class="empty">' +
    '            <div class="empty__title">No items in this scope.</div>' +
    '            <div class="empty__hint">Pick another list or filter above, or add items to the list first.</div>' +
    '          </div>' +
    '        </td></tr>' +
    '        <template x-for="(row, i) in visible" :key="row.id">' +
    '          <tr draggable="true" x-show="!loading"' +
    '              @dragstart="onDragStart($event, row.id)"' +
    '              @dragover.prevent="onDragOver($event, row.id)"' +
    '              @drop.prevent="onDrop($event, row.id)"' +
    '              @dragend="onDragEnd()"' +
    '              :class="{ \'is-dragging\': dragId === row.id,' +
    '                        \'is-drop-before\': dropId === row.id && dropPos === \'before\' && dragId !== row.id,' +
    '                        \'is-drop-after\': dropId === row.id && dropPos === \'after\' && dragId !== row.id }">' +
    '            <td class="grid__drag-handle"><svg class="icon icon--16" aria-hidden="true"><use href="#ic-fluent-re-order-dots-vertical-24-regular"></use></svg></td>' +
    '            <td x-text="row.title"></td>' +
    '            <template x-for="f in displayFields" :key="f.internalName">' +
    '              <td class="cell-secondary" :class="f.type === \'Number\' ? \'num\' : null" x-text="fmt(row.fields[f.internalName], f)"></td>' +
    '            </template>' +
    '            <td class="num mono">' +
    '              <template x-if="row.needsPlacement"><span class="badge badge--warning">Needs placement</span></template>' +
    '              <template x-if="!row.needsPlacement"><span x-text="row.sort"></span></template>' +
    '            </td>' +
    '            <td class="grid__move-cell">' +
    '              <button class="icon-btn" type="button" @click="moveUp(row.id)" :disabled="i === 0 || saving" :aria-label="\'Move \' + row.title + \' up\'">' +
    '                <svg class="icon icon--16"><use href="#ic-fluent-arrow-up-24-regular"></use></svg>' +
    '              </button>' +
    '              <button class="icon-btn" type="button" @click="moveDown(row.id)" :disabled="i === visible.length - 1 || saving" :aria-label="\'Move \' + row.title + \' down\'">' +
    '                <svg class="icon icon--16"><use href="#ic-fluent-arrow-down-24-regular"></use></svg>' +
    '              </button>' +
    '            </td>' +
    '          </tr>' +
    '        </template>' +
    '      </tbody>' +
    '    </table>' +
    '    </div>' +
    '  </div>' +

    '  <p class="u-sr-only" :id="hid">Rows can be reordered. Drag a row with the mouse, or use the Move up and Move down buttons on each row. Changes are applied only when you choose Save order.</p>' +
    '  <span class="u-sr-only" aria-live="polite" x-text="announce"></span>' +

    '  <div class="toast" x-show="toastMsg" x-cloak role="status">' +
    '    <svg class="icon icon--20" aria-hidden="true"><use href="#ic-fluent-checkmark-circle-24-filled"></use></svg>' +
    '    <span x-text="toastMsg"></span>' +
    '    <button class="toast__close" type="button" aria-label="Dismiss" @click="hideToast()">' +
    '      <svg class="icon icon--16"><use href="#ic-fluent-dismiss-24-regular"></use></svg>' +
    '    </button>' +
    '  </div>' +

    '</div>';

  /* ════════ Alpine component factory (global — the injected markup's x-data). */
  window.listReorderTool = function () {
    return {
      hid: 'lro-help-' + (++seq),
      configUrl: '', config: null, api: null, mock: false,
      listKey: '', filterValue: '', filterChoices: [],
      items: [],      // working copy, in on-screen order: {id, title, sort, needsPlacement, fields}
      original: [],   // pristine snapshot of the fetched order: [{id, sort}]
      loading: true, saving: false, error: '', toastMsg: '', toastTimer: null,
      dragId: null, dropId: null, dropPos: 'before',
      announce: '',

      /* ---- derived state ---- */
      get listCfg() {
        if (!this.config) return null;
        for (var i = 0; i < this.config.lists.length; i++) {
          if (this.config.lists[i].title === this.listKey) return this.config.lists[i];
        }
        return null;
      },
      get filterField() { return (this.listCfg && this.listCfg.filterField) || null; },
      get displayFields() { return (this.listCfg && this.listCfg.displayFields) || []; },
      get colCount() { return 4 + this.displayFields.length; },
      get visible() {
        if (!this.filterField || !this.filterValue) return this.items;
        var name = this.filterField.internalName, val = this.filterValue;
        return this.items.filter(function (r) { return String(r.fields[name] == null ? '' : r.fields[name]) === val; });
      },
      // What Save writes: renumber the visible scope to GAP, 2*GAP…, keeping only rows whose stored value differs.
      get pending() {
        var out = [];
        this.visible.forEach(function (r, i) {
          var v = (i + 1) * GAP;
          if (r.sort !== v) out.push({ id: r.id, value: v });
        });
        return out;
      },
      get orderChanged() {
        var orig = this.original, byPos = {};
        for (var i = 0; i < orig.length; i++) byPos[orig[i].id] = i;
        var last = -1;
        for (var j = 0; j < this.items.length; j++) {
          var p = byPos[this.items[j].id];
          if (p < last) return true;
          last = p;
        }
        return false;
      },
      get needsCount() { return this.visible.filter(function (r) { return r.needsPlacement; }).length; },
      get truncated() { return this.items.length >= FETCH_TOP; },
      // Save is enabled for a manual reorder OR to normalize missing/duplicate values in scope.
      get dirty() { return (this.orderChanged || this.needsCount > 0) && this.pending.length > 0; },
      get warnText() {
        var parts = [];
        if (this.needsCount > 0) parts.push(this.needsCount + (this.needsCount === 1 ? ' item has' : ' items have') + ' a missing or duplicate sort value — Save will renumber everything shown here.');
        if (this.truncated) parts.push('Only the first ' + FETCH_TOP + ' items were loaded; reorder in a filtered scope instead.');
        return parts.join(' ');
      },

      /* ---- lifecycle ---- */
      async init() {
        var host = this.$el.closest(MOUNT_SELECTOR);
        if (host) {
          var boot = host.querySelector('[data-lro-boot]');
          if (boot) boot.parentNode.removeChild(boot);
        }
        this.configUrl = (host && host.getAttribute('data-config')) || 'sp-list-ordering.config.json';
        this.mock = window.location.protocol === 'file:' || typeof window.pnp === 'undefined';
        this.api = this.mock ? makeMockApi() : makeLiveApi(this.configUrl);
        try {
          this.config = validateConfig(await this.api.getConfig());
          this.listKey = this.config.lists[0].title;
          await this.load();
        } catch (e) {
          this.error = 'Could not start the list ordering tool: ' + (e.message || e);
          this.loading = false;
        }
      },
      async load() {
        var cfg = this.listCfg;
        if (!cfg) { this.loading = false; return; }
        this.loading = true; this.error = '';
        this.dragId = this.dropId = null;
        try {
          var raw = await this.api.getItems(cfg);
          var rows = raw.map(function (it) {
            var fields = {};
            (cfg.displayFields || []).forEach(function (f) { fields[f.internalName] = it[f.internalName]; });
            if (cfg.filterField) fields[cfg.filterField.internalName] = it[cfg.filterField.internalName];
            var sort = it[cfg.sortField];
            return {
              id: it.Id,
              title: it.Title == null || it.Title === '' ? '(no title)' : it.Title,
              sort: typeof sort === 'number' && isFinite(sort) ? sort : null,
              needsPlacement: false,
              fields: fields
            };
          });
          // Duplicates only collide within the same filter scope (e.g. the same
          // Category) — cross-scope duplicates are expected and harmless. With no
          // filterField the whole list is one scope.
          var scopeKey = function (r) {
            if (!cfg.filterField) return String(r.sort);
            var fv = r.fields[cfg.filterField.internalName];
            return String(fv == null ? '' : fv) + ' ' + r.sort;
          };
          var counts = {};
          rows.forEach(function (r) { if (r.sort !== null) { var k = scopeKey(r); counts[k] = (counts[k] || 0) + 1; } });
          rows.forEach(function (r) { r.needsPlacement = r.sort === null || counts[scopeKey(r)] > 1; });
          // Unplaced/colliding rows first (by ID), then everything else by sort value (ties by ID).
          rows.sort(function (a, b) {
            if (a.needsPlacement !== b.needsPlacement) return a.needsPlacement ? -1 : 1;
            if (a.needsPlacement) return a.id - b.id;
            return (a.sort - b.sort) || (a.id - b.id);
          });
          this.items = rows;
          this.original = rows.map(function (r) { return { id: r.id, sort: r.sort }; });
          this.filterChoices = this.filterField ? await this.api.getFilterChoices(cfg, rows) : [];
          if (this.filterValue && this.filterChoices.indexOf(this.filterValue) === -1) this.filterValue = '';
        } catch (e) {
          this.error = 'Could not load items from “' + cfg.title + '”: ' + (e.message || e);
          this.items = []; this.original = []; this.filterChoices = [];
        } finally {
          this.loading = false;
        }
      },
      onListChange() { this.filterValue = ''; this.load(); },
      reset() {
        var pos = {};
        this.original.forEach(function (o, i) { pos[o.id] = i; });
        this.items = this.items.slice().sort(function (a, b) { return pos[a.id] - pos[b.id]; });
        this.say('Order reset');
      },
      async save() {
        var cfg = this.listCfg;
        if (!cfg || !this.dirty || this.saving) return;
        this.saving = true; this.error = '';
        var changes = this.pending;
        try {
          await this.api.saveOrder(cfg, changes);
          await this.load();
          var msg = 'Order saved — ' + changes.length + (changes.length === 1 ? ' item' : ' items') + ' updated';
          this.toast(msg); this.say(msg);
        } catch (e) {
          // On failure keep the local order so nothing the user arranged is lost.
          this.error = 'Save failed: ' + (e.message || e) + ' Your on-screen order is unchanged — try Save again.';
        } finally {
          this.saving = false;
        }
      },

      /* ---- reordering ---- */
      moveNear(srcId, dstId, pos) {
        if (srcId === dstId) return;
        var from = -1, i;
        for (i = 0; i < this.items.length; i++) if (this.items[i].id === srcId) { from = i; break; }
        if (from < 0) return;
        var row = this.items.splice(from, 1)[0];
        var to = -1;
        for (i = 0; i < this.items.length; i++) if (this.items[i].id === dstId) { to = i; break; }
        if (to < 0) { this.items.splice(from, 0, row); return; }
        if (pos === 'after') to += 1;
        this.items.splice(to, 0, row);
        this.sayPosition(row);
      },
      moveUp(id) {
        var vis = this.visible, vi = -1;
        for (var i = 0; i < vis.length; i++) if (vis[i].id === id) { vi = i; break; }
        if (vi <= 0) return;
        this.moveNear(id, vis[vi - 1].id, 'before');
      },
      moveDown(id) {
        var vis = this.visible, vi = -1;
        for (var i = 0; i < vis.length; i++) if (vis[i].id === id) { vi = i; break; }
        if (vi < 0 || vi >= vis.length - 1) return;
        this.moveNear(id, vis[vi + 1].id, 'after');
      },

      /* ---- drag layer (hand-rolled HTML5 DnD) ---- */
      onDragStart(e, id) {
        this.dragId = id;
        try { e.dataTransfer.setData('text/plain', String(id)); } catch (err) { /* IE quirk */ }
        e.dataTransfer.effectAllowed = 'move';
      },
      onDragOver(e, id) {
        if (this.dragId === null || this.dragId === id) { this.dropId = null; return; }
        e.dataTransfer.dropEffect = 'move';
        var rect = e.currentTarget.getBoundingClientRect();
        this.dropPos = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
        this.dropId = id;
      },
      onDrop(e, id) {
        var src = this.dragId;
        if (src === null) {
          var data = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(data)) src = data;
        }
        if (src !== null && src !== id) this.moveNear(src, id, this.dropPos);
        this.onDragEnd();
      },
      onDragEnd() { this.dragId = null; this.dropId = null; },

      /* ---- output helpers ---- */
      fmt(v, f) {
        if (v === null || v === undefined || v === '') return '—';
        if (f.type === 'DateTime') {
          var d = new Date(v);
          return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
        }
        if (typeof v === 'object') return v.Title || v.LookupValue || '—';
        return String(v);
      },
      say(msg) {
        var self = this;
        this.announce = '';
        window.setTimeout(function () { self.announce = msg; }, 30);
      },
      sayPosition(row) {
        var vis = this.visible, n = vis.length, at = 0;
        for (var i = 0; i < n; i++) if (vis[i].id === row.id) { at = i + 1; break; }
        this.say('Moved “' + row.title + '” to position ' + at + ' of ' + n);
      },
      toast(msg) {
        var self = this;
        this.toastMsg = msg;
        if (this.toastTimer) window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(function () { self.toastMsg = ''; }, 4000);
      },
      hideToast() {
        if (this.toastTimer) window.clearTimeout(this.toastTimer);
        this.toastMsg = '';
      }
    };
  };

  /* ════════ Config validation ════════ */
  function validateConfig(cfg) {
    if (!cfg || !Array.isArray(cfg.lists) || cfg.lists.length === 0) {
      throw new Error('the config JSON has no "lists" array.');
    }
    cfg.lists.forEach(function (l) {
      if (!l.title) throw new Error('a config list entry is missing "title".');
      if (!l.sortField) throw new Error('config list “' + l.title + '” is missing "sortField".');
      l.displayFields = (l.displayFields || []).slice(0, 4);
      if (l.filterField && !l.filterField.internalName) {
        throw new Error('config list “' + l.title + '” has a filterField without "internalName".');
      }
    });
    return cfg;
  }

  function distinctValues(rows, fieldName) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = r.fields ? r.fields[fieldName] : r[fieldName];
      if (v === null || v === undefined || v === '') return;
      v = String(v);
      if (!seen[v]) { seen[v] = true; out.push(v); }
    });
    return out.sort();
  }

  /* ════════ Live adapter — PnPjs v2 (global `pnp`), the only place SharePoint
     is touched. Swap this object out to change the transport. ════════ */
  function makeLiveApi(configUrl) {
    return {
      getConfig: async function () {
        var res = await window.fetch(configUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('config fetch failed (' + res.status + ') for ' + configUrl);
        var cfg = await res.json();
        var ctx = window._spPageContextInfo;
        var baseUrl = (ctx && (ctx.webAbsoluteUrl || ctx.webServerRelativeUrl)) || cfg.webUrl;
        if (!baseUrl) throw new Error('no web URL — set "webUrl" in the config JSON.');
        window.pnp.sp.setup({ sp: { baseUrl: baseUrl } });
        return cfg;
      },
      getFilterChoices: async function (cfg, rows) {
        var ff = cfg.filterField;
        if (ff.type === 'Choice') {
          try {
            var field = await window.pnp.sp.web.lists.getByTitle(cfg.title)
              .fields.getByInternalNameOrTitle(ff.internalName)
              .select('Choices', 'TypeAsString').get();
            if (field && field.Choices && field.Choices.length) return field.Choices;
          } catch (e) { /* fall back to observed values */ }
        }
        return distinctValues(rows, ff.internalName);
      },
      getItems: async function (cfg) {
        var select = ['Id', 'Title', cfg.sortField];
        (cfg.displayFields || []).forEach(function (f) { select.push(f.internalName); });
        if (cfg.filterField) select.push(cfg.filterField.internalName);
        var uniq = select.filter(function (s, i) { return select.indexOf(s) === i; });
        var items = window.pnp.sp.web.lists.getByTitle(cfg.title).items;
        return items.select.apply(items, uniq).top(FETCH_TOP).orderBy(cfg.sortField, true).get();
      },
      saveOrder: async function (cfg, changes) {
        var list = window.pnp.sp.web.lists.getByTitle(cfg.title);
        for (var i = 0; i < changes.length; i += 100) {
          var chunk = changes.slice(i, i + 100);
          var batch = window.pnp.sp.web.createBatch();
          chunk.forEach(function (c) {
            var payload = {};
            payload[cfg.sortField] = c.value;
            list.items.getById(c.id).inBatch(batch).update(payload, '*');
          });
          await batch.execute();
        }
      }
    };
  }

  /* ════════ Mock adapter — canned data so the tool runs from disk / outside
     SharePoint. Includes one missing and one duplicated sort value on purpose. */
  function makeMockApi() {
    var MOCK_CONFIG = {
      webUrl: '/sites/FCUPortal',
      lists: [
        {
          title: 'FAQ Entries', label: 'FAQ entries', sortField: 'SortOrder',
          filterField: { internalName: 'Category', label: 'Category', type: 'Choice' },
          displayFields: [
            { internalName: 'Category', label: 'Category', type: 'Choice' },
            { internalName: 'Owner', label: 'Owner', type: 'Text' },
            { internalName: 'Modified', label: 'Modified', type: 'DateTime' }
          ]
        },
        {
          title: 'Quick Links', label: 'Quick links', sortField: 'SortOrder',
          displayFields: [{ internalName: 'Url', label: 'Destination', type: 'Text' }]
        }
      ]
    };
    var MOCK_ITEMS = {
      'FAQ Entries': [
        { Id: 11, Title: 'How do I reset my password?', SortOrder: 10, Category: 'Accounts', Owner: 'S. Chen', Modified: '2026-07-14T09:30:00Z' },
        { Id: 12, Title: 'Where do I see pending transfers?', SortOrder: 20, Category: 'Accounts', Owner: 'S. Chen', Modified: '2026-06-02T14:10:00Z' },
        { Id: 13, Title: 'How do I close an account?', SortOrder: 30, Category: 'Accounts', Owner: 'R. Kumar', Modified: '2026-08-01T11:00:00Z' },
        { Id: 14, Title: 'What are the card limits?', SortOrder: 10, Category: 'Cards', Owner: 'M. Ortiz', Modified: '2026-05-19T08:45:00Z' },
        { Id: 15, Title: 'How do I report a lost card?', SortOrder: 20, Category: 'Cards', Owner: 'M. Ortiz', Modified: '2026-07-30T16:20:00Z' },
        { Id: 16, Title: 'Can I get a virtual card?', SortOrder: 30, Category: 'Cards', Owner: 'A. Torres', Modified: '2026-08-12T10:05:00Z' },
        { Id: 17, Title: 'How do I dispute a charge?', SortOrder: 30, Category: 'Cards', Owner: 'A. Torres', Modified: '2026-08-15T13:40:00Z' }, // duplicate of 16 on purpose
        { Id: 18, Title: 'What rates apply to new loans?', SortOrder: 10, Category: 'Loans', Owner: 'J. Lee', Modified: '2026-04-22T09:00:00Z' },
        { Id: 19, Title: 'How long does approval take?', SortOrder: 20, Category: 'Loans', Owner: 'J. Lee', Modified: '2026-06-18T15:55:00Z' },
        { Id: 20, Title: 'Can I repay early without fees?', SortOrder: null, Category: 'Loans', Owner: 'J. Lee', Modified: '2026-08-20T12:30:00Z' }, // missing on purpose
        { Id: 21, Title: 'Which documents do I need?', SortOrder: 40, Category: 'Loans', Owner: 'P. Singh', Modified: '2026-07-07T10:15:00Z' },
        { Id: 22, Title: 'How do I contact loan support?', SortOrder: 50, Category: 'Loans', Owner: 'P. Singh', Modified: '2026-08-19T17:25:00Z' }
      ],
      'Quick Links': [
        { Id: 31, Title: 'Payroll calendar', SortOrder: 10, Url: 'intranet/payroll' },
        { Id: 32, Title: 'Expense portal', SortOrder: 20, Url: 'intranet/expenses' },
        { Id: 33, Title: 'IT service desk', SortOrder: 30, Url: 'intranet/helpdesk' },
        { Id: 34, Title: 'Branch directory', SortOrder: 40, Url: 'intranet/branches' },
        { Id: 35, Title: 'Benefits hub', SortOrder: 50, Url: 'intranet/benefits' }
      ]
    };
    function delay(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }
    return {
      getConfig: async function () { await delay(250); return JSON.parse(JSON.stringify(MOCK_CONFIG)); },
      getFilterChoices: async function (cfg, rows) { await delay(80); return distinctValues(rows, cfg.filterField.internalName); },
      getItems: async function (cfg) { await delay(350); return JSON.parse(JSON.stringify(MOCK_ITEMS[cfg.title] || [])); },
      saveOrder: async function (cfg, changes) {
        await delay(450);
        var items = MOCK_ITEMS[cfg.title] || [];
        changes.forEach(function (c) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].Id === c.id) { items[i][cfg.sortField] = c.value; break; }
          }
        });
      }
    };
  }

  /* ════════ Boot — SharePoint renders web part markup on its own schedule, so a
     plain timer + DOM check is the reliable primary mechanism (a MutationObserver
     is attached as an accelerator only). Swappable for the house wait pattern. */
  function waitFor(test, opts) {
    opts = opts || {};
    var interval = opts.interval || 150;
    var timeout = opts.timeout || 20000;
    return new Promise(function (resolve, reject) {
      var timer = null, mo = null, start = Date.now(), done = false;
      function finish(ok, v) {
        if (done) return;
        done = true;
        if (timer) window.clearInterval(timer);
        if (mo) mo.disconnect();
        if (ok) resolve(v); else reject(new Error('waitFor timed out'));
      }
      function tick() {
        var v = null;
        try { v = test(); } catch (e) { v = null; }
        if (v) { finish(true, v); return; }
        if (Date.now() - start > timeout) finish(false);
      }
      timer = window.setInterval(tick, interval);
      if (opts.observe && window.MutationObserver && document.documentElement) {
        mo = new MutationObserver(tick);
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
      tick();
    });
  }

  function injectSprite() {
    if (document.getElementById(SPRITE_WRAP_ID)) return;
    var holder = document.createElement('div');
    holder.id = SPRITE_WRAP_ID;
    holder.setAttribute('aria-hidden', 'true');
    holder.style.display = 'none';
    holder.innerHTML = SPRITE;
    document.body.insertBefore(holder, document.body.firstChild);
  }

  function plainError(msg) {
    return '<div class="msgbar msgbar--danger" role="alert">' +
      '<svg class="icon icon--20 msgbar__icon" aria-hidden="true"><use href="#ic-fluent-dismiss-circle-24-regular"></use></svg>' +
      '<div class="msgbar__body">' + msg + '</div></div>';
  }

  function mountAll() {
    injectSprite();
    var hosts = document.querySelectorAll(MOUNT_SELECTOR + ':not([data-lro-mounted])');
    for (var i = 0; i < hosts.length; i++) {
      hosts[i].setAttribute('data-lro-mounted', '');
      hosts[i].innerHTML = MARKUP;
    }
  }

  waitFor(function () { return document.querySelector(MOUNT_SELECTOR + ':not([data-lro-mounted])'); },
    { observe: true, timeout: 30000 })
    .then(function () {
      mountAll();
      // Alpine v3 auto-initializes trees that are already in (or later added to)
      // the document, so mounting before or after Alpine starts both work. We
      // only wait here so a missing script tag produces a visible error.
      return waitFor(function () { return window.Alpine; }, { timeout: 20000 }).catch(function () {
        var hosts = document.querySelectorAll(MOUNT_SELECTOR);
        for (var i = 0; i < hosts.length; i++) {
          hosts[i].innerHTML = plainError('Alpine.js did not load — check the alpine.js script URL in the web part HTML.');
        }
      });
    })
    .catch(function () { /* no host div on this page — nothing to mount */ });
})();
