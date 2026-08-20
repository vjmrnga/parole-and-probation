import { useEffect, useRef, useState } from 'react';
import { Button, Image, Slider, message, Popconfirm, Space, Typography, Upload } from 'antd';
import { CameraOutlined, MinusOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Preview/crop frame size in CSS px — matches the fixed `width: 260` wrapper
// and the `4 / 3` aspect-ratio box below, so the zoom/pan math (which needs
// concrete pixel dimensions) lines up with what's actually on screen without
// having to measure the DOM.
const FRAME_W = 260;
const FRAME_H = (FRAME_W * 3) / 4;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
// Output resolution for the cropped photo — comfortably above the PSIR photo
// slot's 620x624 (see psirPhoto.js) so it still looks sharp once fit into
// that frame, without ballooning the saved data URL.
const OUTPUT_W = 900;
const OUTPUT_H = 675;

// Companion to SignatureCapture.jsx for the reference photo on file.
// Primary path is a live webcam capture (getUserMedia — Electron's main
// process already grants the 'media' permission request, see main.js's
// setPermissionRequestHandler) so the officer can take the photo right
// there instead of needing a pre-existing image file. A plain file upload
// is kept as a fallback for machines with no camera or if the permission
// prompt is denied. Same two-step "preview, then explicitly confirm" save
// pattern SignatureCapture uses for the reference signature.
//
// Whichever source the preview came from, the officer can zoom/drag it
// within the frame before saving — a phone photo or a webcam grab rarely
// frames the face the same way the 4:3 slot wants it, so this lets them
// recompose instead of being stuck with whatever the source image cropped
// to. clampPan() keeps the image covering the frame at all times so the
// crop can never show empty space.
function clampPan(pan, zoom, naturalSize) {
  if (!naturalSize) return { x: 0, y: 0 };
  const baseScale = Math.max(FRAME_W / naturalSize.w, FRAME_H / naturalSize.h);
  const dispW = naturalSize.w * baseScale * zoom;
  const dispH = naturalSize.h * baseScale * zoom;
  const maxX = Math.max(0, (dispW - FRAME_W) / 2);
  const maxY = Math.max(0, (dispH - FRAME_H) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export default function PhotoCapture({ existingPhoto, onSave, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const dragRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [naturalSize, setNaturalSize] = useState(null); // { w, h } of previewUrl, once known
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => stopCamera(), []); // release the camera if the view is left mid-capture

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  function resetAdjust() {
    setNaturalSize(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setPreviewUrl(null);
      resetAdjust();
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
    resetAdjust();
    setNaturalSize({ w: canvas.width, h: canvas.height });
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.92));
    stopCamera();
  }

  function retake() {
    setPreviewUrl(null);
    resetAdjust();
    startCamera();
  }

  function handleFile(file) {
    resetAdjust();
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result);
    reader.readAsDataURL(file);
    return false; // stop antd Upload from trying to auto-upload the file itself
  }

  function onZoomChange(z) {
    setZoom(z);
    setPan((p) => clampPan(p, z, naturalSize));
  }

  function onPointerDown(e) {
    if (!naturalSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy }, zoom, naturalSize));
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  // Renders the current zoom/pan framing onto a fixed-size canvas, so the
  // saved photo is exactly what was visible in the crop frame rather than
  // the untouched source image.
  function renderCrop() {
    return new Promise((resolve, reject) => {
      if (!naturalSize) {
        resolve(previewUrl);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        const baseScale = Math.max(FRAME_W / naturalSize.w, FRAME_H / naturalSize.h);
        const displayScale = baseScale * zoom;
        const dispW = naturalSize.w * displayScale;
        const dispH = naturalSize.h * displayScale;
        const left = (FRAME_W - dispW) / 2 + pan.x;
        const top = (FRAME_H - dispH) / 2 + pan.y;
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_W;
        canvas.height = OUTPUT_H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          -left / displayScale, -top / displayScale, FRAME_W / displayScale, FRAME_H / displayScale,
          0, 0, OUTPUT_W, OUTPUT_H,
        );
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error('Could not process that image.'));
      img.src = previewUrl;
    });
  }

  async function save() {
    if (!previewUrl) return;
    setSaving(true);
    try {
      const finalUrl = await renderCrop();
      await onSave(finalUrl);
      setPreviewUrl(null);
      resetAdjust();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const baseScale = naturalSize ? Math.max(FRAME_W / naturalSize.w, FRAME_H / naturalSize.h) : 0;
  const dispW = naturalSize ? naturalSize.w * baseScale * zoom : 0;
  const dispH = naturalSize ? naturalSize.h * baseScale * zoom : 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
        {existingPhoto && (
          <div style={{ width: 260 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>On file (click to zoom)</Text>
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
              position: 'relative',
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
              <img
                src={previewUrl}
                alt="New photo preview"
                draggable={false}
                onLoad={(e) => {
                  if (!naturalSize) setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                  position: 'absolute', left: '50%', top: '50%',
                  width: naturalSize ? dispW : '100%', height: naturalSize ? dispH : '100%',
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                  objectFit: naturalSize ? 'fill' : 'contain',
                  touchAction: 'none', userSelect: 'none',
                  cursor: naturalSize ? (dragging ? 'grabbing' : 'grab') : 'default',
                }}
              />
            ) : (
              <Text style={{ color: '#8c8c8c' }}>{existingPhoto ? 'No new photo yet' : 'No photo on file yet'}</Text>
            )}
          </div>
          {previewUrl && !cameraOn && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <MinusOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
              <Slider
                style={{ flex: 1 }}
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={onZoomChange}
                disabled={!naturalSize || disabled}
                tooltip={{ formatter: (v) => `${v.toFixed(1)}x` }}
              />
              <PlusOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
            </div>
          )}
        </div>
      </div>
      {previewUrl && !cameraOn && (
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12, marginBottom: 6 }}>
          Drag the photo to reposition it, use the slider to zoom.
        </Text>
      )}
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
