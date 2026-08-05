import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Button, Card, ConfigProvider, Input, message, Modal, Popconfirm, Select, Table, Tabs, Typography,
} from 'antd';
import { ApiClient } from '../api/apiClient.js';
import SignatureCapture from '../components/SignatureCapture.jsx';
import AttendanceOverviewTable from '../components/AttendanceOverviewTable.jsx';

const { Title } = Typography;

export default function SignatureAttendanceView() {
  const signatureRef = useRef(null);

  const [probationers, setProbationers] = useState([]);
  const [targetId, setTargetId] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [existingSignature, setExistingSignature] = useState(null);

  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [loggingAttendance, setLoggingAttendance] = useState(false);

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
      message.success('Signature saved.');
    } catch (err) {
      message.error(err.message);
    }
  }

  async function logAttendance() {
    setLoggingAttendance(true);
    try {
      await ApiClient.post(`/probationers/${targetId}/attendance`, {
        logDate: dayjs().format('YYYY-MM-DD'),
        notes: attendanceNotes.trim(),
      });
      setAttendanceNotes('');
      setAttendanceModalOpen(false);
      await load(targetId);
      message.success('Attendance logged.');
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoggingAttendance(false);
    }
  }

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
                <div style={{ marginBottom: 20 }}>
                  <div style={{ marginBottom: 4 }}>Probationer</div>
                  <ConfigProvider theme={{ components: { Select: { controlHeightLG: 56, fontSizeLG: 16, lineWidth: 2, colorBorder: '#8c8c8c' } } }}>
                    <Select
                      size="large"
                      style={{ width: '100%' }}
                      value={targetId}
                      onChange={setTargetId}
                      showSearch
                      optionFilterProp="label"
                      options={probationers.map((p) => ({ label: `${p.full_name} (${p.docket_number})`, value: p.id }))}
                    />
                  </ConfigProvider>
                </div>

                <Title level={5}>Signature</Title>
                <SignatureCapture
                  ref={signatureRef}
                  existingSignature={existingSignature}
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
                    { title: 'Notes', dataIndex: 'notes', key: 'notes' },
                  ]}
                />
                <Button
                  type="primary"
                  size="large"
                  block
                  style={{ marginTop: 16 }}
                  onClick={() => setAttendanceModalOpen(true)}
                  disabled={!targetId}
                >
                  Log Attendance
                </Button>
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
      >
        <div style={{ marginBottom: 4 }}>Notes / Remarks</div>
        <Input.TextArea
          rows={4}
          placeholder="Notes / remarks (Shift+Enter for a new line)"
          value={attendanceNotes}
          onChange={(e) => setAttendanceNotes(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              logAttendance();
            }
          }}
        />
      </Modal>
    </div>
  );
}
