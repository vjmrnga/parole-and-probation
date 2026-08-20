import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { useDocEditor, lockStatus } from '../hooks/useDocEditor.js';

const { RangePicker } = DatePicker;

const { Title } = Typography;

const RECOMMENDATION_LABELS = {
  GRANTED: 'GRANTED',
  DENIED: 'DENIED — unfavorable',
  LEGAL_DQ: 'DENIED — Legal DQ',
  WITHDRAWN: 'WITHDRAWN',
  MOOT: 'MOOT and ACADEMIC',
};
const RECOMMENDATION_COLORS = {
  GRANTED: 'green',
  DENIED: 'red',
  LEGAL_DQ: 'red',
  WITHDRAWN: 'default',
  MOOT: 'default',
};

export default function PsirListView() {
  const { user, openCase } = useApp();
  const isAdmin = user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [officerFilter, setOfficerFilter] = useState();
  const [dateRange, setDateRange] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const officerOptions = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.generated_by_name).filter(Boolean))];
    return names.sort().map((name) => ({ label: name, value: name }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.probationer_name || ''} ${r.docket_number || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (officerFilter && r.generated_by_name !== officerFilter) return false;
      if (dateRange && dateRange[0] && dateRange[1]) {
        const generated = dayjs(r.generated_at);
        if (generated.isBefore(dateRange[0], 'day') || generated.isAfter(dateRange[1], 'day')) return false;
      }
      return true;
    });
  }, [rows, search, officerFilter, dateRange]);

  async function load() {
    setLoading(true);
    try {
      setRows(await ApiClient.get('/psir'));
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const editor = useDocEditor({
    keyPrefix: 'psir',
    lockPath: (id) => `/psir/${id}/lock`,
    uploadPath: (id) => `/psir/${id}/file`,
    downloadFile: (id) => ApiClient.get(`/psir/${id}/download`),
    onReleased: load,
  });

  async function forceUnlock(id) {
    try {
      await ApiClient.delete(`/psir/${id}/lock`);
      message.success('Lock released.');
      await load();
    } catch (err) {
      message.error(err.message);
    }
  }

  async function saveFileAs(id) {
    setBusyId(id);
    try {
      const { base64, filename } = await ApiClient.get(`/psir/${id}/download`);
      const result = await window.api.psirSaveFile(base64, filename);
      if (result.ok) message.success(`Saved to ${result.filePath}`);
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    try {
      await ApiClient.delete(`/psir/${id}`);
      message.success('Deleted.');
      await load();
    } catch (err) {
      message.error(err.message);
    }
  }

  return (
    <div>
      <Title level={3} style={{ margin: '0 0 16px' }}>PSIR Reports</Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search name or docket #…"
          allowClear
          style={{ width: 280 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          placeholder="All Officers"
          allowClear
          style={{ width: 220 }}
          options={officerOptions}
          value={officerFilter}
          onChange={setOfficerFilter}
        />
        <RangePicker
          placeholder={['Generated from', 'Generated to']}
          value={dateRange}
          onChange={setDateRange}
          format="MM/DD/YYYY"
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={filteredRows}
        columns={[
          {
            title: 'Probationer',
            dataIndex: 'probationer_name',
            key: 'probationer_name',
            render: (name, row) => <a onClick={() => openCase(row.probationer_id)}>{name}</a>,
          },
          { title: 'Docket #', dataIndex: 'docket_number', key: 'docket_number' },
          {
            title: 'Recommendation',
            dataIndex: 'recommendation_type',
            key: 'recommendation_type',
            render: (v) => <Tag color={RECOMMENDATION_COLORS[v] || 'default'}>{RECOMMENDATION_LABELS[v] || v}</Tag>,
          },
          {
            title: 'Generated',
            dataIndex: 'generated_at',
            key: 'generated_at',
            render: (v) => new Date(v).toLocaleString(),
          },
          { title: 'Generated By', dataIndex: 'generated_by_name', key: 'generated_by_name' },
          {
            title: 'Actions',
            key: 'actions',
            render: (_, row) => {
              const lock = lockStatus(row, user?.id);
              const mine = editor.isEditing(row.id) || (lock.locked && lock.byMe);
              const lockedByOther = lock.locked && !lock.byMe;
              const canDelete = isAdmin || row.generated_by === user?.id;
              return (
                <Space wrap>
                  {mine ? (
                    <Button size="small" type="primary" loading={editor.busyId === row.id} onClick={() => editor.stopEdit(row.id)}>
                      Done editing
                    </Button>
                  ) : lockedByOther ? (
                    <Tooltip title={`Being edited by ${lock.name || 'another user'}`}>
                      <Tag icon={<LockOutlined />} color="orange">In use{lock.name ? ` — ${lock.name}` : ''}</Tag>
                    </Tooltip>
                  ) : (
                    <Button size="small" loading={editor.busyId === row.id} onClick={() => editor.startEdit(row.id)}>Open</Button>
                  )}
                  <Button size="small" loading={busyId === row.id} onClick={() => saveFileAs(row.id)}>Save a copy as…</Button>
                  {isAdmin && lockedByOther && (
                    <Popconfirm title={`Force-release ${lock.name || 'this'} lock?`} onConfirm={() => forceUnlock(row.id)}>
                      <Button size="small" danger>Force unlock</Button>
                    </Popconfirm>
                  )}
                  {canDelete && (
                    <Popconfirm title="Delete this PSIR?" onConfirm={() => remove(row.id)}>
                      <Button size="small" danger>Delete</Button>
                    </Popconfirm>
                  )}
                </Space>
              );
            },
          },
        ]}
      />
    </div>
  );
}
