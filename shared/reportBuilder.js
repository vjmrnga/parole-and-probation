// Builds an in-memory .xlsx workbook from the plain JSON rows returned by
// GET /reports/probationers-full. Used identically by both Head Office and
// Branch Office renderers — this is a reporting *output*, never a data
// source. Mirrors the styling approach of OfflineSignatureManager's
// excel/excelStore.js (banded rows, colored header).
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Docket #', key: 'docket_number', width: 16 },
  { header: 'Case Number', key: 'case_number', width: 20 },
  { header: 'Last Name', key: 'last_name', width: 20 },
  { header: 'First Name', key: 'first_name', width: 20 },
  { header: 'Middle Name', key: 'middle_name', width: 20 },
  { header: 'Alias', key: 'alias', width: 16 },
  { header: 'Age', key: 'age', width: 8 },
  { header: 'Birthdate', key: 'birthdate', width: 16 },
  { header: 'Sex', key: 'sex', width: 10 },
  { header: 'Marital Status', key: 'marital_status', width: 18 },
  { header: 'Contact Number', key: 'contact_number', width: 18 },
  { header: 'Address', key: 'address', width: 30 },
  { header: 'Offense', key: 'offense', width: 22 },
  { header: 'Offense Classification', key: 'offense_type', width: 20 },
  { header: 'Court Branch', key: 'court_branch', width: 18 },
  { header: 'Judge', key: 'judge', width: 20 },
  { header: 'Conviction Date', key: 'conviction_date', width: 16 },
  { header: 'Date of Order', key: 'date_of_order', width: 16 },
  { header: 'Supervision Period', key: 'supervision_period', width: 18 },
  { header: 'Supervision Start Date', key: 'supervision_start_date', width: 18 },
  { header: 'Supervision End Date', key: 'supervision_end_date', width: 18 },
  { header: 'Stage', key: 'stage', width: 18 },
  { header: 'Status', key: 'status', width: 20 },
  { header: 'Assigned Officer', key: 'assigned_officer_name', width: 22 },
  { header: 'Attendance Entries', key: 'attendance_count', width: 16 },
  { header: 'Remarks', key: 'remarks', width: 30 },
];

const THEME = {
  headerFill: 'FF4F7CFF',
  headerFont: 'FFFFFFFF',
  rowEven: 'FFFFFFFF',
  rowOdd: 'FFF3F6FF',
  border: 'FFC7CDD9',
};

function thinBorder() {
  const style = { style: 'thin', color: { argb: THEME.border } };
  return { top: style, left: style, bottom: style, right: style };
}

async function buildProbationersWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Probationers');

  COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  COLUMNS.forEach((col, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: THEME.headerFont } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.headerFill } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
  });
  sheet.getRow(1).height = 22;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const bandColor = index % 2 === 0 ? THEME.rowEven : THEME.rowOdd;
    const excelRow = sheet.getRow(rowNumber);
    COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = row[col.key] ?? '';
      cell.border = thinBorder();
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandColor } };
      cell.alignment = { vertical: 'middle', wrapText: col.key === 'address' };
    });
  });

  return workbook;
}

module.exports = { buildProbationersWorkbook, COLUMNS };
