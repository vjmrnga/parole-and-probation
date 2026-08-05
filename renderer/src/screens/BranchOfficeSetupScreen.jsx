import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import BrandHeader from '../components/BrandHeader.jsx';
import { useApp } from '../AppContext.jsx';

const { Text } = Typography;

export default function BranchOfficeSetupScreen() {
  const { refreshSettings, setScreen } = useApp();
  const [step, setStep] = useState(0); // 0 = enter URL, 1 = confirm fingerprint, 2 = done
  const [url, setUrl] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fingerprint, setFingerprint] = useState('');

  async function fetchCertificate(values) {
    setFetchError('');
    const targetUrl = values.url.trim();
    setUrl(targetUrl);
    setFetching(true);
    const result = await window.api.fetchRemoteFingerprint(targetUrl);
    setFetching(false);
    if (!result.ok) {
      setFetchError(`Could not connect: ${result.error}`);
      return;
    }
    setFingerprint(result.fingerprint);
    setStep(1);
  }

  async function confirmTrust() {
    await window.api.confirmPinCert(url, fingerprint);
    await refreshSettings();
    setStep(2);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: 640, maxWidth: '100%' }}>
        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setScreen('chooseMode')}>&larr; Back</Button>
        <BrandHeader title="Branch Office Setup" />
        <Text type="secondary">Connect this PC to your office's Head Office server.</Text>

        {step === 0 && (
          <Form layout="vertical" onFinish={fetchCertificate} style={{ marginTop: 16 }}>
            <Form.Item label="Head Office URL" name="url" rules={[{ required: true, message: 'Enter the Head Office URL' }]}>
              <Input placeholder="https://192.168.1.50:4750" />
            </Form.Item>
            {fetchError && <Alert type="error" message={fetchError} showIcon style={{ marginBottom: 16 }} />}
            <Button type="primary" htmlType="submit" loading={fetching}>Fetch Certificate</Button>
          </Form>
        )}

        {step === 1 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Title level={5}>Confirm Certificate</Typography.Title>
            <Text type="secondary">
              Compare this fingerprint against the one shown on the Head Office PC's Settings screen (Ctrl+S there). Only continue if they match exactly.
            </Text>
            <div style={{ marginTop: 12, marginBottom: 16 }}>
              <Text code style={{ wordBreak: 'break-all' }}>{fingerprint}</Text>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button type="primary" onClick={confirmTrust}>Confirm &amp; Trust</Button>
              <Button onClick={() => setStep(0)}>Cancel</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ marginTop: 16 }}>
            <Alert type="success" showIcon message="Paired with Head Office." style={{ marginBottom: 16 }} />
            <Button type="primary" onClick={() => setScreen('login')}>Continue to Login</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
