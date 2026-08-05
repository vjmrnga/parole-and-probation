import { Layout, Menu, Button, Typography, Modal } from 'antd';
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
  const { user, appView, setAppView, logout } = useApp();
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

  // Settings is deliberately not a menu item — Ctrl+S only (see App.jsx).
  const menuItems = [
    { key: 'dashboard', label: 'Probationers' },
    { key: 'signatureAttendance', label: 'Signature & Attendance' },
    { key: 'psir', label: 'PSIR Reports' },
    { key: 'recordsCheck', label: 'Records Check' },
    { key: 'finalReports', label: 'Final Reports' },
    ...(isAdmin ? [{ key: 'manageUsers', label: 'Manage Users' }] : []),
  ];

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
          selectedKeys={[appView === 'caseDetail' ? 'dashboard' : appView === 'settings' ? '' : appView]}
          items={menuItems}
          onClick={({ key }) => setAppView(key)}
        />
        <div style={{ marginTop: 'auto', padding: '12px 20px' }}>
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
          <div key={appView} style={{ animation: 'viewFadeIn 380ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
            {appView === 'dashboard' && <DashboardView />}
            {appView === 'caseDetail' && <CaseDetailView />}
            {appView === 'signatureAttendance' && <SignatureAttendanceView />}
            {appView === 'psir' && <PsirListView />}
            {appView === 'recordsCheck' && <RecordsCheckView />}
            {appView === 'finalReports' && <FinalReportListView />}
            {appView === 'manageUsers' && <ManageUsersView />}
            {appView === 'settings' && <SettingsView />}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
