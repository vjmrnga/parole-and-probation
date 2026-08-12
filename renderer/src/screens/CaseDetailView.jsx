import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  AutoComplete, Avatar, Button, Card, Col, DatePicker, Divider, Form, Input, InputNumber, message,
  Modal, Popconfirm, Radio, Row, Select, Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import { CameraOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { STAGE_COLORS, STATUS_COLORS } from '../constants/statusColors.js';
import GeneratePsirModal from '../components/GeneratePsirModal.jsx';
import GenerateFinalReportModal from '../components/GenerateFinalReportModal.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import DocumentChecklist from '../components/DocumentChecklist.jsx';
import { composeName } from '../utils/composeName.js';
import {
  CIVIL_STATUS_OPTIONS, GENDER_PREF_OPTIONS, LAW_TYPES, NATIONALITY_OPTIONS, PRIOR_RECORD_AGENCIES,
  RELIGION_OPTIONS, SOCIO_ECONOMIC_GROUPS,
} from '../constants/psirOptions.js';

const { Title, Text } = Typography;

function toAutoCompleteOptions(values) {
  return values.map((v) => ({ value: v }));
}

// Wrap the alias in double quotes automatically, but leave it alone if the
// user already typed their own quotes (so "Tony" stays "Tony", not ""Tony"").
function formatAlias(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) return trimmed;
  return `"${trimmed}"`;
}

function defaultPriorRecords() {
  return PRIOR_RECORD_AGENCIES.map(([agency, placeholder]) => ({ agency, placeholder, caseNo: '', offense: '', dateCharged: '', status: '' }));
}

