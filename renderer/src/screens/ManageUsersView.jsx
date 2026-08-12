import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

const { Title } = Typography;

export default function ManageUsersView() {
  const { enums } = useApp();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUserForm] = Form.useForm();
  const [newUserError, setNewUserError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editUser, setEditUser] = useState(null);
  const [editForm] = Form.useForm();
  const [editError, setEditError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function load() {
    setError('');
    try {
      setUsers(await ApiClient.get(`/users${showInactive ? '?includeInactive=1' : ''}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(u) {
    const action = u.is_active ? 'deactivate' : 'activate';
    try {
      await ApiClient.post(`/users/${u.id}/${action}`, {});
      message.success(`${u.username} ${action}d.`);
      await load();
    } catch (err) {
      message.error(err.message);
    }
  }

  function openNewUser() {
    newUserForm.resetFields();
    setNewUserError('');
    setNewUserOpen(true);
  }

  async function createUser() {
    setNewUserError('');
    const values = await newUserForm.validateFields();
    setCreating(true);
    try {
      await ApiClient.post('/users', {
        username: values.username.trim(),
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || null,
        lastName: values.lastName.trim(),
        title: values.title || null,
        password: values.password,
        role: values.role,
      });
      setNewUserOpen(false);
      await load();
    } catch (err) {
      setNewUserError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(u) {
    editForm.resetFields();
    editForm.setFieldsValue({
      username: u.username,
      firstName: u.first_name,
      middleName: u.middle_name || '',
      lastName: u.last_name,
      title: u.title || undefined,
      role: u.role,
      password: '',
    });
    setEditError('');
    setEditUser(u);
  }

  async function saveEdit() {
    setEditError('');
    const values = await editForm.validateFields();
    setEditing(true);
    try {
      await ApiClient.patch(`/users/${editUser.id}`, {
        username: values.username.trim(),
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || null,
        lastName: values.lastName.trim(),
        title: values.title || null,
        role: values.role,
        ...(values.password ? { password: values.password } : {}),
      });
      message.success(`${values.username.trim()} updated.`);
      setEditUser(null);
      await load();
    } catch (err) {
      setEditError(err.message);
      message.error(err.message);
    } finally {
      setEditing(false);
    }
  }

  const columns = [
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'First Name', dataIndex: 'first_name', key: 'first_name' },
    { title: 'Middle Name', dataIndex: 'middle_name', key: 'middle_name', render: (v) => v || '—' },
    { title: 'Last Name', dataIndex: 'last_name', key: 'last_name' },
    { title: 'Title', dataIndex: 'title', key: 'title', render: (v) => v || '—' },
    { title: 'Role', dataIndex: 'role', key: 'role' },
    { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? 'Yes' : 'No'}</Tag> },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, u) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)}>Edit</Button>
          <Popconfirm title={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.username}?`} onConfirm={() => toggleActive(u)}>
            <Button size="small">{u.is_active ? 'Deactivate' : 'Activate'}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3}>Manage Users</Title>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={openNewUser}>New User</Button>
        <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}>
          Show deactivated users
        </Checkbox>
      </Space>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Table rowKey="id" columns={columns} dataSource={users} pagination={{ pageSize: 20 }} />

      <Modal title="New User" open={newUserOpen} onCancel={() => setNewUserOpen(false)} onOk={createUser} confirmLoading={creating} okText="Create User">
        <Form form={newUserForm} layout="vertical" initialValues={{ role: 'officer' }}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="First Name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Middle Name" name="middleName"><Input /></Form.Item>
          <Form.Item label="Last Name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Title" name="title">
            <Select allowClear options={(enums.USER_TITLES || []).map((t) => ({ label: t, value: t }))} />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item label="Role" name="role" rules={[{ required: true }]}>
            <Select options={enums.ROLES.map((r) => ({ label: r, value: r }))} />
          </Form.Item>
          {newUserError && <Alert type="error" message={newUserError} showIcon />}
        </Form>
      </Modal>

      <Modal title="Edit User" open={editUser !== null} onCancel={() => setEditUser(null)} onOk={saveEdit} confirmLoading={editing} okText="Save">
        <Form form={editForm} layout="vertical">
          <Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="First Name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Middle Name" name="middleName"><Input /></Form.Item>
          <Form.Item label="Last Name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Title" name="title">
            <Select allowClear options={(enums.USER_TITLES || []).map((t) => ({ label: t, value: t }))} />
          </Form.Item>
          <Form.Item label="Role" name="role" rules={[{ required: true }]}>
            <Select options={enums.ROLES.map((r) => ({ label: r, value: r }))} />
          </Form.Item>
          <Form.Item
            label="New Password"
            name="password"
            rules={[{ min: 6, message: 'At least 6 characters' }]}
            extra="Leave blank to keep the current password."
          >
            <Input.Password />
          </Form.Item>
          {editError && <Alert type="error" message={editError} showIcon />}
        </Form>
      </Modal>
    </div>
  );
}
