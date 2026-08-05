// Reads a probationer bulk-import .xlsx into plain row objects. Runs in the
// main process (has fs access via exceljs) — all business validation
// (required fields, officer resolution, stage/status enum checks) happens
// in the renderer against live app state, this module only extracts raw
// cell values by matching header aliases.
//
// Header matching is tolerant of real-world office spreadsheets (verified
// against an actual masterlist export): punctuation/case-insensitive, and
// tries the most specific pattern per field first (e.g. "PRESENT ADDRESS"
// before the generic "address" so it isn't shadowed by "PERMANENT ADDRESS").
const ExcelJS = require('exceljs');

// Ordered by priority — first pattern that matches ANY column wins for that
// field. `exact: true` means the normalized header must equal the pattern
// exactly rather than just contain it — required for short/generic words
// that would otherwise false-positive against unrelated columns (verified
// against a real masterlist: "status" as a substring match wrongly grabbed
// "CIVIL STATUS", and unqualified "name" would grab "NAME OF SPOUSE").
const FIELD_HEADER_PATTERNS = {
  fullName: [{ p: 'full name' }, { p: 'name', exact: true }],
  age: [{ p: 'age', exact: true }],
  docketNumber: [{ p: 'docket no' }, { p: 'docket number' }, { p: 'docket' }],
  address: [{ p: 'present address' }, { p: 'address' }],
  offense: [{ p: 'offenses' }, { p: 'offense' }, { p: 'offence' }],
  courtBranch: [{ p: 'court branch' }, { p: 'court', exact: true }],
  judge: [{ p: 'judge', exact: true }],
  convictionDate: [{ p: 'conviction date' }, { p: 'date of conviction' }],
  assignedOfficer: [{ p: 'assigned officer' }, { p: 'officer' }, { p: 'io', exact: true }],
  stage: [{ p: 'stage', exact: true }],
  status: [{ p: 'status', exact: true }],
};

const TEMPLATE_HEADERS = [
  'Full Name', 'Age', 'Docket Number', 'Address', 'Offense', 'Court Branch',
  'Judge', 'Conviction Date', 'Assigned Officer', 'Stage', 'Status',
];

function normalizeHeader(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation ("DOCKET NO." -> "docket no")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildColumnMap(headerRow) {
  const headers = [];
  headerRow.eachCell((cell, col) => headers.push({ col, normalized: normalizeHeader(cell.value) }));

  const map = {};
  for (const [field, patterns] of Object.entries(FIELD_HEADER_PATTERNS)) {
    patternLoop:
    for (const { p, exact } of patterns) {
      for (const h of headers) {
        const matches = exact ? h.normalized === p : (h.normalized === p || h.normalized.includes(p));
        if (matches) {
          map[field] = h.col;
          break patternLoop;
        }
      }
    }
  }
  return map;
}

// Finds the sheet actually holding probationer rows rather than blindly
// using the first one — real masterlists tend to carry extra reference
// sheets (e.g. a "RESTRICTED" lookup tab) alongside the main list.
function findDataWorksheet(workbook) {
  const named = workbook.worksheets.find((ws) => /masterlist|probationers?/i.test(ws.name));
  return named || workbook.worksheets[0];
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      // Rich-text cells (mixed formatting within one cell) — concatenate the runs.
      text = value.richText.map((run) => run.text || '').join('');
    } else if (value.text !== undefined) {
      text = String(value.text);
    } else if (value.result !== undefined) {
      text = String(value.result);
    } else if (value instanceof Date) {
      text = value.toISOString();
    } else {
      // Unrecognized object shape — never fall through to String(value),
      // which silently produces the literal text "[object Object]" (a real
      // bug: it corrupted imported full_name values before this fix).
      console.warn('importParser: unrecognized cell value shape, skipping:', JSON.stringify(value).slice(0, 200));
      text = '';
    }
  } else {
    text = String(value);
  }
  text = text.trim();
  return /^no data$/i.test(text) ? '' : text;
}

// Real-world date columns are sometimes typed as free text rather than a
// real Excel date, and the punctuation is inconsistent (verified against an
// actual import: "6-5--2026", "4- 19- 1987") — MySQL's DATE column rejects
// that outright (ER_TRUNCATED_WRONG_VALUE) rather than being lenient about
// it, so this pulls out the three number groups (month/day/year, matching
// this dataset's M-D-Y convention) instead of trusting the text verbatim.
function parseLooseDateText(text) {
  const nums = text.match(/\d+/g);
  if (!nums || nums.length !== 3) return null;

  let year, month, day;
  if (nums[2].length === 4) { [month, day, year] = nums.map(Number); }
  else if (nums[0].length === 4) { [year, month, day] = nums.map(Number); }
  else return null;

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cellToDateString(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellToText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return parseLooseDateText(text);
}

// Real-world AGE columns are messy: plain numbers, "40 years old", or
// "No Data" — pull out the first run of digits rather than assuming a clean
// numeric cell.
function parseAge(value) {
  const text = cellToText(value);
  if (!text) return null;
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

async function parseProbationerImport(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = findDataWorksheet(workbook);
  if (!worksheet) throw new Error('The workbook has no worksheets.');

  const columnMap = buildColumnMap(worksheet.getRow(1));
  if (!columnMap.fullName || !columnMap.docketNumber) {
    throw new Error('Missing required columns — the sheet needs at least a "Name" and a "Docket No." column.');
  }

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const get = (field) => (columnMap[field] ? row.getCell(columnMap[field]).value : null);
    const fullName = cellToText(get('fullName'));
    const docketNumber = cellToText(get('docketNumber'));
    if (!fullName && !docketNumber) return; // skip fully blank rows

    rows.push({
      rowNumber,
      fullName,
      age: parseAge(get('age')),
      docketNumber,
      address: cellToText(get('address')),
      offense: cellToText(get('offense')),
      courtBranch: cellToText(get('courtBranch')),
      judge: cellToText(get('judge')),
      convictionDate: cellToDateString(get('convictionDate')),
      assignedOfficer: cellToText(get('assignedOfficer')),
      stage: cellToText(get('stage')),
      status: cellToText(get('status')),
    });
  });

  return rows;
}

async function buildImportTemplate(filePath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Probationers');
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  TEMPLATE_HEADERS.forEach((_, i) => { sheet.getColumn(i + 1).width = 20; });
  await workbook.xlsx.writeFile(filePath);
}

module.exports = {
  parseProbationerImport,
  buildImportTemplate,
  normalizeHeader,
  cellToText,
  cellToDateString,
  parseAge,
};
