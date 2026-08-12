// Builds the DDL from shared/statusEnums.js so the STAGE/STATUS ENUM columns
// can never drift from the fixed vocab used everywhere else in the code.
const { STAGES, STATUSES, ROLES, USER_TITLES, OFFENSE_TYPES, HISTORY_FIELDS } = require('../../shared/statusEnums');
const { splitName } = require('../../shared/nameUtils');

function sqlEnum(values) {
  return `ENUM(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`;
}

// Columns added after the initial release — CREATE TABLE IF NOT EXISTS below
// covers fresh installs, but existing databases need these added explicitly
// (see addMissingProbationerColumns).
const NEW_PROBATIONER_COLUMNS = [
  // Name is stored as three normalized parts (replaced the old single
  // full_name column — see the backfill + DROP in runMigration below). Added
  // as NULL for existing DBs since ALTER-adding to a populated table can't be
  // NOT NULL; the API/UI enforce first+last requiredness (same convention the
  // old full_name used). Fresh installs get NOT NULL in CREATE TABLE below.
  { name: 'first_name', ddl: 'VARCHAR(100) NULL' },
  { name: 'middle_name', ddl: 'VARCHAR(100) NULL' },
  { name: 'last_name', ddl: 'VARCHAR(100) NULL' },
  { name: 'case_number', ddl: 'VARCHAR(150) NULL' },
  { name: 'date_of_order', ddl: 'DATE NULL' },
  // Date the court order was actually received in the office (distinct from
  // date_of_order, which is when the court issued it).
  { name: 'date_order_received', ddl: 'DATE NULL' },
  { name: 'supervision_period', ddl: 'VARCHAR(20) NULL' },
  { name: 'supervision_start_date', ddl: 'DATE NULL' },
  { name: 'supervision_end_date', ddl: 'DATE NULL' },
  { name: 'alias', ddl: 'VARCHAR(150) NULL' },
  { name: 'birthdate', ddl: 'DATE NULL' },
  { name: 'sex', ddl: 'VARCHAR(20) NULL' },
  { name: 'marital_status', ddl: 'VARCHAR(50) NULL' },
  { name: 'contact_number', ddl: 'VARCHAR(30) NULL' },
  { name: 'remarks', ddl: 'TEXT NULL' },
  { name: 'offense_type', ddl: `${sqlEnum(OFFENSE_TYPES)} NULL` },
  // Snapshot of the last-used PSIR Generator form fields for this
  // probationer (identifying data, offense/sentence builders, prior
  // records, socio-economic ratings, petitioner photo, etc.) — see
  // renderer/public/psir-generator/app-logic.js's collectSnapshot(). Kept
  // as one JSON blob rather than dozens of columns since the source of
  // truth is inherently a flat form-field map keyed by the generator's
  // own field ids.
  { name: 'psir_profile', ddl: 'JSON NULL' },
  // Snapshot of the last-used Final Report Generator form fields for this
  // probationer — same rollforward pattern as psir_profile above, see
  // renderer/public/final-report-generator/app-logic.js's collectSnapshot().
  { name: 'file_report_profile', ddl: 'JSON NULL' },
  // Reference photo on file (mirrors signature_path) — shown next to the
  // reference signature on the Signature & Attendance screen so the officer
  // can compare both against the person appearing before logging attendance.
  { name: 'photo_path', ddl: 'VARCHAR(500) NULL' },
];

// Same rollforward pattern as NEW_PROBATIONER_COLUMNS above, for the users
// table — single-session enforcement (see server/routes/auth.js and
// server/middleware/auth.js): a login is only ever valid from the one
// device recorded here, so signing in elsewhere can warn the user and, once
// confirmed, boot the old session out.
const NEW_USER_COLUMNS = [
  { name: 'active_session_id', ddl: 'VARCHAR(64) NULL' },
  { name: 'active_session_device', ddl: 'VARCHAR(150) NULL' },
  { name: 'active_session_started_at', ddl: 'TIMESTAMP NULL' },
  // Name is stored as three normalized parts (replaced the old single
  // full_name column — see migrateUserFullNameToParts below), same convention
  // as probationers. Added NULL for existing DBs since ALTER-adding to a
  // populated table can't be NOT NULL; the API/UI enforce first+last
  // requiredness. Fresh installs get NOT NULL in CREATE TABLE below.
  { name: 'first_name', ddl: 'VARCHAR(100) NULL' },
  { name: 'middle_name', ddl: 'VARCHAR(100) NULL' },
  { name: 'last_name', ddl: 'VARCHAR(100) NULL' },
  // Job/rank title (PPO1, SrPPO, …) — one of shared/statusEnums.js's
  // USER_TITLES. Optional (the bootstrap admin may have none).
  { name: 'title', ddl: `${sqlEnum(USER_TITLES)} NULL` },
];

