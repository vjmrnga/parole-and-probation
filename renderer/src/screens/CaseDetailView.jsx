import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  Avatar, Button, Card, Col, Divider, Form, Input, message,
  Modal, Popconfirm, Row, Select, Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import { CameraOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { STAGE_COLORS, STATUS_COLORS } from '../constants/statusColors.js';
import GeneratePsirModal from '../components/GeneratePsirModal.jsx';
import GenerateFinalReportModal from '../components/GenerateFinalReportModal.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import DocumentChecklist from '../components/DocumentChecklist.jsx';
import CaseProfileFields from '../components/CaseProfileFields.jsx';
import { composeName } from '../utils/composeName.js';
import { buildPsirProfilePatch } from '../utils/buildPsirProfilePatch.js';
import { defaultPriorRecords, priorRecordsFromFields, profileFormValues } from '../utils/caseProfileDefaults.js';
import { PSIR_PHOTO_SLOT, dataUrlToBase64, fitImageToSlot } from '../utils/psirPhoto.js';
import { reportValidationError } from '../utils/formValidation.js';

const { Title, Text } = Typography;

// Wrap the alias in double quotes automatically, but leave it alone if the
// user already typed their own quotes (so "Tony" stays "Tony", not ""Tony"").
function formatAlias(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) return trimmed;
  return `"${trimmed}"`;
}

