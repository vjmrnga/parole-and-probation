import { useState } from 'react';
import { Alert, Button, Modal, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

const { Text, Paragraph } = Typography;

// Every imported row represents a case already under active supervision —
// unlike the masterlist import (which lands new applications), this always
// targets these fixed stage/status values regardless of anything in the file.
const TARGET_STAGE = 'Under Supervision';
const TARGET_STATUS = 'Active/Compliant';

// This file format has no "Assigned Officer" column — each worksheet TAB is
// one officer's caseload (e.g. a sheet named "KIRSTEN"). Sheet names are
// informal (first names, nicknames) and not reliably matchable against real
// accounts, so the officer for each sheet is picked explicitly by the admin
// running the import rather than guessed from the name.
function buildValidatedRows(rawRows, sheetOfficerMap, isAdmin, currentUser) {
  const docketCounts = {};
  rawRows.forEach((r) => { docketCounts[r.docketNumber] = (docketCounts[r.docketNumber] || 0) + 1; });

  return rawRows.map((raw) => {
    const row = { ...raw, fullName: raw.fullName ? raw.fullName.toUpperCase() : raw.fullName };
    const errors = [];
    if (!row.fullName) errors.push('Missing Name');
    if (!row.docketNumber) errors.push('Missing Docket Number');
    if (row.docketNumber && docketCounts[row.docketNumber] > 1) errors.push('Duplicate docket number in this file');

    let assignedOfficerId = null;
    if (!isAdmin) {
      assignedOfficerId = currentUser.id;
    } else {
      assignedOfficerId = sheetOfficerMap[row.sheetName] || null;
      if (!assignedOfficerId) errors.push(`No officer assigned to sheet "${row.sheetName}"`);
    }

    return { ...row, errors, assignedOfficerId };
  });
}

export default function ImportActiveSupervisionModal({ open, onClose, onImported }) {
  const { user } = useApp();
  const isAdmin = user?.role === 'admin';

  const [step, setStep] = useState('pick'); // pick | assignOfficers | review | importing | done
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [officers, setOfficers] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [sheetOfficerMap, setSheetOfficerMap] = useState({});
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);

  function reset() {
    setStep('pick');
    setError('');
    setRawRows([]);
    setSheetOfficerMap({});
    setRows([]);
    setResults([]);
    setProgress(0);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function pickFile() {
    setError('');
    setPicking(true);
    try {
      const officersList = isAdmin ? await ApiClient.get('/users') : [];
      setOfficers(officersList);

      const result = await window.api.importActiveSupervisionPickFile();
      if (!result.ok) {
        if (result.error) setError(result.error);
        return;
      }

      setRawRows(result.rows);
      if (isAdmin) {
        setSheetOfficerMap({});
        setStep('assignOfficers');
      } else {
        setRows(buildValidatedRows(result.rows, {}, isAdmin, user));
        setStep('review');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPicking(false);
    }
  }

  function continueToReview() {
    setRows(buildValidatedRows(rawRows, sheetOfficerMap, isAdmin, user));
    setStep('review');
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
          alias: row.alias,
          age: row.age,
          birthdate: row.birthdate,
          sex: row.sex,
          maritalStatus: row.maritalStatus,
          contactNumber: row.contactNumber,
          docketNumber: row.docketNumber,
          caseNumber: row.caseNumber,
          address: row.address,
          offense: row.offense,
          courtBranch: row.courtBranch,
          judge: row.judge,
          dateOfOrder: row.dateOfOrder,
          supervisionPeriod: row.supervisionPeriod,
          supervisionStartDate: row.supervisionStartDate,
          supervisionEndDate: row.supervisionEndDate,
          remarks: row.remarks,
          ...(isAdmin ? { assignedOfficerId: row.assignedOfficerId } : {}),
        });

        // Stage/Status follow-up PATCHes (rather than columns on create) so
        // they land in status_history with a proper audit trail, same
        // pattern as the masterlist importer.
        await ApiClient.patch(`/probationers/${created.id}/stage`, { stage: TARGET_STAGE });

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

  const sheetCounts = {};
  rawRows.forEach((r) => { sheetCounts[r.sheetName] = (sheetCounts[r.sheetName] || 0) + 1; });
  const sheetNames = Object.keys(sheetCounts);
  const unassignedSheetCount = sheetNames.filter((s) => !sheetOfficerMap[s]).length;

  const errorRowCount = rows.filter((r) => r.errors.length > 0).length;
  const readyRowCount = rows.length - errorRowCount;
  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <Modal
      title="Import Active Supervision Cases"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={850}
    >
      {step === 'pick' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Paragraph type="secondary">
            Upload an Active Supervision .xlsx file (one worksheet per officer's caseload).
            You&apos;ll be asked which officer each worksheet belongs to before importing.
            Every imported case is set to stage &quot;{TARGET_STAGE}&quot; and status &quot;{TARGET_STATUS}&quot;.
          </Paragraph>
          <Space>
            <Button type="primary" loading={picking} onClick={pickFile}>Choose Excel File…</Button>
          </Space>
          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      )}

      {step === 'assignOfficers' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Paragraph type="secondary">
            This file has {sheetNames.length} worksheet{sheetNames.length === 1 ? '' : 's'}. Assign the officer each one belongs to
            — sheets left unassigned will be skipped during import.
          </Paragraph>
          <Table
            size="small"
            rowKey={(s) => s}
            dataSource={sheetNames}
            pagination={false}
            columns={[
              { title: 'Worksheet', render: (s) => s, width: 160 },
              { title: 'Rows', render: (s) => sheetCounts[s], width: 80 },
              {
                title: 'Officer',
                render: (s) => (
                  <Select
                    style={{ width: '100%' }}
                    placeholder="Select officer…"
                    showSearch
                    optionFilterProp="label"
                    value={sheetOfficerMap[s] || undefined}
                    onChange={(value) => setSheetOfficerMap((m) => ({ ...m, [s]: value }))}
                    options={officers.map((o) => ({ label: o.full_name, value: o.id }))}
                  />
                ),
              },
            ]}
          />
          {unassignedSheetCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`${unassignedSheetCount} worksheet${unassignedSheetCount === 1 ? '' : 's'} not yet assigned — rows from ${unassignedSheetCount === 1 ? 'it' : 'them'} will be skipped.`}
            />
          )}
          <Space>
            <Button onClick={() => setStep('pick')}>Back</Button>
            <Button type="primary" onClick={continueToReview}>Continue to Review</Button>
          </Space>
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
            rowKey={(r) => `${r.sheetName}-${r.rowNumber}`}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            scroll={{ y: 320 }}
            columns={[
              { title: 'Sheet', dataIndex: 'sheetName', width: 100 },
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
            <Button onClick={() => setStep(isAdmin ? 'assignOfficers' : 'pick')}>Back</Button>
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
              rowKey={(r) => `${r.sheetName}-${r.rowNumber}`}
              dataSource={results.filter((r) => !r.ok)}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: 'Sheet', dataIndex: 'sheetName', width: 100 },
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