function priorRecordsFromFields(fields) {
  return PRIOR_RECORD_AGENCIES.map(([agency, placeholder], i) => ({
    agency,
    placeholder,
    caseNo: fields[`pr_case_${i}`] || '',
    offense: fields[`pr_off_${i}`] || '',
    dateCharged: fields[`pr_date_${i}`] || '',
    status: fields[`pr_status_${i}`] || '',
  }));
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

    const profile = p.psir_profile || {};
    const f = profile.fields || {};
    const radios = profile.radios || {};
    const charged = (profile.offenses && profile.offenses.charged) || [];
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
      offense: p.offense,
      offenseType: p.offense_type,
      courtBranch: p.court_branch,
      judge: p.judge,
      convictionDate: p.conviction_date ? dayjs(p.conviction_date) : null,
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
      trueName: f.trueName || '',
      education: f.education || '',
      religion: f.religion === '__other' ? (f.religionOther || '') : (f.religion || ''),
      nationality: f.nationality === '__other' ? (f.nationalityOther || '') : (f.nationality || ''),
      genderPref: f.genderPref === '__other' ? (f.genderPrefOther || '') : (f.genderPref || ''),
      motherName: f.motherName || '',
      fatherName: f.fatherName || '',
      spouse: f.spouse || '',
      features: f.features || '',
      placeOfBirth: f.placeOfBirth || '',
      permanentAddress: f.permanentAddress || '',
      custodialStatus: radios.custodial || 'Bail',
      detFacility: f.detFacility || '',
      rorCustodian: f.rorCustodian || '',
      custodialAddress: f.custodialAddress || '',
      chargedOffenses: charged.length ? charged : [{ sec: '', art: '', law: 'R.A.', no: '', date: '' }],
      sentences: Array.isArray(profile.sentences) && profile.sentences.length
        ? profile.sentences
        : [{ y: '', m: '', d: '', y2: '', m2: '', d2: '', fine: '' }],
      ...Object.fromEntries(SOCIO_ECONOMIC_GROUPS.map((g) => [`rate_${g.id}`, radios[`rate_${g.id}`] || g.options[g.options.length > 3 ? 1 : 0]])),
    });
    setStage(p.stage);
    setStatus(p.status);
    setReassignTo(p.assigned_officer_id);
    setPriorRecords(priorRecordsFromFields(f));

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
    const values = await caseForm.validateFields();
    setSaving(true);
    try {
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
      const fields = {
        trueName: (values.trueName || '').trim(),
        education: (values.education || '').trim(),
        religion: (values.religion || '').trim(),
        nationality: (values.nationality || '').trim(),
        genderPref: (values.genderPref || '').trim(),
        motherName: (values.motherName || '').trim(),
        fatherName: (values.fatherName || '').trim(),
        spouse: (values.spouse || '').trim(),
        features: (values.features || '').trim(),
        placeOfBirth: (values.placeOfBirth || '').trim(),
        permanentAddress: (values.permanentAddress || '').trim(),
        detFacility: (values.detFacility || '').trim(),
        rorCustodian: (values.rorCustodian || '').trim(),
        custodialAddress: (values.custodialAddress || '').trim(),
      };
      priorRecords.forEach((r, i) => {
        fields[`pr_case_${i}`] = r.caseNo || '';
        fields[`pr_off_${i}`] = r.offense || '';
        fields[`pr_date_${i}`] = r.dateCharged || '';
        fields[`pr_status_${i}`] = r.status || '';
      });
      const radios = { custodial: values.custodialStatus || 'Bail' };
      SOCIO_ECONOMIC_GROUPS.forEach((g) => { radios[`rate_${g.id}`] = values[`rate_${g.id}`]; });
      const offenses = { charged: (values.chargedOffenses || []).filter((o) => o && (o.sec || o.no)) };
      const sentences = (values.sentences || []).filter((s) => s && (s.y || s.m || s.d || s.fine));
      await ApiClient.patch(`/probationers/${selectedProbationerId}/psir-profile`, { fields, radios, offenses, sentences });

      message.success('Saved.');
      await load();
    } catch (err) {
      if (err?.errorFields) return; // antd validation error — already shown inline
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStage() {
    setSavingStage(true);
    try {
      await ApiClient.patch(`/probationers/${selectedProbationerId}/stage`, { stage });
      message.success('Stage updated.');
      await load();
    } catch (err) {
      message.error(err.message);
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
        <Form form={caseForm} layout="vertical" size="large" disabled={!canEdit}>
          <Divider orientation="center" className="section-title">Identifying Data</Divider>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
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
            <div style={{ flex: 1, minWidth: 0 }}>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12} md={8}>
              {/* required={false} only hides the red "*" mark — the rules
                  validation stays, since saveCaseInfo() below assumes non-blank
                  first/last names (values.*.trim()) and the DB columns are
                  NOT NULL. */}
              <Form.Item label="Last Name" name="lastName" required={false} rules={[{ required: true }]}><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="First Name" name="firstName" required={false} rules={[{ required: true }]}><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Middle Name" name="middleName"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Alias" name="alias"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="True Name" name="trueName" tooltip="Only if different from the name above"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Birthdate" name="birthdate">
                <DatePicker
                  style={{ width: '100%' }}
                  onChange={(d) => caseForm.setFieldValue('age', d ? dayjs().diff(d, 'year') : null)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Age" name="age" tooltip="Auto-computed from birthdate">
                <InputNumber
                  style={{ width: '100%' }}
                  disabled
                  formatter={(value) => (value === '' || value === null || value === undefined ? '' : `${value} years old`)}
                  parser={(value) => (value ? value.replace(/\D/g, '') : '')}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Place of Birth" name="placeOfBirth"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Sex" name="sex">
                <Select options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Gender Preference" name="genderPref">
                <AutoComplete options={toAutoCompleteOptions(GENDER_PREF_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Marital Status" name="maritalStatus">
                <Select
                  allowClear
                  options={CIVIL_STATUS_OPTIONS.map((v) => ({ label: v, value: v }))}
                  onChange={(v) => {
                    // Mirrors the PSIR generator: Single ⇒ spouse "Not Applicable";
                    // moving off Single clears an auto-filled "Not Applicable".
                    if (v === 'Single') caseForm.setFieldValue('spouse', 'Not Applicable');
                    else if (caseForm.getFieldValue('spouse') === 'Not Applicable') caseForm.setFieldValue('spouse', '');
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Contact Number" name="contactNumber"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Educational Attainment" name="education"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Religion" name="religion">
                <AutoComplete options={toAutoCompleteOptions(RELIGION_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Nationality" name="nationality">
                <AutoComplete options={toAutoCompleteOptions(NATIONALITY_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Mother (Maiden Name)" name="motherName"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Father" name="fatherName"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Spouse" name="spouse"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Identifying / Remarkable Features" name="features"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Address" name="address"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Permanent Address" name="permanentAddress" tooltip="Only if different from the Address on file above"><Input /></Form.Item>
            </Col>
          </Row>
            </div>
          </div>

          <Divider orientation="center" className="section-title">Court &amp; Case Data</Divider>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12} md={8}>
              {/* required={false} hides the red "*" but keeps the rule — the
                  column is NOT NULL UNIQUE. Disabled for non-admins even when
                  the rest of the form is editable, since docket edits are
                  admin-only on the server. */}
              <Form.Item
                label="Docket #"
                name="docketNumber"
                required={false}
                rules={[{ required: true, message: 'Docket number is required' }]}
                tooltip={isAdmin ? undefined : 'Only admins can change the docket number.'}
              >
                <Input disabled={!isAdmin} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Case Number" name="caseNumber"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Court Branch" name="courtBranch"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Judge" name="judge"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Conviction Date" name="convictionDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Date of Order" name="dateOfOrder" tooltip="Date the court issued the order"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Date of Order Received in Office" name="dateOrderReceived" tooltip="Date the order was received in this office"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            {isAdmin && (
              <Col xs={24} sm={12} md={8}>
                <Form.Item label="Assigned Officer" tooltip="Reassigns this case to another officer. Saved with the rest of the case information.">
                  <Select
                    style={{ width: '100%' }}
                    value={reassignTo}
                    onChange={setReassignTo}
                    options={officers.map((o) => ({ label: o.full_name, value: o.id }))}
                  />
                </Form.Item>
              </Col>
            )}
          </Row>

          <Divider orientation="center" className="section-title">Criminal History</Divider>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Offense" name="offense"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Offense Classification" name="offenseType">
                <Select
                  allowClear
                  options={(enums.OFFENSE_TYPES || []).map((v) => ({ label: v, value: v }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Text strong style={{ display: 'block', margin: '8px 0 8px' }}>
            Original Charge <Text type="secondary" style={{ fontWeight: 400 }}>(if different from the Convicted Offense above)</Text>
          </Text>
          <Form.List name="chargedOffenses">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} align="middle" style={{ marginBottom: 8 }}>
                    <Col xs={12} sm={4}><Form.Item {...field} name={[field.name, 'sec']} noStyle><Input placeholder="Sec." /></Form.Item></Col>
                    <Col xs={12} sm={3}><Form.Item {...field} name={[field.name, 'art']} noStyle><Input placeholder="Art. (optional)" /></Form.Item></Col>
                    <Col xs={12} sm={4}>
                      <Form.Item {...field} name={[field.name, 'law']} noStyle>
                        <Select options={LAW_TYPES.map((l) => ({ label: l, value: l }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={5}><Form.Item {...field} name={[field.name, 'no']} noStyle><Input placeholder="Number, e.g. 9165" /></Form.Item></Col>
                    <Col xs={18} sm={6}><Form.Item {...field} name={[field.name, 'date']} noStyle><Input placeholder="Date charged (YYYY-MM-DD)" /></Form.Item></Col>
                    <Col xs={6} sm={2}>
                      {fields.length > 1 && <Button danger size="small" onClick={() => remove(field.name)}>Remove</Button>}
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" size="small" onClick={() => add({ sec: '', art: '', law: 'R.A.', no: '', date: '' })}>+ Add charge</Button>
              </>
            )}
          </Form.List>

          <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>Sentence Details</Text>
          <Form.List name="sentences">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} align="middle" style={{ marginBottom: 8 }}>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'y']} noStyle><InputNumber min={0} placeholder="Min Yrs" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'm']} noStyle><InputNumber min={0} placeholder="Min Mos" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'd']} noStyle><InputNumber min={0} placeholder="Min Days" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'y2']} noStyle><InputNumber min={0} placeholder="Max Yrs" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'm2']} noStyle><InputNumber min={0} placeholder="Max Mos" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'd2']} noStyle><InputNumber min={0} placeholder="Max Days" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={20} sm={4}><Form.Item {...field} name={[field.name, 'fine']} noStyle><InputNumber min={0} placeholder="Fine (₱)" style={{ width: '100%' }} /></Form.Item></Col>
                    <Col xs={4} sm={2}>
                      {fields.length > 1 && <Button danger size="small" onClick={() => remove(field.name)}>Remove</Button>}
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" size="small" onClick={() => add({ y: '', m: '', d: '', y2: '', m2: '', d2: '', fine: '' })}>+ Add sentence</Button>
              </>
            )}
          </Form.List>

          <Row gutter={[24, 8]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Custodial Status" name="custodialStatus">
                <Radio.Group optionType="button" options={['Bail', 'Detention', 'ROR'].map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            {custodialStatus === 'Detention' && (
              <Col xs={24} sm={12} md={8}>
                <Form.Item label="Detention Facility" name="detFacility" tooltip="Optional — prints as “Detention – ___”">
                  <Input />
                </Form.Item>
              </Col>
            )}
            {custodialStatus === 'ROR' && (
              <Col xs={24} sm={12} md={8}>
                <Form.Item label="ROR Custodian" name="rorCustodian"><Input /></Form.Item>
              </Col>
            )}
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Custodial Address" name="custodialAddress" tooltip="Bail / detention / custodian address">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Text strong style={{ display: 'block', margin: '8px 0 8px' }}>Prior and Pending Records</Text>
          <Table
            rowKey="agency"
            size="small"
            pagination={false}
            dataSource={priorRecords}
            columns={[
              { title: 'Agency', dataIndex: 'agency', key: 'agency', width: 110 },
              {
                title: 'Criminal Case No.',
                key: 'caseNo',
                render: (_, row, i) => (
                  <Input
                    disabled={!canEdit}
                    value={row.caseNo}
                    onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, caseNo: e.target.value } : r)))}
                  />
                ),
              },
              {
                title: 'Offense',
                key: 'offense',
                render: (_, row, i) => (
                  <Input
                    disabled={!canEdit}
                    value={row.offense}
                    onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, offense: e.target.value } : r)))}
                  />
                ),
              },
              {
                title: 'Date Charged',
                key: 'dateCharged',
                render: (_, row, i) => (
                  <Input
                    disabled={!canEdit}
                    value={row.dateCharged}
                    onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, dateCharged: e.target.value } : r)))}
                  />
                ),
              },
              {
                title: 'Decision / Status',
                key: 'status',
                render: (_, row, i) => (
                  <Input
                    disabled={!canEdit}
                    placeholder={row.placeholder}
                    value={row.status}
                    onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, status: e.target.value } : r)))}
                  />
                ),
              },
            ]}
          />

          <Divider orientation="center" className="section-title" style={{ marginTop: 24 }}>Supervision</Divider>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Supervision Period" name="supervisionPeriod"><Input placeholder="e.g. 1-0-0" /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Supervision Start Date" name="supervisionStartDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="Supervision End Date" name="supervisionEndDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Remarks" name="remarks"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>

          <Divider orientation="center" className="section-title" style={{ marginTop: 24 }}>Socio-Economic Background</Divider>
          <Row gutter={[24, 16]}>
            {SOCIO_ECONOMIC_GROUPS.map((g) => (
              <Col xs={24} md={12} key={g.id}>
                <Form.Item label={g.title} name={`rate_${g.id}`}>
                  <Radio.Group
                    options={g.options.map((o) => ({ label: o, value: o }))}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 4 }}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
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
                <Button type="primary" onClick={updateStage} loading={savingStage} disabled={stage === probationer.stage}>
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
    </div>
  );
}
