import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Space, message } from 'antd';
import { ApiClient } from '../api/apiClient.js';
import { useApp } from '../AppContext.jsx';
// Same 5-option list Case Information / New Case / the PSIR Generator use —
// the Final Report Generator's own <select id="civilStatus"> used to carry a
// 6th "Common-Law Relationship" option nothing else in the system could ever
// set; removed so all four tools agree ("Single w/ CLS" already covers that
// case).
import { CIVIL_STATUS_OPTIONS } from '../constants/psirOptions.js';
import { composeName } from '../utils/composeName.js';

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

// Case Information's Court & Case Data / Sentencing Judge & Court (see
// CaseProfileFields.jsx) live in psir_profile.fields, not on file_report_profile
// or a probationers column — so unlike judgeName/docketNo/etc. below, they'd
// otherwise never reach the Final Report Generator's own Transmittal Letter
// Court fields or Judge Granting Probation fields at all, leaving the officer
// to retype court info Case Information already has. Sentencing Judge & Court
// is the more accurate source (it's literally the court that granted
// probation); Court & Case Data is the fallback for cases that predate that
// field or never diverged from it.
// [psir_profile.fields key (sentencing), same key (Court & Case Data),
//  Transmittal Letter field id, Judge Granting Probation field id]
const COURT_FIELD_MIRROR = [
  ['sentCourtType', 'courtType', 'courtType', 'grantCourtType'],
  ['sentBranchNo', 'courtBranchNo', 'courtBranchNo', 'grantBranchNo'],
  ['sentCourtCity', 'courtCity', 'courtCity', 'grantCity'],
  ['sentCourtProv', 'courtProvince', 'courtProv', 'grantProv'],
];
// The Transmittal Letter / Judge Granting Probation <select>s only render a
// fixed option list each (see index.html) — no "Others…" + free-text fallback
// the way PSIR's equivalents have. Setting a value outside that list would
// silently leave the <select> on whatever it already had, so only mirror a
// court type into the ones that actually offer it.
const COURT_TYPE_SELECT_OPTIONS = {
  courtType: ['RTC', 'MTC', 'MTCC'],
  grantCourtType: ['RTC', 'MTC', 'MTCC', 'MCTC'],
};

// Converts one Case Information "Convicted Of" row (see CaseProfileFields.jsx
// / buildPsirProfilePatch.js — {text, date}, e.g. "Sec. 5, Art. II of R.A.
// 9165") into one Final Report offense-builder row (see addOffenseRow() in
// app-logic.js — {custom}), carried over verbatim as free-typed text — with
// the same "Viol. of " prefix composeOffense() in the PSIR Generator adds at
// print time (see renderer/public/psir-generator/app-logic.js) prepended
// here, so the two generators print the identical offense line for the same
// conviction.
function offenseRowFromConvicted(o) {
  const text = ((o && o.text) || '').trim();
  return { custom: text ? `Viol. of ${text}` : '' };
}

// Case Information's Supervision Period (see CaseProfileFields.jsx) is one
// "years-months-days" string, e.g. "1-0-0" — split into the Final Report
// Generator's own separate periodYears/periodMonths/periodDays fields. Same
// parsing rule as CaseProfileFields.jsx's own parseSupervisionPeriod(): any
// piece that isn't a plain integer makes the whole period unparseable, so
// the fields are just left unseeded rather than seeded with garbage.
function parseSupervisionPeriod(period) {
  if (typeof period !== 'string') return null;
  const parts = period.split('-').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [years, months, days] = parts;
  return { years, months, days };
}

