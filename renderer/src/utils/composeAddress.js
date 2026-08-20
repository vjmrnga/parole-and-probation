// Combines the structured address parts (House No., Street/Sitio, Purok,
// Barangay, City, Province) collected on CaseProfileFields into a single
// printable line — the same shape the "address" column, PSIR/Final Report
// present-address prefill, and Records Check PRESENT ADDRESS have always
// expected. Barangay is auto-prefixed with "Brgy." unless the officer
// already typed one.
export function composeAddress({ houseNo, street, purok, barangay, city, province } = {}) {
  const parts = [];

  const streetLine = [houseNo, purok, street].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  if (streetLine) parts.push(streetLine);

  const brgy = (barangay || '').trim();
  if (brgy) parts.push(/^brgy\.?/i.test(brgy) ? brgy : `Brgy. ${brgy}`);

  const cityTrimmed = (city || '').trim();
  if (cityTrimmed) parts.push(cityTrimmed);

  const provinceTrimmed = (province || '').trim();
  if (provinceTrimmed) parts.push(provinceTrimmed);

  return parts.join(', ');
}
