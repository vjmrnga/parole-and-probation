// Single source of truth for the fixed stage/status vocab. Not admin-editable
// by design — changing these means shipping a code change (and a matching
// migration for the MySQL ENUM columns), never a UI setting.

const STAGES = ['Application', 'Under Supervision', 'Termination'];

const STATUSES = [
  'Active/Compliant',
  'Absconding',
  'Lacking Requirements',
  'Incomplete Attendance',
];

const ROLES = ['officer', 'admin'];

const OFFENSE_TYPES = ['Drug Offense', 'Non-Drug Offense'];

const HISTORY_FIELDS = ['stage', 'status', 'assigned_officer'];

module.exports = { STAGES, STATUSES, ROLES, OFFENSE_TYPES, HISTORY_FIELDS };