function buildPrefillPayload(probationer, orgSettings) {
  const base = probationer.file_report_profile ? { ...probationer.file_report_profile } : {};
  const psirFields = (probationer.psir_profile && probationer.psir_profile.fields) || {};
  // Same "Convicted Of" list the PSIR Generator prefills from (see
  // buildPsirProfilePatch.js / GeneratePsirModal.jsx) — Case Information only
  // has the one list, so the Final Report's own Offense(s) of Which
  // Convicted builder is seeded from it too, rather than starting blank.
  const convictedOffenses = (probationer.psir_profile && probationer.psir_profile.offenses && probationer.psir_profile.offenses.convicted) || [];

  // Seeded from the probationer's own case record every time — not just the
  // first time — so these stay in sync even after file_report_profile has
  // started accumulating past generations of its own.
  const seeded = {
    lastName: probationer.last_name || '',
    firstName: probationer.first_name || '',
    middleName: probationer.middle_name || '',
    docketNo: probationer.docket_number || '',
    probAddr: probationer.address || '',
    alias: probationer.alias || '',
    // "Presiding Judge" (Transmittal Letter) and "Judge Granting Probation"
    // are both the judge who actually issued the probation order — i.e. Case
    // Information's Sentencing Judge, falling back to the plain Judge field
    // for cases that never got a Sentencing entry of their own.
    judgeName: psirFields.sentJudge || probationer.judge || '',
    grantJudgeName: psirFields.sentJudge || probationer.judge || '',
    // "Date of Probation Order" (Transmittal Letter) and "Date Probation
    // Granted" (Judge Granting Probation) are both the date the court issued
    // the order — same source, same as PSIR's own orderDate (see
    // GeneratePsirModal.jsx). "Date Order Received by Office" is the
    // separate date Case Information tracks for when that order reached
    // this office.
    orderDate: probationer.date_of_order ? String(probationer.date_of_order).slice(0, 10) : '',
    receivedDate: probationer.date_order_received ? String(probationer.date_order_received).slice(0, 10) : '',
    grantDate: probationer.date_of_order ? String(probationer.date_of_order).slice(0, 10) : '',
    birthday: probationer.birthdate ? String(probationer.birthdate).slice(0, 10) : '',
  };
  if (probationer.sex === 'Male' || probationer.sex === 'Female') seeded.sex = probationer.sex;
  if (probationer.marital_status) {
    if (CIVIL_STATUS_OPTIONS.includes(probationer.marital_status)) seeded.civilStatus = probationer.marital_status;
    else { seeded.civilStatus = '__other'; seeded.civilOther = probationer.marital_status; }
  }
  const supervisionPeriod = parseSupervisionPeriod(probationer.supervision_period);
  if (supervisionPeriod) {
    seeded.periodYears = supervisionPeriod.years;
    seeded.periodMonths = supervisionPeriod.months;
    seeded.periodDays = supervisionPeriod.days;
  }
  COURT_FIELD_MIRROR.forEach(([sentKey, courtKey, letterDest, grantDest]) => {
    const v = psirFields[sentKey] || psirFields[courtKey];
    if (!v) return;
    if (!(letterDest in COURT_TYPE_SELECT_OPTIONS) || COURT_TYPE_SELECT_OPTIONS[letterDest].includes(v)) seeded[letterDest] = v;
    if (!(grantDest in COURT_TYPE_SELECT_OPTIONS) || COURT_TYPE_SELECT_OPTIONS[grantDest].includes(v)) seeded[grantDest] = v;
  });

  // file_report_profile (past generations) wins over the seed above when
  // both set the same field; office defaults win over everything. Blank
  // values are dropped from that override — Case Information's court fields
  // above can be genuinely absent, and a blank there shouldn't blank out the
  // generator's own defaults (courtProv/grantProv default to "Cebu").
  const nonEmptyReportFields = Object.fromEntries(
    Object.entries(base.fields || {}).filter(([, v]) => v !== '' && v != null)
  );
  const fields = { ...seeded, ...nonEmptyReportFields };
  Object.entries(ORG_FIELD_MAP).forEach(([col, id]) => {
    if (orgSettings && orgSettings[col]) fields[id] = orgSettings[col];
  });

  // Criminal Case No(s). and Offense(s) of Which Convicted are their own
  // row-builders, not part of `fields` (see addCaseRow()/addOffenseRow() in
  // app-logic.js) — applyPrefill() there only replaces the generator's
  // default blank row when it's given a non-empty array, so these are seeded
  // from Case Information the same way `fields` is above: a past Final
  // Report generation's own rows (file_report_profile.cases/.offenses) win
  // when present, otherwise Case Information's case number / convicted
  // offenses are used.
  const cases = (Array.isArray(base.cases) && base.cases.length)
    ? base.cases
    : (probationer.case_number ? [probationer.case_number] : []);
  const offenses = (Array.isArray(base.offenses) && base.offenses.length)
    ? base.offenses
    : convictedOffenses.filter((o) => o && o.text && o.text.trim()).map(offenseRowFromConvicted);

  return { ...base, fields, cases, offenses };
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
      title={`Generate Final Report — ${composeName(probationer)}`}
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
