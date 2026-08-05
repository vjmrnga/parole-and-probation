// Mirrors the fixed option list baked into renderer/public/final-report-generator's
// own <select id="civilStatus"> (see index.html) — kept in sync by hand since
// that generator is a separate, largely frozen embedded tool. Note this list
// differs slightly from constants/psirOptions.js's CIVIL_STATUS_OPTIONS (this
// one adds "Common-Law Relationship"), so it isn't shared with the PSIR side.
export const FINAL_REPORT_CIVIL_STATUS_OPTIONS = [
  'Single', 'Single w/ CLS', 'Married', 'Common-Law Relationship', 'Widowed', 'Separated',
];
