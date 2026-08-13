import { Layout, Menu, Button, Typography, Modal, Alert, Tag } from 'antd';
import logo from '../assets/logo.png';
import { useApp } from '../AppContext.jsx';
import DashboardView from './DashboardView.jsx';
import CaseDetailView from './CaseDetailView.jsx';
import ManageUsersView from './ManageUsersView.jsx';
import SettingsView from './SettingsView.jsx';
import SignatureAttendanceView from './SignatureAttendanceView.jsx';
import PsirListView from './PsirListView.jsx';
import RecordsCheckView from './RecordsCheckView.jsx';
import FinalReportListView from './FinalReportListView.jsx';

const { Sider, Content } = Layout;
const { Text } = Typography;

export default function AppShell() {
  const { user, appView, setAppView, logout, offlineMode } = useApp();
  const isAdmin = user?.role === 'admin';

  const confirmLogout = () => {
    Modal.confirm({
      title: 'Log out?',
      content: 'Are you sure you want to log out?',
      okText: 'Log Out',
      cancelText: 'Cancel',
      onOk: logout,
    });
  };

  // Offline (Head Office unreachable): attendance is the only thing that works
  // locally, so it's the only menu item. Everything else needs Head Office.
  // Settings is deliberately not a menu item — Ctrl+S only (see App.jsx).
  const menuItems = offlineMode
    ? [{ key: 'signatureAttendance', label: 'Signature & Attendance' }]
    : [
        { key: 'dashboard', label: 'Probationers' },
        { key: 'signatureAttendance', label: 'Signature & Attendance' },
        { key: 'psir', label: 'PSIR Reports' },
        { key: 'recordsCheck', label: 'Records Check' },
        { key: 'finalReports', label: 'Final Reports' },
        ...(isAdmin ? [{ key: 'manageUsers', label: 'Manage Users' }] : []),
      ];
  // In offline mode only the attendance view exists — never render another.
  const activeView = offlineMode ? 'signatureAttendance' : appView;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px' }}>
          <img src={logo} alt="" style={{ width: 30, height: 30 }} />
          <Text style={{ color: '#fff', fontWeight: 600 }}>Case Manager</Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeView === 'caseDetail' ? 'dashboard' : activeView === 'settings' ? '' : activeView]}
          items={menuItems}
          onClick={({ key }) => setAppView(key)}
        />
        <div style={{ marginTop: 'auto', padding: '12px 20px' }}>
          {offlineMode && (
            <Tag color="orange" style={{ marginBottom: 8 }}>Offline mode</Tag>
          )}
          <Text style={{ color: '#8b93aa', fontSize: 12, display: 'block', marginBottom: 8 }}>
            {user?.full_name} ({user?.role})
          </Text>
          <Button block onClick={confirmLogout}>Log Out</Button>
        </div>
      </Sider>
      <Layout>
        <Content style={{ padding: 32 }}>
          <style>{`
            @keyframes viewFadeIn {
              from { opacity: 0; transform: translateY(10px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          {offlineMode && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="Working offline — Head Office is unreachable"
              description="Only attendance is available. Entries you log are saved on this PC and will sync automatically the next time you sign in while connected to Head Office."
            />
          )}
          <div key={activeView} style={{ animation: 'viewFadeIn 380ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
            {activeView === 'dashboard' && <DashboardView />}
            {activeView === 'caseDetail' && <CaseDetailView />}
            {activeView === 'signatureAttendance' && <SignatureAttendanceView />}
            {activeView === 'psir' && <PsirListView />}
            {activeView === 'recordsCheck' && <RecordsCheckView />}
            {activeView === 'finalReports' && <FinalReportListView />}
            {activeView === 'manageUsers' && <ManageUsersView />}
            {activeView === 'settings' && <SettingsView />}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
