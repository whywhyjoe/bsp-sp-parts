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
    { InternalName: 'Justification', Title: 'Justification', TypeAsString: 'Note', RichText: true, Required: false, ReadOnlyField: false },
    { InternalName: 'EstimatedCost', Title: 'Estimated cost', TypeAsString: 'Currency', Required: false, ReadOnlyField: false },
    { InternalName: 'VendorLink', Title: 'Vendor link', TypeAsString: 'URL', Required: false, ReadOnlyField: false },
    { InternalName: 'AssetTeam', Title: 'Asset team', TypeAsString: 'Lookup', Required: false, ReadOnlyField: false },
    { InternalName: 'NeededBy', Title: 'Needed by', TypeAsString: 'DateTime', Required: false, ReadOnlyField: false },
    { InternalName: 'Urgency', Title: 'Urgency', TypeAsString: 'Choice', Required: false, ReadOnlyField: false },
    { InternalName: 'SourceTeam', Title: 'Source team', TypeAsString: 'Text', Required: false, ReadOnlyField: false },
    { InternalName: 'IsRecurring', Title: 'Recurring', TypeAsString: 'Boolean', Required: false, ReadOnlyField: false },
    { InternalName: 'RecurrenceEnd', Title: 'Recurring until', TypeAsString: 'DateTime', Required: false, ReadOnlyField: false },
    { InternalName: 'ManagerAware', Title: 'Manager aware', TypeAsString: 'Boolean', Required: false, ReadOnlyField: false },
    { InternalName: 'AccessLevel', Title: 'Access level', TypeAsString: 'Choice', Required: false, ReadOnlyField: false },
    { InternalName: 'Quantity', Title: 'Quantity', TypeAsString: 'Number', Required: false, ReadOnlyField: false },
    { InternalName: 'ImpactScore', Title: 'Impact score', TypeAsString: 'Number', Required: false, ReadOnlyField: false }
  ];
  /* The builder's reads (BSPForms.lists()): a small mock tenant. The schema
     mirrors the dev list BSPF Builder Test (dev/live/live-builder-list.ps1),
     as the real adapter returns it after B0's probe — unbounded Number limits
     already null, Choices as arrays. */
  var MOCK_LISTS = [
    { id: 'c279b324-0000-4000-8000-000000000001', title: 'BSPF Builder Test', url: '/sites/FCUPortal/Lists/BSPFBuilderTest', enableAttachments: true, itemCount: 6 },
    { id: 'c279b324-0000-4000-8000-000000000002', title: 'IT Requests', url: '/sites/FCUPortal/Lists/IT Requests', enableAttachments: true, itemCount: 42 },
    { id: 'c279b324-0000-4000-8000-000000000003', title: 'No Attachments', url: '/sites/FCUPortal/Lists/NoAttachments', enableAttachments: false, itemCount: 0 }
  ];
  function sf(name, type, extra) {
    var o = { InternalName: name, EntityPropertyName: name.charAt(0) === '_' ? 'OData_' + name : name, Title: name,
      TypeAsString: type, Required: false, ReadOnlyField: false, FromBaseType: false, Sealed: false, Hidden: false, EnforceUniqueValues: false };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var BUILDER_TEST_FIELDS = [
    sf('Title', 'Text', { Required: true, FromBaseType: true, MaxLength: 255 }),
    sf('TxtShort', 'Text', { MaxLength: 50 }),
    sf('TxtReq', 'Text', { Required: true, MaxLength: 255 }),
    sf('TxtDefault', 'Text', { DefaultValue: 'Hello', MaxLength: 255 }),
    sf('NotePlain', 'Note', { RichText: false, AppendOnly: false, NumberOfLines: 6 }),
    sf('NoteRich', 'Note', { RichText: true, AppendOnly: false, NumberOfLines: 6 }),
    sf('NumPlain', 'Number', { DisplayFormat: 0, MinimumValue: 0, MaximumValue: 100, ShowAsPercentage: false }),
    sf('NumDefault', 'Number', { DefaultValue: '7', DisplayFormat: -1, MinimumValue: null, MaximumValue: null, ShowAsPercentage: false }),
    sf('NumPct', 'Number', { DisplayFormat: -1, MinimumValue: null, MaximumValue: null, ShowAsPercentage: true }),
    sf('Money', 'Currency', { DisplayFormat: -1, MinimumValue: null, MaximumValue: null }),
    sf('ChoiceA', 'Choice', { DefaultValue: 'Medium', Choices: ['Low', 'Medium', 'High'], FillInChoice: false }),
    sf('ChoiceFill', 'Choice', { Choices: ['Alpha', 'Beta'], FillInChoice: true }),
    sf('ChoiceReqDef', 'Choice', { Required: true, DefaultValue: 'Standard', Choices: ['Standard', 'Urgent'], FillInChoice: false }),
    sf('Multi', 'MultiChoice', { Choices: ['Red', 'Green', 'Blue'], FillInChoice: false }),
    sf('DateOnlyCol', 'DateTime', { DisplayFormat: 0 }),
    sf('DateTimeCol', 'DateTime', { DisplayFormat: 1 }),
    sf('YesNo', 'Boolean', { DefaultValue: '0' }),
    sf('Person', 'User', { AllowMultipleValues: false, SelectionMode: 0 }),
    sf('People', 'UserMulti', { AllowMultipleValues: true, SelectionMode: 0 }),
    sf('LinkCol', 'URL', { DisplayFormat: 0 }),
    sf('PicCol', 'URL', { DisplayFormat: 1 }),
    sf('UniqueCode', 'Text', { MaxLength: 255, EnforceUniqueValues: true }),
    sf('EvenNum', 'Number', { DisplayFormat: -1, MinimumValue: null, MaximumValue: null, ValidationFormula: '=MOD(EvenNum,2)=0' }),
    sf('CalcCol', 'Calculated', { ReadOnlyField: true }),
    sf('_Under', 'Text', { MaxLength: 255 }),
    sf('LookupCol', 'Lookup', { AllowMultipleValues: false, LookupList: '{eae80cf6-e4fd-4b50-b006-80242686d744}' }),
    sf('_x0032_Num', 'Number', { DisplayFormat: -1, MinimumValue: null, MaximumValue: null })
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
      // BSPF_MOCK_FAIL.addItemAfter = n: the first n adds succeed, then they fail
      var F = window.BSPF_MOCK_FAIL || {};
      var adds = writes.filter(function (w) { return w.op === 'addItem'; }).length;
      if (F.addItemAfter != null && adds >= F.addItemAfter) {
        return Promise.reject(new Error('mock addItem failure after ' + F.addItemAfter + ' (BSPF_MOCK_FAIL.addItemAfter)'));
      }
      // BSPF_MOCK_FAIL.addItemLostAfter = n: after n good adds, the next add
      // LANDS (it's recorded) but the browser never hears back — the
      // "committed, response lost" case
      if (F.addItemLostAfter != null && adds >= F.addItemLostAfter && !F.__lost) {
        F.__lost = true;
        writes.push({ op: 'addItem', id: ++nextId, payload: JSON.parse(JSON.stringify(payload)), lost: true });
        return delay(null, 200).then(function () { throw new Error('mock: response lost after the add landed (BSPF_MOCK_FAIL.addItemLostAfter)'); });
      }
      var id = ++nextId;
      writes.push({ op: 'addItem', id: id, payload: JSON.parse(JSON.stringify(payload)) });
      console.info('[mock-sp] addItem #' + id, payload);
      // BSPF_MOCK_ADD_MS: how long an add takes (default 500)
      var ms = window.BSPF_MOCK_ADD_MS != null ? window.BSPF_MOCK_ADD_MS : 500;
      return delay({ id: id, item: { __mockItemId: id, attachmentFiles: { add: function () { } } } }, ms);
    },
    addAttachment: function (itemRef, name, file) {
      var fail = maybeFail('addAttachment');
      if (fail) return fail;
      writes.push({ op: 'addAttachment', itemId: itemRef.__mockItemId, name: name, size: file.size });
      console.info('[mock-sp] addAttachment', name, file.size + 'B');
      return delay(null, 300);
    },
    // afterSubmit lookup: window.BSPF_MOCK_LOOKUP maps match value -> URL
    // (case-insensitive like SharePoint text compares); a Hyperlink-shaped
    // { Url } value is unwrapped the same way the real adapter does
    lookupValue: function (lk) {
      var fail = maybeFail('lookupValue');
      if (fail) return fail;
      writes.push({ op: 'lookup', matchColumn: lk.matchColumn, value: lk.value, list: lk.listUrl || lk.listTitle });
      var table = window.BSPF_MOCK_LOOKUP || { 'policy library': { Url: 'https://example.com/policy-library-new' } };
      var hit = null;
      Object.keys(table).forEach(function (k) { if (k.toLowerCase() === String(lk.value).toLowerCase()) hit = table[k]; });
      if (hit && typeof hit === 'object') hit = hit.Url;
      return delay(hit || null, 250);
    },
    getListFields: function (spec) {
      if (spec) {
        return delay([
          { InternalName: 'ResourceName', Title: 'ResourceName', TypeAsString: 'Text', Required: false, ReadOnlyField: false },
          { InternalName: 'URL', Title: 'URL', TypeAsString: 'URL', Required: false, ReadOnlyField: false }
        ], 200);
      }
      return delay(LIST_FIELDS, 200);
    },
    getLookupItems: function () {
      return maybeFail('getLookupItems') || delay(LOOKUP_ITEMS, 400);
    },
    // builder reads — same shapes as the real adapter
    getWebLists: function (webUrl) {
      var fail = maybeFail('getWebLists');
      if (fail) return fail;
      writes.push({ op: 'getWebLists', webUrl: webUrl || null });
      return delay(JSON.parse(JSON.stringify(MOCK_LISTS)), 200);
    },
    getListSchema: function (spec) {
      var fail = maybeFail('getListSchema');
      if (fail) return fail;
      writes.push({ op: 'getListSchema', listId: spec.listId || null, listUrl: spec.listUrl || null });
      var l = MOCK_LISTS.filter(function (x) { return x.id === spec.listId || x.url === spec.listUrl; })[0];
      if (!l) return Promise.reject(new Error('mock: list not found'));
      var fields = l.title === 'BSPF Builder Test' ? BUILDER_TEST_FIELDS
        : l.title === 'IT Requests' ? LIST_FIELDS.map(function (f) { return sf(f.InternalName, f.TypeAsString, { Required: f.Required, RichText: f.RichText }); })
          : [sf('Title', 'Text', { Required: true, FromBaseType: true, MaxLength: 255 }), sf('Notes', 'Note', { RichText: false })];
      return delay({
        list: { id: l.id, title: l.title, url: l.url, enableAttachments: l.enableAttachments, validationFormula: '' },
        fields: JSON.parse(JSON.stringify(fields))
      }, 250);
    },
    // assignments: window.BSPF_MOCK_ASSIGNMENTS (rows, each with ID + the
    // source columns and the user column) filtered like the real adapter —
    // userColumn equal to any of the user's addresses, case-insensitive
    getAssignments: function (src, emails) {
      var fail = maybeFail('getAssignments');
      if (fail) return fail;
      writes.push({ op: 'getAssignments', list: src.listUrl || src.listTitle, emails: emails.slice() });
      var max = src.top || 500;
      var rows = (window.BSPF_MOCK_ASSIGNMENTS || ASSIGNMENTS).filter(function (r) {
        return emails.indexOf(String(r[src.userColumn] || '').toLowerCase()) > -1;
      }).map(function (r) {
        var o = { ID: r.ID };
        src._cols.forEach(function (c) { o[c] = r[c] == null ? '' : r[c]; });
        return o;
      }).sort(function (a, b) {
        var c = src.orderBy || src.labelColumn;
        return String(a[c]).localeCompare(String(b[c]));
      });
      // same shape as the real adapter: cut at max, say if there were more
      return delay({ rows: rows.slice(0, max), more: rows.length > max }, 450);
    },
    // keys already saved for this user: window.BSPF_MOCK_DONE plus every
    // row this page has saved through addItem (including a "lost" one).
    // window.BSPF_MOCK_KEYS_CAP = n: the read returns only the first n keys
    // and reports itself cut off — like the real adapter past ROW_KEYS_MAX.
    getRowKeys: function (rk) {
      var fail = maybeFail('getRowKeys');
      if (fail) return fail;
      var keys = (window.BSPF_MOCK_DONE || []).map(String);
      writes.forEach(function (w) {
        if (w.op === 'addItem' && w.payload[rk.keyColumn] != null) keys.push(String(w.payload[rk.keyColumn]));
      });
      writes.push({ op: 'getRowKeys' });
      var cap = window.BSPF_MOCK_KEYS_CAP;
      return delay(cap != null && keys.length > cap ? { keys: keys.slice(0, cap), more: true } : { keys: keys, more: false }, 200);
    },
    // the exact check for a few keys (no cap), as the real adapter does
    getRowKeysFor: function (rk, emails, values) {
      var fail = maybeFail('getRowKeysFor');
      if (fail) return fail;
      writes.push({ op: 'getRowKeysFor', values: values.slice() });
      var keys = (window.BSPF_MOCK_DONE || []).map(String);
      writes.forEach(function (w) {
        if (w.op === 'addItem' && w.payload[rk.keyColumn] != null) keys.push(String(w.payload[rk.keyColumn]));
      });
      var want = values.map(String);
      return delay(keys.filter(function (k) { return want.indexOf(k) > -1; }), 150);
    }
  };
  // what the dev tester is assigned (plus a row for someone else, which the
  // user filter must drop)
  var ASSIGNMENTS = [
    { ID: 11, UserEmail: 'Dev.Tester@example.com', UserDescription: 'Branch manager', AreaName: 'Floor 3 — East wing' },
    { ID: 12, UserEmail: 'dev.tester@example.com', UserDescription: 'Branch manager', AreaName: 'Floor 1 — Lobby & vault' },
    { ID: 13, UserEmail: 'dev.tester@example.com', UserDescription: 'Branch manager', AreaName: 'Parking level P2' },
    { ID: 14, UserEmail: 'someone.else@example.com', UserDescription: 'Facilities', AreaName: 'Data centre — Hall B' }
  ];
  // per-list schemas for the doctor (window.BSPF_MOCK_FIELDS[listTitle] wins)
  var ZONE_FIELDS = {
    'Workplace Requests': ['Title:Text', 'Requester:User', 'RequestType:Choice', 'OtherDetails:Note', 'HasDeadline:Boolean',
      'Ergonomic:Boolean', 'Item:Choice', 'Quantity:Number', 'Attendees:Number', 'BookingDate:DateTime', 'Deadline:DateTime',
      'Notes:Note', '_Ref:Text'],
    'PS_Zone-Attestation-Assignments': ['UserEmail:Text', 'UserDescription:Text', 'AreaName:Text'],
    'PS_Zone-Attestation-Responses': ['Title:Text', 'LookupID:Number', 'UserName:Text', 'UserEmail:Text', 'UserDescription:Text',
      'AreaName:Text', 'ZoneSelection:Text', 'Attestation:Text', 'AttestationTime:DateTime']
  };
  function fieldsOf(defs) {
    return defs.map(function (d) {
      var p = d.split(':');
      return { InternalName: p[0], Title: p[0], TypeAsString: p[1], Required: p[0] === 'Title', ReadOnlyField: false };
    });
  }
  var baseFields = window.BSPF_MOCK_SP.getListFields;
  window.BSPF_MOCK_SP.getListFields = function (spec, target) {
    var name = spec ? (spec.listTitle || spec.listUrl) : (window.BSPF_MOCK_TARGET || null);
    var custom = window.BSPF_MOCK_FIELDS && name && window.BSPF_MOCK_FIELDS[name];
    if (custom) return delay(custom, 200);
    if (name && ZONE_FIELDS[name]) return delay(fieldsOf(ZONE_FIELDS[name]), 200);
    return baseFields(spec, target);
  };
})();
