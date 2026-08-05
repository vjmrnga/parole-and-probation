import { useState } from 'react';
import { Alert, Button, Card, Form, Input } from 'antd';
import BrandHeader from '../components/BrandHeader.jsx';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

export default function LoginScreen() {
  const { enterApp, setScreen } = useApp();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onFinish(values) {
    setError('');
    setLoading(true);
    try {
      const user = await ApiClient.login(values.username.trim(), values.password);
      enterApp(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setScreen('chooseMode')}>&larr; Back</Button>
        <BrandHeader title="Sign In" />
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item label="Username" name="username" rules={[{ required: true, message: 'Username is required' }]}>
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Password is required' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>Sign In</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
