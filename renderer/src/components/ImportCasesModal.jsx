import { useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Table, Tag, Typography } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

const { Text, Paragraph } = Typography;

// Resolves the spreadsheet's free-text "Assigned Officer" column against
// real user accounts (by username or full name, case-insensitive) — real
// masterlists are messy here (verified against an actual office export:
// values like "PPO2 JOUANA O. EJARES" alongside stray typos), so this is
// surfaced as a per-row error rather than silently guessing.
function resolveOfficer(row, officers, isAdmin, currentUser) {
  if (!isAdmin) return { assignedOfficerId: currentUser.id, officerError: null };
  if (!row.assignedOfficer) return { assignedOfficerId: currentUser.id, officerError: null };
  const needle = row.assignedOfficer.trim().toLowerCase();
  const match = officers.find(
    (o) => (o.username && o.username.toLowerCase() === needle) || o.full_name.toLowerCase() === needle
  );
  if (match) return { assignedOfficerId: match.id, officerError: null };
  return { assignedOfficerId: null, officerError: `Officer "${row.assignedOfficer}" not found` };
}

function validateRow(row, enums, officers, isAdmin, currentUser) {
  const errors = [];
  if (!row.fullName) errors.push('Missing Name');
  if (!row.docketNumber) errors.push('Missing Docket Number');
  if (row.status && !enums.STATUSES.includes(row.status)) errors.push(`Invalid status "${row.status}"`);

  const { assignedOfficerId, officerError } = resolveOfficer(row, officers, isAdmin, currentUser);
  if (officerError) errors.push(officerError);

  return { ...row, errors, assignedOfficerId };
}

export default function ImportCasesModal({ open, onClose, onImported }) {
  const { enums, user } = useApp();
  const isAdmin = user?.role === 'admin';

  const [step, setStep] = useState('pick'); // pick | review | importing | done
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [officers, setOfficers] = useState([]);
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);

  function reset() {
    setStep('pick');
    setError('');
    setRows([]);
    setResults([]);
    setProgress(0);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function downloadTemplate() {
    setError('');
    const result = await window.api.importCasesDownloadTemplate();
    if (!result.ok && result.error) setError(result.error);
  }

  async function pickFile() {
    setError('');
    setPicking(true);
    try {
      const officersList = await ApiClient.get('/users');
      setOfficers(officersList);

      const result = await window.api.importCasesPickFile();
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }
      // Duplicate docket numbers within the file itself — flag before even
      // hitting the server (a true DB duplicate still surfaces later as a
      // per-row failure when the create request 409s).
      const docketCounts = {};
      result.rows.forEach((r) => { docketCounts[r.docketNumber] = (docketCounts[r.docketNumber] || 0) + 1; });

      const validated = result.rows.map((r) => {
        const row = { ...r, fullName: r.fullName ? r.fullName.toUpperCase() : r.fullName };
        const v = validateRow(row, enums, officersList, isAdmin, user);
        if (r.docketNumber && docketCounts[r.docketNumber] > 1) v.errors.push('Duplicate docket number in this file');
        return v;
      });
      setRows(validated);
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setPicking(false);
    }
  }

  async function runImport() {
    setStep('importing');
    setProgress(0);
    const validRows = rows.filter((r) => r.errors.length === 0);
    const outcomes = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const created = await ApiClient.post('/probationers', {
          fullName: row.fullName,
          age: row.age,
          docketNumber: row.docketNumber,
          address: row.address,
          offense: row.offense,
          courtBranch: row.courtBranch,
          judge: row.judge,
          convictionDate: row.convictionDate,
          ...(isAdmin ? { assignedOfficerId: row.assignedOfficerId } : {}),
        });

        // Every imported row is a new application, so it always lands in the
        // "Application" stage (the creation default) regardless of anything
        // in the file — same convention as the Active Supervision importer.
        // Status only differs from the creation default if the sheet
        // explicitly set it — applied as a follow-up PATCH so it still
        // lands in status_history with a proper audit trail, same as if
        // someone changed it by hand right after creating the case.
        if (row.status && row.status !== enums.STATUSES[0]) {
          await ApiClient.patch(`/probationers/${created.id}/status`, { status: row.status });
        }

        outcomes.push({ ...row, ok: true });
      } catch (err) {
        outcomes.push({ ...row, ok: false, error: err.message });
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100));
    }

    setResults(outcomes);
    setStep('done');
    onImported();
  }

  const errorRowCount = rows.filter((r) => r.errors.length > 0).length;
  const readyRowCount = rows.length - errorRowCount;
  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <Modal
      title="Import Cases from Excel"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={800}
    >
      {step === 'pick' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Paragraph type="secondary">
            Upload an .xlsx file with one row per probationer. Column headers are matched flexibly
            (e.g. "Docket No.", "Present Address", "IO" for officer all work) — download the template
            below if you'd rather start from a blank sheet. Every imported case is placed in the
            "Application" stage regardless of anything in the file.
          </Paragraph>
          <Space>
            <Button onClick={downloadTemplate}>Download Template</Button>
            <Button type="primary" loading={picking} onClick={pickFile}>Choose Excel File…</Button>
          </Space>
          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      )}

      {step === 'review' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type={errorRowCount ? 'warning' : 'success'}
            showIcon
            message={`${readyRowCount} ready to import${errorRowCount ? `, ${errorRowCount} with errors (will be skipped)` : ''}.`}
          />
          <Table
            size="small"
            rowKey="rowNumber"
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            scroll={{ y: 320 }}
            columns={[
              { title: 'Row', dataIndex: 'rowNumber', width: 60 },
              { title: 'Name', dataIndex: 'fullName' },
              { title: 'Docket #', dataIndex: 'docketNumber' },
              {
                title: 'Status',
                key: 'status',
                render: (_, r) => (r.errors.length
                  ? <Tag color="red">{r.errors.join('; ')}</Tag>
                  : <Tag color="green">Ready</Tag>),
              },
            ]}
          />
          <Space>
            <Button onClick={() => setStep('pick')}>Back</Button>
            <Button type="primary" disabled={readyRowCount === 0} onClick={runImport}>
              Import {readyRowCount} Case{readyRowCount === 1 ? '' : 's'}
            </Button>
          </Space>
        </Space>
      )}

      {step === 'importing' && (
        <div style={{ padding: '24px 0' }}>
          <Progress percent={progress} />
          <Text type="secondary">Importing…</Text>
        </div>
      )}

      {step === 'done' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type={failCount ? 'warning' : 'success'}
            showIcon
            message={`${successCount} case${successCount === 1 ? '' : 's'} created${failCount ? `, ${failCount} failed` : ''}.`}
          />
          {failCount > 0 && (
            <Table
              size="small"
              rowKey="rowNumber"
              dataSource={results.filter((r) => !r.ok)}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: 'Row', dataIndex: 'rowNumber', width: 60 },
                { title: 'Name', dataIndex: 'fullName' },
                { title: 'Docket #', dataIndex: 'docketNumber' },
                { title: 'Error', dataIndex: 'error' },
              ]}
            />
          )}
          <Button type="primary" onClick={handleClose}>Done</Button>
        </Space>
      )}
    </Modal>
  );
}
