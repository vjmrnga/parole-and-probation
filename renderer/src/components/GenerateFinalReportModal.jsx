import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Space, message } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import { FINAL_REPORT_CIVIL_STATUS_OPTIONS } from '../constants/finalReportOptions.js';
import { splitName } from '../utils/splitName.js';

// Maps psir_org_settings columns -> the Final Report Generator's own field
// ids (see renderer/public/final-report-generator/index.html). Reuses the
// same settings the PSIR Generator uses (GET /api/psir/settings) — both
// generators' letterhead/signatory fields carry the same ids, so there's no
// separate settings table for Final Reports. Only non-empty org values are
// applied, so an unconfigured office still gets the generator's own built-in
// defaults rather than blanks.
const ORG_FIELD_MAP = {
  br_region: 'brRegion', br_office: 'brOffice', br_addr: 'brAddr',
  br_tel: 'brTel', br_email: 'brEmail', br_web: 'brWeb',
  cppo_name: 'cppoName', cppo_title: 'cppoTitle',
  officer_title: 'officerTitle', sign_place: 'signPlace',
};

function buildPrefillPayload(probationer, orgSettings) {
  const base = probationer.file_report_profile ? { ...probationer.file_report_profile } : {};

  // Seeded from the probationer's own case record every time — not just the
  // first time — so these stay in sync even after file_report_profile has
  // started accumulating past generations of its own.
  const { lastName, firstName, middleName } = splitName(probationer.full_name);
  const seeded = {
    lastName, firstName, middleName,
    docketNo: probationer.docket_number || '',
    probAddr: probationer.address || '',
    grantJudgeName: probationer.judge || '',
    grantDate: probationer.date_of_order ? String(probationer.date_of_order).slice(0, 10) : '',
    birthday: probationer.birthdate ? String(probationer.birthdate).slice(0, 10) : '',
  };
  if (probationer.sex === 'Male' || probationer.sex === 'Female') seeded.sex = probationer.sex;
  if (probationer.marital_status) {
    if (FINAL_REPORT_CIVIL_STATUS_OPTIONS.includes(probationer.marital_status)) seeded.civilStatus = probationer.marital_status;
    else { seeded.civilStatus = '__other'; seeded.civilOther = probationer.marital_status; }
  }

  // file_report_profile (past generations) wins over the seed above when
  // both set the same field; office defaults win over everything.
  const fields = { ...seeded, ...(base.fields || {}) };
  Object.entries(ORG_FIELD_MAP).forEach(([col, id]) => {
    if (orgSettings && orgSettings[col]) fields[id] = orgSettings[col];
  });

  return { ...base, fields };
}

export default function GenerateFinalReportModal({ open, probationer, onClose, onGenerated }) {
  const { setAppView } = useApp();
  const iframeRef = useRef(null);
  const [orgSettings, setOrgSettings] = useState(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrgSettings(null);
    setIframeLoaded(false);
    setPrefilled(false);
    ApiClient.get('/psir/settings').then(setOrgSettings).catch(() => setOrgSettings({}));
  }, [open]);

  const prefillPayload = useMemo(() => {
    if (!probationer || !orgSettings) return null;
    return buildPrefillPayload(probationer, orgSettings);
  }, [probationer, orgSettings]);

  useEffect(() => {
    if (!open) return undefined;

    function handleMessage(ev) {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'finalReport:ready') {
        setIframeLoaded(true);
      } else if (msg.type === 'finalReport:generated') {
        handleGenerated(msg.payload);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, probationer]);

  useEffect(() => {
    if (!open || !iframeLoaded || !prefillPayload || prefilled) return;
    iframeRef.current.contentWindow.postMessage({ type: 'finalReport:prefill', payload: prefillPayload }, '*');
    setPrefilled(true);
  }, [open, iframeLoaded, prefillPayload, prefilled]);

  async function handleGenerated(payload) {
    if (!payload || !payload.base64) return;
    setSaving(true);
    try {
      await ApiClient.post('/file-reports', {
        probationerId: probationer.id,
        filename: payload.filename,
        base64: payload.base64,
        snapshot: payload.snapshot,
      });
      message.success('Final Report saved.');
      onGenerated?.();
      onClose();
      setAppView('finalReports');
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!probationer) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Generate Final Report — ${probationer.full_name}`}
      width="95%"
      centered
      styles={{ body: { height: '78vh', padding: 0 } }}
      footer={(
        <Space>
          <Button onClick={onClose}>Close</Button>
        </Space>
      )}
    >
      {saving && <div style={{ padding: '4px 16px', color: '#8b93aa', fontSize: 12 }}>Saving Final Report…</div>}
      <iframe
        ref={iframeRef}
        title="Final Report Generator"
        src="final-report-generator/index.html"
        style={{ width: '100%', height: '100%', border: 'none' }}
        onLoad={() => {
          // The generator posts "finalReport:ready" itself once its own
          // DOMContentLoaded init finishes — no action needed here.
        }}
      />
    </Modal>
  );
}
