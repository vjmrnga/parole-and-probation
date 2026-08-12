import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Button, Card, ConfigProvider, Input, message, Modal, Popconfirm, Select, Table, Tabs, Typography,
} from 'antd';
import { ApiClient } from '../api/apiClient.js';
import SignatureCapture from '../components/SignatureCapture.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import AttendanceOverviewTable from '../components/AttendanceOverviewTable.jsx';
import { composeName } from '../utils/composeName.js';

const { Title, Paragraph } = Typography;

export default function SignatureAttendanceView() {
  const signatureRef = useRef(null);
  const visitSignatureRef = useRef(null);

  const [probationers, setProbationers] = useState([]);
  const [targetId, setTargetId] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [existingSignature, setExistingSignature] = useState(null);
  const [existingPhoto, setExistingPhoto] = useState(null);

  const [attendanceNotes, setAttendanceNotes] = useState('');
  // Set once by the officer and left as-is (not reset per submission or per
  // probationer) so it carries forward automatically to every attendance
  // logged in the same sitting — the point is to avoid retyping it each time.
  const [gadTopic, setGadTopic] = useState('');
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [loggingAttendance, setLoggingAttendance] = useState(false);

  const [viewSignatureEntry, setViewSignatureEntry] = useState(null); // { id, dataUrl } | null
  const [loadingSignatureId, setLoadingSignatureId] = useState(null);

  useEffect(() => {
    ApiClient.get('/probationers').then((rows) => {
      setProbationers(rows);
      if (rows.length && !targetId) setTargetId(rows[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!targetId) return;
    signatureRef.current?.clear();
    load(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  async function load(id) {
    const rows = await ApiClient.get(`/probationers/${id}/attendance`);
    setAttendance(rows);

    const target = await ApiClient.get(`/probationers/${id}`);

    if (target?.signature_path) {
      try {
        const { pngBase64 } = await ApiClient.get(`/probationers/${id}/signature`);
        setExistingSignature(`data:image/png;base64,${pngBase64}`);
      } catch (err) {
        setExistingSignature(null);
      }
    } else {
      setExistingSignature(null);
    }

    if (target?.photo_path) {
      try {
        const { dataUrl } = await ApiClient.get(`/probationers/${id}/photo`);
        setExistingPhoto(dataUrl);
      } catch (err) {
        setExistingPhoto(null);
      }
    } else {
      setExistingPhoto(null);
    }
  }

  async function saveSignature() {
    if (signatureRef.current.isEmpty()) {
      message.error('Please capture a signature first.');
      return;
    }
    try {
      const dataUrl = signatureRef.current.getDataUrl();
      await ApiClient.post(`/probationers/${targetId}/signature`, { pngBase64: dataUrl });
      setExistingSignature(dataUrl);
      message.success('Reference signature saved.');
    } catch (err) {
      message.error(err.message);
    }
  }

  async function savePhoto(dataUrl) {
    await ApiClient.post(`/probationers/${targetId}/photo`, { dataUrl });
    setExistingPhoto(dataUrl);
    message.success('Reference photo saved.');
  }

  function openAttendanceModal() {
    visitSignatureRef.current?.clear();
    setAttendanceModalOpen(true);
  }

  async function logAttendance() {
    if (!visitSignatureRef.current || visitSignatureRef.current.isEmpty()) {
      message.error("Please capture the probationer's signature for this visit.");
      return;
    }
    setLoggingAttendance(true);
    try {
      await ApiClient.post(`/probationers/${targetId}/attendance`, {
        logDate: dayjs().format('YYYY-MM-DD'),
        notes: attendanceNotes.trim(),
        gadTopic: gadTopic.trim(),
        pngBase64: visitSignatureRef.current.getDataUrl(),
      });
      setAttendanceNotes('');
      visitSignatureRef.current.clear();
      setAttendanceModalOpen(false);
      await load(targetId);
      message.success('Attendance logged.');
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoggingAttendance(false);
    }
  }

  async function viewSignature(entryId) {
    setLoadingSignatureId(entryId);
    try {
      const { pngBase64 } = await ApiClient.get(`/attendance/${entryId}/signature`);
      setViewSignatureEntry({ id: entryId, dataUrl: `data:image/png;base64,${pngBase64}` });
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoadingSignatureId(null);
    }
  }

  const viewedEntry = viewSignatureEntry && attendance.find((a) => a.id === viewSignatureEntry.id);
  const selectedProbationer = probationers.find((p) => p.id === targetId);

  return (
    <div>
      <Title level={3}>Signature &amp; Attendance</Title>
      <Tabs
        items={[
          {
            key: 'sign',
            label: 'Sign & Log Attendance',
            children: (
              <Card>
                <div style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 4 }}>Probationer</div>
                    <ConfigProvider theme={{ components: { Select: { controlHeightLG: 56, fontSizeLG: 16, lineWidth: 2, colorBorder: '#8c8c8c' } } }}>
                      <Select
                        size="large"
                        style={{ width: '100%' }}
                        value={targetId}
                        onChange={setTargetId}
                        showSearch
                        optionFilterProp="label"
                        options={probationers.map((p) => ({ label: `${composeName(p)} (${p.docket_number})`, value: p.id }))}
                      />
                    </ConfigProvider>
                  </div>
                  <Button
                    type="primary"
                    size="large"
                    style={{ height: 56 }}
                    onClick={openAttendanceModal}
                    disabled={!targetId}
                  >
                    Log Attendance
                  </Button>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ marginBottom: 4 }}>
                    GAD Topic{' '}
                    <span style={{ color: '#8c8c8c', fontWeight: 400 }}>
                      (optional — stays set and applies to every attendance you log until you change it)
                    </span>
                  </div>
                  <Input
                    size="large"
                    placeholder="e.g., Gender Sensitivity, Values Formation..."
                    value={gadTopic}
                    onChange={(e) => setGadTopic(e.target.value)}
                    allowClear
                  />
                </div>

                <Title level={5}>Photo on File</Title>
                <Paragraph type="secondary" style={{ marginTop: -8 }}>
                  Compare this against the person appearing, before logging attendance.
                </Paragraph>
                <PhotoCapture existingPhoto={existingPhoto} onSave={savePhoto} disabled={!targetId} />

                <Title level={5} style={{ marginTop: 24 }}>Reference Signature on File</Title>
                <SignatureCapture
                  ref={signatureRef}
                  existingSignature={existingSignature}
                  signerName={selectedProbationer ? composeName(selectedProbationer) : undefined}
                  reason="Reference signature on file"
                  extraActions={(
                    <Popconfirm title="Are you sure to save signature?" onConfirm={saveSignature} disabled={!targetId}>
                      <Button type="primary" size="large" disabled={!targetId}>Save Signature</Button>
                    </Popconfirm>
                  )}
                />

                <Title level={5} style={{ marginTop: 24 }}>Attendance</Title>
                <Table
                  rowKey="id"
                  dataSource={attendance}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: 'Date', dataIndex: 'log_date', key: 'log_date' },
                    { title: 'GAD Topic', dataIndex: 'gad_topic', key: 'gad_topic', render: (v) => v || '—' },
                    { title: 'Notes', dataIndex: 'notes', key: 'notes' },
                    {
                      title: 'Signature',
                      key: 'signature',
                      width: 100,
                      render: (_, row) => (
                        <Button
                          type="link"
                          size="small"
                          loading={loadingSignatureId === row.id}
                          disabled={!row.signature_path}
                          onClick={() => viewSignature(row.id)}
                        >
                          View
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'overview',
            label: 'Attendance Overview',
            children: <AttendanceOverviewTable />,
          },
        ]}
      />

      <Modal
        title="Log Attendance"
        open={attendanceModalOpen}
        onCancel={() => setAttendanceModalOpen(false)}
        onOk={logAttendance}
        confirmLoading={loggingAttendance}
        okText="Submit"
        width={640}
      >
        <div style={{ marginBottom: 4 }}>Notes / Remarks</div>
        <Input.TextArea
          rows={4}
          placeholder="Notes / remarks (Shift+Enter for a new line)"
          value={attendanceNotes}
          onChange={(e) => setAttendanceNotes(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 4 }}>Probationer&apos;s Signature (this visit)</div>
        <SignatureCapture
          ref={visitSignatureRef}
          signerName={selectedProbationer ? composeName(selectedProbationer) : undefined}
          reason="Attendance visit signature"
        />
      </Modal>

      <Modal
        title={`Attendance Signature${viewedEntry ? ` — ${dayjs(viewedEntry.log_date).format('MMM D, YYYY')}` : ''}`}
        open={!!viewSignatureEntry}
        onCancel={() => setViewSignatureEntry(null)}
        footer={null}
      >
        {viewSignatureEntry && (
          <img
            src={viewSignatureEntry.dataUrl}
            alt="Attendance signature"
            style={{ width: '100%', border: '1px solid #d0d3d9', borderRadius: 6, background: '#fff' }}
          />
        )}
      </Modal>
    </div>
  );
}
