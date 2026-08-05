import { Typography } from 'antd';
import logo from '../assets/logo.png';

const { Title } = Typography;

export default function BrandHeader({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
      <img src={logo} alt="Parole and Probation Administration seal" style={{ width: 48, height: 48, objectFit: 'contain' }} />
      <Title level={3} style={{ margin: 0 }}>{title}</Title>
    </div>
  );
}
