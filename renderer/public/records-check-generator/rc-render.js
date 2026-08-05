/* ============================================================================
   RECORDS CHECK — PDF RENDERER
   Faithful reproduction of "Records Check - Talisay.xlsx" (PPA Form 13).
   Geometry derived directly from the workbook: column widths, row heights,
   fonts, borders and image anchors. Drawn as real vector text via jsPDF, so
   there are no Excel formulas to break and no external file links to resolve.
   ============================================================================ */
(function (root) {
  'use strict';

  /* ---- Sheet grid, in millimetres -------------------------------------- */
  // Column left edges (A..H) and widths, from the workbook's column widths.
  var COL = { A: 6.35, B: 23.55, C: 41.54, D: 58.47, E: 75.41, F: 107.16, G: 125.15, H: 144.46 };
  var CW  = { A: 17.20, B: 17.99, C: 16.93, D: 16.93, E: 31.75, F: 17.99, G: 19.31, H: 46.57 };
  var RIGHT = COL.H + CW.H;          // 191.03 — right edge of the print area

  // Row top edges, from the workbook's row heights. Two variants:
  // STD  = the 9 sheets that share the RTC layout
  // NBI  = the NBI sheet (has an extra ATTN block, so everything shifts down)
  var ROWS_STD = [0, 6.35, 10.85, 15.35, 20.64, 26.19, 31.49, 36.25, 41.01, 47.36, 49.48,
    55.03, 60.59, 66.15, 71.70, 73.82, 79.38, 84.67, 86.78, 92.08, 97.37, 102.92, 108.48,
    114.04, 119.59, 125.15, 130.44, 136.00, 141.55, 147.11, 152.66, 158.22, 163.78, 169.33,
    174.89, 181.98, 187.54, 192.83, 198.12, 203.68, 208.97, 209.71, 213.22, 218.51, 224.07,
    229.36, 232.87, 238.42, 243.98, 249.54, 254.83, 260.12, 265.41, 270.70, 276.00, 281.29,
    286.58, 291.87, 297.16];

  var ROWS_NBI = [0, 6.35, 10.85, 15.35, 20.64, 26.19, 31.49, 36.25, 41.01, 47.36, 49.48,
    55.03, 58.74, 64.29, 69.85, 75.41, 79.38, 84.93, 90.22, 95.51, 98.69, 104.25, 109.54,
    111.65, 116.95, 122.24, 127.79, 133.35, 138.91, 144.46, 150.02, 155.31, 160.87, 166.42,
    171.98, 177.54, 183.09, 188.65, 194.20, 199.76, 206.85, 212.41, 217.70, 222.99, 228.55,
    233.84, 234.58, 238.09, 243.38, 248.94, 254.23, 257.74, 263.30, 268.85, 274.41, 279.96,
    284.46, 289.75, 295.05, 300.34, 305.63, 310.92, 316.21, 321.50, 326.80, 332.09];

  /* ---- Row roles per variant -------------------------------------------- */
  var L_STD = {
    rows: ROWS_STD, last: 57,
    date: 10, to: 11, attn: 0, sir: 15, intro: 16, data: 18,
    ioName: 35, ioLabel: 36, noted: 37, chief: 38, chiefLabel: 39,
    tear: 40, dateLine: 42, to2: 43, to2b: 44, from: 46,
    revealed: 49, check: 50, verified: 54, verifiedLine: 55,
    approved: 56, approvedLine: 57,
    sigDaclanRow: 33, sigIoRow: 33
  };
  var L_NBI = {
    rows: ROWS_NBI, last: 64,
    date: 10, to: 12, attn: 16, sir: 20, intro: 21, data: 23,
    ioName: 40, ioLabel: 41, noted: 42, chief: 43, chiefLabel: 44,
    tear: 45, dateLine: 47, to2: 48, to2b: 49, from: 51,
    revealed: 56, check: 57, verified: 61, verifiedLine: 62,
    approved: 63, approvedLine: 64,
    sigDaclanRow: 38, sigIoRow: 38
  };

  /* ---- The 16 data lines: label + which masterlist column feeds it ------- */
  var FIELDS = [
    ['NAME OF PETITIONER',    'NAME'],
    ['TRUE NAME',             'TRUE NAME'],
    ['ALIAS / ES',            'ALIAS'],
    ['SEX',                   'SEX'],
    ['AGE',                   'AGE'],
    ['CIVIL STATUS',          'CIVIL STATUS'],
    ['DATE OF BIRTH',         'DATE OF BIRTH'],
    ['PLACE OF BIRTH',        'PLACE OF BIRTH'],
    ['PRESENT ADDRESS',       'PRESENT ADDRESS'],
    ['PERMANENT ADDRESS',     'PERMANENT ADDRESS'],
    ['CRIMINAL CASE NO. / S', 'CRIMINAL CASE NO./S'],
    ['OFFENSES',              'OFFENSES'],
    ['COURT',                 'COURT'],
    ['NAME OF SPOUSE',        'NAME OF SPOUSE'],
    ['NAME OF PARENTS',       'NAME OF FATHER'],
    ['',                      'NAME OF MOTHER']
  ];

  /* ---- The 10 forms in the workbook ------------------------------------- */
  var FORMS = [
    { id: 'RTC',      sheet: 'RTC',                     label: 'RTC',
      to: ['The Records In-Charge', 'RTC OCC - Talisay City', 'HOJ, Talisay City, Cebu'] },
    { id: 'MTCC',     sheet: 'MTCC (2)',                label: 'MTCC',
      to: ['The Records In-Charge', 'MTCC OCC-Talisay City', 'HOJ, Talisay City, Cebu'] },
    { id: 'CITYPROS', sheet: 'City Prosecutor',         label: 'City Prosecutor',
      to: ['The Administrative Officer', 'Talisay City Prosecution Office', 'Talisay City, Cebu'] },
    { id: 'NBI',      sheet: 'NBI',                     label: 'NBI',  variant: 'NBI',
      to: ['MR. ROMEL T. PAPA, M.D.', 'Assistant Director-ICTS', 'National Bureau of Investigation, Manila'],
      attn: ['SI IV MARLOU D. BALTAZAR', 'HEAD, NCIC', 'National Bureau of Investigation, Manila'] },
    { id: 'PNP_TAL',  sheet: 'PNP Talisay',             label: 'PNP Talisay',
      to: ['THE CHIEF OF POLICE', 'Poblacion, Talisay City', 'Talisay City, Cebu'] },
    { id: 'PNP_MING', sheet: 'PNP M (Mailing)',         label: 'PNP Minglanilla (Mailing)',
      to: ['THE CHIEF OF POLICE', 'Poblacion Ward II, Minglanilla', 'Minglanilla, Cebu'] },
    { id: 'RTC_CC',   sheet: 'RTC CC (Mailing)',        label: 'RTC Cebu City (Mailing)',
      to: ['THE CLERK OF COURT', 'RTC OCC', 'Cebu City'] },
    { id: 'MTCC_CC',  sheet: 'MTCC CC (Mailing)',       label: 'MTCC Cebu City (Mailing)',
      to: ['THE CLERK OF COURT', 'MTCC OCC', 'Cebu City'] },
    { id: 'PROV_CC',  sheet: 'Prov. Pros CC (Mailing)', label: 'Prov. Prosecutor (Mailing)',
      to: ['THE RECORDS OFFICER', 'Provincial Prosecutors Office', 'Cebu City'] },
    { id: 'BRGY',     sheet: 'Brgy',                    label: 'Barangay',  noIoSig: true, dynamicBrgy: true,
      to: ['THE BARANGAY CAPTAIN', 'Barangay Sto. Niño', 'Talisay City, Cebu'] }
  ];

  /* ---- Signature routing: masterlist IO name -> embedded signature ------- */
  function sigForIO(name, assets) {
    var n = String(name || '').toUpperCase();
    if (n.indexOf('EJARES') >= 0)  return assets.sigEjares;
    if (n.indexOf('HERBITO') >= 0) return assets.sigHerbito;
    return null;                                   // unknown IO -> blank line
  }

  /* ---- Value formatting -------------------------------------------------- */
  var MONTHS = ['January','February','March','April','May','June','July',
                'August','September','October','November','December'];

  function fmtDate(v) {
    if (v == null || v === '') return '';
    var d = (v instanceof Date) ? v : null;
    if (!d && typeof v === 'number') {                 // Excel serial date
      d = new Date(Date.UTC(1899, 11, 30 + Math.floor(v)));
    }
    if (!d || isNaN(d.getTime())) return String(v);    // e.g. "No Data"
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  function fmtCell(v) {
    if (v == null) return '';
    if (v instanceof Date) return fmtDate(v);
    return String(v).replace(/\r?\n/g, '  ').trim();
  }

  /* ======================================================================== */
  /*  PAGE RENDERER                                                           */
  /* ======================================================================== */
  /**
   * @param doc     jsPDF instance, positioned on the page to draw
   * @param form    one entry from FORMS
   * @param rec     plain object keyed by masterlist header, e.g. rec['NAME']
   * @param assets  { logoPpa, logoBp, sigDaclan, sigEjares, sigHerbito } base64 PNGs
   * @param opt     { date: Date, chief: string, showSignatures: bool,
   *                  paper: {w,h}, blankId: bool }
   */
  function renderForm(doc, form, rec, assets, opt) {
    opt = opt || {};
    var L = (form.variant === 'NBI') ? L_NBI : L_STD;
    var R = L.rows;

    /* --- fit the sheet's print area onto the chosen paper ---------------- */
    var PW = opt.paper ? opt.paper.w : 210;
    var PH = opt.paper ? opt.paper.h : 297;
    // The workbook runs its print area to within 0mm of the paper edge, which
    // Excel reflows away but a fixed-layout PDF cannot. Almost every printer has
    // a ~5mm unprintable bottom margin, which was swallowing the "Approved" rule
    // on the last row. Reserve real space for it and scale the sheet to suit.
    var TOPM = 6.35, BOTM = 9.0, SIDEM = 6.35;

    var contentTop = R[1];                         // 6.35
    var contentH   = R[L.last + 1] - contentTop;   // full print-area height
    var contentW   = RIGHT - COL.A;

    var s = Math.min(
      (PH - TOPM - BOTM) / contentH,
      (PW - 2 * SIDEM) / contentW,
      1
    );
    var offX = (PW - contentW * s) / 2 - COL.A * s;   // centre horizontally
    var offY = TOPM - contentTop * s;

    var X = function (mm) { return offX + mm * s; };
    var Y = function (mm) { return offY + mm * s; };
    var S = function (mm) { return mm * s; };            // scale a length
    var rowTop = function (r) { return R[r]; };
    var rowBot = function (r) { return R[r + 1]; };

    /* --- primitives ------------------------------------------------------ */
    // Baseline sits near the bottom of the row, as Excel bottom-aligns by default.
    function baseline(r, size) {
      var lead = size * 0.3528;                    // pt -> mm
      return rowBot(r) - lead * 0.22;
    }

    function font(size, style, family) {
      doc.setFont(family || 'helvetica', style || 'normal');
      doc.setFontSize(size * s);                   // shrink the type with the page
    }

    /**
     * Draw text in a cell.
     * where: {x} absolute mm, or {col} column letter
     * align: 'left' | 'center' | 'right'; span: [colStart,colEnd] for centring
     */
    function text(str, x, r, size, style, align, maxW, family) {
      if (str === '' || str == null) return;
      font(size, style, family);
      var t = String(str);
      if (maxW) {                                  // auto-shrink over-long values
        var avail = S(maxW), sz = size * s;
        while (doc.getTextWidth(t) > avail && sz > 5.5) {
          sz -= 0.25;
          doc.setFontSize(sz);
        }
      }
      doc.text(t, X(x), Y(baseline(r, size)), { align: align || 'left', baseline: 'alphabetic' });
    }

    function line(x1, x2, r, dashed) {
      var y = Y(rowBot(r));
      doc.setDrawColor(0);
      doc.setLineWidth(dashed ? 0.2 : 0.25);
      if (dashed) doc.setLineDashPattern([1.2, 1.2], 0);
      doc.line(X(x1), y, X(x2), y);
      if (dashed) doc.setLineDashPattern([], 0);
    }

    function underlineText(str, x, r, size, style, align) {
      // for the underlined title
      font(size, style);
      var w = doc.getTextWidth(String(str));
      doc.text(String(str), X(x), Y(baseline(r, size)), { align: align, baseline: 'alphabetic' });
      var cx = X(x), x1 = align === 'center' ? cx - w / 2 : cx;
      var yb = Y(baseline(r, size)) + 0.9 * s;
      doc.setLineWidth(0.35 * s);
      doc.line(x1, yb, x1 + w, yb);
    }

    doc.setTextColor(0, 0, 0);

    /* --- 1. form codes --------------------------------------------------- */
    text('PPA Form 13', COL.A, 1, 9, 'normal', 'left');
    text('PPA-FO-FR-013', RIGHT, 1, 8.5, 'bolditalic', 'right');

    /* --- 2. letterhead --------------------------------------------------- */
    var CX = 103.1;                                // centre of the letterhead text
    if (assets.logoPpa) doc.addImage(assets.logoPpa, 'PNG', X(11.5), Y(11.6), S(26.5), S(25.3));
    if (assets.logoBp)  doc.addImage(assets.logoBp,  'PNG', X(167.5), Y(10.8), S(27.0), S(25.2));

    doc.setTextColor(0, 0, 0);
    font(11, 'normal', 'times');
    doc.text('Republic of the Philippines', X(CX), Y(12.30), { align: 'center' });
    font(11, 'bolditalic');
    doc.text('Department of Justice', X(CX), Y(16.25), { align: 'center' });
    doc.setTextColor(228, 0, 0);
    font(11.5, 'bold');
    doc.text('PAROLE AND PROBATION ADMINISTRATION', X(CX), Y(20.05), { align: 'center' });
    doc.setTextColor(0, 0, 205);
    font(11.5, 'bold');
    doc.text('Regional Office No. VII', X(CX), Y(24.40), { align: 'center' });
    font(11.5, 'bold');
    doc.text('TALISAY CITY PAROLE AND PROBATION OFFICE', X(CX), Y(28.90), { align: 'center' });
    doc.setTextColor(0, 0, 0);
    font(9, 'normal');
    doc.text('G/F Hall of Justice, Lawaan II, Talisay City, Cebu', X(CX), Y(32.95), { align: 'center' });

    // Tel / e-mail line — the e-mail is a blue underlined link, as in the original.
    font(9, 'normal');
    var pre = 'Tel. No. 032-239-8358 | Email: ', mail = 'talisay.ppa7doj@gmail.com';
    var wPre = doc.getTextWidth(pre), wMail = doc.getTextWidth(mail);
    var lx = X(CX) - (wPre + wMail) / 2;
    doc.text(pre, lx, Y(36.90));
    doc.setTextColor(0, 0, 205);
    doc.text(mail, lx + wPre, Y(36.90));
    doc.setLineWidth(0.15 * s);
    doc.setDrawColor(0, 0, 205);
    doc.line(lx + wPre, Y(37.55), lx + wPre + wMail, Y(37.55));

    var web = 'Website: https://probation.gov.ph';
    var wWeb = doc.getTextWidth(web);
    doc.text(web, X(CX), Y(40.85), { align: 'center' });
    doc.line(X(CX) - wWeb / 2, Y(41.50), X(CX) + wWeb / 2, Y(41.50));
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0);

    /* --- 3. title -------------------------------------------------------- */
    underlineText('REQUEST FOR RECORDS CHECK', (COL.A + RIGHT) / 2, 8, 15, 'bold', 'center');

    /* --- 4. date --------------------------------------------------------- */
    text('DATE:', COL.G + CW.G, L.date, 12, 'bold', 'right');
    text(fmtDate(opt.date || new Date()), COL.H + CW.H / 2, L.date, 11, 'normal', 'center');
    line(COL.H, RIGHT, L.date);

    /* --- 5. TO: block ---------------------------------------------------- */
    var toEnd = (form.variant === 'NBI') ? COL.E + CW.E : COL.D + CW.D;
    var to = form.to.slice();
    if (form.dynamicBrgy && rec && rec['BARANGAY']) {
      var b = String(rec['BARANGAY']).trim();
      if (b && b.toLowerCase() !== 'others' && b.toLowerCase() !== 'no data') {
        var parts = b.split(',');
        to[1] = 'Barangay ' + parts[0].trim();
        to[2] = parts.slice(1).join(',').trim() || 'Talisay City, Cebu';
      }
    }
    text('TO:', COL.A, L.to, 12, 'bold');
    for (var i = 0; i < 3; i++) {
      text(to[i], COL.B, L.to + i, 12, i === 0 ? 'bold' : 'normal', 'left', toEnd - COL.B - 1);
      line(COL.B, toEnd, L.to + i);
    }

    /* --- 5b. ATTN block (NBI only) --------------------------------------- */
    if (L.attn && form.attn) {
      text('ATTN:', COL.C + CW.C / 2, L.attn, 10, 'bold', 'center');
      var aEnd = COL.F + CW.F;
      for (var j = 0; j < 3; j++) {
        text(form.attn[j], COL.D, L.attn + j, 12, j === 0 ? 'bold' : 'normal', 'left', aEnd - COL.D - 1);
        line(COL.D, aEnd, L.attn + j);
      }
    }

    /* --- 6. salutation + intro ------------------------------------------- */
    text("SIR/MA'AM:", COL.A, L.sir, 12, 'bold');
    /* The record ID (A16) is intentionally NOT printed — it exists only in the
       source workbook and should never appear on the printed/PDF output. */
    text('May we be furnished derogatory records of the applicant for probation named below:',
         COL.B, L.intro, 12, 'normal', 'left', RIGHT - COL.B);

    /* --- 7. the 16 data lines -------------------------------------------- */
    var vMax = RIGHT - COL.E - 1;
    for (var k = 0; k < FIELDS.length; k++) {
      var r = L.data + k;
      text(FIELDS[k][0], COL.B, r, 12, 'normal', 'left', COL.E - COL.B - 1);
      text(fmtCell(rec ? rec[FIELDS[k][1]] : ''), COL.E, r, 10, 'bold', 'left', vMax);
      line(COL.E, RIGHT, r);
    }

    /* --- 8. signatures ---------------------------------------------------- */
    /* Boxes below are the workbook's own image anchors, re-expressed relative
       to the underline each signature sits on. That makes them land identically
       on the RTC layout and on the taller NBI layout.                          */
    var ioName = fmtCell(rec ? rec['IO'] : '');
    var chief  = opt.chief || 'LYLE E. DACLAN';

    if (opt.showSignatures !== false) {
      // Chief's signature — straddles the "LYLE E. DACLAN" rule
      if (assets.sigDaclan) {
        var cy = rowBot(L.chief) + 8.9;                  // bottom of the image
        doc.addImage(assets.sigDaclan, 'PNG', X(43.3), Y(cy - 38.0), S(44.5), S(38.0));
      }
      // Investigating Officer's signature — chosen by the IO named on the record
      if (!form.noIoSig) {
        var ioSig = sigForIO(ioName, assets);
        if (ioSig) {
          var isHerbito = (ioSig === assets.sigHerbito);
          var iw = isHerbito ? 20.8 : 36.3;
          var ih = 21.0;
          var ix = isHerbito ? 145.75 : 138.0;
          var iy = rowBot(L.ioName) + 6.35;              // bottom of the image
          doc.addImage(ioSig, 'PNG', X(ix), Y(iy - ih), S(iw), S(ih));
        }
      }
    }

    text(ioName, COL.F + (RIGHT - COL.F) / 2, L.ioName, 12, 'bold', 'center', RIGHT - COL.F - 2);
    line(COL.F, RIGHT, L.ioName);
    text('Investigating Officer-on-Case', COL.F + (RIGHT - COL.F) / 2, L.ioLabel, 11, 'italic', 'center');

    text('Noted:', COL.A, L.noted, 12, 'normal');
    text(chief, COL.B + (COL.F - COL.B) / 2, L.chief, 12, 'bold', 'center');
    line(COL.B, COL.F, L.chief);
    text('Chief Probation and Parole Officer', COL.B + (COL.F - COL.B) / 2, L.chiefLabel, 11, 'italic', 'center');

    /* --- 9. tear-off line ------------------------------------------------- */
    line(COL.A, RIGHT, L.tear, true);

    /* --- 10. reply section ------------------------------------------------ */
    text('Date', COL.F + CW.F, L.dateLine, 11, 'normal', 'right');
    line(COL.G, RIGHT, L.dateLine);

    text('TO:', COL.A, L.to2, 12, 'normal');
    text('Talisay City Parole and Probation Office', COL.B, L.to2, 12, 'bold');
    line(COL.B, COL.F, L.to2);
    text('Ground Floor, Hall of Justice, Lawaan II, Talisay City, Cebu', COL.B, L.to2b, 11, 'normal');
    line(COL.B, COL.G, L.to2b);

    text('FROM:', COL.A, L.from, 12, 'normal');
    var fromEnd = (form.variant === 'NBI') ? COL.F : COL.E;
    for (var m = 0; m < 3; m++) {
      text(to[m], COL.B, L.from + m, 12, m === 0 ? 'bold' : 'normal', 'left', fromEnd - COL.B - 1);
      line(COL.B, fromEnd, L.from + m);
    }

    text('Records check revealed the following as of this date:', COL.A, L.revealed, 12, 'normal');
    var CHECKS = ['(   ) No records on file', '(   ) No derogatory record',
                  '(   ) No other derogatory record',
                  '(   ) Derogatory record stated at the back of this page'];
    for (var c = 0; c < 4; c++) text(CHECKS[c], COL.B, L.check + c, 12, 'normal');

    text('Verified by:', COL.F, L.verified, 12, 'normal');
    line(COL.G, RIGHT, L.verifiedLine);
    text('Approved:', COL.A, L.approved, 12, 'normal');
    line(COL.C, COL.F, L.approvedLine);
  }

  var API = {
    FORMS: FORMS,
    FIELDS: FIELDS,
    renderForm: renderForm,
    fmtDate: fmtDate,
    fmtCell: fmtCell
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.RCRender = API;
})(typeof window !== 'undefined' ? window : this);
