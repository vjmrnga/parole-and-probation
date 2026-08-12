// Composes a probationer's stored name parts into a single "Last, First Middle"
// display string — used wherever one name string is still needed (case-detail
// header, report/modal titles, records-check NAME, attendance sheet labels).
// Mirrors shared/nameUtils.js's probationerNameSql() ordering; keep in sync.
export function composeName(p) {
  if (!p) return '';
  const last = (p.last_name || '').trim();
  const rest = [p.first_name, p.middle_name].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  if (last && rest) return `${last}, ${rest}`;
  return last || rest;
}
