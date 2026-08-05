// Builds the DDL from shared/statusEnums.js so the STAGE/STATUS ENUM columns
// can never drift from the fixed vocab used everywhere else in the code.
const { STAGES, STATUSES, ROLES, OFFENSE_TYPES, HISTORY_FIELDS } = require('../../shared/statusEnums');

function sqlEnum(values) {
  return `ENUM(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`;
}

// Columns added after the initial release — CREATE TABLE IF NOT EXISTS below
// covers fresh installs, but existing databases need these added explicitly
// (see addMissingProbationerColumns).
const NEW_PROBATIONER_COLUMNS = [
  { name: 'case_number', ddl: 'VARCHAR(150) NULL' },
  { name: 'date_of_order', ddl: 'DATE NULL' },
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
];

async function addMissingProbationerColumns(pool) {
  const [existing] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'probationers'`
  );
  const have = new Set(existing.map((r) => r.COLUMN_NAME));
  for (const col of NEW_PROBATIONER_COLUMNS) {
    if (!have.has(col.name)) {
      await pool.query(`ALTER TABLE probationers ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

function buildSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(50)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name     VARCHAR(150) NOT NULL,
      role          ${sqlEnum(ROLES)} NOT NULL DEFAULT 'officer',
      is_active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS probationers (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      full_name           VARCHAR(200) NOT NULL,
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
      case_number             VARCHAR(150) NULL,
      date_of_order           DATE NULL,
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
  ];
}

async function runMigration(pool) {
  const statements = buildSchemaStatements();
  for (const sql of statements) {
    await pool.query(sql);
  }
  await addMissingProbationerColumns(pool);
}

module.exports = { buildSchemaStatements, runMigration };
