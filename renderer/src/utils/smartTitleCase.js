// Auto-capitalizes name fields (Last/First/Middle Name, Alias, True Name,
// Mother/Father/Spouse, Judge) as the officer types — regardless of whether
// they typed "juan dela cruz" or "JUAN DELA CRUZ", both come out
// "Juan Dela Cruz". Common Filipino/Spanish name particles stay lowercase
// mid-name (dela Cruz, de la Torre, y, ng, sa, ...), matching the same
// convention renderer/public/psir-generator/app-logic.js's smartTitle() uses
// for the generated document — kept in sync by hand since that generator is
// a separate embedded tool.
const TITLE_MINOR = new Set([
  'of', 'and', 'the', 'at', 'in', 'on', 'for',
  'de', 'del', 'dela', 'de la', 'da', 'di', 'la', 'las', 'los', 'ng', 'sa', 'y',
]);

export function smartTitleCase(value) {
  const words = (value || '').split(/(\s+)/);
  let seenWord = false;
  return words
    .map((w) => {
      if (!w.trim()) return w;
      const lower = w.toLowerCase();
      if (seenWord && TITLE_MINOR.has(lower)) return lower;
      seenWord = true;
      return lower.replace(/^([("']*)(\p{L})/u, (m, pre, ch) => pre + ch.toUpperCase());
    })
    .join('');
}
