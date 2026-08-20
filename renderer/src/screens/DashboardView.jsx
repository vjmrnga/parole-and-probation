import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Button, Divider, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { CameraOutlined, DeleteOutlined, EditOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiClient } from '../api/apiClient.js';
import { useServerEvents } from '../hooks/useServerEvents.js';
import { useApp } from '../AppContext.jsx';
import ImportCasesModal from '../components/ImportCasesModal.jsx';
import ImportActiveSupervisionModal from '../components/ImportActiveSupervisionModal.jsx';
import CaseProfileFields from '../components/CaseProfileFields.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import { STAGE_COLORS, STATUS_COLORS } from '../constants/statusColors.js';
import { composeName } from '../utils/composeName.js';
import { buildPsirProfilePatch } from '../utils/buildPsirProfilePatch.js';
import { blankProfileFormValues, defaultPriorRecords, priorRecordsFromFields, profileFormValues } from '../utils/caseProfileDefaults.js';
import { PSIR_PHOTO_SLOT, dataUrlToBase64, fitImageToSlot } from '../utils/psirPhoto.js';
import { reportValidationError } from '../utils/formValidation.js';

const { Title, Text } = Typography;

export default function DashboardView() {
  const { enums, user, openCase } = useApp();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: undefined, assignedOfficerId: undefined });
  const [activeStage, setActiveStage] = useState(undefined);

  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newCaseForm] = Form.useForm();
  const [newCaseError, setNewCaseError] = useState('');
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importActiveSupervisionOpen, setImportActiveSupervisionOpen] = useState(false);

  const [editCase, setEditCase] = useState(null);
  const [editForm] = Form.useForm();
  const [editError, setEditError] = useState('');
  const [editReassignTo, setEditReassignTo] = useState();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const searchTimeoutRef = useRef(null);

  // Prior-records table state for whichever of New Case / Edit Case is open
  // (only one is ever open at once) — same lifted-state pattern CaseDetailView
  // uses for its Case Information tab. See CaseProfileFields.jsx.
  const [newCasePriorRecords, setNewCasePriorRecords] = useState(defaultPriorRecords());
  const [editCasePriorRecords, setEditCasePriorRecords] = useState(defaultPriorRecords());

  // New Case has no probationer id yet to upload a photo against, so it's
  // held as a plain data URL until createCase() has one (see there).
  const [newCasePhoto, setNewCasePhoto] = useState(null);
  const [newCasePhotoModalOpen, setNewCasePhotoModalOpen] = useState(false);

  useEffect(() => {
    ApiClient.get('/users').then(setOfficers).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Debounced so typing fires a search automatically without needing
  // Enter/the search icon, but doesn't send a request per keystroke.
  useEffect(() => () => clearTimeout(searchTimeoutRef.current), []);

  // Live update: reload when a probationer is created/updated/deleted on any
  // machine (including a bulk import, which the hook coalesces into one refetch).
  useServerEvents((events) => {
    if (events.some((e) => e.resource === 'probationers')) loadDashboard();
  });

  function handleSearchChange(value) {
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: value }));
    }, 300);
  }

  async function loadDashboard() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    if (filters.assignedOfficerId) params.set('assignedOfficerId', filters.assignedOfficerId);
    try {
      const data = await ApiClient.get(`/probationers?${params.toString()}`);
      setRows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    setError('');
    try {
      const fullRows = await ApiClient.get('/reports/probationers-full');
      await window.api.exportReport(fullRows);
    } catch (err) {
      setError(err.message);
    }
  }

  function openNewCase() {
    newCaseForm.resetFields();
    // Same "brand-new case" defaults CaseDetailView.load() seeds for a fresh
    // psir_profile — keeps the two forms' starting state identical.
    newCaseForm.setFieldsValue(blankProfileFormValues());
    setNewCasePriorRecords(defaultPriorRecords());
    setNewCasePhoto(null);
    setNewCaseError('');
    setNewCaseOpen(true);
  }

  async function createCase() {
    setNewCaseError('');
    setCreating(true);
    try {
      const values = await newCaseForm.validateFields();
      const created = await ApiClient.post('/probationers', {
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || '',
        lastName: values.lastName.trim(),
        age: values.age ?? null,
        docketNumber: values.docketNumber.trim(),
        address: values.address?.trim() || '',
        offenseType: values.offenseType || null,
        courtBranch: values.courtBranch?.trim() || '',
        judge: values.judge?.trim() || '',
        caseNumber: values.caseNumber?.trim() || '',
        dateOfOrder: values.dateOfOrder ? values.dateOfOrder.format('YYYY-MM-DD') : null,
        dateOrderReceived: values.dateOrderReceived ? values.dateOrderReceived.format('YYYY-MM-DD') : null,
        supervisionPeriod: values.supervisionPeriod?.trim() || '',
        supervisionStartDate: values.supervisionStartDate ? values.supervisionStartDate.format('YYYY-MM-DD') : null,
        supervisionEndDate: values.supervisionEndDate ? values.supervisionEndDate.format('YYYY-MM-DD') : null,
        alias: values.alias?.trim() || '',
        birthdate: values.birthdate ? values.birthdate.format('YYYY-MM-DD') : null,
        sex: values.sex || '',
        maritalStatus: values.maritalStatus?.trim() || '',
        contactNumber: values.contactNumber?.trim() || '',
        remarks: values.remarks?.trim() || '',
        ...(isAdmin && values.assignedOfficerId ? { assignedOfficerId: values.assignedOfficerId } : {}),
      });
      // 2. PSIR profile (everything beyond the core case record — see
      // CaseProfileFields.jsx) — same two-call pattern as CaseDetailView's
      // saveCaseInfo(), just against the id we just created.
      const psirPatch = buildPsirProfilePatch(values, newCasePriorRecords);
      if (newCasePhoto) {
        // 3. Reference photo — mirrors CaseDetailView.savePhoto(): saved as
        // the case's photo on file, and also fitted into the PSIR profile's
        // photo slot so Generate PSIR starts pre-filled with it.
        await ApiClient.post(`/probationers/${created.id}/photo`, { dataUrl: newCasePhoto });
        const fitted = await fitImageToSlot(newCasePhoto);
        psirPatch.media = { [PSIR_PHOTO_SLOT.path]: dataUrlToBase64(fitted) };
      }
      await ApiClient.patch(`/probationers/${created.id}/psir-profile`, psirPatch);
      setNewCaseOpen(false);
      message.success(`Case for ${composeName({ first_name: values.firstName, middle_name: values.middleName, last_name: values.lastName })} created.`);
      await loadDashboard();
    } catch (err) {
      if (reportValidationError(err)) return;
      setNewCaseError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function openEditCase(record) {
    setEditError('');
    editForm.setFieldsValue({
      firstName: record.first_name,
      middleName: record.middle_name,
      lastName: record.last_name,
      age: record.birthdate ? dayjs().diff(dayjs(record.birthdate), 'year') : record.age,
      docketNumber: record.docket_number,
      address: record.address,
      offenseType: record.offense_type,
      courtBranch: record.court_branch,
      judge: record.judge,
      caseNumber: record.case_number,
      dateOfOrder: record.date_of_order ? dayjs(record.date_of_order) : null,
      dateOrderReceived: record.date_order_received ? dayjs(record.date_order_received) : null,
      supervisionPeriod: record.supervision_period,
      supervisionStartDate: record.supervision_start_date ? dayjs(record.supervision_start_date) : null,
      supervisionEndDate: record.supervision_end_date ? dayjs(record.supervision_end_date) : null,
      alias: record.alias,
      birthdate: record.birthdate ? dayjs(record.birthdate) : null,
      sex: record.sex,
      maritalStatus: record.marital_status,
      contactNumber: record.contact_number,
      remarks: record.remarks,
      ...profileFormValues(record),
    });
    setEditCasePriorRecords(priorRecordsFromFields(record.psir_profile?.fields || {}));
    setEditReassignTo(record.assigned_officer_id);
    setEditCase(record);
  }

  async function saveEditCase() {
    setEditError('');
    setSaving(true);
    try {
      const values = await editForm.validateFields();
      await ApiClient.patch(`/probationers/${editCase.id}`, {
        // Docket number is admin-only on the server — only send it when this
        // user is an admin, otherwise the whole PATCH is rejected with 403
        // (matches CaseDetailView.saveCaseInfo()).
        ...(isAdmin ? { docketNumber: values.docketNumber?.trim() || '' } : {}),
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || '',
        lastName: values.lastName.trim(),
        age: values.age ?? null,
        address: values.address?.trim() || '',
        offenseType: values.offenseType || null,
        courtBranch: values.courtBranch?.trim() || '',
        judge: values.judge?.trim() || '',
        caseNumber: values.caseNumber?.trim() || '',
        dateOfOrder: values.dateOfOrder ? values.dateOfOrder.format('YYYY-MM-DD') : null,
        dateOrderReceived: values.dateOrderReceived ? values.dateOrderReceived.format('YYYY-MM-DD') : null,
        supervisionPeriod: values.supervisionPeriod?.trim() || '',
        supervisionStartDate: values.supervisionStartDate ? values.supervisionStartDate.format('YYYY-MM-DD') : null,
        supervisionEndDate: values.supervisionEndDate ? values.supervisionEndDate.format('YYYY-MM-DD') : null,
        alias: values.alias?.trim() || '',
        birthdate: values.birthdate ? values.birthdate.format('YYYY-MM-DD') : null,
        sex: values.sex || '',
        maritalStatus: values.maritalStatus?.trim() || '',
        contactNumber: values.contactNumber?.trim() || '',
        remarks: values.remarks?.trim() || '',
      });
      // Admins can reassign from this form; the officer change goes through
      // its dedicated endpoint (records an audit entry) — same as
      // CaseDetailView.saveCaseInfo().
      if (isAdmin && editReassignTo && editReassignTo !== editCase.assigned_officer_id) {
        await ApiClient.patch(`/probationers/${editCase.id}/reassign`, { assignedOfficerId: editReassignTo });
      }
      // 2. PSIR profile — same two-call pattern as CaseDetailView.saveCaseInfo().
      await ApiClient.patch(`/probationers/${editCase.id}/psir-profile`, buildPsirProfilePatch(values, editCasePriorRecords));
      setEditCase(null);
      message.success('Case updated.');
      await loadDashboard();
    } catch (err) {
      if (reportValidationError(err)) return;
      setEditError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCase(record) {
    setDeletingId(record.id);
    try {
      await ApiClient.delete(`/probationers/${record.id}`);
      message.success(`Case for ${composeName(record)} deleted.`);
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const row of rows) counts[row.stage] = (counts[row.stage] || 0) + 1;
    return counts;
  }, [rows]);

  const visibleRows = useMemo(
    () => (activeStage ? rows.filter((r) => r.stage === activeStage) : rows),
    [rows, activeStage],
  );

  const columns = [
    { title: 'Docket #', dataIndex: 'docket_number', key: 'docket_number' },
    { title: 'Last Name', dataIndex: 'last_name', key: 'last_name' },
    { title: 'First Name', dataIndex: 'first_name', key: 'first_name' },
    { title: 'Middle Name', dataIndex: 'middle_name', key: 'middle_name', render: (v) => v || '—' },
    { title: 'Stage', dataIndex: 'stage', key: 'stage', render: (v) => <Tag color={STAGE_COLORS[v] || 'default'}>{v}</Tag> },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
    { title: 'Assigned Officer', dataIndex: 'assigned_officer_name', key: 'assigned_officer_name' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space onClick={(e) => e.stopPropagation()}>
          {(isAdmin || user?.id === record.assigned_officer_id) && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditCase(record)}>Edit</Button>
          )}
          {isAdmin && (
            <Popconfirm
              title={`Delete case for ${composeName(record)}?`}
              description="This cannot be undone."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteCase(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id}>Delete</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3}>Probationers</Title>

      <style>{`
        @keyframes stageContentFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .stage-tab {
          transition: background 0.3s cubic-bezier(0.22, 1, 0.36, 1),
            color 0.3s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.3s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .stage-tab:hover {
          background: #f5f8ff;
        }
        .stage-tab .stage-tab-count {
          transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), color 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .stage-tab.active .stage-tab-count {
          transform: scale(1.08);
        }
        .case-modal-form .ant-form-item-label > label { font-weight: 600; }
        .case-modal-form .section-title .ant-divider-inner-text { font-weight: 700; font-size: 16px; }
        .case-modal-form .section-title.ant-divider-horizontal { margin: 4px 0 16px; }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          marginBottom: 24,
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {[{ label: 'All', value: undefined }, ...enums.STAGES.map((s) => ({ label: s, value: s }))].map((opt, idx, arr) => {
          const count = opt.value ? stageCounts[opt.value] || 0 : rows.length;
          const active = activeStage === opt.value;
          return (
            <div key={opt.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div
                className={`stage-tab${active ? ' active' : ''}`}
                onClick={() => setActiveStage(opt.value)}
                style={{
                  cursor: 'pointer',
                  flex: 1,
                  padding: '16px 24px',
                  textAlign: 'center',
                  background: active ? '#e6f4ff' : 'transparent',
                  borderBottom: active ? '3px solid #1677ff' : '3px solid transparent',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: active ? '#1677ff' : 'rgba(0,0,0,0.85)' }}>
                  {opt.label}
                </div>
                <div className="stage-tab-count" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.4, color: active ? '#1677ff' : 'rgba(0,0,0,0.85)' }}>
                  {count}
                </div>
              </div>
              {idx < arr.length - 1 && <Divider type="vertical" style={{ height: 56, margin: 0 }} />}
            </div>
          );
        })}
      </div>

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Input.Search
            placeholder="Search name or docket #…"
            allowClear
            style={{ width: 280 }}
            onChange={(e) => handleSearchChange(e.target.value)}
            onSearch={(v) => {
              clearTimeout(searchTimeoutRef.current);
              setFilters((f) => ({ ...f, q: v }));
            }}
          />
          <Select
            placeholder="All Statuses"
            allowClear
            style={{ width: 180 }}
            options={enums.STATUSES.map((s) => ({ label: s, value: s }))}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          {isAdmin && (
            <Select
              placeholder="All Officers"
              allowClear
              style={{ width: 260 }}
              options={officers.map((o) => ({ label: o.full_name, value: o.id }))}
              onChange={(v) => setFilters((f) => ({ ...f, assignedOfficerId: v }))}
            />
          )}
        </Space>
        <Space>
          <Button size="large" onClick={() => setImportOpen(true)}>Import Applications</Button>
          <Button size="large" onClick={() => setImportActiveSupervisionOpen(true)}>Import Active Supervision</Button>
          <Button size="large" onClick={exportExcel}>Export Excel</Button>
          <Button size="large" type="primary" onClick={openNewCase}>New Case</Button>
        </Space>
      </Space>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <div key={activeStage || 'all'} style={{ animation: 'stageContentFadeIn 320ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visibleRows}
          loading={loading}
          onRow={(record) => ({ onClick: () => openCase(record.id), style: { cursor: 'pointer' } })}
          pagination={{ pageSize: 20 }}
        />
      </div>

      <Modal
        title="New Case"
        open={newCaseOpen}
        onCancel={() => setNewCaseOpen(false)}
        onOk={createCase}
        confirmLoading={creating}
        okText="Create Case"
        width={1100}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Fields marked <Text type="danger">*</Text> are required. Everything else can be filled in now or completed later on Case Information.
        </Text>
        <Form form={newCaseForm} className="case-modal-form" layout="vertical" size="large" scrollToFirstError={{ behavior: 'smooth', block: 'center' }}>
          <CaseProfileFields
            // Remount on every open so leftover internal state (Sentencing-
            // field mirror tracking, etc.) from a previous New Case attempt
            // doesn't bleed into this one.
            key={newCaseOpen}
            form={newCaseForm}
            enums={enums}
            officers={officers}
            isAdmin={isAdmin}
            priorRecords={newCasePriorRecords}
            setPriorRecords={setNewCasePriorRecords}
            docketDisabled={false}
            assignedOfficerField="form"
            collapseExtras
            photoSlot={(
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Avatar
                  size={110}
                  shape="circle"
                  src={newCasePhoto}
                  icon={<UserOutlined />}
                  style={{ border: '1px solid #d9d9d9', background: '#f5f5f5' }}
                />
                <Space size={4}>
                  <Button size="small" icon={<CameraOutlined />} onClick={() => setNewCasePhotoModalOpen(true)}>
                    {newCasePhoto ? 'Change' : 'Add'}
                  </Button>
                  {newCasePhoto && (
                    <Popconfirm title="Remove this photo?" onConfirm={() => setNewCasePhoto(null)}>
                      <Button size="small" danger icon={<DeleteOutlined />}>Remove</Button>
                    </Popconfirm>
                  )}
                </Space>
              </div>
            )}
          />
          {newCaseError && <Alert type="error" message={newCaseError} showIcon />}
        </Form>
      </Modal>

      <Modal
        title={newCasePhoto ? 'Change Photo' : 'Add Photo'}
        open={newCasePhotoModalOpen}
        onCancel={() => setNewCasePhotoModalOpen(false)}
        footer={null}
        destroyOnClose
        width={620}
      >
        <PhotoCapture
          existingPhoto={newCasePhoto}
          onSave={async (dataUrl) => {
            setNewCasePhoto(dataUrl);
            setNewCasePhotoModalOpen(false);
          }}
        />
      </Modal>

      <Modal
        title="Edit Case"
        open={editCase !== null}
        onCancel={() => setEditCase(null)}
        onOk={saveEditCase}
        confirmLoading={saving}
        okText="Save"
        width={1100}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Form form={editForm} className="case-modal-form" layout="vertical" size="large" scrollToFirstError={{ behavior: 'smooth', block: 'center' }}>
          <CaseProfileFields
            // Remount per case being edited — same reason as CaseDetailView.
            key={editCase?.id}
            form={editForm}
            enums={enums}
            officers={officers}
            isAdmin={isAdmin}
            priorRecords={editCasePriorRecords}
            setPriorRecords={setEditCasePriorRecords}
            docketDisabled={!isAdmin}
            assignedOfficerField="external"
            reassignTo={editReassignTo}
            setReassignTo={setEditReassignTo}
          />
          {editError && <Alert type="error" message={editError} showIcon />}
        </Form>
      </Modal>

      <ImportCasesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={loadDashboard}
      />

      <ImportActiveSupervisionModal
        open={importActiveSupervisionOpen}
        onClose={() => setImportActiveSupervisionOpen(false)}
        onImported={loadDashboard}
      />
    </div>
  );
}
