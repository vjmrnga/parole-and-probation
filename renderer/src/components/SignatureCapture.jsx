import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Image, Space, Typography } from 'antd';
import SignaturePad from 'signature_pad';

const { Text } = Typography;

// signature_pad is an imperative canvas library, not a React component, so
// this wraps it with refs/effects and exposes get/clear/isEmpty/loadDataUrl
// to the parent via useImperativeHandle — same shape the old vanilla
// src/signature.js exposed, just as a component instead of a factory
// function. Also wires the same Wacom pad IPC calls
// (getPadStatus/captureFromPad/onPadStatusChanged) the reference project used.
const SignatureCapture = forwardRef(function SignatureCapture({ extraActions, existingSignature }, ref) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [padStatus, setPadStatus] = useState({ connected: false, model: null });

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas || !padRef.current) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = padRef.current.toData();
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    padRef.current.clear();
    if (data && data.length) padRef.current.fromData(data);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    padRef.current = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' });

    window.addEventListener('resize', resizeCanvas);
    const t = setTimeout(resizeCanvas, 0); // canvas needs to be visible/sized first

    window.api.getPadStatus().then(setPadStatus).catch(() => setPadStatus({ connected: false, model: null }));
    window.api.onPadStatusChanged(setPadStatus);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      clearTimeout(t);
    };
  }, []);

  // The preview column appears/disappears based on existingSignature, which
  // changes the canvas's rendered width — resync the drawing buffer to match.
  useEffect(() => {
    const t = setTimeout(resizeCanvas, 0);
    return () => clearTimeout(t);
  }, [existingSignature]);

  useImperativeHandle(ref, () => ({
    getDataUrl: () => padRef.current.toDataURL('image/png'),
    clear: () => padRef.current.clear(),
    isEmpty: () => padRef.current.isEmpty(),
    loadDataUrl: (dataUrl) => padRef.current.fromDataURL(dataUrl),
  }));

  async function captureFromPad() {
    const result = await window.api.captureFromPad({ signerName: '', reason: 'Case signature' });
    if (result.ok && result.pngBase64) {
      const dataUrl = result.pngBase64.startsWith('data:') ? result.pngBase64 : `data:image/png;base64,${result.pngBase64}`;
      await padRef.current.fromDataURL(dataUrl);
    } else if (!result.ok) {
      alert(`Pad capture failed: ${result.error}`);
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
          background: padStatus.connected ? '#27ae60' : '#c0392b',
        }} />
        <Text type="secondary">
          {padStatus.connected ? `Pad connected (${padStatus.model || 'unknown model'})` : 'No pad detected — sign below with mouse/touch'}
        </Text>
      </Space>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, width: '100%' }}>
        {existingSignature && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>On file</Text>
            <Image
              src={existingSignature}
              alt="Signature on file"
              width="100%"
              style={{ height: 200, objectFit: 'contain', border: '1px solid #d0d3d9', borderRadius: 6, background: '#fff' }}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {existingSignature && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>New signature</Text>
          )}
          <div style={{ border: '1px solid #c7cdd9', borderRadius: 6, background: '#fff', height: 200 }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>
      </div>
      <Space wrap style={{ width: '100%', justifyContent: 'center' }}>
        <Button size="large" onClick={() => padRef.current.clear()}>Clear</Button>
        <Button size="large" disabled={!padStatus.connected} onClick={captureFromPad}>Capture from Wacom Pad</Button>
        {extraActions}
      </Space>
    </div>
  );
});

export default SignatureCapture;
