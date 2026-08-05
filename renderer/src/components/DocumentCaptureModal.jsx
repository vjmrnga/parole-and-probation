import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Popconfirm, Space, Typography, Upload, message } from 'antd';
import { CameraOutlined, FileTextOutlined, ScanOutlined, UploadOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Generic "attach a copy of this document" modal used by DocumentChecklist.jsx.
// Three capture paths, same underlying idea as PhotoCapture.jsx's
// camera-vs-upload choice, plus a native scanner option:
//   - Scan Document: window.api.scanDocument() — talks to a physical
//     scanner via scanner/scannerBridge.js (see scanner-bridge/README.md).
//     Only offered when a scanner is actually detected.
//   - Use Camera: same getUserMedia + mirrored-canvas approach as
//     PhotoCapture.jsx, for offices without a scanner (or a quick snap of a
//     document page held up to the webcam).
//   - Upload File: accepts images or a PDF already produced by scanning
//     software elsewhere.
// All three converge on the same previewUrl/filename state, then a single
// Save button hands the result to onSave.
export default function DocumentCaptureModal({ open, title, onClose, onSave, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [scannerStatus, setScannerStatus] = useState({ connected: false, deviceName: null });
  const [scanning, setScanning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFilename, setPreviewFilename] = useState(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.api.getScannerStatus().then(setScannerStatus).catch(() => setScannerStatus({ connected: false, deviceName: null }));
  }, [open]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setPreviewUrl(null);
      setPreviewFilename(null);
      setPreviewIsPdf(false);
    }
  }, [open]);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setPreviewUrl(null);
      setCameraOn(true);
    } catch (err) {
      message.error(`Could not access the camera: ${err.message}`);
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.92));
    setPreviewFilename('camera-capture.jpg');
    setPreviewIsPdf(false);
    stopCamera();
  }

  async function scanFromDevice() {
    setScanning(true);
    try {
      const result = await window.api.scanDocument();
      if (!result.ok) throw new Error(result.error);
      const mimeType = result.mimeType || 'image/jpeg';
      setPreviewUrl(`data:${mimeType};base64,${result.imageBase64}`);
      setPreviewFilename('scan.jpg');
      setPreviewIsPdf(false);
    } catch (err) {
      message.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result);
      setPreviewFilename(file.name);
      setPreviewIsPdf(file.type === 'application/pdf');
    };
    reader.readAsDataURL(file);
    return false; // stop antd Upload from trying to auto-upload the file itself
  }

  function reset() {
    setPreviewUrl(null);
    setPreviewFilename(null);
    setPreviewIsPdf(false);
  }

  async function save() {
    if (!previewUrl) return;
    setSaving(true);
    try {
      await onSave(previewUrl, previewFilename);
      reset();
      onClose();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    stopCamera();
    reset();
    onClose();
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleCancel}
      footer={null}
      destroyOnClose
      width={560}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            border: '1px solid #c7cdd9', borderRadius: 6, background: '#000', width: '100%',
            aspectRatio: cameraOn || (previewUrl && !previewIsPdf) ? '4 / 3' : undefined,
            minHeight: cameraOn || (previewUrl && !previewIsPdf) ? undefined : 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 12,
          }}
        >
          {cameraOn ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : previewUrl && previewIsPdf ? (
            <div style={{ padding: 24, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <FileTextOutlined style={{ fontSize: 40 }} />
              <Text style={{ color: '#fff' }}>{previewFilename}</Text>
            </div>
          ) : previewUrl ? (
            <img src={previewUrl} alt="Document preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <Text style={{ color: '#8c8c8c', padding: 24 }}>Choose how to attach this document below</Text>
          )}
        </div>

        <Space wrap style={{ justifyContent: 'center' }}>
          {cameraOn ? (
            <>
              <Button type="primary" onClick={capture}>Capture</Button>
              <Button onClick={stopCamera}>Cancel</Button>
            </>
          ) : previewUrl ? (
            <>
              <Button onClick={reset} disabled={disabled}>Choose Again</Button>
              <Popconfirm title="Save this as the attached document?" onConfirm={save} disabled={disabled}>
                <Button type="primary" loading={saving} disabled={disabled}>Save Attachment</Button>
              </Popconfirm>
            </>
          ) : (
            <>
              <Button
                icon={<ScanOutlined />}
                onClick={scanFromDevice}
                loading={scanning}
                disabled={disabled || !scannerStatus.connected}
                title={scannerStatus.connected ? scannerStatus.deviceName : 'No scanner detected'}
              >
                Scan Document
              </Button>
              <Button icon={<CameraOutlined />} onClick={startCamera} disabled={disabled}>Use Camera</Button>
              <Upload accept="image/png,image/jpeg,image/webp,application/pdf" showUploadList={false} beforeUpload={handleFile} disabled={disabled}>
                <Button icon={<UploadOutlined />} disabled={disabled}>Upload File</Button>
              </Upload>
            </>
          )}
        </Space>
        {!scannerStatus.connected && !previewUrl && !cameraOn && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            No scanner detected — connect one or use the camera/upload options above.
          </Text>
        )}
      </div>
    </Modal>
  );
}
