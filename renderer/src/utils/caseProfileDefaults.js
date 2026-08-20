// Shared defaults for the psir_profile-backed parts of a case (prior records
// table + socio-economic ratings) — used by CaseProfileFields so New Case,
// Edit Case, and Case Information all seed identical starting values instead
// of each screen guessing its own.
import { PRIOR_RECORD_AGENCIES, SOCIO_ECONOMIC_GROUPS } from '../constants/psirOptions.js';

export function defaultPriorRecords() {
  return PRIOR_RECORD_AGENCIES.map(([agency, placeholder]) => ({ agency, placeholder, caseNo: '', offense: '', dateCharged: '', status: '' }));
}

// fields: the psir_profile.fields map (pr_case_i/pr_off_i/pr_date_i/pr_status_i).
export function priorRecordsFromFields(fields) {
  return PRIOR_RECORD_AGENCIES.map(([agency, placeholder], i) => ({
    agency,
    placeholder,
    caseNo: fields[`pr_case_${i}`] || '',
    offense: fields[`pr_off_${i}`] || '',
    dateCharged: fields[`pr_date_${i}`] || '',
    status: fields[`pr_status_${i}`] || '',
  }));
}

// Same "no strong opinion" default the socio-economic radios have always
// used: the 2nd option for the 7-option Family Economic Status scale, the
// 1st ("Very satisfactory") for every 3-option scale.
export function defaultSocioRatings() {
  return Object.fromEntries(
    SOCIO_ECONOMIC_GROUPS.map((g) => [`rate_${g.id}`, g.options[g.options.length > 3 ? 1 : 0]])
  );
}

export function socioRatingsFromRadios(radios) {
  return Object.fromEntries(
    SOCIO_ECONOMIC_GROUPS.map((g) => [`rate_${g.id}`, (radios || {})[`rate_${g.id}`] || g.options[g.options.length > 3 ? 1 : 0]])
  );
}

// Charged/Convicted offense rows used to be split into Sec./Art./Law/Number
// fields; they're now one free-text field. Old saved rows (identified by
// having a sec/no but no text) are composed into the same string the old
// fields used to print, so existing data keeps showing/printing correctly
// after the UI switch — see CaseProfileFields.jsx and psir-generator's
// app-logic.js (composeOffense), which does the equivalent migration.
function offenseRowToText(o) {
  if (!o) return { text: '', date: '' };
  if (typeof o.text === 'string' && o.text.trim()) return { text: o.text, date: o.date || '' };
  if (o.sec || o.no) {
    let t = o.sec && o.sec.trim() ? `Sec. ${o.sec.trim()}` : '';
    if (o.art && o.art.trim()) t += `${t ? ', ' : ''}Art. ${o.art.trim()}`;
    if (o.no && o.no.trim()) t += `${t ? ' of ' : ''}${o.law || 'R.A.'} ${o.no.trim()}`;
    return { text: t, date: o.date || '' };
  }
  return { text: o.text || '', date: o.date || '' };
}

// The form values for every field CaseProfileFields adds beyond the core
// probationer columns — i.e. everything that lives in probationer.psir_profile
// (fields/radios/offenses/sentences). Shared by CaseDetailView's Case
// Information load and DashboardView's Edit Case load so both start from the
// exact same mapping buildPsirProfilePatch() saves.
export function profileFormValues(p) {
  const profile = p.psir_profile || {};
  const f = profile.fields || {};
  const radios = profile.radios || {};
  const charged = (profile.offenses && profile.offenses.charged) || [];
  const convicted = (profile.offenses && profile.offenses.convicted) || [];
  return {
    trueName: f.trueName || '',
    education: f.education || '',
    occupation: f.occupation || '',
    religion: f.religion === '__other' ? (f.religionOther || '') : (f.religion || ''),
    nationality: f.nationality === '__other' ? (f.nationalityOther || '') : (f.nationality || ''),
    genderPref: f.genderPref === '__other' ? (f.genderPrefOther || '') : (f.genderPref || ''),
    motherName: f.motherName || '',
    fatherName: f.fatherName || '',
    spouse: f.spouse || '',
    features: f.features || '',
    placeOfBirth: f.placeOfBirth || '',
    addressHouseNo: f.addressHouseNo || '',
    addressStreet: f.addressStreet || '',
    addressPurok: f.addressPurok || '',
    addressBarangay: f.addressBarangay || '',
    addressCity: f.addressCity || '',
    addressProvince: f.addressProvince || '',
    permanentAddress: f.permanentAddress || '',
    permanentAddressHouseNo: f.permanentAddressHouseNo || '',
    permanentAddressStreet: f.permanentAddressStreet || '',
    permanentAddressPurok: f.permanentAddressPurok || '',
    permanentAddressBarangay: f.permanentAddressBarangay || '',
    permanentAddressCity: f.permanentAddressCity || '',
    permanentAddressProvince: f.permanentAddressProvince || '',
    custodialStatus: radios.custodial || 'Bail',
    detFacility: f.detFacility || '',
    rorCustodian: f.rorCustodian || '',
    custodialAddress: f.custodialAddress || '',
    courtType: f.courtType || '',
    courtBranchNo: f.courtBranchNo || '',
    courtCity: f.courtCity || '',
    courtProvince: f.courtProvince || '',
    sentJudge: f.sentJudge || '',
    sentCourtType: f.sentCourtType === '__other' ? (f.sentCourtTypeOther || '') : (f.sentCourtType || ''),
    sentBranchNo: f.sentBranchNo || '',
    sentCourtCity: f.sentCourtCity || '',
    sentCourtProv: f.sentCourtProv || '',
    chargedOffenses: charged.length ? charged.map(offenseRowToText) : [{ text: '', date: '' }],
    convictedOffenses: convicted.length ? convicted.map(offenseRowToText) : [{ text: '', date: '' }],
    sentences: Array.isArray(profile.sentences) && profile.sentences.length
      ? profile.sentences
      : [{ y: '', m: '', d: '', y2: '', m2: '', d2: '', fine: '' }],
    ...socioRatingsFromRadios(radios),
  };
}

// Same "brand-new case, nothing saved yet" defaults as profileFormValues({}),
// for the New Case form (see DashboardView.jsx's openNewCase()).
export function blankProfileFormValues() {
  return profileFormValues({});
}
