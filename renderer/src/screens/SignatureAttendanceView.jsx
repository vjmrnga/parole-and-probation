import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Button, Card, ConfigProvider, Input, message, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography,
} from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { syncOutbox, pendingAttendanceFor, outboxCount } from '../api/offlineAttendance.js';
import { useServerEvents } from '../hooks/useServerEvents.js';
import SignatureCapture from '../components/SignatureCapture.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import AttendanceOverviewTable from '../components/AttendanceOverviewTable.jsx';
import { composeName } from '../utils/composeName.js';

const { Title, Paragraph } = Typography;

// A queued (not-yet-synced) outbox entry, shaped like an attendance_log row so
// it can sit in the same table alongside real entries.
function toPendingRow(e) {
  return {
    id: `pending-${e.clientId}`,
    log_date: e.logDate,
    gad_topic: e.gadTopic,
    notes: e.notes,
    signature_path: null,
    _pending: true,
  };
}

export default function SignatureAttendanceView() {
  // Fixed for the life of this session — the officer is either signed in
  // online (normal) or against a cached credential (offline). See apiClient.js.
  const offline = ApiClient.isOffline();
  const me = ApiClient.getUser();

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

  // Offline/sync UI state.
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [preparing, setPreparing] = useState(false);

  async function refreshPendingCount() {
    setPendingCount(await outboxCount());
  }

  useEffect(() => {
    loadProbationers();
    refreshPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!targetId) return;
    signatureRef.current?.clear();
    load(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // Live update: refresh the probationer picker when cases change elsewhere,
  // and reload the selected probationer's attendance/signature/photo when a
  // new visit is logged (e.g. by another officer on another machine).
  // No server events arrive in offline mode (the stream isn't connected).
  useServerEvents((events) => {
    if (offline) return;
    if (events.some((e) => e.resource === 'probationers')) {
      ApiClient.get('/probationers').then(setProbationers).catch(() => {});
    }
    if (targetId && events.some((e) => e.resource === 'attendance')) {
      load(targetId);
    }
  });

  async function loadProbationers() {
    if (offline) {
      const cache = await window.api.offlineGetCache();
      const list = cache.probationers || [];
      setProbationers(list);
      if (list.length && !targetId) setTargetId(list[0].id);
      return;
    }
    try {
      const rows = await ApiClient.get('/probationers');
      setProbationers(rows);
      window.api.offlineSetProbationerList(rows).catch(() => {});
      if (rows.length && !targetId) setTargetId(rows[0].id);
    } catch (err) {
      message.error(err.message);
    }
  }

  async function load(id) {
    const pending = (await pendingAttendanceFor(me.id, id)).map(toPendingRow);

    if (offline) {
      const cache = await window.api.offlineGetCache();
      const detail = (cache.byId && cache.byId[id]) || {};
      setAttendance([...pending, ...(detail.attendance || [])]);
      setExistingSignature(detail.referenceSignature || null);
      setExistingPhoto(detail.referencePhoto || null);
      return;
    }

    const rows = await ApiClient.get(`/probationers/${id}/attendance`);
    setAttendance([...pending, ...rows]);

    const target = await ApiClient.get(`/probationers/${id}`);

    let referenceSignature = null;
    let referencePhoto = null;
    if (target?.signature_path) {
      try {
        const { pngBase64 } = await ApiClient.get(`/probationers/${id}/signature`);
        referenceSignature = `data:image/png;base64,${pngBase64}`;
      } catch (err) {
        referenceSignature = null;
      }
    }
    if (target?.photo_path) {
      try {
        const { dataUrl } = await ApiClient.get(`/probationers/${id}/photo`);
        referencePhoto = dataUrl;
      } catch (err) {
        referencePhoto = null;
      }
    }
    setExistingSignature(referenceSignature);
    setExistingPhoto(referencePhoto);

    // Keep the offline cache warm so this case is usable the next time Head
    // Office is unreachable.
    window.api
      .offlineSetProbationerDetail(id, { probationer: target, attendance: rows, referenceSignature, referencePhoto })
      .catch(() => {});
  }

  // Reference signature/photo "on file" are one-per-probationer. Offline we
  // apply the capture to the local cache (so it shows immediately and is there
  // to compare against on the next offline visit) and queue it to overwrite the
  // server copy on the next sync.
  async function queueReference(kind, payload, cachePatch) {
    const prob = probationers.find((p) => p.id === targetId);
    await window.api.offlineEnqueue({
      kind,
      probationerId: targetId,
      probationerName: prob ? composeName(prob) : '',
      recordedByUserId: me.id,
      recordedByName: me.full_name,
      ...payload,
    });
    await window.api.offlineSetProbationerDetail(targetId, cachePatch);
    await refreshPendingCount();
  }

  async function saveSignature() {
    if (signatureRef.current.isEmpty()) {
      message.error('Please capture a signature first.');
      return;
    }
    const dataUrl = signatureRef.current.getDataUrl();
    try {
      if (offline) {
        await queueReference('referenceSignature', { pngBase64: dataUrl }, { referenceSignature: dataUrl });
        setExistingSignature(dataUrl);
        message.success('Reference signature saved offline — will sync when connected.');
        return;
      }
      await ApiClient.post(`/probationers/${targetId}/signature`, { pngBase64: dataUrl });
      setExistingSignature(dataUrl);
      message.success('Reference signature saved.');
    } catch (err) {
      message.error(err.message);
    }
  }

  async function savePhoto(dataUrl) {
    if (offline) {
      await queueReference('referencePhoto', { dataUrl }, { referencePhoto: dataUrl });
      setExistingPhoto(dataUrl);
      message.success('Reference photo saved offline — will sync when connected.');
      return;
    }
    await ApiClient.post(`/probationers/${targetId}/photo`, { dataUrl });
    setExistingPhoto(dataUrl);
    message.success('Reference photo saved.');
  }

  function openAttendanceModal() {
    visitSignatureRef.current?.clear();
    setAttendanceModalOpen(true);
  }

  // Saves an entry to the local outbox instead of Head Office. Used both when
  // signed in offline and when an online submit turns out to have lost the
  // connection mid-sitting.
  async function queueOffline(payload) {
    const prob = probationers.find((p) => p.id === targetId);
    await window.api.offlineEnqueue({
      kind: 'attendance',
      probationerId: targetId,
      probationerName: prob ? composeName(prob) : '',
      logDate: payload.logDate,
      notes: payload.notes,
      gadTopic: payload.gadTopic,
      pngBase64: payload.pngBase64,
      recordedByUserId: me.id,
      recordedByName: me.full_name,
    });
  }

  async function logAttendance() {
    if (!visitSignatureRef.current || visitSignatureRef.current.isEmpty()) {
      message.error("Please capture the probationer's signature for this visit.");
      return;
    }

    const payload = {
      logDate: dayjs().format('YYYY-MM-DD'),
      notes: attendanceNotes.trim(),
      gadTopic: gadTopic.trim(),
      pngBase64: visitSignatureRef.current.getDataUrl(),
    };

    // Guard the once-per-day rule locally too, so an offline officer doesn't
    // queue a duplicate the server would only reject later.
    if (attendance.some((a) => a.log_date === payload.logDate)) {
      message.error('An entry already exists for today.');
      return;
    }

    setLoggingAttendance(true);
    try {
      if (offline) {
        await queueOffline(payload);
        message.success('Saved offline — this will sync when connected to Head Office.');
      } else {
        try {
          await ApiClient.post(`/probationers/${targetId}/attendance`, payload);
          message.success('Attendance logged.');
        } catch (err) {
          if (err.status === 0) {
            // Connection dropped mid-sitting — don't lose the capture.
            await queueOffline(payload);
            message.warning('No connection to Head Office — saved offline and will sync later.');
          } else {
            throw err;
          }
        }
      }
      setAttendanceNotes('');
      visitSignatureRef.current.clear();
      setAttendanceModalOpen(false);
      await load(targetId);
      await refreshPendingCount();
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoggingAttendance(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncOutbox(me.id);
      const parts = [];
      if (res.synced) parts.push(`${res.synced} synced`);
      if (res.alreadyThere) parts.push(`${res.alreadyThere} already on file`);
      if (res.failed) parts.push(`${res.failed} still pending`);
      message[res.failed ? 'warning' : 'success'](parts.length ? `Sync: ${parts.join(', ')}.` : 'Nothing to sync.');
      await load(targetId);
      await refreshPendingCount();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSyncing(false);
    }
  }

  // Pre-caches every probationer's detail (reference signature/photo + latest
  // attendance) so they're all available if Head Office goes offline later.
  async function prepareOffline() {
    setPreparing(true);
    let done = 0;
    try {
      for (const p of probationers) {
        try {
          const target = await ApiClient.get(`/probationers/${p.id}`);
          const rows = await ApiClient.get(`/probationers/${p.id}/attendance`);
          let referenceSignature = null;
          let referencePhoto = null;
          if (target?.signature_path) {
            try {
              const { pngBase64 } = await ApiClient.get(`/probationers/${p.id}/signature`);
              referenceSignature = `data:image/png;base64,${pngBase64}`;
            } catch (err) { /* skip */ }
          }
          if (target?.photo_path) {
            try {
              const { dataUrl } = await ApiClient.get(`/probationers/${p.id}/photo`);
              referencePhoto = dataUrl;
            } catch (err) { /* skip */ }
          }
          await window.api.offlineSetProbationerDetail(p.id, {
            probationer: target,
            attendance: rows,
            referenceSignature,
            referencePhoto,
          });
          done += 1;
        } catch (err) { /* skip this one, keep going */ }
      }
      await window.api.offlineSetProbationerList(probationers);
      message.success(`Ready for offline use — ${done} of ${probationers.length} case(s) cached.`);
    } finally {
      setPreparing(false);
    }
  }

  async function exportPending() {
    const res = await window.api.offlineExportOutboxExcel();
    if (res.ok) message.success('Pending attendance exported.');
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

  const signTab = (
    <Card>
      {(pendingCount > 0 || offline) && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: '#fff7e6',
            border: '1px solid #ffd591',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Tag color="orange" style={{ margin: 0 }}>
            {pendingCount} pending {pendingCount === 1 ? 'entry' : 'entries'}
          </Tag>
          <span style={{ color: '#8c6d1f' }}>
            {offline
              ? 'Saved on this PC — sign in while connected to Head Office to sync.'
              : 'Captured offline earlier and not yet on Head Office.'}
          </span>
          <Space style={{ marginLeft: 'auto' }}>
            {!offline && (
              <Button size="small" type="primary" loading={syncing} disabled={!pendingCount} onClick={handleSync}>
                Sync now
              </Button>
            )}
            <Button size="small" disabled={!pendingCount} onClick={exportPending}>
              Export to Excel
            </Button>
          </Space>
        </div>
      )}

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
        {!offline && (
          <Button size="large" style={{ height: 56 }} loading={preparing} onClick={prepareOffline}>
            Prepare for Offline
          </Button>
        )}
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
      {offline && (
        <Paragraph type="secondary" style={{ marginTop: -4 }}>
          {existingPhoto
            ? 'Showing the cached photo on file. A new photo you take offline will sync when connected.'
            : 'No photo on file yet — you can take one now; it will sync to Head Office when connected.'}
        </Paragraph>
      )}
      <PhotoCapture existingPhoto={existingPhoto} onSave={savePhoto} disabled={!targetId} />

      <Title level={5} style={{ marginTop: 24 }}>Reference Signature on File</Title>
      {offline && (
        <Paragraph type="secondary">
          {existingSignature
            ? 'Showing the cached signature on file. A new signature you capture offline will sync when connected.'
            : 'No reference signature on file yet — you can capture one now; it will sync when connected.'}
        </Paragraph>
      )}
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
          {
            title: 'Date',
            dataIndex: 'log_date',
            key: 'log_date',
            render: (v, row) => (
              <Space>
                {v}
                {row._pending && <Tag color="orange">Pending sync</Tag>}
              </Space>
            ),
          },
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
                disabled={offline || row._pending || !row.signature_path}
                onClick={() => viewSignature(row.id)}
              >
                View
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );

  return (
    <div>
      <Title level={3}>Signature &amp; Attendance</Title>
      {offline ? (
        signTab
      ) : (
        <Tabs
          items={[
            { key: 'sign', label: 'Sign & Log Attendance', children: signTab },
            { key: 'overview', label: 'Attendance Overview', children: <AttendanceOverviewTable /> },
          ]}
        />
      )}

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
