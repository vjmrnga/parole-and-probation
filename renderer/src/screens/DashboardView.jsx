import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Col, DatePicker, Divider, Form, Input, InputNumber, message, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import ImportCasesModal from '../components/ImportCasesModal.jsx';
import ImportActiveSupervisionModal from '../components/ImportActiveSupervisionModal.jsx';
import { STAGE_COLORS, STATUS_COLORS } from '../constants/statusColors.js';
import { CIVIL_STATUS_OPTIONS } from '../constants/psirOptions.js';
import { composeName } from '../utils/composeName.js';

const { Title } = Typography;

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
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const searchTimeoutRef = useRef(null);

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
    setNewCaseError('');
    setNewCaseOpen(true);
  }

  async function createCase() {
    setNewCaseError('');
    const values = await newCaseForm.validateFields();
    setCreating(true);
    try {
      await ApiClient.post('/probationers', {
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || '',
        lastName: values.lastName.trim(),
        age: values.age ?? null,
        docketNumber: values.docketNumber.trim(),
        address: values.address?.trim() || '',
        offense: values.offense?.trim() || '',
        offenseType: values.offenseType || null,
        courtBranch: values.courtBranch?.trim() || '',
        judge: values.judge?.trim() || '',
        convictionDate: values.convictionDate ? values.convictionDate.format('YYYY-MM-DD') : null,
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
      setNewCaseOpen(false);
      message.success(`Case for ${composeName({ first_name: values.firstName, middle_name: values.middleName, last_name: values.lastName })} created.`);
      await loadDashboard();
    } catch (err) {
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
      offense: record.offense,
      offenseType: record.offense_type,
      courtBranch: record.court_branch,
      judge: record.judge,
      convictionDate: record.conviction_date ? dayjs(record.conviction_date) : null,
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
    });
    setEditCase(record);
  }

  async function saveEditCase() {
    setEditError('');
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      await ApiClient.patch(`/probationers/${editCase.id}`, {
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || '',
        lastName: values.lastName.trim(),
        age: values.age ?? null,
        address: values.address?.trim() || '',
        offense: values.offense?.trim() || '',
        offenseType: values.offenseType || null,
        courtBranch: values.courtBranch?.trim() || '',
        judge: values.judge?.trim() || '',
        convictionDate: values.convictionDate ? values.convictionDate.format('YYYY-MM-DD') : null,
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
      setEditCase(null);
      message.success('Case updated.');
      await loadDashboard();
    } catch (err) {
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
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditCase(record)}>Edit</Button>
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
        width={760}
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Form form={newCaseForm} className="case-modal-form" layout="vertical" size="large">
          <Divider orientation="center" className="section-title">Identifying Data</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Last Name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="First Name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Middle Name" name="middleName"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Alias" name="alias"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Birthdate" name="birthdate">
                <DatePicker
                  style={{ width: '100%' }}
                  onChange={(d) => newCaseForm.setFieldValue('age', d ? dayjs().diff(d, 'year') : null)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Age" name="age" tooltip="Auto-computed from birthdate">
                <InputNumber style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Sex" name="sex">
                <Select options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Marital Status" name="maritalStatus">
                <Select allowClear options={CIVIL_STATUS_OPTIONS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}><Form.Item label="Contact Number" name="contactNumber"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Address" name="address"><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="center" className="section-title">Court &amp; Case Data</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Docket #" name="docketNumber" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Case Number" name="caseNumber"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Offense" name="offense"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Offense Classification" name="offenseType">
                <Select allowClear options={(enums.OFFENSE_TYPES || []).map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}><Form.Item label="Court Branch" name="courtBranch"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Judge" name="judge"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Conviction Date" name="convictionDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Date of Order" name="dateOfOrder" tooltip="Date the court issued the order"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Date of Order Received in Office" name="dateOrderReceived" tooltip="Date the order was received in this office"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            {isAdmin && (
              <Col xs={24} sm={12}>
                <Form.Item label="Assigned Officer" name="assignedOfficerId">
                  <Select options={officers.map((o) => ({ label: o.full_name, value: o.id }))} allowClear />
                </Form.Item>
              </Col>
            )}
          </Row>

          <Divider orientation="center" className="section-title">Supervision</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Supervision Period" name="supervisionPeriod"><Input placeholder="e.g. 1-0-0 (yrs-mos-days)" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Supervision Start Date" name="supervisionStartDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Supervision End Date" name="supervisionEndDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24}><Form.Item label="Remarks" name="remarks"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
          {newCaseError && <Alert type="error" message={newCaseError} showIcon />}
        </Form>
      </Modal>

      <Modal
        title="Edit Case"
        open={editCase !== null}
        onCancel={() => setEditCase(null)}
        onOk={saveEditCase}
        confirmLoading={saving}
        okText="Save"
        width={760}
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        <Form form={editForm} className="case-modal-form" layout="vertical" size="large">
          <Divider orientation="center" className="section-title">Identifying Data</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Last Name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="First Name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Middle Name" name="middleName"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Alias" name="alias"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Birthdate" name="birthdate">
                <DatePicker
                  style={{ width: '100%' }}
                  onChange={(d) => editForm.setFieldValue('age', d ? dayjs().diff(d, 'year') : null)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Age" name="age" tooltip="Auto-computed from birthdate">
                <InputNumber style={{ width: '100%' }} disabled />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Sex" name="sex">
                <Select options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Marital Status" name="maritalStatus">
                <Select allowClear options={CIVIL_STATUS_OPTIONS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}><Form.Item label="Contact Number" name="contactNumber"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Address" name="address"><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="center" className="section-title">Court &amp; Case Data</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Docket #" name="docketNumber"><Input disabled /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Case Number" name="caseNumber"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Offense" name="offense"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Offense Classification" name="offenseType">
                <Select allowClear options={(enums.OFFENSE_TYPES || []).map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}><Form.Item label="Court Branch" name="courtBranch"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Judge" name="judge"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Conviction Date" name="convictionDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Date of Order" name="dateOfOrder" tooltip="Date the court issued the order"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Date of Order Received in Office" name="dateOrderReceived" tooltip="Date the order was received in this office"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>

          <Divider orientation="center" className="section-title">Supervision</Divider>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}><Form.Item label="Supervision Period" name="supervisionPeriod"><Input placeholder="e.g. 1-0-0 (yrs-mos-days)" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Supervision Start Date" name="supervisionStartDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item label="Supervision End Date" name="supervisionEndDate"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24}><Form.Item label="Remarks" name="remarks"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
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
