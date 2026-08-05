// "Last, First Middle" or "First Middle Last" — best-effort starting point
// only; every consumer surfaces these as editable fields before anything is
// printed or saved, so a wrong guess here never silently sticks.
export function splitName(fullName) {
  const empty = { lastName: '', firstName: '', middleName: '' };
  if (!fullName) return empty;
  if (fullName.includes(',')) {
    const [last, rest] = fullName.split(',').map((s) => s.trim());
    const [first, ...mid] = (rest || '').split(/\s+/).filter(Boolean);
    return { lastName: last || '', firstName: first || '', middleName: mid.join(' ') };
  }
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { lastName: parts[0], firstName: '', middleName: '' };
  return { lastName: parts[parts.length - 1], firstName: parts[0], middleName: parts.slice(1, -1).join(' ') };
}
