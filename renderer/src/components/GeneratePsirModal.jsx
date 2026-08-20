import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Space, message } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
import {
  CIVIL_STATUS_OPTIONS as CIVIL_OPTIONS, RELIGION_OPTIONS, NATIONALITY_OPTIONS, GENDER_PREF_OPTIONS,
  COURT_TYPE_OPTIONS,
} from '../constants/psirOptions.js';
import { composeName } from '../utils/composeName.js';

// The generator's <select id="religion">/etc. only render one of their
// fixed <option> values or "__other" (with the free text in a companion
// *Other field) — so a value coming from Case Detail's plain free-text
// input (e.g. "Baptist") needs to be routed through that pair or the
// <select> would just silently reset to blank.
function applySelectOther(fields, key, options) {
  const v = fields[key];
  if (v && v !== '__other' && !options.includes(v)) {
    fields[key + 'Other'] = v;
    fields[key] = '__other';
  }
}

// Maps psir_org_settings columns -> the PSIR Generator's own field ids (see
// renderer/public/psir-generator/index.html) — only non-empty org values are
// applied, so an unconfigured office still gets the generator's own
// built-in office defaults rather than blanks.
const ORG_FIELD_MAP = {
  br_region: 'brRegion', br_region2: 'brRegion2', br_office: 'brOffice', br_addr: 'brAddr',
  br_tel: 'brTel', br_email: 'brEmail', br_web: 'brWeb', office_name: 'officeName',
  office_address: 'officeAddress', cppo_name: 'cppoName', cppo_title: 'cppoTitle',
  officer_rank: 'officerRank', officer_name: 'officerName', officer_title: 'officerTitle',
  sign_place: 'signPlace',
};

function buildPrefillPayload(probationer, orgSettings) {
  const base = probationer.psir_profile ? { ...probationer.psir_profile } : {};

  // Seeded from the probationer's own case record every time — not just the
  // first time — so these stay in sync even after psir_profile has started
  // accumulating Case Detail / PSIR Generator edits of its own.
  const seeded = {
    lastName: probationer.last_name || '',
    firstName: probationer.first_name || '',
    middleName: probationer.middle_name || '',
    docketNo: probationer.docket_number || '',
    criminalCaseNo: probationer.case_number || '',
    alias: probationer.alias || '',
    judgeName: probationer.judge || '',
    presentAddress: probationer.address || '',
    orderDate: probationer.date_of_order ? String(probationer.date_of_order).slice(0, 10) : '',
    birthday: probationer.birthdate ? String(probationer.birthdate).slice(0, 10) : '',
  };
  if (probationer.sex === 'Male' || probationer.sex === 'Female') seeded.sex = probationer.sex;
  if (probationer.marital_status) {
    if (CIVIL_OPTIONS.includes(probationer.marital_status)) seeded.civilStatus = probationer.marital_status;
    else { seeded.civilStatus = '__other'; seeded.civilOther = probationer.marital_status; }
  }

  // psir_profile (Case Detail edits + past generations) wins over the seed
  // above when both set the same field; office defaults win over everything.
  // Blank values are dropped from that override, same as the org-settings
  // merge below — Case Information writes every field on save, even ones the
  // officer never touched (e.g. Sentencing Court City/Province), and an
  // empty string there would otherwise blank out the generator's own
  // sensible built-in default (e.g. "Talisay"/"Cebu") instead of leaving it.
  const nonEmptyProfileFields = Object.fromEntries(
    Object.entries(base.fields || {}).filter(([, v]) => v !== '' && v != null)
  );
  const fields = { ...seeded, ...nonEmptyProfileFields };
  // Case Information's Court field is named "courtProvince" (see
  // CaseProfileFields.jsx); the generator's Transmittal Letter section uses
  // "courtProv" for the same input.
  if (fields.courtProvince !== undefined) fields.courtProv = fields.courtProvince;
  Object.entries(ORG_FIELD_MAP).forEach(([col, id]) => {
    if (orgSettings && orgSettings[col]) fields[id] = orgSettings[col];
  });
  applySelectOther(fields, 'religion', RELIGION_OPTIONS);
  applySelectOther(fields, 'nationality', NATIONALITY_OPTIONS);
  applySelectOther(fields, 'genderPref', GENDER_PREF_OPTIONS);
  // Court Type / Sentencing Court Type are free-typed on Case Information
  // (see CaseProfileFields.jsx) but the generator's own <select id="courtType">
  // / <select id="sentCourtType"> only render one of their fixed options or
  // "__other".
  applySelectOther(fields, 'courtType', COURT_TYPE_OPTIONS);
  applySelectOther(fields, 'sentCourtType', COURT_TYPE_OPTIONS);

  return { ...base, fields };
}

export default function GeneratePsirModal({ open, probationer, onClose, onGenerated }) {
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
      if (msg.type === 'psir:ready') {
        setIframeLoaded(true);
      } else if (msg.type === 'psir:generated') {
        handleGenerated(msg.payload);
      } else if (msg.type === 'psir:error') {
        message.error(msg.payload);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, probationer]);

  useEffect(() => {
    if (!open || !iframeLoaded || !prefillPayload || prefilled) return;
    iframeRef.current.contentWindow.postMessage({ type: 'psir:prefill', payload: prefillPayload }, '*');
    setPrefilled(true);
  }, [open, iframeLoaded, prefillPayload, prefilled]);

  async function handleGenerated(payload) {
    if (!payload || !payload.base64) return;
    setSaving(true);
    try {
      const recommendationType = (payload.snapshot && payload.snapshot.fields && payload.snapshot.fields.recoVerdict) || 'GRANTED';
      await ApiClient.post('/psir', {
        probationerId: probationer.id,
        filename: payload.filename,
        base64: payload.base64,
        recommendationType,
        snapshot: payload.snapshot,
      });
      message.success('PSIR saved.');
      onGenerated?.();
      onClose();
      setAppView('psir');
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
      title={`Generate PSIR — ${composeName(probationer)}`}
      width="95%"
      centered
      styles={{ body: { height: '78vh', padding: 0 } }}
      footer={(
        <Space>
          <Button onClick={onClose}>Close</Button>
        </Space>
      )}
    >
      {saving && <div style={{ padding: '4px 16px', color: '#8b93aa', fontSize: 12 }}>Saving PSIR…</div>}
      <iframe
        ref={iframeRef}
        title="PSIR Generator"
        src="psir-generator/index.html"
        style={{ width: '100%', height: '100%', border: 'none' }}
        onLoad={() => {
          // The generator posts "psir:ready" itself once its own
          // DOMContentLoaded init finishes — no action needed here.
        }}
      />
    </Modal>
  );
}
