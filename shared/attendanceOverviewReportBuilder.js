// Builds an in-memory .xlsx workbook for the Attendance Overview export —
// same rows/filters/signatures the renderer already assembled for the Print
// and Preview views (see AttendanceOverviewTable.jsx and its ReportContent),
// just as a spreadsheet instead. Mirrors reportBuilder.js's banded-row style.
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Name', key: 'fullName', width: 26 },
  { header: 'Docket #', key: 'docketNumber', width: 16 },
  { header: 'Officer', key: 'assignedOfficerName', width: 22 },
  { header: 'Reported On', key: 'reportedOn', width: 26 },
  { header: 'Status', key: 'statusLabel', width: 14 },
  { header: 'Signature', key: 'signature', width: 20 },
];

const STATUS_LABELS = { present: 'Present', absent: 'Absent', pending: 'Pending' };

const THEME = {
  headerFill: 'FF4F7CFF',
  headerFont: 'FFFFFFFF',
  rowEven: 'FFFFFFFF',
  rowOdd: 'FFF3F6FF',
  border: 'FFC7CDD9',
  subtitle: 'FF666666',
};

const STATUS_ROW_FILL = {
  present: 'FFD4F4DD',
  absent: 'FFFBDADA',
  pending: 'FFFFF1C2',
};

const SIGNATURE_COL = COLUMNS.length; // 1-indexed column number

function thinBorder() {
  const style = { style: 'thin', color: { argb: THEME.border } };
  return { top: style, left: style, bottom: style, right: style };
}

// rows: attendance overview rows as sent by GET /attendance/overview, each
//   optionally carrying attendanceEntryId.
// signatures: { [attendanceEntryId]: 'data:image/png;base64,...' }
// month/officerName/statusFilter/graceEnd/counts/generatedAt: same report
//   metadata used to build the header lines in the Print/Preview views.
async function buildAttendanceOverviewWorkbook({
  rows, monthLabel, officerName, statusFilter, graceEnd, counts, signatures = {}, generatedAt,
}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance Overview');

  COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  const lastCol = COLUMNS.length;
  const mergeAndSet = (rowNum, text, font) => {
    sheet.mergeCells(rowNum, 1, rowNum, lastCol);
    const cell = sheet.getCell(rowNum, 1);
    cell.value = text;
    cell.font = font;
  };

  mergeAndSet(1, 'Talisay City Parole and Probation Office', { bold: true, size: 14 });
  mergeAndSet(2, `Attendance Overview — ${monthLabel}`, { size: 12 });

  const subtitleBits = [
    `Officer: ${officerName || 'All Officers'}`,
    statusFilter ? `Status: ${STATUS_LABELS[statusFilter] || statusFilter}` : null,
    graceEnd ? `Grace period ends ${graceEnd}` : null,
  ].filter(Boolean);
  mergeAndSet(3, subtitleBits.join('   •   '), { size: 9, color: { argb: THEME.subtitle } });
  mergeAndSet(
    4,
    `Present: ${counts.present}   Absent: ${counts.absent}   Pending: ${counts.pending}   •   Generated ${generatedAt}`,
    { size: 9, color: { argb: THEME.subtitle } },
  );

  const headerRow = 6;
  COLUMNS.forEach((col, i) => {
    const cell = sheet.getCell(headerRow, i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: THEME.headerFont } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.headerFill } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
  });
  sheet.getRow(headerRow).height = 22;

  rows.forEach((row, index) => {
    const rowNumber = headerRow + 1 + index;
    const bandColor = STATUS_ROW_FILL[row.status] || (index % 2 === 0 ? THEME.rowEven : THEME.rowOdd);
    const excelRow = sheet.getRow(rowNumber);
    const dataUrl = signatures[row.attendanceEntryId];

    const values = {
      fullName: row.fullName,
      docketNumber: row.docketNumber,
      assignedOfficerName: row.assignedOfficerName,
      reportedOn: row.reportedDates && row.reportedDates.length ? row.reportedDates.join(', ') : '—',
      statusLabel: STATUS_LABELS[row.status] || row.status,
      signature: dataUrl ? '' : '—',
    };

    COLUMNS.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = values[col.key] ?? '';
      cell.border = thinBorder();
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandColor } };
      cell.alignment = { vertical: 'middle' };
    });

    if (dataUrl) {
      excelRow.height = 34;
      const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
      if (match) {
        const imageId = workbook.addImage({ base64: dataUrl, extension: match[1] === 'jpeg' ? 'jpeg' : 'png' });
        sheet.addImage(imageId, {
          tl: { col: SIGNATURE_COL - 1 + 0.05, row: rowNumber - 1 + 0.05 },
          ext: { width: 110, height: 40 },
        });
      }
    }
  });

  return workbook;
}

module.exports = { buildAttendanceOverviewWorkbook, COLUMNS };
