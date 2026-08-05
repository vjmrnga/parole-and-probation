import { useEffect, useState } from 'react';
import { Button, Card, Input, InputNumber, message, Modal, Space, Switch, Typography } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';

const { Title, Text } = Typography;

export default function SettingsView() {
  const { user, settings, refreshSettings, goDashboard, setScreen } = useApp();
  const [fingerprint, setFingerprint] = useState('');
  const [lanAddresses, setLanAddresses] = useState([]);

  const [db, setDb] = useState({ host: '', port: 3306, database: '', user: '', password: '' });
  const [savingDb, setSavingDb] = useState(false);
  const [backupFolder, setBackupFolder] = useState('');
  const [backupSchedule, setBackupSchedule] = useState('');
  const [backupRetention, setBackupRetention] = useState(14);

  useEffect(() => {
    if (settings.mode === 'head-office') {
      setDb({
        host: settings.mysqlConfig?.host || '',
        port: settings.mysqlConfig?.port || 3306,
        database: settings.mysqlConfig?.database || '',
        user: settings.mysqlConfig?.user || '',
        password: settings.mysqlConfig?.password || '',
      });
      setBackupFolder(settings.backupFolder || '');
      setBackupSchedule(settings.backupSchedule || '');
      setBackupRetention(settings.backupRetentionCount || 14);
      window.api.getCertFingerprint().then(setFingerprint);
      window.api.getLanAddresses().then(setLanAddresses);
    }
  }, [settings]);

  function back() {
    // Settings is reachable pre-login too (Ctrl+S works everywhere) —
    // in that case there's no session yet, so "back" means Login.
    if (!ApiClient.isLoggedIn()) {
      setScreen('login');
      return;
    }
    goDashboard();
  }

  async function saveDb() {
    setSavingDb(true);
    const result = await window.api.mysqlRunSetup(db);
    setSavingDb(false);
    if (result.ok) {
      message.success('Database settings saved and server restarted.');
      await refreshSettings();
    } else {
      message.error(`Failed: ${result.error}`);
    }
  }

  async function toggleAutoLaunch(checked) {
    await window.api.setSetting('autoLaunchEnabled', checked);
    await refreshSettings();
  }

  async function saveServerPort(value) {
    await window.api.setSetting('serverPort', value);
    await refreshSettings();
  }

  async function chooseBackupFolder() {
    const folder = await window.api.chooseFolder();
    if (folder) setBackupFolder(folder);
  }

  async function saveBackupSettings() {
    await window.api.setSetting('backupFolder', backupFolder);
    await window.api.setSetting('backupSchedule', backupSchedule);
    await window.api.setSetting('backupRetentionCount', backupRetention);
    await refreshSettings();
    message.success('Backup settings saved.');
  }

  async function runBackupNow() {
    const result = await window.api.runBackupNow();
    if (result.ok) {
      message.success(`Backup written to ${result.filePath}`);
    } else {
      message.error(`Backup failed: ${result.error}`);
    }
  }

  function switchMode() {
    Modal.confirm({
      title: 'Switch mode?',
      content: 'This PC will need to be set up again (MySQL connection or Head Office pairing).',
      okText: 'Switch Mode',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.api.setMode(null);
        await refreshSettings();
        ApiClient.logout();
        setScreen('chooseMode');
      },
    });
  }

  return (
    <div>
      <Button type="link" style={{ paddingLeft: 0 }} onClick={back}>&larr; Back</Button>
      <Title level={3}>Settings</Title>
      <p>
        Mode: <Text strong>{settings.mode || '(not set)'}</Text>{' '}
        <Button type="link" onClick={switchMode}>Switch Mode…</Button>
      </p>

      {settings.mode === 'head-office' && (
        <>
          <Card title="MySQL Connection" style={{ marginBottom: 20 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space wrap>
                <div><div>Host</div><Input value={db.host} onChange={(e) => setDb({ ...db, host: e.target.value })} /></div>
                <div><div>Port</div><InputNumber value={db.port} onChange={(v) => setDb({ ...db, port: v })} /></div>
                <div><div>Database</div><Input value={db.database} onChange={(e) => setDb({ ...db, database: e.target.value })} /></div>
                <div><div>User</div><Input value={db.user} onChange={(e) => setDb({ ...db, user: e.target.value })} /></div>
                <div><div>Password</div><Input.Password value={db.password} onChange={(e) => setDb({ ...db, password: e.target.value })} /></div>
              </Space>
              <Button type="primary" loading={savingDb} onClick={saveDb}>Save &amp; Re-run Setup</Button>
            </Space>

            <Title level={5} style={{ marginTop: 24 }}>Network</Title>
            <p>Server Port: <InputNumber defaultValue={settings.serverPort} onBlur={(e) => saveServerPort(Number(e.target.value))} style={{ width: 120 }} /></p>
            <p>This PC's LAN addresses (share one with Branch Offices): <Text type="secondary">{lanAddresses.join(', ') || '(none found)'}</Text></p>
            <p>Certificate Fingerprint (for Branch Office pairing): <Text code style={{ wordBreak: 'break-all' }}>{fingerprint || '(not generated yet — start the server first)'}</Text></p>
            <Space>
              <Switch checked={!!settings.autoLaunchEnabled} onChange={toggleAutoLaunch} />
              <Text>Start with Windows (run in background)</Text>
            </Space>
          </Card>

          <Card title="Backup" style={{ marginBottom: 20 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space wrap>
                <div>
                  <div>Backup Folder</div>
                  <Space.Compact>
                    <Input value={backupFolder} readOnly style={{ width: 260 }} />
                    <Button onClick={chooseBackupFolder}>Choose…</Button>
                  </Space.Compact>
                </div>
                <div><div>Schedule (cron)</div><Input value={backupSchedule} onChange={(e) => setBackupSchedule(e.target.value)} /></div>
                <div><div>Retention (# of backups)</div><InputNumber value={backupRetention} onChange={setBackupRetention} /></div>
              </Space>
              <Space>
                <Button onClick={saveBackupSettings}>Save Backup Settings</Button>
                <Button onClick={runBackupNow}>Run Backup Now</Button>
              </Space>
            </Space>
          </Card>
        </>
      )}

      {settings.mode === 'branch-office' && (
        <Card title="Head Office Connection" style={{ marginBottom: 20 }}>
          <p>URL: <Text strong>{settings.headOfficeUrl || '(not set)'}</Text></p>
          <p>Pinned Certificate Fingerprint: <Text code style={{ wordBreak: 'break-all' }}>{settings.pinnedCertFingerprint || '(not paired)'}</Text></p>
          <Button onClick={() => setScreen('boSetup')}>Re-pair with Head Office…</Button>
        </Card>
      )}
    </div>
  );
}
