// Combines the structured court parts (Court type, Branch No., Court City,
// Province) collected on CaseProfileFields into a single printable line —
// the same shape the "courtBranch"/court_branch column has always expected
// (Dashboard table, Records Check COURT, etc.). Mirrors the format
// psir-generator's own composeCourt()/composeBranch() print
// (see renderer/public/psir-generator/app-logic.js and
// renderer/public/final-report-generator/app-logic.js), minus their "__"
// placeholders — blank parts are just omitted here instead.
export function composeCourt({ type, branchNo, city, province } = {}) {
  const t = (type || '').trim();
  const n = (branchNo || '').trim();
  const c = (city || '').trim();
  const pv = (province || '').trim();

  const parts = [];
  if (t || n) parts.push([t, n && `Branch ${n}`].filter(Boolean).join(' '));
  if (c) parts.push(`City of ${c}`);
  if (pv) parts.push(pv);
  return parts.join(', ');
}
