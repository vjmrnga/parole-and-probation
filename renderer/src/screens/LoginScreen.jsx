import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import BrandHeader from '../components/BrandHeader.jsx';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

export default function LoginScreen() {
  const { enterApp, setScreen } = useApp();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Held only long enough to retry the login with force:true if the user
  // confirms the "sign out the other session?" modal below — never stored
  // anywhere more durable than this component's state.
  const [pendingCredentials, setPendingCredentials] = useState(null);
  const [conflict, setConflict] = useState(null); // { device, since } from a 409 ALREADY_LOGGED_IN

  async function attemptLogin(username, password, { force = false } = {}) {
    setError('');
    setLoading(true);
    try {
      const user = await ApiClient.login(username, password, { force });
      setConflict(null);
      setPendingCredentials(null);
      enterApp(user);
    } catch (err) {
      if (err.code === 'ALREADY_LOGGED_IN') {
        setPendingCredentials({ username, password });
        setConflict({ device: err.device, since: err.since });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function onFinish(values) {
    attemptLogin(values.username.trim(), values.password);
  }

  function confirmForceLogin() {
    if (!pendingCredentials) return;
    attemptLogin(pendingCredentials.username, pendingCredentials.password, { force: true });
  }

  function cancelConflict() {
    setConflict(null);
    setPendingCredentials(null);
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

      <Modal
        open={!!conflict}
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
            Already signed in elsewhere
          </span>
        }
        okText="Log Out Other Session & Sign In"
        cancelText="Cancel"
        okButtonProps={{ danger: true, loading }}
        onOk={confirmForceLogin}
        onCancel={cancelConflict}
      >
        <p>
          This account is currently signed in on <strong>{conflict?.device || 'another device'}</strong>.
        </p>
        <p>
          Continuing here will immediately sign that session out, so anyone still using it there will be
          returned to the login screen mid-task. Only continue if you're sure that's what should happen.
        </p>
      </Modal>
    </div>
  );
}
