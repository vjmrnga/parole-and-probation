// Single source of truth for the document-submission checklist shown on the
// Stage & Status tab (renderer/src/screens/CaseDetailView.jsx) and enforced
// by server/routes/documents.js — same "fixed vocab, code change to alter"
// approach as shared/statusEnums.js.
//
// detainedRequired: true marks the items that still apply when the
// probationer's custodial status (probationer.psir_profile.radios.custodial,
// set on the PSIR Profile tab) is 'Detention'. Everyone else on this list is
// hidden from the checklist for detained cases, since most of those
// documents require the person to appear in person to obtain them.
const DOCUMENT_CHECKLIST_ITEMS = [
  { key: 'nso_birth_certificate', label: 'NSO Birth Certificate', detainedRequired: true },
  { key: 'nbi_clearance', label: 'NBI Clearance', detainedRequired: false },
  { key: 'picture_2x2', label: 'Picture 2x2', detainedRequired: false },
  { key: 'marriage_contract', label: 'Marriage Contract', detainedRequired: false },
  { key: 'rtc_occ_clearance', label: 'RTC-OCC Clearance', detainedRequired: false },
  { key: 'mtcc_occ_clearance', label: 'MTCC-OCC Clearance', detainedRequired: false },
  { key: 'prosecutor_clearance', label: 'Prosecutor Clearance', detainedRequired: false },
  { key: 'police_clearance', label: 'Police Clearance', detainedRequired: false },
  { key: 'brgy_clearance', label: 'Brgy. Clearance', detainedRequired: true },
  { key: 'brgy_collateral_sheet', label: 'Brgy. Collateral Sheet', detainedRequired: true },
  { key: 'investigation_case_notes', label: 'Investigation Case Notes', detainedRequired: true },
  { key: 'community_work_service', label: 'Community Work Service', detainedRequired: false },
];

const DOCUMENT_CHECKLIST_KEYS = DOCUMENT_CHECKLIST_ITEMS.map((d) => d.key);

module.exports = { DOCUMENT_CHECKLIST_ITEMS, DOCUMENT_CHECKLIST_KEYS };