// Edit-in-place check-out lock, shared by every table that stores a
// generated/attached file users can open, edit and save back (psir_reports,
// file_reports, records_check_files, document_checklist). locked_by is the
// user who currently holds the file open for editing; locked_at is when they
// took it. A NULL locked_by means the file is free. See
// server/routes/lockHelpers.js for the acquire/release/staleness logic and
// electron/main.js's doc-edit-* handlers for the watch-and-upload flow that
// drives it. Added to existing DBs via addMissingColumns (see runMigration).
const NEW_LOCK_COLUMNS = [
  { name: 'locked_by', ddl: 'INT NULL' },
  { name: 'locked_at', ddl: 'TIMESTAMP NULL' },
];

// Same rollforward pattern as NEW_PROBATIONER_COLUMNS above, for
// attendance_log — CREATE TABLE IF NOT EXISTS below covers fresh installs,
// this covers columns added after a database already exists.
const NEW_ATTENDANCE_LOG_COLUMNS = [
  // Per-visit signature, captured at Log Attendance time — separate from
  // probationers.signature_path, which is the one-time reference signature
  // on file, not tied to any specific visit.
  { name: 'signature_path', ddl: 'VARCHAR(500) NULL' },
  // Optional Gender and Development topic covered at this visit. The
  // officer types it once in the Sign & Log Attendance screen and it's
  // reused for every subsequent probationer logged in the same sitting
  // (see SignatureAttendanceView.jsx), so it's stored per-entry here but
  // not required.
  { name: 'gad_topic', ddl: 'VARCHAR(255) NULL' },
];

