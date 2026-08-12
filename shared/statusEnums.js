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

// Job/rank titles a user account can carry (shown next to the name in Manage
// Users; stored on users.title). Fixed vocab like the others here — adding one
// means a code change plus a matching ENUM migration (see users.title DDL).
const USER_TITLES = ['PPO1', 'PPO2', 'SrPPO', 'SPPO', 'CPPO', 'ADA 4', 'JOP', 'CDA'];

const OFFENSE_TYPES = ['Drug Offense', 'Non-Drug Offense'];

const HISTORY_FIELDS = ['stage', 'status', 'assigned_officer'];

module.exports = { STAGES, STATUSES, ROLES, USER_TITLES, OFFENSE_TYPES, HISTORY_FIELDS };
