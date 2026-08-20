import { SOCIO_ECONOMIC_GROUPS } from '../constants/psirOptions.js';

// Builds the { fields, radios, offenses, sentences } body for
// PATCH /probationers/:id/psir-profile from a CaseProfileFields form's
// values + its lifted priorRecords state. Shared by DashboardView's New/Edit
// Case saves and CaseDetailView's Case Information save so all three write
// the exact same shape into probationers.psir_profile.
export function buildPsirProfilePatch(values, priorRecords) {
  const fields = {
    trueName: (values.trueName || '').trim(),
    education: (values.education || '').trim(),
    occupation: (values.occupation || '').trim(),
    religion: (values.religion || '').trim(),
    nationality: (values.nationality || '').trim(),
    genderPref: (values.genderPref || '').trim(),
    motherName: (values.motherName || '').trim(),
    fatherName: (values.fatherName || '').trim(),
    spouse: (values.spouse || '').trim(),
    features: (values.features || '').trim(),
    placeOfBirth: (values.placeOfBirth || '').trim(),
    permanentAddress: (values.permanentAddress || '').trim(),
    addressHouseNo: (values.addressHouseNo || '').trim(),
    addressStreet: (values.addressStreet || '').trim(),
    addressPurok: (values.addressPurok || '').trim(),
    addressBarangay: (values.addressBarangay || '').trim(),
    addressCity: (values.addressCity || '').trim(),
    addressProvince: (values.addressProvince || '').trim(),
    permanentAddressHouseNo: (values.permanentAddressHouseNo || '').trim(),
    permanentAddressStreet: (values.permanentAddressStreet || '').trim(),
    permanentAddressPurok: (values.permanentAddressPurok || '').trim(),
    permanentAddressBarangay: (values.permanentAddressBarangay || '').trim(),
    permanentAddressCity: (values.permanentAddressCity || '').trim(),
    permanentAddressProvince: (values.permanentAddressProvince || '').trim(),
    detFacility: (values.detFacility || '').trim(),
    rorCustodian: (values.rorCustodian || '').trim(),
    custodialAddress: (values.custodialAddress || '').trim(),
    courtType: (values.courtType || '').trim(),
    courtBranchNo: (values.courtBranchNo || '').trim(),
    courtCity: (values.courtCity || '').trim(),
    courtProvince: (values.courtProvince || '').trim(),
    sentJudge: (values.sentJudge || '').trim(),
    sentCourtType: (values.sentCourtType || '').trim(),
    sentBranchNo: (values.sentBranchNo || '').trim(),
    sentCourtCity: (values.sentCourtCity || '').trim(),
    sentCourtProv: (values.sentCourtProv || '').trim(),
  };
  (priorRecords || []).forEach((r, i) => {
    fields[`pr_case_${i}`] = r.caseNo || '';
    fields[`pr_off_${i}`] = r.offense || '';
    fields[`pr_date_${i}`] = r.dateCharged || '';
    fields[`pr_status_${i}`] = r.status || '';
  });

  const radios = { custodial: values.custodialStatus || 'Bail' };
  SOCIO_ECONOMIC_GROUPS.forEach((g) => { radios[`rate_${g.id}`] = values[`rate_${g.id}`]; });

  const offenses = {
    charged: (values.chargedOffenses || []).filter((o) => o && o.text && o.text.trim()),
    convicted: (values.convictedOffenses || []).filter((o) => o && o.text && o.text.trim()),
  };
  const sentences = (values.sentences || []).filter((s) => s && (s.y || s.m || s.d || s.fine));

  return { fields, radios, offenses, sentences };
}
