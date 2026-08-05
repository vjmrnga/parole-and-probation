import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import dayjs from 'dayjs';
import { Button, Col, DatePicker, Input, Modal, message, Row, Select, Space, Table, Typography } from 'antd';
import { EyeOutlined, PrinterOutlined, FileExcelOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';

function waitForNextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const { Text } = Typography;

const STATUS_META = {
  present: { label: 'Present', bg: '#d4f4dd', color: '#1a7a3c' },
  absent: { label: 'Absent', bg: '#fbdada', color: '#a83a3a' },
  pending: { label: 'Pending', bg: '#fff1c2', color: '#8a6d00' },
};

function StatusTag({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <div style={{
      background: meta.bg, color: meta.color, textAlign: 'center', padding: '4px 0',
      borderRadius: 4, fontSize: 12, fontWeight: 500,
    }}
    >
      {meta.label}
    </div>
  );
}

// Shared by the on-screen preview modal and the hidden print area below so
// "what you see in Preview" and "what actually prints/exports" never drift
// apart — see the @media print block and the Preview button's Modal.
function ReportContent({ rows, month, officerName, statusFilter, graceEnd, counts, signatures }) {
  return (
    <>
      <h2 style={{ margin: '0 0 4px' }}>Talisay City Parole and Probation Office</h2>
      <h3 style={{ margin: '0 0 8px', fontWeight: 500 }}>
        Attendance Overview — {month.format('MMMM YYYY')}
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: 12 }}>
        Officer: {officerName || 'All Officers'}
        {statusFilter && ` • Status: ${STATUS_META[statusFilter].label}`}
        {graceEnd && ` • Grace period ends ${dayjs(graceEnd).format('MMMM D, YYYY')}`}
        {' • '}Present: {counts.present} Absent: {counts.absent} Pending: {counts.pending}
        {' • '}Generated {dayjs().format('MMMM D, YYYY h:mm A')}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Name', 'Docket #', 'Officer', 'Reported On', 'Status', 'Signature'].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '2px solid #333', padding: '6px 8px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const sigUrl = signatures?.[p.attendanceEntryId];
            return (
              <tr key={p.probationerId}>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>{p.fullName}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>{p.docketNumber}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>{p.assignedOfficerName}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>
                  {p.reportedDates.length ? p.reportedDates.map((d) => dayjs(d).format('MMM D, YYYY')).join(', ') : '—'}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>
                  {STATUS_META[p.status]?.label || p.status}
                </td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>
                  {sigUrl ? (
                    <img
                      src={sigUrl}
                      alt="Signature"
                      style={{ height: 32, maxWidth: 110, background: '#fff', border: '1px solid #ddd', borderRadius: 3 }}
                    />
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function SummaryBadge({ label, count, meta, active, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        background: meta.bg, color: meta.color,
        border: `1px solid ${meta.color}`,
        borderRadius: 4, padding: '2px 10px', fontSize: 13, fontWeight: 500,
        cursor: 'pointer', userSelect: 'none',
        boxShadow: active ? `0 0 0 2px ${meta.color}` : 'none',
      }}
    >
      {label}: {count}
    </span>
  );
}

// Probationers report once a month, not on a fixed per-person schedule —
// everyone shares one grace period through the end of the month's first
// Monday-Friday work week before an unreported probationer counts as
// Absent for that month. See server/routes/attendance.js's /overview
// handler and shared/attendanceGracePeriod.js.
export default function AttendanceOverviewTable() {
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(dayjs());
  const [graceEnd, setGraceEnd] = useState(null);
  const [probationers, setProbationers] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [search, setSearch] = useState('');
  const [officerId, setOfficerId] = useState('all');
  const [statusFilter, setStatusFilter] = useState(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preparingReport, setPreparingReport] = useState(false);
  const [loadingSignatureId, setLoadingSignatureId] = useState(null);
  const [viewSignatureEntry, setViewSignatureEntry] = useState(null); // { fullName, dataUrl } | null
  // { [attendanceEntryId]: pngDataUrl } — shared by the "View" column button,
  // the print area, the preview modal, and the Excel export so a signature
  // is only ever fetched once per session.
  const [signatureCache, setSignatureCache] = useState({});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function load() {
    setLoading(true);
    try {
      const [overview, users] = await Promise.all([
        ApiClient.get(`/attendance/overview?month=${month.format('YYYY-MM')}`),
        ApiClient.get('/users'),
      ]);
      setProbationers(overview.probationers);
      setGraceEnd(overview.graceEnd);
      setOfficers(users);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return probationers.filter((p) => {
      if (officerId !== 'all' && String(p.assignedOfficerId) !== String(officerId)) return false;
      if (!q) return true;
      return p.fullName.toLowerCase().includes(q) || p.docketNumber.toLowerCase().includes(q);
    });
  }, [probationers, search, officerId]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, pending: 0 };
    filtered.forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; });
    return c;
  }, [filtered]);

  const rows = useMemo(() => (
    statusFilter ? filtered.filter((p) => p.status === statusFilter) : filtered
  ), [filtered, statusFilter]);

  function toggleStatusFilter(status) {
    setStatusFilter((prev) => (prev === status ? null : status));
  }

  // Fetches whichever present rows' signatures aren't cached yet and returns
  // the merged cache. Returned (not just set) because callers that need the
  // bytes immediately — building the Excel export — can't wait on a state update.
  async function ensureSignatures(targetRows) {
    const need = targetRows.filter((p) => p.status === 'present' && p.attendanceEntryId && !signatureCache[p.attendanceEntryId]);
    if (!need.length) return signatureCache;
    const fetched = await Promise.all(need.map(async (p) => {
      try {
        const { pngBase64 } = await ApiClient.get(`/attendance/${p.attendanceEntryId}/signature`);
        return [p.attendanceEntryId, `data:image/png;base64,${pngBase64}`];
      } catch {
        return [p.attendanceEntryId, null]; // no signature on file — leave the report cell blank
      }
    }));
    const merged = { ...signatureCache };
    fetched.forEach(([id, dataUrl]) => { if (dataUrl) merged[id] = dataUrl; });
    setSignatureCache(merged);
    return merged;
  }

  async function viewSignature(record) {
    if (signatureCache[record.attendanceEntryId]) {
      setViewSignatureEntry({ fullName: record.fullName, dataUrl: signatureCache[record.attendanceEntryId] });
      return;
    }
    setLoadingSignatureId(record.probationerId);
    try {
      const { pngBase64 } = await ApiClient.get(`/attendance/${record.attendanceEntryId}/signature`);
      const dataUrl = `data:image/png;base64,${pngBase64}`;
      setSignatureCache((prev) => ({ ...prev, [record.attendanceEntryId]: dataUrl }));
      setViewSignatureEntry({ fullName: record.fullName, dataUrl });
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoadingSignatureId(null);
    }
  }

  const officerName = officerId === 'all'
    ? null
    : officers.find((o) => String(o.id) === String(officerId))?.full_name;

  async function handlePreviewOpen() {
    setPreparingReport(true);
    try {
      await ensureSignatures(rows);
      setPreviewOpen(true);
    } catch (err) {
      message.error(err.message || 'Failed to load signatures');
    } finally {
      setPreparingReport(false);
    }
  }

  async function handlePrint() {
    setPreparingReport(true);
    try {
      const merged = await ensureSignatures(rows);
      // flushSync so the print area's <img> tags are in the DOM (with the
      // right src) before window.print() captures the page — a plain
      // setState here would still be pending on the next tick otherwise.
      flushSync(() => setSignatureCache(merged));
      await waitForNextPaint();
      window.print();
    } catch (err) {
      message.error(err.message || 'Failed to load signatures');
    } finally {
      setPreparingReport(false);
    }
  }

  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      const signatures = await ensureSignatures(rows);
      const result = await window.api.attendanceOverviewExportExcel({
        rows,
        monthLabel: month.format('MMMM YYYY'),
        officerName,
        statusFilter,
        graceEnd: graceEnd ? dayjs(graceEnd).format('MMMM D, YYYY') : null,
        counts,
        signatures,
        generatedAt: dayjs().format('MMMM D, YYYY h:mm A'),
        defaultName: `Attendance Overview ${month.format('YYYY-MM')}.xlsx`,
      });
      if (result.ok) message.success(`Saved to ${result.filePath}`);
    } catch (err) {
      message.error(err.message || 'Failed to export Excel');
    } finally {
      setExportingExcel(false);
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (fullName, record) => (
        <div>
          <div>{fullName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.docketNumber}</Text>
        </div>
      ),
    },
    { title: 'Officer', dataIndex: 'assignedOfficerName', key: 'assignedOfficerName' },
    {
      title: 'Reported On',
      key: 'reportedDates',
      render: (_, record) => (record.reportedDates.length
        ? record.reportedDates.map((d) => dayjs(d).format('MMM D, YYYY')).join(', ')
        : '—'),
    },
    {
      title: 'Status',
      key: 'status',
      width: 130,
      render: (_, record) => <StatusTag status={record.status} />,
    },
    {
      title: 'Signature',
      key: 'signature',
      width: 100,
      render: (_, record) => (record.status === 'present' && record.attendanceEntryId ? (
        <Button
          type="link"
          size="small"
          loading={loadingSignatureId === record.probationerId}
          onClick={() => viewSignature(record)}
        >
          View
        </Button>
      ) : '—'),
    },
  ];

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 16 }} align="middle">
        <Col flex="auto">
          <Input
            placeholder="Filter by name or PI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
        </Col>
        <Col flex="260px">
          <Select
            style={{ width: '100%' }}
            value={officerId}
            onChange={setOfficerId}
            options={[
              { label: 'All Officers', value: 'all' },
              ...officers.map((o) => ({ label: o.full_name, value: String(o.id) })),
            ]}
          />
        </Col>
        <Col flex="180px">
          <DatePicker
            picker="month"
            style={{ width: '100%' }}
            value={month}
            onChange={(v) => v && setMonth(v)}
            allowClear={false}
          />
        </Col>
        <Col>
          <Space>
            <Button icon={<EyeOutlined />} onClick={handlePreviewOpen} loading={preparingReport}>Preview</Button>
            <Button icon={<PrinterOutlined />} onClick={handlePrint} loading={preparingReport}>Print</Button>
            <Button icon={<FileExcelOutlined />} onClick={handleExportExcel} loading={exportingExcel}>Export Excel</Button>
          </Space>
        </Col>
      </Row>
      <Row gutter={8} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <SummaryBadge
            label="Present"
            count={counts.present}
            meta={STATUS_META.present}
            active={statusFilter === 'present'}
            onClick={() => toggleStatusFilter('present')}
          />
        </Col>
        <Col>
          <SummaryBadge
            label="Absent"
            count={counts.absent}
            meta={STATUS_META.absent}
            active={statusFilter === 'absent'}
            onClick={() => toggleStatusFilter('absent')}
          />
        </Col>
        <Col>
          <SummaryBadge
            label="Pending"
            count={counts.pending}
            meta={STATUS_META.pending}
            active={statusFilter === 'pending'}
            onClick={() => toggleStatusFilter('pending')}
          />
        </Col>
        {graceEnd && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Grace period ends {dayjs(graceEnd).format('MMMM D, YYYY')}
            </Text>
          </Col>
        )}
      </Row>
      <Table
        rowKey="probationerId"
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20 }}
      />

      {/* Hidden on screen; @media print below swaps it in for the whole page
          so Print gets every filtered row (not just the current Table page)
          without the sidebar, filters, or antd chrome. */}
      <div id="attendance-print-area" style={{ display: 'none' }}>
        <ReportContent rows={rows} month={month} officerName={officerName} statusFilter={statusFilter} graceEnd={graceEnd} counts={counts} signatures={signatureCache} />
      </div>

      <Modal
        title="Attendance Overview Preview"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={840}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>Close</Button>,
          <Button key="print" icon={<PrinterOutlined />} onClick={handlePrint} loading={preparingReport}>Print</Button>,
          <Button key="excel" type="primary" icon={<FileExcelOutlined />} onClick={handleExportExcel} loading={exportingExcel}>Export Excel</Button>,
        ]}
      >
        <div style={{ maxHeight: '65vh', overflowY: 'auto', padding: '0 4px' }}>
          <ReportContent rows={rows} month={month} officerName={officerName} statusFilter={statusFilter} graceEnd={graceEnd} counts={counts} signatures={signatureCache} />
        </div>
      </Modal>

      <Modal
        title={`Attendance Signature${viewSignatureEntry ? ` — ${viewSignatureEntry.fullName}` : ''}`}
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

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #attendance-print-area, #attendance-print-area * { visibility: visible; }
          #attendance-print-area {
            display: block !important;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
