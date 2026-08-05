import { useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, message, Steps } from 'antd';
import BrandHeader from '../components/BrandHeader.jsx';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

export default function HeadOfficeSetupScreen() {
  const { settings, refreshSettings, hoInitialStep, setScreen } = useApp();
  const [current, setCurrent] = useState(hoInitialStep);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const [dbForm] = Form.useForm();
  const [adminForm] = Form.useForm();

  const initialDb = {
    host: settings.mysqlConfig?.host || 'localhost',
    port: settings.mysqlConfig?.port || 3306,
    database: settings.mysqlConfig?.database || 'parole_probation',
    user: settings.mysqlConfig?.user || '',
    password: settings.mysqlConfig?.password || '',
  };

  async function testConnection() {
    const config = await dbForm.validateFields();
    setTesting(true);
    const result = await window.api.mysqlTestConnection(config);
    setTesting(false);
    if (result.ok) {
      message.success('Connection succeeded.');
    } else {
      message.error(`Connection failed: ${result.error}`);
    }
  }

  async function runSetup() {
    const config = await dbForm.validateFields();
    setRunning(true);
    const result = await window.api.mysqlRunSetup(config);
    setRunning(false);
    if (!result.ok) {
      message.error(`Setup failed: ${result.error}`);
      return;
    }
    await refreshSettings();
    message.success('Database ready.');

    try {
      const status = await ApiClient.get('/auth/bootstrap-status');
      setCurrent(status.needsAdmin ? 1 : 2);
    } catch (err) {
      message.error(`Could not reach the local server: ${err.message}`);
    }
  }

  async function createAdmin(values) {
    setCreatingAdmin(true);
    try {
      await ApiClient.bootstrapAdmin(values.username.trim(), values.password, values.fullName.trim());
      ApiClient.logout(); // send them through the normal login screen rather than silently staying signed in
      setCurrent(2);
    } catch (err) {
      message.error(err.message);
    } finally {
      setCreatingAdmin(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: 640, maxWidth: '100%' }}>
        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setScreen('chooseMode')}>&larr; Back</Button>
        <BrandHeader title="Head Office Setup" />

        <Steps
          current={current}
          size="small"
          style={{ marginBottom: 24 }}
          items={[
            { title: 'MySQL Connection' },
            { title: 'Create Admin' },
            { title: 'Done' },
          ]}
        />

        {current === 0 && (
          <>
            <Alert type="info" showIcon message="MySQL Server must already be installed on this PC." style={{ marginBottom: 16 }} />
            <Form form={dbForm} layout="vertical" initialValues={initialDb}>
              <Form.Item label="Host" name="host" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item label="Port" name="port" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} /></Form.Item>
              <Form.Item label="Database" name="database" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item label="User" name="user" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item label="Password" name="password"><Input.Password /></Form.Item>
            </Form>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={testConnection} loading={testing}>Test Connection</Button>
              <Button type="primary" onClick={runSetup} loading={running}>Run Setup</Button>
            </div>
          </>
        )}

        {current === 1 && (
          <>
            <Alert
              type="info" showIcon style={{ marginBottom: 16 }}
              message="No admin account exists yet — create one now. Every other account is created from Manage Users afterward."
            />
            <Form form={adminForm} layout="vertical" onFinish={createAdmin}>
              <Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item label="Full Name" name="fullName" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item label="Password" name="password" rules={[{ required: true }]}><Input.Password /></Form.Item>
              <Button type="primary" htmlType="submit" loading={creatingAdmin}>Create Admin Account</Button>
            </Form>
          </>
        )}

        {current === 2 && (
          <>
            <Alert type="success" showIcon message="Setup complete." style={{ marginBottom: 16 }} />
            <Button type="primary" onClick={() => setScreen('login')}>Continue to Login</Button>
          </>
        )}
      </Card>
    </div>
  );
}
