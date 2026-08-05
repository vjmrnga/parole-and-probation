// Probationers report once a month, but not on a fixed per-person schedule
// (that turned out too taxing to maintain and kept changing). Instead there
// is one shared rule for everyone: a grace period through the end of the
// month's first Monday-Friday work week (i.e. the first Friday) before an
// unreported probationer counts as Absent for that month.
const dayjs = require('dayjs');

// monthStr: 'YYYY-MM'. Returns 'YYYY-MM-DD' of the first Friday of the month.
function firstWeekGraceEnd(monthStr) {
  const start = dayjs(`${monthStr}-01`);
  for (let d = 1; d <= 7; d += 1) {
    const candidate = start.date(d);
    if (candidate.day() === 5) return candidate.format('YYYY-MM-DD');
  }
  return null; // unreachable — every 7-day span contains a Friday
}

module.exports = { firstWeekGraceEnd };
