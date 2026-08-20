
(function () {
  'use strict';
  var jsPDF = window.jspdf.jsPDF;
  var F = window.RCRender;
  var A = window.RC_ASSETS;

  /* ---------------- state ---------------- */
  // ml: { rows: Map<id,rec>, list:[{id,name}] } — populated by the host app
  // (see "rc:setMasterlist" below) instead of an uploaded workbook.
  var ml = null;
  var queue = [];                // array of ids, in order
  var route = {};                // formId -> { pdf:bool, copies:int, tx:bool }
  var previewURL = null, printURL = null;
  var pvDirty = true;

  // Defaults, straight from the office's standing instruction:
  //   NBI + PNP Talisay -> PDF.   RTC x1, MTCC x2, City Prosecutor x1 -> print.
  //   tx = send that recipient a covering transmittal letter.
  var DEFAULTS = {
    RTC:      { pdf: false, copies: 1, tx: true },
    MTCC:     { pdf: false, copies: 2, tx: true },
    CITYPROS: { pdf: false, copies: 1, tx: true },
    NBI:      { pdf: true,  copies: 0, tx: true },
    PNP_TAL:  { pdf: true,  copies: 0, tx: true },
    PNP_MING: { pdf: false, copies: 0, tx: false },
    RTC_CC:   { pdf: false, copies: 0, tx: false },
    MTCC_CC:  { pdf: false, copies: 0, tx: false },
    PROV_CC:  { pdf: false, copies: 0, tx: false },
    BRGY:     { pdf: false, copies: 0, tx: false }
  };

  var PAPER = {
    a4:     { w: 210,   h: 297,   fmt: 'a4' },
    letter: { w: 215.9, h: 279.4, fmt: 'letter' },
    folio:  { w: 215.9, h: 330.2, fmt: [215.9, 330.2] },
    legal:  { w: 215.9, h: 355.6, fmt: 'legal' }
  };

  /* ---------------- dom ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    mlCount: $('mlCount'),
    idIn: $('idIn'), addBtn: $('addBtn'), results: $('results'),
    queue: $('queue'), qn: $('qn'), clearQ: $('clearQ'),
    routing: $('routing'), dateIn: $('dateIn'), paperIn: $('paperIn'),
    chiefIn: $('chiefIn'), sigIn: $('sigIn'), txIn: $('txIn'), ioIn: $('ioIn'), ioList: $('ioList'),
    recipList: $('recipList'), recipSave: $('recipSave'), recipStatus: $('recipStatus'),
    btnPdf: $('btnPdf'), btnPrint: $('btnPrint'), btnTx: $('btnTx'), btnBoth: $('btnBoth'),
    pv: $('pv'), pvBlank: $('pvBlank'), pvMeta: $('pvMeta'), pvRefresh: $('pvRefresh'),
    log: $('log'), busy: $('busy'), busyTxt: $('busyTxt'), printFrame: $('printFrame')
  };

  function log(msg, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    var t = new Date().toTimeString().slice(0, 8);
    d.innerHTML = '<span class="ts">' + t + '</span>';
    d.appendChild(document.createTextNode(msg));
    el.log.appendChild(d);
    el.log.scrollTop = el.log.scrollHeight;
  }
  function busy(on, txt) { el.busyTxt.textContent = txt || 'Working…'; el.busy.classList.toggle('on', !!on); }

  // Print confirmation, with an escape hatch if the embedded viewer won't cooperate.
  function logPrint(n, url) {
    var d = document.createElement('div');
    d.className = 'ok';
    d.innerHTML = '<span class="ts">' + new Date().toTimeString().slice(0, 8) + '</span>';
    d.appendChild(document.createTextNode(
      'Sent ' + n + ' page' + (n === 1 ? '' : 's') + ' to the print dialog — choose your printer there. '));
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'No dialog? Open in a tab';
    a.style.color = 'var(--navy)';
    d.appendChild(a);
    el.log.appendChild(d);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); }

  /* ---------------- masterlist (fed by the host app, not an uploaded file) ---------------- */
  // payload: { list: [{id,name}], rows: { [id]: rec } } — rec values may be
  // real Date objects (structured-clone survives postMessage) so fmtDate()
  // in rc-render.js renders them the same way it would Excel dates.
  function setMasterlist(payload) {
    var rows = new Map();
    Object.keys(payload.rows || {}).forEach(function (id) { rows.set(id, payload.rows[id]); });
    ml = { rows: rows, list: payload.list || [] };
    el.mlCount.textContent = rows.size + ' case' + (rows.size === 1 ? '' : 's');
    el.idIn.disabled = rows.size === 0;
    el.addBtn.disabled = rows.size === 0;
    log('Loaded ' + rows.size + ' case' + (rows.size === 1 ? '' : 's') + ' from the app.', 'ok');
    // Petitioners removed from the app disappear from a still-open queue too.
    var before = queue.length;
    queue = queue.filter(function (id) { return rows.has(id); });
    if (queue.length !== before) log('Removed ' + (before - queue.length) + ' petitioner(s) no longer available.', 'err');
    drawQueue();
    sync();
  }

  /* ---------------- queue ---------------- */
  function surname(rec) {
    var n = String(rec['NAME'] || '').trim();
    var c = n.indexOf(',');
    return (c > 0 ? n.slice(0, c) : n.split(/\s+/)[0] || 'UNKNOWN').trim();
  }

  function addIds(text) {
    if (!ml) return;
    var added = 0, bad = [];
    String(text).split(/[,;\n]+/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      var ids = [];
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (b < a) { var t = a; a = b; b = t; }
        if (b - a > 400) { bad.push(part + ' (range too large)'); return; }
        for (var i = a; i <= b; i++) ids.push(String(i));
      } else {
        ids.push(part);
      }
      ids.forEach(function (id) {
        if (!ml.rows.has(id)) { bad.push(id); return; }
        if (queue.indexOf(id) >= 0) return;
        queue.push(id); added++;
      });
    });
    if (added) log('Queued ' + added + ' petitioner' + (added === 1 ? '' : 's') + '.');
    if (bad.length) log('No such case in the app: ' + bad.join(', '), 'err');
    drawQueue(); sync();
  }

  function drawQueue() {
    el.queue.innerHTML = '';
    el.qn.textContent = queue.length ? '(' + queue.length + ')' : '';
    el.clearQ.hidden = !queue.length;
    if (!queue.length) {
      el.queue.innerHTML = '<span class="empty">No petitioners queued.</span>';
      return;
    }
    queue.forEach(function (id) {
      var rec = ml.rows.get(id);
      var c = document.createElement('span');
      c.className = 'chip';
      var b = document.createElement('b'); b.textContent = id;
      var s = document.createElement('span'); s.textContent = String(rec['NAME']);
      var x = document.createElement('button'); x.textContent = '×'; x.title = 'Remove';
      x.onclick = function () {
        queue = queue.filter(function (q) { return q !== id; });
        drawQueue(); sync();
      };
      c.appendChild(b); c.appendChild(s); c.appendChild(x);
      el.queue.appendChild(c);
    });
  }

  el.clearQ.onclick = function () { queue = []; drawQueue(); sync(); };
  el.addBtn.onclick = function () {
    if (el.idIn.value.trim()) { addIds(el.idIn.value); el.idIn.value = ''; el.results.innerHTML = ''; }
  };
  el.idIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); el.addBtn.click(); }
  });

  // name search
  el.idIn.addEventListener('input', function () {
    var q = norm(el.idIn.value);
    el.results.innerHTML = '';
    if (!ml || q.length < 2 || /^[\d,\s;–-]+$/.test(el.idIn.value)) return;
    ml.list.filter(function (r) { return norm(r.name).indexOf(q) >= 0; })
      .slice(0, 25)
      .forEach(function (r) {
        var b = document.createElement('button');
        b.innerHTML = '<span class="rid">' + r.id + '</span>';
        var n = document.createElement('span'); n.className = 'rnm'; n.textContent = r.name;
        b.appendChild(n);
        b.onclick = function () { addIds(r.id); el.idIn.value = ''; el.results.innerHTML = ''; el.idIn.focus(); };
        el.results.appendChild(b);
      });
  });

  /* ---------------- recipient addresses ----------------
     Per-line overrides for each recipient's TO/ATTN block (director/ATTN
     names change over time — the built-in defaults live in rc-render.js's
     FORMS array). Persisted through the host app to MySQL, shared by every
     officer — see server/routes/recordsCheck.js's GET/PUT /recipients. */
  var recipDefaults = {};                     // formId -> { to:[3], attn:[3]|null } — snapshot before any override is applied
  F.FORMS.forEach(function (f) {
    recipDefaults[f.id] = { to: f.to.slice(), attn: f.attn ? f.attn.slice() : null };
  });
  var recipOverrides = {};                     // formId -> { to:[3 or ''...], attn:[...]|undefined } — from the server

  function recipBlock(label, block, defaults) {
    var wrap = document.createElement('div');
    var lbl = document.createElement('div'); lbl.className = 'recip-block-lbl'; lbl.textContent = label + ':';
    wrap.appendChild(lbl);
    for (var i = 0; i < 3; i++) {
      var inp = document.createElement('input');
      inp.dataset.block = block; inp.dataset.line = String(i);
      inp.placeholder = defaults[i] || '';
      inp.autocomplete = 'off';
      inp.setAttribute('aria-label', label + ' line ' + (i + 1));
      wrap.appendChild(inp);
    }
    return wrap;
  }

  function drawRecipients() {
    el.recipList.innerHTML = '';
    F.FORMS.forEach(function (f) {
      var def = recipDefaults[f.id];
      var row = document.createElement('div');
      row.className = 'recip-row';
      row.dataset.form = f.id;

      var hd = document.createElement('div'); hd.className = 'rr-hd';
      var b = document.createElement('b'); b.textContent = f.label;
      var reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'rr-reset'; reset.textContent = 'Reset to default';
      reset.onclick = function () {
        Array.prototype.forEach.call(row.querySelectorAll('input'), function (inp) { inp.value = ''; });
        recipStatus('');
      };
      hd.appendChild(b); hd.appendChild(reset);
      row.appendChild(hd);

      row.appendChild(recipBlock('TO', 'to', def.to));
      if (def.attn) row.appendChild(recipBlock('ATTN', 'attn', def.attn));

      el.recipList.appendChild(row);
    });
  }

  // Reflects recipOverrides (as loaded from, or just saved to, the server)
  // into the input values — blank input means "no override for this line".
  function fillRecipientInputs() {
    Array.prototype.forEach.call(el.recipList.children, function (row) {
      var ov = recipOverrides[row.dataset.form] || {};
      Array.prototype.forEach.call(row.querySelectorAll('input'), function (inp) {
        var arr = ov[inp.dataset.block];
        inp.value = (arr && arr[+inp.dataset.line]) || '';
      });
    });
  }

  // Merges recipOverrides line-by-line onto F.FORMS[i].to/.attn in place.
  // renderForm/renderTransmittal (rc-render.js) already just read
  // form.to/form.attn, so nothing there needs to change.
  function applyRecipientOverrides() {
    F.FORMS.forEach(function (f) {
      var def = recipDefaults[f.id], ov = recipOverrides[f.id] || {};
      f.to = def.to.map(function (line, i) { return (ov.to && ov.to[i]) || line; });
      if (def.attn) f.attn = def.attn.map(function (line, i) { return (ov.attn && ov.attn[i]) || line; });
    });
  }

  function recipStatus(text, cls) {
    el.recipStatus.textContent = text || '';
    el.recipStatus.className = 'hint' + (cls ? ' ' + cls : '');
  }

  el.recipSave.onclick = function () {
    var recipients = {};
    Array.prototype.forEach.call(el.recipList.children, function (row) {
      var toIn = row.querySelectorAll('input[data-block="to"]');
      var attnIn = row.querySelectorAll('input[data-block="attn"]');
      var entry = { to: Array.prototype.map.call(toIn, function (i) { return i.value; }) };
      if (attnIn.length) entry.attn = Array.prototype.map.call(attnIn, function (i) { return i.value; });
      recipients[row.dataset.form] = entry;
    });
    recipStatus('Saving…');
    window.parent.postMessage({ type: 'rc:saveRecipients', payload: { recipients: recipients } }, '*');
  };

  /* ---------------- routing table ---------------- */
  function drawRouting() {
    F.FORMS.forEach(function (f) {
      route[f.id] = Object.assign({}, DEFAULTS[f.id] || { pdf: false, copies: 0, tx: false });
      var tr = document.createElement('tr');

      var td1 = document.createElement('td'); td1.textContent = f.label;

      var tdT = document.createElement('td'); tdT.className = 'c';
      var tcb = document.createElement('input'); tcb.type = 'checkbox'; tcb.checked = route[f.id].tx;
      tcb.setAttribute('aria-label', 'Send ' + f.label + ' a transmittal');
      tcb.onchange = function () { route[f.id].tx = tcb.checked; mark(); sync(); };
      tdT.appendChild(tcb);

      var td2 = document.createElement('td'); td2.className = 'c';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = route[f.id].pdf;
      cb.setAttribute('aria-label', 'Save ' + f.label + ' as PDF');
      cb.onchange = function () { route[f.id].pdf = cb.checked; mark(); sync(); };
      td2.appendChild(cb);

      var td3 = document.createElement('td'); td3.className = 'c';
      var num = document.createElement('input');
      num.type = 'number'; num.min = 0; num.max = 20; num.className = 'copies';
      num.value = route[f.id].copies;
      num.setAttribute('aria-label', 'Copies of ' + f.label + ' to print');
      num.onchange = num.oninput = function () {
        var v = Math.max(0, Math.min(20, parseInt(num.value, 10) || 0));
        num.value = v; route[f.id].copies = v;
        num.classList.toggle('zero', v === 0);
        mark(); sync();
      };
      num.classList.toggle('zero', route[f.id].copies === 0);
      td3.appendChild(num);

      tr.appendChild(td1); tr.appendChild(tdT); tr.appendChild(td2); tr.appendChild(td3);
      tr.dataset.form = f.id;
      el.routing.appendChild(tr);
    });
    mark();
  }
  function mark() {
    Array.prototype.forEach.call(el.routing.children, function (tr) {
      var r = route[tr.dataset.form];
      var on = r.pdf || r.copies > 0 || r.tx;
      tr.classList.toggle('on', on);
      tr.classList.toggle('off', !on);
    });
  }

  /* ---------------- document building ---------------- */
  function opts() {
    var p = PAPER[el.paperIn.value] || PAPER.a4;
    var d = el.dateIn.value ? new Date(el.dateIn.value + 'T00:00:00Z') : new Date();
    return {
      date: d,
      paper: { w: p.w, h: p.h },
      fmt: p.fmt,
      chief: el.chiefIn.value.trim() || 'LYLE E. DACLAN',
      showSignatures: el.sigIn.value === '1',
      transmittal: el.txIn.value === '1',
      io: el.ioIn.value.trim()
    };
  }

  function newDoc(o) {
    return new jsPDF({ unit: 'mm', format: o.fmt, orientation: 'portrait', compress: true });
  }

  /* ---------------- transmittal ----------------
     The covering letter lists every petitioner in the queue, in queue order.
     Barangay is split into one letter per barangay, since each goes to a
     different captain and may only carry that barangay's residents. Cover
     letters are for printing only — they are not tied to one petitioner, so
     they never go through the per-petitioner saved-PDF path. */

  function queuedRecs() {
    return queue.map(function (id) { return ml.rows.get(id); }).filter(Boolean);
  }

  /** Every distinct IO in the masterlist — the suggestions under the field. */
  function allIOs() {
    if (!ml) return [];
    var seen = [];
    ml.rows.forEach(function (rec) {
      var v = F.fmtCell(rec['IO']);
      if (v && seen.indexOf(v) < 0) seen.push(v);
    });
    return seen.sort();
  }

  /** The IO carrying most of the queued petitioners — the sensible default. */
  function queuedIO() {
    var tally = {}, best = '', top = 0;
    queuedRecs().forEach(function (rec) {
      var v = F.fmtCell(rec['IO']);
      if (!v) return;
      tally[v] = (tally[v] || 0) + 1;
      if (tally[v] > top) { top = tally[v]; best = v; }
    });
    return best;
  }

  var ioTouched = false;

  function refreshIO() {
    var list = allIOs();
    if (el.ioList.dataset.filled !== String(list.length) || !list.length) {
      el.ioList.innerHTML = '';
      list.forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        el.ioList.appendChild(o);
      });
      el.ioList.dataset.filled = String(list.length);
    }
    // Follow the queue until the user types their own name in.
    if (!ioTouched) {
      var q = queuedIO();
      if (q) el.ioIn.value = q;
    }
  }

  function brgyOf(rec) {
    var b = String(rec['BARANGAY'] == null ? '' : rec['BARANGAY']).trim();
    if (!b || b.toLowerCase() === 'others' || b.toLowerCase() === 'no data') return '';
    return b;
  }

  // Names read "LAST, FIRST MIDDLE", so a plain locale compare sorts by surname.
  // Case- and accent-insensitive so "de la Cruz" and "DELA CRUZ" sort together.
  function byName(a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }); }

  /** One transmittal letter per recipient — or per barangay, for the Brgy form. */
  function transmittalLetters(form) {
    var recs = queuedRecs();
    if (!recs.length) return [];
    if (!form.dynamicBrgy) {
      return [{ form: form, to: form.to, key: form.label,
                names: recs.map(function (r) { return F.fmtCell(r['NAME']); }).sort(byName) }];
    }
    var order = [], groups = {};
    recs.forEach(function (rec) {
      var b = brgyOf(rec) || ' none';
      if (!groups[b]) { groups[b] = []; order.push(b); }
      groups[b].push(F.fmtCell(rec['NAME']));
    });
    order.forEach(function (b) { groups[b].sort(byName); });
    return order.map(function (b) {
      var to = form.to.slice();
      if (b !== ' none') {
        var parts = b.split(',');
        to[1] = 'Barangay ' + parts[0].trim();
        to[2] = parts.slice(1).join(',').trim() || 'Talisay City, Cebu';
      }
      return { form: form, to: to, key: form.label + (b !== ' none' ? ' - ' + to[1] : ''),
               names: groups[b] };
    });
  }

  /** Every transmittal page, for the recipients that are actually being sent to. */
  function transmittalPlan() {
    if (!ml || !queue.length || el.txIn.value !== '1') return [];
    var pages = [];
    F.FORMS.forEach(function (f) {
      var r = route[f.id];
      if (!r || !r.tx) return;                        // transmittal not ticked for this recipient
      transmittalLetters(f).forEach(function (letter) {
        F.transmittalPages(letter.names).forEach(function (pg, i, all) {
          pages.push({ kind: 'tx', form: f, letter: letter, page: pg,
                       part: i + 1, parts: all.length });
        });
      });
    });
    return pages;
  }

  /** Every page that will be produced, in production order.
      Grouped by recipient first, then by petitioner — so a run reads
      "all RTC, then all MTCC, then all City Prosecutor, ..." rather than
      cycling through every recipient once per petitioner. */
  function plan() {
    var pdfJobs = [], printPages = [];
    F.FORMS.forEach(function (f) {
      var r = route[f.id];
      queue.forEach(function (id) {
        var rec = ml.rows.get(id);
        if (r.pdf) pdfJobs.push({ id: id, rec: rec, form: f });
        for (var c = 0; c < r.copies; c++) printPages.push({ id: id, rec: rec, form: f, copy: c + 1 });
      });
    });
    // Cover letters lead the print run — one per recipient, ahead of the forms.
    var tx = transmittalPlan();
    return { pdfJobs: pdfJobs, printPages: tx.concat(printPages), tx: tx };
  }

  /** Draw one plan entry — a request form, or a transmittal cover page. */
  function drawPage(doc, p, o) {
    if (p.kind === 'tx') {
      F.renderTransmittal(doc, p.form, p.page, A, Object.assign({}, o, { to: p.letter.to }));
    } else {
      F.renderForm(doc, p.form, p.rec, A, o);
    }
  }

  function buildCombined(pages, o, autoPrint) {
    if (!pages.length) return null;
    var doc = newDoc(o), first = true;
    pages.forEach(function (p) {
      if (!first) doc.addPage(o.fmt, 'portrait');
      first = false;
      drawPage(doc, p, o);
    });
    if (autoPrint) doc.autoPrint();
    return doc;
  }

  // Saved PDFs land in <app folder>/<recipient>/<date>/<Last - First - Middle>.pdf
  // — one folder per office (NBI, RTC, ...), so nothing scatters across
  // wherever an officer last happened to click "Save".
  function safeSeg(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim(); }
  function saveInfoFor(job, o) {
    var rec = job.rec;
    var d = o.date;
    var stamp = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
    var nameParts = [rec['LAST_NAME'], rec['FIRST_NAME'], rec['MIDDLE_NAME']]
      .map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    var fileBase = nameParts.length ? nameParts.join(' - ') : surname(rec);
    return {
      recipient: safeSeg(job.form.label),
      dateFolder: stamp,
      filename: safeSeg(fileBase) + '.pdf'
    };
  }

  /* ---------------- preview ---------------- */
  function sync() {
    refreshIO();
    var p = ml ? plan() : { pdfJobs: [], printPages: [], tx: [] };
    var hasPdf = p.pdfJobs.length > 0, hasPrint = p.printPages.length > 0;
    var ready = !!ml && queue.length > 0;
    var txPages = (p.tx || []).length;
    el.btnPdf.disabled = !(ready && hasPdf);
    el.btnPrint.disabled = !(ready && hasPrint);
    el.btnTx.disabled = !(ready && txPages > 0);
    var txTotal = txPages * TX_COPIES;
    el.btnTx.textContent = txPages > 0
      ? 'Print transmittal only (' + TX_COPIES + ' copies, ' + txTotal + ' page' + (txTotal === 1 ? '' : 's') + ')'
      : 'Print transmittal only';
    el.btnBoth.disabled = !(ready && (hasPdf || hasPrint));
    el.pvRefresh.disabled = !(ready && (hasPdf || hasPrint));

    if (!ready || (!hasPdf && !hasPrint)) {
      el.pvMeta.textContent = '';
      showBlank();
      return;
    }
    el.pvMeta.textContent = p.pdfJobs.length + ' PDF' + (p.pdfJobs.length === 1 ? '' : 's') +
      ' · ' + p.printPages.length + ' page' + (p.printPages.length === 1 ? '' : 's') + ' to print';
    pvDirty = true;
    schedulePreview();
  }

  var pvTimer = null;
  function schedulePreview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 220);
  }

  function showBlank() {
    el.pv.hidden = true; el.pvBlank.hidden = false;
    if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
  }

  function renderPreview() {
    if (!pvDirty || !ml || !queue.length) return;
    var o = opts(), p = plan();
    // Preview shows exactly what will be produced: each PDF once, then the print run.
    var pages = p.pdfJobs.concat(p.printPages);
    if (!pages.length) { showBlank(); return; }
    try {
      var doc = buildCombined(pages, o, false);
      var url = doc.output('bloburl');
      if (previewURL) URL.revokeObjectURL(previewURL);
      previewURL = url;
      el.pv.src = url + '#zoom=page-fit&navpanes=0';
      el.pv.hidden = false; el.pvBlank.hidden = true;
      pvDirty = false;
    } catch (e) {
      log('Preview failed: ' + e.message, 'err');
    }
  }
  el.pvRefresh.onclick = function () { pvDirty = true; renderPreview(); };

  /* ---------------- save PDFs (routed through the host app, which POSTs
     these to /api/records-check/batch — see RecordsCheckView.jsx — so the
     files land on Head Office's disk and are visible from every machine;
     a plain browser download or the File System Access API doesn't work
     once this runs from a packaged file:// build anyway) ---------------- */
  function u8ToB64(u8) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function savePdfs() {
    var o = opts(), jobs = plan().pdfJobs;
    if (!jobs.length) return;

    var files = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      busy(true, 'Building PDF ' + (i + 1) + ' of ' + jobs.length + '…');
      await new Promise(function (r) { setTimeout(r, 0); });      // let the UI paint
      var doc = newDoc(o);
      F.renderForm(doc, job.form, job.rec, A, o);
      var bytes = doc.output('arraybuffer');
      var info = saveInfoFor(job, o);
      files.push({
        probationerId: job.id,
        recipient: info.recipient, dateFolder: info.dateFolder, filename: info.filename,
        base64: u8ToB64(new Uint8Array(bytes))
      });
    }
    busy(true, 'Saving ' + files.length + ' PDF' + (files.length === 1 ? '' : 's') + '…');
    window.parent.postMessage({ type: 'rc:savePdfs', payload: { files: files } }, '*');
  }

  /* ---------------- print ---------------- */
  // The office keeps a file copy of every transmittal, so "Print transmittal
  // only" always runs the full set twice — two complete, correctly ordered copies.
  var TX_COPIES = 2;

  function printDocs() { printSet(plan().printPages); }
  function printTransmittals() {
    var tx = plan().tx, pages = [];
    for (var c = 0; c < TX_COPIES; c++) pages = pages.concat(tx);
    printSet(pages);
  }

  function printSet(pages) {
    var o = opts();
    if (!pages || !pages.length) return;
    busy(true, 'Preparing ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' for printing…');
    setTimeout(function () {
      try {
        var doc = buildCombined(pages, o, true);
        printURL = doc.output('bloburl');
        var f = el.printFrame;
        f.onload = function () {
          // The PDF carries its own auto-print action (doc.autoPrint above),
          // which the embedded viewer fires on load. We deliberately do NOT
          // also call f.contentWindow.print() here — doing both opened the
          // print dialog twice for the same document.
          try { f.contentWindow.focus(); } catch (e) { /* viewer handles it */ }
          busy(false);
        };
        f.src = printURL;
        logPrint(pages.length, printURL);
        // Safety net: if the embedded viewer refuses, open it in a tab.
        setTimeout(function () { busy(false); }, 4000);
      } catch (e) {
        busy(false);
        log('Print failed: ' + e.message + ' — use Refresh, then print from the preview.', 'err');
      }
    }, 30);
  }

  el.btnPdf.onclick = function () { savePdfs(); };
  el.btnPrint.onclick = function () { printDocs(); };
  el.btnTx.onclick = function () { printTransmittals(); };
  el.btnBoth.onclick = async function () { await savePdfs(); printDocs(); };

  /* ---------------- host bridge ---------------- */
  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'rc:setMasterlist') {
      setMasterlist(msg.payload || {});
    } else if (msg.type === 'rc:saveResult') {
      busy(false);
      var p = msg.payload || {};
      if (p.ok) {
        log('Saved ' + p.count + ' PDF' + (p.count === 1 ? '' : 's') +
            ' — sorted into a folder per recipient, then by date.', 'ok');
      } else {
        log('Could not save PDFs: ' + (p.error || 'unknown error'), 'err');
      }
    } else if (msg.type === 'rc:setRecipients') {
      recipOverrides = (msg.payload && msg.payload.recipients) || {};
      fillRecipientInputs();
      applyRecipientOverrides();
      pvDirty = true; sync();
    } else if (msg.type === 'rc:recipientsSaved') {
      var rp = msg.payload || {};
      if (rp.ok) {
        recipOverrides = rp.recipients || recipOverrides;
        fillRecipientInputs();
        applyRecipientOverrides();
        pvDirty = true; sync();
        recipStatus('Saved.', 'ok');
        log('Saved recipient address changes.', 'ok');
      } else {
        recipStatus('Could not save: ' + (rp.error || 'unknown error'), 'err');
        log('Could not save recipient addresses: ' + (rp.error || 'unknown error'), 'err');
      }
    }
  });

  /* ---------------- init ---------------- */
  drawRouting();
  drawRecipients();
  var today = new Date();
  el.dateIn.value = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  ['change', 'input'].forEach(function (ev) {
    [el.dateIn, el.paperIn, el.chiefIn, el.sigIn, el.txIn].forEach(function (n) {
      n.addEventListener(ev, function () { pvDirty = true; sync(); });
    });
    // Mark the IO field as user-edited *before* sync() runs, so refreshIO()
    // stops overriding the typed name with the queue's default.
    el.ioIn.addEventListener(ev, function () { ioTouched = true; pvDirty = true; sync(); });
  });
  sync();
  log('Template is built in — nothing to link, no formulas to repair.');
  window.parent.postMessage({ type: 'rc:ready' }, '*');
})();
