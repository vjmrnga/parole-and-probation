import { Card, Col, Row, Typography } from 'antd';
import BrandHeader from '../components/BrandHeader.jsx';
import { useApp } from '../AppContext.jsx';

const { Text } = Typography;

export default function ChooseModeScreen() {
  const { goHeadOfficeSetup, setScreen } = useApp();

  async function chooseHeadOffice() {
    await window.api.setMode('head-office');
    goHeadOfficeSetup();
  }

  async function chooseBranchOffice() {
    await window.api.setMode('branch-office');
    setScreen('boSetup');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: 640, maxWidth: '100%' }}>
        <BrandHeader title="Choose Mode" />
        <Text type="secondary">This decision is per-PC and can be changed later from Settings (Ctrl+S).</Text>
        <Row gutter={16} style={{ marginTop: 20 }}>
          <Col span={12}>
            <Card hoverable onClick={chooseHeadOffice}>
              <Text strong style={{ fontSize: 16 }}>Head Office</Text>
              <p style={{ marginTop: 8, color: '#555' }}>
                This PC hosts the database and API server for the office. Use this on the one always-on office PC.
              </p>
            </Card>
          </Col>
          <Col span={12}>
            <Card hoverable onClick={chooseBranchOffice}>
              <Text strong style={{ fontSize: 16 }}>Branch Office</Text>
              <p style={{ marginTop: 8, color: '#555' }}>
                This PC connects to a Head Office over the LAN. Use this on every other officer's PC.
              </p>
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
