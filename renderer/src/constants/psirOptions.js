// Mirrors the fixed option lists baked into renderer/public/psir-generator's
// own <select> elements (see index.html / app-logic.js) — kept in sync by
// hand since that generator is a separate, largely frozen embedded tool.
// Shared by CaseDetailView's "PSIR Profile" card and GeneratePsirModal so
// values saved from one place resolve correctly in the other.
export const CIVIL_STATUS_OPTIONS = ['Single', 'Single w/ CLS', 'Married', 'Widowed', 'Separated'];

export const RELIGION_OPTIONS = [
  'Roman Catholic', 'Islam', 'Iglesia ni Cristo', 'Born Again Christian', 'Protestant',
  'Seventh-day Adventist', 'Jehovah’s Witnesses', 'Aglipayan', 'Buddhism',
];

export const NATIONALITY_OPTIONS = ['Filipino', 'American', 'Chinese', 'Japanese', 'Korean'];

export const GENDER_PREF_OPTIONS = ['Heterosexual', 'Homosexual', 'Bisexual'];

export const LAW_TYPES = ['R.A.', 'P.D.', 'B.P.', 'C.A.', 'Ordinance'];

// Mirrors the PSIR Generator's <select id="sentCourtType"> (and its main
// <select id="courtType">) options — used by the Sentencing Court
// AutoComplete on CaseProfileFields.
export const COURT_TYPE_OPTIONS = ['RTC', 'MTC', 'MTCC', 'MCTC', 'FC'];

// [agency name, default/placeholder status text] — fixed order, matches the
// generator's own AGENCIES list in renderer/public/psir-generator/template-data.js.
export const PRIOR_RECORD_AGENCIES = [
  ['NBI', 'No Derogatory Record'],
  ['CMRD/CMRU', 'No Probation Record'],
  ['Prosecutor', 'No Record on File'],
  ['RTC-OCC', 'No Criminal Case Filed'],
  ['MTCC-OCC', 'No Criminal Case Filed'],
  ['Police', 'No Record on File'],
  ['Barangay', 'No Record on File'],
];

export const SOCIO_ECONOMIC_GROUPS = [
  { id: 'econ', title: 'A. Family Economic Status', options: ['Poor', 'Low-income class (but not poor)', 'Lower middle-income class', 'Middle middle-income class', 'Upper middle-income class', 'Upper-income class (but not rich)', 'Rich'] },
  { id: 'famrel', title: 'B. Family Relationship', options: ['Very satisfactory', 'Satisfactory', 'Poor'] },
  { id: 'famrep', title: 'C. Family Reputation', options: ['Very satisfactory', 'Satisfactory', 'Poor'] },
  { id: 'wellbeing', title: 'D. Overall Well-Being', options: ['Very satisfactory', 'Satisfactory', 'Poor'] },
  { id: 'famsup', title: 'E. Family Support', options: ['Very satisfactory', 'Satisfactory', 'Poor'] },
  { id: 'commsup', title: 'F. Community Support', options: ['Very satisfactory', 'Satisfactory', 'Poor'] },
];
