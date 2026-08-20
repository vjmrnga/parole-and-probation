import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Typography } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import BrandHeader from '../components/BrandHeader.jsx';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

const { Text, Link } = Typography;

export default function LoginScreen() {
  const { enterApp, enterOfflineApp, settings, enums } = useApp();
  // 'login' | 'signup' | 'submitted' — 'submitted' shows the "wait for
  // admin approval" confirmation after a successful sign-up request.
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  // 'error' for a real failure, 'warning' for "we understood you, but the
  // account isn't usable yet" (pending approval / rejected) — same Alert,
  // less alarming color for a state that isn't a mistake.
  const [errorType, setErrorType] = useState('error');
  const [loading, setLoading] = useState(false);
  const [signupForm] = Form.useForm();
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
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
    setErrorType('error');
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
        if (err.code === 'PENDING_APPROVAL' || err.code === 'REGISTRATION_REJECTED') setErrorType('warning');
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

  function goToSignup() {
    signupForm.resetFields();
    setSignupError('');
    setMode('signup');
  }

  function goToLogin() {
    setError('');
    setErrorType('error');
    setMode('login');
  }

  async function onFinishSignup(values) {
    setSignupError('');
    setSignupLoading(true);
    try {
      await ApiClient.signup({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        confirmPassword: values.confirmPassword,
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || null,
        lastName: values.lastName.trim(),
        title: values.title || null,
      });
      setMode('submitted');
    } catch (err) {
      setSignupError(err.message);
    } finally {
      setSignupLoading(false);
    }
  }

  // Checked when the user leaves the field (not on every keystroke) — see
  // GET /auth/check-username. Still just a UX head start: the /signup
  // submit itself is the authoritative check (the column is UNIQUE), so a
  // name claimed in between is caught there regardless.
  async function validateUsernameAvailable(_, value) {
    if (!value || !value.trim()) return Promise.resolve();
    const { available } = await ApiClient.get(`/auth/check-username?username=${encodeURIComponent(value.trim())}`);
    if (!available) return Promise.reject(new Error('Username is already taken'));
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {mode === 'submitted' && (
        <Card style={{ width: 380, maxWidth: '100%' }}>
          <BrandHeader title="Request Submitted" />
          <Alert
            type="success"
            showIcon
            message="Your account request was submitted"
            description="An administrator needs to review and approve it before you can sign in. Check back once you've been notified it's been approved."
            style={{ marginBottom: 16 }}
          />
          <Button block onClick={goToLogin}>Back to Sign In</Button>
        </Card>
      )}

      {mode === 'signup' && (
        <Card style={{ width: 380, maxWidth: '100%' }}>
          <BrandHeader title="Sign Up" />
          <Form form={signupForm} layout="vertical" onFinish={onFinishSignup} requiredMark={false}>
            <Form.Item
              label="Username"
              name="username"
              validateTrigger="onBlur"
              rules={[{ required: true, message: 'Username is required' }, { validator: validateUsernameAvailable }]}
            >
              <Input autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: 'Email is required' },
                { type: 'email', message: 'Enter a valid email address' },
              ]}
            >
              <Input autoComplete="email" />
            </Form.Item>
            <Form.Item label="First Name" name="firstName" rules={[{ required: true, message: 'First name is required' }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Middle Name" name="middleName">
              <Input />
            </Form.Item>
            <Form.Item label="Last Name" name="lastName" rules={[{ required: true, message: 'Last name is required' }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Title" name="title">
              <Select allowClear placeholder="Optional" options={(enums.USER_TITLES || []).map((t) => ({ label: t, value: t }))} />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              extra={enums.PASSWORD_POLICY_DESCRIPTION}
              rules={[
                { required: true, message: 'Password is required' },
                { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, message: enums.PASSWORD_POLICY_DESCRIPTION },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="Confirm Password"
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Please confirm your password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            {signupError && <Alert type="error" message={signupError} showIcon style={{ marginBottom: 16 }} />}
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" loading={signupLoading} block>Request Account</Button>
            </Form.Item>
          </Form>
          <Button type="link" block onClick={goToLogin} style={{ padding: 0 }}>Back to Sign In</Button>
        </Card>
      )}

      {mode === 'login' && (
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
            {error && <Alert type={errorType} message={error} showIcon style={{ marginBottom: 16 }} />}
            <Form.Item style={{ marginBottom: 8 }}>
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
          <Text type="secondary">
            Don't have an account? <Link onClick={goToSignup}>Sign Up</Link>
          </Text>
        </Card>
      )}

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
