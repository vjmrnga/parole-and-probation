import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  AutoComplete, Avatar, Button, Card, Col, DatePicker, Divider, Form, Input, InputNumber, message,
  Radio, Row, Select, Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { STAGE_COLORS, STATUS_COLORS } from '../constants/statusColors.js';
import GeneratePsirModal from '../components/GeneratePsirModal.jsx';
import GenerateFinalReportModal from '../components/GenerateFinalReportModal.jsx';
import DocumentChecklist from '../components/DocumentChecklist.jsx';
import {
  GENDER_PREF_OPTIONS, LAW_TYPES, NATIONALITY_OPTIONS, PRIOR_RECORD_AGENCIES,
  RELIGION_OPTIONS, SOCIO_ECONOMIC_GROUPS,
} from '../constants/psirOptions.js';

const { Title, Text } = Typography;

function toAutoCompleteOptions(values) {
  return values.map((v) => ({ value: v }));
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
  const [psirForm] = Form.useForm();
  const [stage, setStage] = useState();
  const [status, setStatus] = useState();
  const [reassignTo, setReassignTo] = useState();
  const [priorRecords, setPriorRecords] = useState(defaultPriorRecords());

  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingReassign, setSavingReassign] = useState(false);
  const [savingPsirProfile, setSavingPsirProfile] = useState(false);
  const [psirModalOpen, setPsirModalOpen] = useState(false);
  const [finalReportModalOpen, setFinalReportModalOpen] = useState(false);
  const custodialStatus = Form.useWatch('custodialStatus', psirForm);

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

    caseForm.setFieldsValue({
      fullName: p.full_name,
      age: p.age,
      address: p.address,
      offense: p.offense,
      offenseType: p.offense_type,
      courtBranch: p.court_branch,
      judge: p.judge,
      convictionDate: p.conviction_date ? dayjs(p.conviction_date) : null,
      caseNumber: p.case_number,
      dateOfOrder: p.date_of_order ? dayjs(p.date_of_order) : null,
      supervisionPeriod: p.supervision_period,
      supervisionStartDate: p.supervision_start_date ? dayjs(p.supervision_start_date) : null,
      supervisionEndDate: p.supervision_end_date ? dayjs(p.supervision_end_date) : null,
      alias: p.alias,
      birthdate: p.birthdate ? dayjs(p.birthdate) : null,
      sex: p.sex,
      maritalStatus: p.marital_status,
      contactNumber: p.contact_number,
      remarks: p.remarks,
    });
    setStage(p.stage);
    setStatus(p.status);
    setReassignTo(p.assigned_officer_id);

    const profile = p.psir_profile || {};
    const f = profile.fields || {};
    const radios = profile.radios || {};
    const charged = (profile.offenses && profile.offenses.charged) || [];
    psirForm.setFieldsValue({
      trueName: f.trueName || '',
      education: f.education || '',
      religion: f.religion === '__other' ? (f.religionOther || '') : (f.religion || ''),
      nationality: f.nationality === '__other' ? (f.nationalityOther || '') : (f.nationality || ''),
      genderPref: f.genderPref === '__other' ? (f.genderPrefOther || '') : (f.genderPref || ''),
      motherName: f.motherName || '',
      fatherName: f.fatherName || '',
      spouse: f.spouse || '',
      features: f.features || '',
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

  if (!probationer) return null;

  const canEdit = isAdmin || user?.id === probationer.assigned_officer_id;
  const isDetained = probationer.psir_profile?.radios?.custodial === 'Detention';

  async function saveCaseInfo() {
    const values = await caseForm.validateFields();
    setSaving(true);
    try {
      await ApiClient.patch(`/probationers/${selectedProbationerId}`, {
        fullName: values.fullName.trim(),
        age: values.age ?? null,
        address: values.address?.trim() || '',
        offense: values.offense?.trim() || '',
        offenseType: values.offenseType || null,
        courtBranch: values.courtBranch?.trim() || '',
        judge: values.judge?.trim() || '',
        convictionDate: values.convictionDate ? values.convictionDate.format('YYYY-MM-DD') : null,
        caseNumber: values.caseNumber?.trim() || '',
        dateOfOrder: values.dateOfOrder ? values.dateOfOrder.format('YYYY-MM-DD') : null,
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
      message.success('Saved.');
      await load();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePsirProfile() {
    const values = await psirForm.validateFields();
    setSavingPsirProfile(true);
    try {
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
      message.success('PSIR profile saved.');
      await load();
    } catch (err) {
      if (err?.errorFields) return; // antd validation error — already shown inline
      message.error(err.message);
    } finally {
      setSavingPsirProfile(false);
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

  async function reassign() {
    setSavingReassign(true);
    try {
      await ApiClient.patch(`/probationers/${selectedProbationerId}/reassign`, { assignedOfficerId: reassignTo });
      message.success('Reassigned.');
      await load();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSavingReassign(false);
    }
  }

  return (
    <div>
      <Button type="link" style={{ paddingLeft: 0 }} onClick={goDashboard}>&larr; Back to list</Button>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
        <Title level={3} style={{ margin: 0 }}>{probationer.full_name} — {probationer.docket_number}</Title>
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
        `}</style>
        <Form form={caseForm} layout="vertical" disabled={!canEdit}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <Avatar
              size={110}
              shape="circle"
              src={photo}
              icon={<UserOutlined />}
              style={{ flexShrink: 0, border: '1px solid #d9d9d9', background: '#f5f5f5' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12}>
              {/* required={false} only hides the red "*" mark — the rules
                  validation stays, since saveCaseInfo() below assumes a
                  non-blank fullName (values.fullName.trim()) and the DB
                  column is NOT NULL. */}
              <Form.Item label="Full Name" name="fullName" required={false} rules={[{ required: true }]}><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Alias" name="alias"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Age" name="age"><InputNumber style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Birthdate" name="birthdate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Sex" name="sex">
                <Select options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Marital Status" name="maritalStatus"><Input /></Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item label="Contact Number" name="contactNumber"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Docket #"><Input value={probationer.docket_number} disabled /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Case Number" name="caseNumber"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Conviction Date" name="convictionDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item label="Address" name="address"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Offense" name="offense"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Offense Classification" name="offenseType">
                <Select
                  allowClear
                  options={(enums.OFFENSE_TYPES || []).map((v) => ({ label: v, value: v }))}
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item label="Court Branch" name="courtBranch"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Judge" name="judge"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Date of Order" name="dateOfOrder"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item label="Supervision Period" name="supervisionPeriod"><Input placeholder="e.g. 1-0-0" /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Supervision Start Date" name="supervisionStartDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Supervision End Date" name="supervisionEndDate"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Remarks" name="remarks"><Input.TextArea rows={1} /></Form.Item>
            </Col>
          </Row>
            </div>
          </div>
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
            key: 'psir',
            label: 'PSIR Profile',
            children: (
      <Card className="psir-form">
        <style>{`
          .psir-form .ant-form-item-label > label { font-weight: 600; }
          .psir-form .psir-section-title .ant-divider-inner-text { font-weight: 700; font-size: 18px; }
        `}</style>
        <Form form={psirForm} layout="vertical" disabled={!canEdit}>
          <Divider orientation="center" className="psir-section-title">Identifying Data</Divider>
          <Row gutter={[24, 8]}>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="True Name" name="trueName" tooltip="Only if different from Full Name above">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Educational Attainment" name="education"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Religion" name="religion">
                <AutoComplete options={toAutoCompleteOptions(RELIGION_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Nationality" name="nationality">
                <AutoComplete options={toAutoCompleteOptions(NATIONALITY_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Gender Preference" name="genderPref">
                <AutoComplete options={toAutoCompleteOptions(GENDER_PREF_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Mother (Maiden Name)" name="motherName"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Father" name="fatherName"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item label="Spouse" name="spouse"><Input /></Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Identifying / Remarkable Features" name="features"><Input /></Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Permanent Address" name="permanentAddress" tooltip="Only if different from the Address on file above">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="center" className="psir-section-title">Criminal History</Divider>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
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

          <Divider orientation="center" className="psir-section-title" style={{ marginTop: 24 }}>Socio-Economic Background</Divider>
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
        {canEdit && <Button type="primary" onClick={savePsirProfile} loading={savingPsirProfile}>Save PSIR Profile</Button>}
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
          {isAdmin && (
            <Col xs={24} sm={12} lg={8}>
              <div style={{ marginBottom: 6, color: 'rgba(0,0,0,0.65)', fontWeight: 600 }}>Assigned Officer</div>
              <Space.Compact style={{ width: '100%' }}>
                <Select
                  style={{ width: '100%' }}
                  value={reassignTo}
                  onChange={setReassignTo}
                  options={officers.map((o) => ({ label: o.full_name, value: o.id }))}
                />
                <Button
                  type="primary"
                  onClick={reassign}
                  loading={savingReassign}
                  disabled={reassignTo === probationer.assigned_officer_id}
                >
                  Update
                </Button>
              </Space.Compact>
            </Col>
          )}
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
    </div>
  );
}