async function addMissingColumns(pool, table, columns) {
  const [existing] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const have = new Set(existing.map((r) => r.COLUMN_NAME));
  for (const col of columns) {
    if (!have.has(col.name)) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

function buildSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(50)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      first_name    VARCHAR(100) NOT NULL,
      middle_name   VARCHAR(100) NULL,
      last_name     VARCHAR(100) NOT NULL,
      title         ${sqlEnum(USER_TITLES)} NULL,
      role          ${sqlEnum(ROLES)} NOT NULL DEFAULT 'officer',
      is_active     TINYINT(1) NOT NULL DEFAULT 1,
      active_session_id         VARCHAR(64) NULL,
      active_session_device     VARCHAR(150) NULL,
      active_session_started_at TIMESTAMP NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS probationers (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      first_name          VARCHAR(100) NOT NULL,
      middle_name         VARCHAR(100) NULL,
      last_name           VARCHAR(100) NOT NULL,
      age                 INT NULL,
      address             VARCHAR(255) NULL,
      docket_number       VARCHAR(100) NOT NULL UNIQUE,
      offense             VARCHAR(255) NULL,
      offense_type        ${sqlEnum(OFFENSE_TYPES)} NULL,
      court_branch        VARCHAR(150) NULL,
      judge               VARCHAR(150) NULL,
      conviction_date     DATE NULL,
      stage               ${sqlEnum(STAGES)} NOT NULL DEFAULT '${STAGES[0]}',
      status              ${sqlEnum(STATUSES)} NOT NULL DEFAULT '${STATUSES[0]}',
      assigned_officer_id INT NOT NULL,
      signature_path      VARCHAR(500) NULL,
      photo_path          VARCHAR(500) NULL,
      case_number             VARCHAR(150) NULL,
      date_of_order           DATE NULL,
      date_order_received     DATE NULL,
      supervision_period      VARCHAR(20) NULL,
      supervision_start_date  DATE NULL,
      supervision_end_date    DATE NULL,
      alias                   VARCHAR(150) NULL,
      birthdate               DATE NULL,
      sex                     VARCHAR(20) NULL,
      marital_status          VARCHAR(50) NULL,
      contact_number          VARCHAR(30) NULL,
      remarks                 TEXT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_officer_id) REFERENCES users(id) ON DELETE RESTRICT,
      INDEX idx_assigned_officer (assigned_officer_id),
      INDEX idx_stage (stage),
      INDEX idx_status (status)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS attendance_log (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id INT NOT NULL,
      log_date       DATE NOT NULL,
      notes          TEXT NULL,
      signature_path VARCHAR(500) NULL,
      gad_topic      VARCHAR(255) NULL,
      recorded_by    INT NOT NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id),
      UNIQUE KEY uniq_probationer_date (probationer_id, log_date),
      INDEX idx_probationer (probationer_id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS psir_reports (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id        INT NOT NULL,
      recommendation_type   VARCHAR(20) NOT NULL,
      filename              VARCHAR(255) NOT NULL,
      file_path             VARCHAR(500) NOT NULL,
      snapshot              JSON NULL,
      generated_by          INT NOT NULL,
      generated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_by             INT NULL,
      locked_at             TIMESTAMP NULL,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (generated_by) REFERENCES users(id),
      INDEX idx_probationer (probationer_id)
    ) ENGINE=InnoDB`,

    // Generated by the Final Report Generator (renderer/public/final-report-generator).
    // No recommendation_type column like psir_reports — the Final Report only
    // ever recommends probation TERMINATED, so there's no GRANTED/DENIED branch.
    `CREATE TABLE IF NOT EXISTS file_reports (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id        INT NOT NULL,
      filename              VARCHAR(255) NOT NULL,
      file_path             VARCHAR(500) NOT NULL,
      snapshot              JSON NULL,
      generated_by          INT NOT NULL,
      generated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_by             INT NULL,
      locked_at             TIMESTAMP NULL,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (generated_by) REFERENCES users(id),
      INDEX idx_probationer (probationer_id)
    ) ENGINE=InnoDB`,

    // Generated by the Records Check Generator (renderer/public/records-check-generator).
    // file_path lives on Head Office's disk regardless of which machine
    // (Head or Branch) generated the PDF, same as psir_reports above — so
    // every office sees the same list and can pull the bytes down to open.
    `CREATE TABLE IF NOT EXISTS records_check_files (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id INT NOT NULL,
      recipient      VARCHAR(100) NOT NULL,
      date_folder    VARCHAR(10) NOT NULL,
      filename       VARCHAR(255) NOT NULL,
      file_path      VARCHAR(500) NOT NULL,
      generated_by   INT NOT NULL,
      generated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_by      INT NULL,
      locked_at      TIMESTAMP NULL,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (generated_by) REFERENCES users(id),
      INDEX idx_probationer (probationer_id),
      INDEX idx_recipient (recipient)
    ) ENGINE=InnoDB`,

    // Singleton (id = 1) — office letterhead/signatory defaults the PSIR
    // Generator prefills every report with; still editable per report.
    `CREATE TABLE IF NOT EXISTS psir_org_settings (
      id            INT PRIMARY KEY DEFAULT 1,
      br_region     VARCHAR(150) NULL,
      br_region2    VARCHAR(150) NULL,
      br_office     VARCHAR(200) NULL,
      br_addr       VARCHAR(255) NULL,
      br_tel        VARCHAR(50)  NULL,
      br_email      VARCHAR(150) NULL,
      br_web        VARCHAR(150) NULL,
      office_name   VARCHAR(200) NULL,
      office_address VARCHAR(255) NULL,
      cppo_name     VARCHAR(150) NULL,
      cppo_title    VARCHAR(150) NULL,
      officer_rank  VARCHAR(50)  NULL,
      officer_name  VARCHAR(150) NULL,
      officer_title VARCHAR(150) NULL,
      sign_place    VARCHAR(200) NULL,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS status_history (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id INT NOT NULL,
      changed_by     INT NOT NULL,
      field_changed  ${sqlEnum(HISTORY_FIELDS)} NOT NULL,
      old_value      VARCHAR(255) NULL,
      new_value      VARCHAR(255) NOT NULL,
      changed_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id),
      INDEX idx_probationer (probationer_id)
    ) ENGINE=InnoDB`,

    // Submitted-documents checklist shown on the Stage & Status tab
    // (renderer/src/components/DocumentChecklist.jsx). doc_key is one of
    // shared/documentChecklist.js's DOCUMENT_CHECKLIST_KEYS — kept as a plain
    // VARCHAR rather than an ENUM (unlike stage/status above) since that list
    // is more likely to grow and a VARCHAR needs no ALTER TABLE to do it.
    // One row per (probationer, doc_key), created on first checkbox toggle
    // or file attach — a missing row just means "not submitted, no file yet".
    `CREATE TABLE IF NOT EXISTS document_checklist (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      probationer_id    INT NOT NULL,
      doc_key           VARCHAR(60) NOT NULL,
      submitted         TINYINT(1) NOT NULL DEFAULT 0,
      submitted_at      DATE NULL,
      file_path         VARCHAR(500) NULL,
      original_filename VARCHAR(255) NULL,
      mime_type         VARCHAR(100) NULL,
      updated_by        INT NULL,
      locked_by         INT NULL,
      locked_at         TIMESTAMP NULL,
      updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (probationer_id) REFERENCES probationers(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id),
      UNIQUE KEY uniq_probationer_doc (probationer_id, doc_key),
      INDEX idx_probationer (probationer_id)
    ) ENGINE=InnoDB`,
  ];
}

// One-time transition off the old single full_name column: split each existing
// value into the first/middle/last parts, then drop full_name. Idempotent —
// guarded on the column still existing, so re-runs (and fresh installs, which
// never had full_name) are no-ops.
async function migrateFullNameToParts(pool) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'probationers' AND COLUMN_NAME = 'full_name'`
  );
  if (cols.length === 0) return; // already migrated (or fresh install)

  const [rows] = await pool.query(
    `SELECT id, full_name FROM probationers WHERE last_name IS NULL OR last_name = ''`
  );
  for (const row of rows) {
    const { lastName, firstName, middleName } = splitName(row.full_name);
    await pool.query(
      'UPDATE probationers SET first_name = ?, middle_name = ?, last_name = ? WHERE id = ?',
      [firstName, middleName || null, lastName, row.id]
    );
  }
  await pool.query('ALTER TABLE probationers DROP COLUMN full_name');
}

// Same one-time transition as migrateFullNameToParts above, for the users
// table: split each existing full_name into first/middle/last, then drop the
// column. Idempotent — guarded on full_name still existing, so re-runs and
// fresh installs (which never had it) are no-ops.
async function migrateUserFullNameToParts(pool) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'full_name'`
  );
  if (cols.length === 0) return; // already migrated (or fresh install)

  const [rows] = await pool.query(
    `SELECT id, full_name FROM users WHERE last_name IS NULL OR last_name = ''`
  );
  for (const row of rows) {
    // User names were stored in natural "First Middle Last" order, so read the
    // last token as the surname and the first as the given name.
    const parts = String(row.full_name || '').trim().split(/\s+/).filter(Boolean);
    let firstName = '';
    let middleName = '';
    let lastName = '';
    if (parts.length === 1) {
      firstName = parts[0];
      lastName = parts[0];
    } else if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts[parts.length - 1];
      middleName = parts.slice(1, -1).join(' ');
    }
    await pool.query(
      'UPDATE users SET first_name = ?, middle_name = ?, last_name = ? WHERE id = ?',
      [firstName, middleName || null, lastName, row.id]
    );
  }
  await pool.query('ALTER TABLE users DROP COLUMN full_name');
}

async function runMigration(pool) {
  const statements = buildSchemaStatements();
  for (const sql of statements) {
    await pool.query(sql);
  }
  await addMissingColumns(pool, 'probationers', NEW_PROBATIONER_COLUMNS);
  await addMissingColumns(pool, 'attendance_log', NEW_ATTENDANCE_LOG_COLUMNS);
  await addMissingColumns(pool, 'users', NEW_USER_COLUMNS);
  // Edit-in-place lock columns, added to every file-bearing table that
  // existed before the check-out feature (see NEW_LOCK_COLUMNS).
  for (const table of ['psir_reports', 'file_reports', 'records_check_files', 'document_checklist']) {
    await addMissingColumns(pool, table, NEW_LOCK_COLUMNS);
  }
  await migrateFullNameToParts(pool);
  await migrateUserFullNameToParts(pool);
}

module.exports = { buildSchemaStatements, runMigration };
