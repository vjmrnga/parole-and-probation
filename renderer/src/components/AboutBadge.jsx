import { InfoCircleOutlined } from '@ant-design/icons';
import { Button, Popover, Typography } from 'antd';

const { Text } = Typography;

// Fixed to the bottom-right corner of the viewport so it stays visible across
// every screen, same pattern as ExitAppButton (top-right) — a small credit
// icon rather than a permanent banner.
export default function AboutBadge() {
  const content = (
    <div style={{ maxWidth: 220 }}>
      <p style={{ margin: 0 }}>
        Made by <Text strong>Vincent James A. Maranga</Text>
      </p>
      <p style={{ margin: 0 }}>
        <Text type="secondary">Intern, University of San Jose-Recoletos</Text>
      </p>
      <p style={{ margin: 0 }}>
        <Text type="secondary">2026</Text>
      </p>
    </div>
  );

  return (
    <Popover content={content} title="About this app" trigger="click" placement="topRight">
      <Button
        shape="circle"
        icon={<InfoCircleOutlined />}
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 999 }}
      />
    </Popover>
  );
}
