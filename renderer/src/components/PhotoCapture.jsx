import { useEffect, useRef, useState } from 'react';
import { Button, Image, message, Popconfirm, Space, Typography, Upload } from 'antd';
import { CameraOutlined, UploadOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Companion to SignatureCapture.jsx for the reference photo on file.
// Primary path is a live webcam capture (getUserMedia — Electron's main
// process already grants the 'media' permission request, see main.js's
// setPermissionRequestHandler) so the officer can take the photo right
// there instead of needing a pre-existing image file. A plain file upload
// is kept as a fallback for machines with no camera or if the permission
// prompt is denied. Same two-step "preview, then explicitly confirm" save
// pattern SignatureCapture uses for the reference signature.
export default function PhotoCapture({ existingPhoto, onSave, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => stopCamera(), []); // release the camera if the view is left mid-capture

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
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
    const ctx = canvas.getContext('2d');
    // Mirror the captured frame to match the mirrored live preview — without
    // this, the saved photo comes out flipped relative to what was just on
    // screen while framing the shot, which reads as wrong/inverted.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.92));
    stopCamera();
  }

  function retake() {
    setPreviewUrl(null);
    startCamera();
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result);
    reader.readAsDataURL(file);
    return false; // stop antd Upload from trying to auto-upload the file itself
  }

  async function save() {
    if (!previewUrl) return;
    setSaving(true);
    try {
      await onSave(previewUrl);
      setPreviewUrl(null);
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
        {existingPhoto && (
          <div style={{ width: 260 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>On file</Text>
            <Image
              src={existingPhoto}
              alt="Photo on file"
              width="100%"
              style={{ aspectRatio: '4 / 3', objectFit: 'contain', border: '1px solid #d0d3d9', borderRadius: 6, background: '#fff' }}
            />
          </div>
        )}
        <div style={{ width: 260 }}>
          {existingPhoto && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>New photo</Text>
          )}
          <div
            style={{
              border: '1px solid #c7cdd9', borderRadius: 6, background: '#000', width: '100%', aspectRatio: '4 / 3',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}
          >
            {cameraOn ? (
              // Mirrored so the live preview feels like a mirror instead of a
              // confusing flipped video feed — capture() mirrors the saved
              // frame the same way, so the photo matches what was on screen
              // while framing the shot instead of flipping back on save.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            ) : previewUrl ? (
              <img src={previewUrl} alt="New photo preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <Text style={{ color: '#8c8c8c' }}>{existingPhoto ? 'No new photo yet' : 'No photo on file yet'}</Text>
            )}
          </div>
        </div>
      </div>
      <Space wrap style={{ width: '100%', justifyContent: 'center' }}>
        {cameraOn ? (
          <>
            <Button type="primary" size="large" onClick={capture}>Capture</Button>
            <Button size="large" onClick={stopCamera}>Cancel</Button>
          </>
        ) : previewUrl ? (
          <>
            <Button size="large" onClick={retake} disabled={disabled}>Retake</Button>
            <Popconfirm title="Save this as the reference photo on file?" onConfirm={save} disabled={disabled}>
              <Button type="primary" size="large" loading={saving} disabled={disabled}>Save Photo</Button>
            </Popconfirm>
          </>
        ) : (
          <>
            <Button type="primary" size="large" icon={<CameraOutlined />} onClick={startCamera} disabled={disabled}>Use Camera</Button>
            <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={handleFile} disabled={disabled}>
              <Button size="large" icon={<UploadOutlined />} disabled={disabled}>Upload Instead</Button>
            </Upload>
          </>
        )}
      </Space>
    </div>
  );
}
