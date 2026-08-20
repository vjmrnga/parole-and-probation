// Turns the Sentence Details rows (min Y/M/D, optional max Y/M/D, fine) into
// the same printable sentence text the PSIR Generator composes — mirrors
// composeSentence()/fmtPeso() in renderer/public/psir-generator/app-logic.js
// exactly, so the live preview shown on Case Information matches what
// actually prints on the generated PSIR.
function has(v) {
  return v !== '' && v !== null && v !== undefined && !Number.isNaN(parseFloat(v));
}
function n(v) {
  return has(v) ? String(parseInt(v, 10)) : '0';
}
function fmtPeso(v) {
  const num = parseFloat(v);
  if (Number.isNaN(num)) return '';
  return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function composeSentence(sentences) {
  const parts = [];
  (sentences || []).forEach((sn) => {
    if (!sn) return;
    const bits = [];
    if (has(sn.y) || has(sn.m) || has(sn.d)) {
      let t = `Imprisonment of ${n(sn.y)}-${n(sn.m)}-${n(sn.d)}`;
      if (has(sn.y2) || has(sn.m2) || has(sn.d2)) t += ` to ${n(sn.y2)}-${n(sn.m2)}-${n(sn.d2)}`;
      bits.push(t);
    }
    if (has(sn.fine) && parseFloat(sn.fine) > 0) bits.push(`a fine of ${fmtPeso(sn.fine)}`);
    if (bits.length) {
      const s = bits.join(' and ');
      parts.push(s.charAt(0).toUpperCase() + s.slice(1));
    }
  });
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const items = parts.map((p, i) => `(${i + 1}) ${p}`);
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
}
