import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import BrandHeader from '../components/BrandHeader.jsx';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

export default function LoginScreen() {
  const { enterApp, enterOfflineApp, settings } = useApp();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Held only long enough to retry the login with force:true if the user
  // confirms the "sign out the other session?" modal below — never stored
  // anywhere more durable than this component's state.
  const [pendingCredentials, setPendingCredentials] = useState(null);
  const [conflict, setConflict] = useState(null); // { device, since } from a 409 ALREADY_LOGGED_IN
  // Set when Head Office was unreachable on the last attempt (branch office
  // only). We don't drop into offline mode automatically — the user explicitly
  // chooses "Continue in Offline Mode" below.
  const [offlineDetected, setOfflineDetected] = useState(false);
  const [offlineCredentials, setOfflineCredentials] = useState(null);

  async function attemptLogin(username, password, { force = false } = {}) {
    setError('');
    setOfflineDetected(false);
    setLoading(true);
    try {
      const user = await ApiClient.login(username, password, { force });
      setConflict(null);
      setPendingCredentials(null);
      enterApp(user);
    } catch (err) {
      // Head Office unreachable (branch office only — head office is the server,
      // so it's never "offline" from itself). Surface it and let the user decide.
      if (err.offline && settings.mode === 'branch-office') {
        setOfflineCredentials({ username, password });
        setOfflineDetected(true);
      } else if (err.code === 'ALREADY_LOGGED_IN') {
        setPendingCredentials({ username, password });
        setConflict({ device: err.device, since: err.since });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function continueOffline() {
    if (!offlineCredentials) return;
    setError('');
    setLoading(true);
    try {
      const user = await ApiClient.loginOffline(offlineCredentials.username, offlineCredentials.password);
      enterOfflineApp(user);
    } catch (err) {
      setError(err.message);
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
        <BrandHeader title="Sign In" />
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item label="Username" name="username" rules={[{ required: true, message: 'Username is required' }]}>
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Password is required' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {offlineDetected && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="You are offline"
              description="Head Office can't be reached right now. You can continue in Offline Mode to log attendance — anything you record will sync automatically once you're back online."
            />
          )}
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          <Form.Item style={{ marginBottom: 0 }}>
            {offlineDetected ? (
              <>
                <Button type="primary" onClick={continueOffline} loading={loading} block style={{ marginBottom: 8 }}>
                  Continue in Offline Mode
                </Button>
                <Button htmlType="submit" loading={loading} block>Try Again</Button>
              </>
            ) : (
              <Button type="primary" htmlType="submit" loading={loading} block>Sign In</Button>
            )}
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
