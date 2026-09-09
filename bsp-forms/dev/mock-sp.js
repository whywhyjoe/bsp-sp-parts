/*! BSP Forms · v0.1.0 · dev/mock-sp.js — dev-only SharePoint mock */
/* =====================================================================
   A stand-in for the pnpjs adapter so the form runs with zero network
   and zero tenant. Load it before bsp-forms.js and pass it via:

     window.BSP_FORMS_SETTINGS = { mockSp: window.BSPF_MOCK_SP, ... };

   Every write is recorded on window.__BSPF_MOCK_WRITES__ so a test (or
   you, in devtools) can assert exactly what would have hit SharePoint.
   Set window.BSPF_MOCK_FAIL = { addItem: true } (or addAttachment /
   searchPeople / getLookupItems) to exercise the error paths.
   ===================================================================== */
(function () {
  'use strict';

  var PEOPLE = [
    { key: 'i:0#.f|membership|sofia.chen@example.com', text: 'Sofia Chen', email: 'sofia.chen@example.com' },
    { key: 'i:0#.f|membership|marcus.osei@example.com', text: 'Marcus Osei', email: 'marcus.osei@example.com' },
    { key: 'i:0#.f|membership|priya.patel@example.com', text: 'Priya Patel', email: 'priya.patel@example.com' },
    { key: 'i:0#.f|membership|jean.tremblay@example.com', text: 'Jean Tremblay', email: 'jean.tremblay@example.com' },
    { key: 'i:0#.f|membership|amara.diallo@example.com', text: 'Amara Diallo', email: 'amara.diallo@example.com' },
    { key: 'i:0#.f|membership|liam.oconnor@example.com', text: 'Liam O’Connor', email: 'liam.oconnor@example.com' },
    { key: 'i:0#.f|membership|yuki.tanaka@example.com', text: 'Yuki Tanaka', email: 'yuki.tanaka@example.com' }
  ];
  var LOOKUP_ITEMS = [
    { id: 1, text: 'End-user computing' },
    { id: 2, text: 'Collaboration platforms' },
    { id: 3, text: 'Data & reporting' },
    { id: 4, text: 'Core infrastructure' }
  ];
  var LIST_FIELDS = [
    { InternalName: 'Title', Title: 'Title', TypeAsString: 'Text', Required: true, ReadOnlyField: false },
    { InternalName: 'RequestFor', Title: 'Request for', TypeAsString: 'User', Required: true, ReadOnlyField: false },
    { InternalName: 'CcPeople', Title: 'Cc', TypeAsString: 'UserMulti', Required: false, ReadOnlyField: false },
    { InternalName: 'ContactEmail', Title: 'Contact email', TypeAsString: 'Text', Required: false, ReadOnlyField: false },
    { InternalName: 'ContactPhone', Title: 'Contact phone', TypeAsString: 'Text', Required: false, ReadOnlyField: false },
    { InternalName: 'CostCentre', Title: 'Cost centre', TypeAsString: 'Text', Required: false, ReadOnlyField: false },
    { InternalName: 'Category', Title: 'Category', TypeAsString: 'Choice', Required: false, ReadOnlyField: false },
    { InternalName: 'SubCategory', Title: 'Sub-category', TypeAsString: 'Choice', Required: false, ReadOnlyField: false },
    { InternalName: 'AccessSystems', Title: 'Access systems', TypeAsString: 'MultiChoice', Required: false, ReadOnlyField: false },
    { InternalName: 'Justification', Title: 'Justification', TypeAsString: 'Note', Required: false, ReadOnlyField: false },
    { InternalName: 'EstimatedCost', Title: 'Estimated cost', TypeAsString: 'Currency', Required: false, ReadOnlyField: false },
    { InternalName: 'VendorLink', Title: 'Vendor link', TypeAsString: 'URL', Required: false, ReadOnlyField: false },
    { InternalName: 'AssetTeam', Title: 'Asset team', TypeAsString: 'Lookup', Required: false, ReadOnlyField: false },
    { InternalName: 'NeededBy', Title: 'Needed by', TypeAsString: 'DateTime', Required: false, ReadOnlyField: false },
    { InternalName: 'IsRecurring', Title: 'Recurring', TypeAsString: 'Boolean', Required: false, ReadOnlyField: false },
    { InternalName: 'RecurrenceEnd', Title: 'Recurring until', TypeAsString: 'DateTime', Required: false, ReadOnlyField: false },
    { InternalName: 'ManagerAware', Title: 'Manager aware', TypeAsString: 'Boolean', Required: false, ReadOnlyField: false }
  ];

  var writes = window.__BSPF_MOCK_WRITES__ = [];
  var nextId = 100;
  function delay(v, ms) {
    return new Promise(function (res) { setTimeout(function () { res(v); }, ms == null ? 250 : ms); });
  }
  function maybeFail(op) {
    var f = window.BSPF_MOCK_FAIL || {};
    if (f[op]) return Promise.reject(new Error('mock ' + op + ' failure (BSPF_MOCK_FAIL.' + op + ')'));
    return null;
  }

  window.BSPF_MOCK_SP = {
    isMock: true,
    webUrl: function () { return 'https://mock.local/sites/FCUPortal'; },
    ready: function () { return Promise.resolve(); },
    userInfo: function () { return { name: 'Dev Tester', email: 'dev.tester@example.com', login: 'i:0#.f|membership|dev.tester@example.com' }; },
    photoUrl: function () { return 'about:invalid'; }, // force the initials fallback
    searchPeople: function (q) {
      return maybeFail('searchPeople') || delay(PEOPLE.filter(function (p) {
        var s = q.toLowerCase();
        return p.text.toLowerCase().indexOf(s) > -1 || p.email.indexOf(s) > -1;
      }), 350);
    },
    ensureUser: function (key) {
      var i = PEOPLE.findIndex(function (p) { return p.key === key; });
      return delay(i > -1 ? 1000 + i : 999, 120);
    },
    addItem: function (payload) {
      var fail = maybeFail('addItem');
      if (fail) return fail;
      var id = ++nextId;
      writes.push({ op: 'addItem', id: id, payload: JSON.parse(JSON.stringify(payload)) });
      console.info('[mock-sp] addItem #' + id, payload);
      return delay({ id: id, item: { __mockItemId: id, attachmentFiles: { add: function () { } } } }, 500);
    },
    addAttachment: function (itemRef, name, file) {
      var fail = maybeFail('addAttachment');
      if (fail) return fail;
      writes.push({ op: 'addAttachment', itemId: itemRef.__mockItemId, name: name, size: file.size });
      console.info('[mock-sp] addAttachment', name, file.size + 'B');
      return delay(null, 300);
    },
    getListFields: function () { return delay(LIST_FIELDS, 200); },
    getLookupItems: function () {
      return maybeFail('getLookupItems') || delay(LOOKUP_ITEMS, 400);
    }
  };
})();
