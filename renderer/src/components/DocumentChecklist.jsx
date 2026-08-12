import { useEffect, useState } from 'react';
import { Button, Checkbox, Popconfirm, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { EyeOutlined, PaperClipOutlined, DeleteOutlined, EditOutlined, CheckOutlined, LockOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { useDocEditor, lockStatus } from '../hooks/useDocEditor.js';
import DocumentCaptureModal from './DocumentCaptureModal.jsx';

const { Text } = Typography;

// Submitted-documents checklist for the Stage & Status tab
// (renderer/src/screens/CaseDetailView.jsx). The full list vs. the
// detained-only subset is decided by `isDetained` (derived by the caller
// from probationer.psir_profile.radios.custodial === 'Detention') — see
// shared/documentChecklist.js for the fixed list itself and which items
// still apply when detained.
export default function DocumentChecklist({ probationerId, isDetained, canEdit }) {
  const { user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [togglingKey, setTogglingKey] = useState(null);
  const [attachKey, setAttachKey] = useState(null);
  const [savingAttach, setSavingAttach] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probationerId]);

  async function load() {
    setLoading(true);
    try {
      const rows = await ApiClient.get(`/probationers/${probationerId}/documents`);
      setItems(rows);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSubmitted(key, checked) {
    setTogglingKey(key);
    try {
      await ApiClient.patch(`/probationers/${probationerId}/documents/${key}`, { submitted: checked });
      await load();
    } catch (err) {
      message.error(err.message);
    } finally {
      setTogglingKey(null);
    }
  }

  async function saveAttachment(dataUrl, filename) {
    setSavingAttach(true);
    try {
      await ApiClient.post(`/probationers/${probationerId}/documents/${attachKey}/file`, { dataUrl, filename });
      message.success('Attachment saved.');
      await load();
    } finally {
      setSavingAttach(false);
    }
  }

  async function viewFile(key) {
    try {
      const { dataUrl, filename } = await ApiClient.get(`/probationers/${probationerId}/documents/${key}/file`);
      const base64 = dataUrl.split(',')[1];
      const result = await window.api.documentOpenFile(base64, filename || `${key}.jpg`);
      if (!result.ok) throw new Error(result.error || 'Could not open the file');
    } catch (err) {
      message.error(err.message);
    }
  }

  async function removeFile(key) {
    try {
      await ApiClient.delete(`/probationers/${probationerId}/documents/${key}/file`);
      message.success('Attachment removed.');
      await load();
    } catch (err) {
      message.error(err.message);
    }
  }

  const editor = useDocEditor({
    keyPrefix: `doc-${probationerId}`,
    lockPath: (key) => `/probationers/${probationerId}/documents/${key}/lock`,
    uploadPath: (key) => `/probationers/${probationerId}/documents/${key}/file`,
    downloadFile: async (key) => {
      const { dataUrl, filename } = await ApiClient.get(`/probationers/${probationerId}/documents/${key}/file`);
      const base64 = dataUrl.split(',')[1];
      // Open with a real extension so the OS picks the matching editor (Paint
      // for images, Acrobat/etc. for PDFs) — original_filename can be null.
      const row = items.find((i) => i.key === key);
      let ext = 'bin';
      if (row?.mimeType === 'application/pdf') ext = 'pdf';
      else if (row?.mimeType) ext = row.mimeType.replace('image/', '').replace('jpeg', 'jpg');
      return { base64, filename: filename || `${key}.${ext}` };
    },
    onReleased: load,
  });

  async function forceUnlock(key) {
    try {
      await ApiClient.delete(`/probationers/${probationerId}/documents/${key}/lock`);
      message.success('Lock released.');
      await load();
    } catch (err) {
      message.error(err.message);
    }
  }

  const rows = isDetained ? items.filter((i) => i.detainedRequired) : items;

  return (
    <>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        loading={loading}
        dataSource={rows}
        columns={[
          { title: 'Document', dataIndex: 'label', key: 'label' },
          {
            title: 'Submitted',
            key: 'submitted',
            width: 110,
            render: (_, row) => (
              <Checkbox
                checked={row.submitted}
                disabled={!canEdit || togglingKey === row.key}
                onChange={(e) => toggleSubmitted(row.key, e.target.checked)}
              />
            ),
          },
          {
            title: 'Date Submitted',
            dataIndex: 'submittedAt',
            key: 'submittedAt',
            width: 130,
            render: (v) => v || <Text type="secondary">—</Text>,
          },
          {
            title: 'File',
            key: 'file',
            width: 110,
            render: (_, row) => (row.hasFile ? <Tag color="green">Attached</Tag> : <Tag>No file</Tag>),
          },
          {
            title: 'Actions',
            key: 'actions',
            width: 200,
            render: (_, row) => {
              const lock = lockStatus(row, user?.id);
              const mine = editor.isEditing(row.key) || (lock.locked && lock.byMe);
              const lockedByOther = lock.locked && !lock.byMe;
              return (
                <Space wrap>
                  {row.hasFile && (
                    <Tooltip title="View (read-only)">
                      <Button size="small" icon={<EyeOutlined />} onClick={() => viewFile(row.key)} />
                    </Tooltip>
                  )}
                  {canEdit && row.hasFile && (
                    mine ? (
                      <Tooltip title="Done editing">
                        <Button size="small" type="primary" icon={<CheckOutlined />} loading={editor.busyId === row.key} onClick={() => editor.stopEdit(row.key)} />
                      </Tooltip>
                    ) : lockedByOther ? (
                      <Tooltip title={`Being edited by ${lock.name || 'another user'}`}>
                        <Tag icon={<LockOutlined />} color="orange" style={{ margin: 0 }}>In use</Tag>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Edit (changes save automatically)">
                        <Button size="small" icon={<EditOutlined />} loading={editor.busyId === row.key} onClick={() => editor.startEdit(row.key)} />
                      </Tooltip>
                    )
                  )}
                  {canEdit && row.hasFile && !lockedByOther && (
                    <Popconfirm title="Remove this attachment?" onConfirm={() => removeFile(row.key)}>
                      <Tooltip title="Remove">
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                  {isAdmin && lockedByOther && (
                    <Popconfirm title={`Force-release ${lock.name || 'this'} lock?`} onConfirm={() => forceUnlock(row.key)}>
                      <Button size="small" danger icon={<LockOutlined />} />
                    </Popconfirm>
                  )}
                  {canEdit && !lockedByOther && (
                    <Tooltip title={row.hasFile ? 'Replace' : 'Attach'}>
                      <Button size="small" icon={<PaperClipOutlined />} onClick={() => setAttachKey(row.key)} />
                    </Tooltip>
                  )}
                </Space>
              );
            },
          },
        ]}
      />

      <DocumentCaptureModal
        open={!!attachKey}
        title={attachKey ? `Attach: ${rows.find((r) => r.key === attachKey)?.label || ''}` : ''}
        onClose={() => setAttachKey(null)}
        onSave={saveAttachment}
        disabled={savingAttach}
      />
    </>
  );
}