export default function CaseDetailView() {
  const { enums, user, selectedProbationerId, goDashboard } = useApp();
  const isAdmin = user?.role === 'admin';

  const [probationer, setProbationer] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [officers, setOfficers] = useState([]);
  const [history, setHistory] = useState([]);
  const [attendance, setAttendance] = useState([]);

  const [caseForm] = Form.useForm();
  const [stage, setStage] = useState();
  const [status, setStatus] = useState();
  const [reassignTo, setReassignTo] = useState();
  const [priorRecords, setPriorRecords] = useState(defaultPriorRecords());

  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [docketConfirmOpen, setDocketConfirmOpen] = useState(false);
  const [docketConfirmValue, setDocketConfirmValue] = useState('');
  const [psirModalOpen, setPsirModalOpen] = useState(false);
  const [finalReportModalOpen, setFinalReportModalOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const custodialStatus = Form.useWatch('custodialStatus', caseForm);

  useEffect(() => {
    ApiClient.get('/users').then(setOfficers).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProbationerId]);

  async function load() {
    const p = await ApiClient.get(`/probationers/${selectedProbationerId}`);
    setProbationer(p);

    if (p.photo_path) {
      try {
        const { dataUrl } = await ApiClient.get(`/probationers/${selectedProbationerId}/photo`);
        setPhoto(dataUrl);
      } catch (err) {
        setPhoto(null);
      }
    } else {
      setPhoto(null);
    }

    // Case-info and PSIR-profile fields share a single form. Their field names
    // are disjoint, so one setFieldsValue populates both; saveCaseInfo() splits
    // the values back to the two endpoints on save.
    caseForm.setFieldsValue({
      firstName: p.first_name,
      middleName: p.middle_name,
      lastName: p.last_name,
      // Age is auto-computed from the birthdate; recompute on load so an edited
      // birthdate stays authoritative over any stale stored age.
      age: p.birthdate ? dayjs().diff(dayjs(p.birthdate), 'year') : p.age,
      address: p.address,
      offenseType: p.offense_type,
      courtBranch: p.court_branch,
      judge: p.judge,
      docketNumber: p.docket_number,
      caseNumber: p.case_number,
      dateOfOrder: p.date_of_order ? dayjs(p.date_of_order) : null,
      dateOrderReceived: p.date_order_received ? dayjs(p.date_order_received) : null,
      supervisionPeriod: p.supervision_period,
      supervisionStartDate: p.supervision_start_date ? dayjs(p.supervision_start_date) : null,
      supervisionEndDate: p.supervision_end_date ? dayjs(p.supervision_end_date) : null,
      alias: p.alias,
      birthdate: p.birthdate ? dayjs(p.birthdate) : null,
      sex: p.sex,
      maritalStatus: p.marital_status,
      contactNumber: p.contact_number,
      remarks: p.remarks,
      ...profileFormValues(p),
    });
    setStage(p.stage);
    setStatus(p.status);
    setReassignTo(p.assigned_officer_id);
    setPriorRecords(priorRecordsFromFields(p.psir_profile?.fields || {}));

    await loadHistory();
    await loadAttendance();
  }

  async function loadHistory() {
    const rows = await ApiClient.get(`/probationers/${selectedProbationerId}/history`);
    setHistory(rows);
  }

  async function loadAttendance() {
    const rows = await ApiClient.get(`/probationers/${selectedProbationerId}/attendance`);
    setAttendance(rows);
  }

  async function savePhoto(dataUrl) {
    await ApiClient.post(`/probationers/${selectedProbationerId}/photo`, { dataUrl });
    // Also propagate into the PSIR profile's photo slot so Generate PSIR
    // starts pre-filled with this same picture instead of needing it
    // re-uploaded inside the generator.
    const fitted = await fitImageToSlot(dataUrl);
    const updated = await ApiClient.patch(`/probationers/${selectedProbationerId}/psir-profile`, {
      media: { [PSIR_PHOTO_SLOT.path]: dataUrlToBase64(fitted) },
    });
    // The PATCH response already carries the merged psir_profile — apply it
    // to local state too, or Generate PSIR (which reads `probationer`, not
    // `photo`) would still see the pre-upload snapshot until the case is
    // reloaded.
    setProbationer(updated);
    setPhoto(dataUrl);
    setPhotoModalOpen(false);
    message.success('Photo saved.');
  }

  async function removePhoto() {
    setRemovingPhoto(true);
    try {
      await ApiClient.delete(`/probationers/${selectedProbationerId}/photo`);
      setPhoto(null);
      message.success('Photo removed.');
    } catch (err) {
      message.error(err.message);
    } finally {
      setRemovingPhoto(false);
    }
  }

  if (!probationer) return null;

  const canEdit = isAdmin || user?.id === probationer.assigned_officer_id;
  const isDetained = probationer.psir_profile?.radios?.custodial === 'Detention';

  async function saveCaseInfo() {
    setSaving(true);
    try {
      const values = await caseForm.validateFields();
      // 1. Core case record.
      await ApiClient.patch(`/probationers/${selectedProbationerId}`, {
        // Docket number is admin-only on the server — only send it when this
        // user is an admin, otherwise the whole PATCH is rejected with 403.
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
        alias: formatAlias(values.alias),
        birthdate: values.birthdate ? values.birthdate.format('YYYY-MM-DD') : null,
        sex: values.sex || '',
        maritalStatus: values.maritalStatus?.trim() || '',
        contactNumber: values.contactNumber?.trim() || '',
        remarks: values.remarks?.trim() || '',
      });
      // Admins can reassign the case from this form; the officer change goes
      // through its dedicated endpoint (which records an audit entry).
      if (isAdmin && reassignTo && reassignTo !== probationer.assigned_officer_id) {
        await ApiClient.patch(`/probationers/${selectedProbationerId}/reassign`, { assignedOfficerId: reassignTo });
      }

      // 2. PSIR profile (consolidated into the same form).
      await ApiClient.patch(`/probationers/${selectedProbationerId}/psir-profile`, buildPsirProfilePatch(values, priorRecords));

      message.success('Saved.');
      await load();
    } catch (err) {
      if (reportValidationError(err)) return;
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // A docket number is finalized once a case leaves Application and enters
  // supervision, so that specific transition asks the user to confirm (or,
  // for admins, correct) the docket number before the stage change commits.
  function stageChangeNeedsDocketConfirm(fromStage, toStage) {
    return fromStage === 'Application' && toStage === 'Under Supervision';
  }

  function handleUpdateStageClick() {
    if (stageChangeNeedsDocketConfirm(probationer.stage, stage)) {
      setDocketConfirmValue(probationer.docket_number || '');
      setDocketConfirmOpen(true);
      return;
    }
    updateStage();
  }

  async function confirmDocketAndUpdateStage() {
    const docket = docketConfirmValue.trim();
    if (!docket) {
      message.error('Docket number cannot be empty.');
      return;
    }
    setSavingStage(true);
    try {
      if (isAdmin && docket !== probationer.docket_number) {
        await ApiClient.patch(`/probationers/${selectedProbationerId}`, { docketNumber: docket });
      }
      const ok = await updateStage();
      if (ok) setDocketConfirmOpen(false);
    } catch (err) {
      message.error(err.message);
    } finally {
      setSavingStage(false);
    }
  }

  // Returns whether the update succeeded, so confirmDocketAndUpdateStage
  // above can decide whether the modal should stay open (e.g. to let the
  // user retry after a validation error) or close.
  async function updateStage() {
    setSavingStage(true);
    try {
      await ApiClient.patch(`/probationers/${selectedProbationerId}/stage`, { stage });
      message.success('Stage updated.');
      await load();
      return true;
    } catch (err) {
      message.error(err.message);
      return false;
    } finally {
      setSavingStage(false);
    }
  }

  async function updateStatus() {
    setSavingStatus(true);
    try {
      await ApiClient.patch(`/probationers/${selectedProbationerId}/status`, { status });
      message.success('Status updated.');
      await load();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSavingStatus(false);
    }
  }

  return (
    <div>
      <Button type="link" style={{ paddingLeft: 0 }} onClick={goDashboard}>&larr; Back to list</Button>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
        <Title level={3} style={{ margin: 0 }}>{composeName(probationer)} — {probationer.docket_number}</Title>
        <Space>
          <Tooltip title={probationer.stage === 'Application' ? '' : 'PSIR can only be generated while the case is in the Application stage.'}>
            <Button
              type="primary"
              disabled={probationer.stage !== 'Application'}
              onClick={() => setPsirModalOpen(true)}
            >
              Generate PSIR
            </Button>
          </Tooltip>
          <Tooltip title={probationer.stage === 'Termination' ? '' : 'Final Report can only be generated while the case is in the Termination stage.'}>
            <Button
              type="primary"
              disabled={probationer.stage !== 'Termination'}
              onClick={() => setFinalReportModalOpen(true)}
            >
              Generate Final Report
            </Button>
          </Tooltip>
        </Space>
      </Space>

      <Tabs
        defaultActiveKey="case"
        items={[
          {
            key: 'case',
            label: 'Case Information',
            children: (
      <Card className="case-info-form">
        <style>{`
          .case-info-form .ant-form-item-label > label { font-weight: 600; }
          .case-info-form .section-title .ant-divider-inner-text { font-weight: 700; font-size: 18px; }
        `}</style>
        <Form form={caseForm} layout="vertical" size="large" disabled={!canEdit} scrollToFirstError={{ behavior: 'smooth', block: 'center' }}>
          <CaseProfileFields
            // Force a clean remount per case — otherwise this component's own
            // internal state (Same as Present Address, the Sentencing-field
            // mirror tracking) would carry over from whichever case was open
            // before it, instead of starting fresh for this one.
            key={selectedProbationerId}
            form={caseForm}
            enums={enums}
            officers={officers}
            isAdmin={isAdmin}
            canEdit={canEdit}
            priorRecords={priorRecords}
            setPriorRecords={setPriorRecords}
            docketDisabled={!isAdmin}
            assignedOfficerField="external"
            reassignTo={reassignTo}
            setReassignTo={setReassignTo}
            photoSlot={(
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Avatar
                  size={110}
                  shape="circle"
                  src={photo}
                  icon={<UserOutlined />}
                  style={{ border: '1px solid #d9d9d9', background: '#f5f5f5' }}
                />
                {canEdit && (
                  <Space size={4}>
                    <Button size="small" icon={<CameraOutlined />} onClick={() => setPhotoModalOpen(true)}>
                      {photo ? 'Change' : 'Add'}
                    </Button>
                    {photo && (
                      <Popconfirm title="Remove this photo?" onConfirm={removePhoto} okButtonProps={{ loading: removingPhoto }}>
                        <Button size="small" danger icon={<DeleteOutlined />} loading={removingPhoto}>Remove</Button>
                      </Popconfirm>
                    )}
                  </Space>
                )}
              </div>
            )}
          />
        </Form>
        {canEdit && (
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" onClick={saveCaseInfo} loading={saving}>Save Changes</Button>
          </div>
        )}
      </Card>
            ),
          },
          {
            key: 'stage',
            label: 'Stage & Status',
            children: (
      <Card>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.45)',
            marginBottom: 8,
          }}
        >
          Current Stage and Status
        </div>
        <Space size="middle" style={{ marginBottom: 24 }}>
          <Tag color={STAGE_COLORS[probationer.stage] || 'default'} style={{ fontSize: 13, padding: '3px 12px' }}>
            {probationer.stage}
          </Tag>
          <Tag color={STATUS_COLORS[probationer.status] || 'default'} style={{ fontSize: 13, padding: '3px 12px' }}>
            {probationer.status}
          </Tag>
        </Space>

        <Row gutter={[24, 20]}>
          <Col xs={24} sm={12} lg={8}>
            <div style={{ marginBottom: 6, color: 'rgba(0,0,0,0.65)', fontWeight: 600 }}>Stage</div>
            <Space.Compact style={{ width: '100%' }}>
              <Select
                style={{ width: '100%' }}
                value={stage}
                onChange={setStage}
                disabled={!canEdit}
                options={enums.STAGES.map((s) => ({ label: s, value: s }))}
              />
              {canEdit && (
                <Button type="primary" onClick={handleUpdateStageClick} loading={savingStage} disabled={stage === probationer.stage}>
                  Update
                </Button>
              )}
            </Space.Compact>
          </Col>
          <Col xs={24} sm={12} lg={8}>
            <div style={{ marginBottom: 6, color: 'rgba(0,0,0,0.65)', fontWeight: 600 }}>Status</div>
            <Space.Compact style={{ width: '100%' }}>
              <Select
                style={{ width: '100%' }}
                value={status}
                onChange={setStatus}
                disabled={!canEdit}
                options={enums.STATUSES.map((s) => ({ label: s, value: s }))}
              />
              {canEdit && (
                <Button type="primary" onClick={updateStatus} loading={savingStatus} disabled={status === probationer.status}>
                  Update
                </Button>
              )}
            </Space.Compact>
          </Col>
        </Row>

        <Divider />
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.45)',
            marginBottom: 8,
          }}
        >
          Submitted Documents Checklist
        </div>
        {isDetained && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            Custodial status is Detention — only the documents still obtainable while detained are listed below.
          </Text>
        )}
        <DocumentChecklist probationerId={selectedProbationerId} isDetained={isDetained} canEdit={canEdit} />
      </Card>
            ),
          },
          {
            key: 'attendance',
            label: 'Attendance',
            children: (
      <Card>
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          dataSource={attendance}
          columns={[
            { title: 'Date', dataIndex: 'log_date', key: 'log_date' },
            {
              title: 'Status',
              key: 'status',
              render: () => <Tag color="green">Present</Tag>,
            },
            { title: 'GAD Topic', dataIndex: 'gad_topic', key: 'gad_topic', render: (v) => v || '—' },
            { title: 'Notes', dataIndex: 'notes', key: 'notes' },
          ]}
        />
      </Card>
            ),
          },
          {
            key: 'history',
            label: 'History',
            children: (
      <Card>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={history}
          columns={[
            { title: 'When', dataIndex: 'changed_at', key: 'changed_at' },
            { title: 'Field', dataIndex: 'field_changed', key: 'field_changed' },
            { title: 'From', dataIndex: 'old_value', key: 'old_value' },
            { title: 'To', dataIndex: 'new_value', key: 'new_value' },
            { title: 'Changed By', dataIndex: 'changed_by_name', key: 'changed_by_name' },
          ]}
        />
      </Card>
            ),
          },
        ]}
      />

      <GeneratePsirModal
        open={psirModalOpen}
        probationer={probationer}
        onClose={() => setPsirModalOpen(false)}
        onGenerated={load}
      />
      <GenerateFinalReportModal
        open={finalReportModalOpen}
        probationer={probationer}
        onClose={() => setFinalReportModalOpen(false)}
        onGenerated={load}
      />
      <Modal
        title={photo ? 'Change Photo' : 'Add Photo'}
        open={photoModalOpen}
        onCancel={() => setPhotoModalOpen(false)}
        footer={null}
        destroyOnClose
        width={620}
      >
        <PhotoCapture existingPhoto={photo} onSave={savePhoto} disabled={!canEdit} />
      </Modal>
      <Modal
        title="Confirm Docket Number"
        open={docketConfirmOpen}
        onCancel={() => setDocketConfirmOpen(false)}
        onOk={confirmDocketAndUpdateStage}
        okText="Confirm & Update Stage"
        confirmLoading={savingStage}
      >
        <Text>
          This case is moving from <b>Application</b> to <b>Under Supervision</b>.
          Please confirm the docket number before continuing.
        </Text>
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Docket Number</div>
          <Input
            value={docketConfirmValue}
            onChange={(e) => setDocketConfirmValue(e.target.value)}
            placeholder="e.g., PS-2026-01-00001"
            disabled={!isAdmin}
          />
          {!isAdmin && (
            <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
              Only admins can change the docket number. Confirm to proceed with the current number.
            </Text>
          )}
        </div>
      </Modal>
    </div>
  );
}
