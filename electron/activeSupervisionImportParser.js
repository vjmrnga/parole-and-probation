// Reads an "Active Supervision" .xlsx (e.g. the EJARES export) into plain row
// objects. Unlike the masterlist import (electron/importParser.js), this
// format has no "Assigned Officer" column — each worksheet TAB is one
// officer's caseload, so the sheet name itself is the officer identifier.
// Reuses importParser's battle-tested cell-parsing primitives rather than
// duplicating them; keeps its own header-pattern map since this format's
// column labels (VIOLATION, COURT, DATE OF ORDER, ...) differ from the
// masterlist's and mixing the two pattern sets risks false-positive matches.
const ExcelJS = require('exceljs');
const { normalizeHeader, cellToText, cellToDateString, parseAge } = require('./importParser');

const FIELD_HEADER_PATTERNS = {
  fullName: [{ p: 'name' }],
  alias: [{ p: 'alias', exact: true }],
  docketNumber: [{ p: 'docket no' }, { p: 'docket number' }],
  caseNumber: [{ p: 'case number' }],
  offense: [{ p: 'violation' }],
  courtBranch: [{ p: 'court', exact: true }],
  judge: [{ p: 'judge', exact: true }],
  dateOfOrder: [{ p: 'date of order' }],
  supervisionPeriod: [{ p: 'period', exact: true }],
  supervisionStartDate: [{ p: 'start', exact: true }],
  supervisionEndDate: [{ p: 'end', exact: true }],
  address: [{ p: 'address', exact: true }],
  birthdate: [{ p: 'birthdate', exact: true }],
  age: [{ p: 'age', exact: true }],
  sex: [{ p: 'sex', exact: true }],
  maritalStatus: [{ p: 'marital status' }],
  contactNumber: [{ p: 'contact number' }],
  remarks: [{ p: 'remarks', exact: true }],
};

// A rollup/summary tab observed in the real file ("FINAL") carries corrupted
// data (a single cell with hundreds of concatenated dates) rather than
// per-probationer rows — never treat it as an officer's caseload.
function isSkippableSheet(name) {
  return /^final$/i.test(String(name || '').trim());
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

function parseSheet(worksheet) {
  const columnMap = buildColumnMap(worksheet.getRow(1));
  if (!columnMap.fullName || !columnMap.docketNumber) return [];

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const get = (field) => (columnMap[field] ? row.getCell(columnMap[field]).value : null);
    const fullName = cellToText(get('fullName'));
    const docketNumber = cellToText(get('docketNumber'));
    if (!fullName && !docketNumber) return; // skip fully blank rows

    rows.push({
      sheetName: worksheet.name,
      rowNumber,
      fullName,
      alias: cellToText(get('alias')),
      age: parseAge(get('age')),
      birthdate: cellToDateString(get('birthdate')),
      sex: cellToText(get('sex')),
      maritalStatus: cellToText(get('maritalStatus')),
      contactNumber: cellToText(get('contactNumber')),
      docketNumber,
      caseNumber: cellToText(get('caseNumber')),
      address: cellToText(get('address')),
      offense: cellToText(get('offense')),
      courtBranch: cellToText(get('courtBranch')),
      judge: cellToText(get('judge')),
      dateOfOrder: cellToDateString(get('dateOfOrder')),
      supervisionPeriod: cellToText(get('supervisionPeriod')),
      supervisionStartDate: cellToDateString(get('supervisionStartDate')),
      supervisionEndDate: cellToDateString(get('supervisionEndDate')),
      remarks: cellToText(get('remarks')),
    });
  });
  return rows;
}

async function parseActiveSupervisionImport(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = workbook.worksheets.filter((ws) => !isSkippableSheet(ws.name));
  if (sheets.length === 0) throw new Error('The workbook has no usable worksheets.');

  const rows = sheets.flatMap(parseSheet);
  if (rows.length === 0) {
    throw new Error('No probationer rows found — each sheet needs at least a "Name" and a "Docket No." column.');
  }
  return rows;
}

module.exports = { parseActiveSupervisionImport };
