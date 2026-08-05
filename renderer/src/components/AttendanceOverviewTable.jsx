import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Col, DatePicker, Input, Row, Select, Table, Typography } from 'antd';
import { ApiClient } from '../api/apiClient.js';

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
    </div>
  );
}
