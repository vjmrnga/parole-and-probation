import { useRef, useState } from 'react';
import dayjs from 'dayjs';
import { CloseOutlined } from '@ant-design/icons';
import {
  AutoComplete, Button, Checkbox, Col, Collapse, DatePicker, Divider, Form, Input, InputNumber,
  Radio, Row, Select, Table, Typography,
} from 'antd';
import {
  CIVIL_STATUS_OPTIONS, COURT_TYPE_OPTIONS, GENDER_PREF_OPTIONS, NATIONALITY_OPTIONS,
  RELIGION_OPTIONS, SOCIO_ECONOMIC_GROUPS,
} from '../constants/psirOptions.js';
import { composeAddress } from '../utils/composeAddress.js';
import { composeCourt } from '../utils/composeCourt.js';
import { composeSentence } from '../utils/composeSentence.js';
import { smartTitleCase } from '../utils/smartTitleCase.js';

const { Text } = Typography;

function toAutoCompleteOptions(values) {
  return values.map((v) => ({ value: v }));
}

// Present address fields are named address{HouseNo,Street,...}, composing
// into "address"; permanent address fields are named
// permanentAddress{HouseNo,Street,...}, composing into "permanentAddress" —
// same shape, different prefix, so one set of helpers (below) drives both
// blocks.
function addressPartFields(prefix) {
  return [`${prefix}HouseNo`, `${prefix}Street`, `${prefix}Purok`, `${prefix}Barangay`, `${prefix}City`, `${prefix}Province`];
}

// The full case profile — Identifying Data, Court & Case Data, Criminal
// History, Supervision, Socio-Economic Background — as one set of Form
// fields. Rendered as *children* of a caller-owned <Form>, so the same field
// list/order/defaults are shared by the New Case modal, Edit Case modal, and
// the Case Information tab (see DashboardView.jsx / CaseDetailView.jsx) —
// the one place this data's shape is defined.
export default function CaseProfileFields({
  form,
  enums,
  officers = [],
  isAdmin = false,
  canEdit = true,
  priorRecords,
  setPriorRecords,
  docketDisabled = false,
  assignedOfficerField = 'form',
  reassignTo,
  setReassignTo,
  photoSlot = null,
  collapseExtras = false,
}) {
  const custodialStatus = Form.useWatch('custodialStatus', form);
  // Live "Prints as" preview under Sentence Details — same wording
  // composeSentence() in the PSIR Generator prints (see composeSentence.js).
  const sentencePreview = composeSentence(Form.useWatch('sentences', form));
  // Address/Permanent Address/Court Branch are consolidated fields — they
  // still hold real, saved values (see the hidden Form.Items below), but are
  // shown as a live text line instead of a boxed input the officer could
  // mistake for directly editable.
  const addressPreview = Form.useWatch('address', form);
  const permanentAddressPreview = Form.useWatch('permanentAddress', form);
  const courtBranchPreview = Form.useWatch('courtBranch', form);
  // "Same as Present Address" — mirrors the present-address parts into the
  // permanent-address fields (and keeps mirroring as the officer keeps
  // editing the present address) instead of making them retype it.
  const [permanentSameAsPresent, setPermanentSameAsPresent] = useState(false);

  // Auto-cases a field on blur (not every keystroke, so it doesn't fight the
  // cursor while typing) — shared by the two conventions below.
  function makeCapsHandler(fieldName, transform) {
    return () => {
      const v = form.getFieldValue(fieldName);
      if (typeof v !== 'string' || !v.trim()) return;
      const capped = transform(v);
      if (capped !== v) form.setFieldValue(fieldName, capped);
    };
  }
  // "juan dela cruz" / "JUAN DELA CRUZ" -> "Juan Dela Cruz". For name-ish
  // fields that read best in title case.
  function capitalizeOnBlur(fieldName) {
    return makeCapsHandler(fieldName, smartTitleCase);
  }
  // Last/First/Middle Name print in ALL CAPS on every generated document
  // (see CAPS_UPPER in renderer/public/psir-generator/app-logic.js) — matched
  // here too, rather than title-casing them, so what's on screen matches
  // what gets printed.
  function upperCaseOnBlur(fieldName) {
    return makeCapsHandler(fieldName, (v) => v.toUpperCase());
  }

  function recomposeAddress(prefix, overrides) {
    const [houseNoField, streetField, purokField, barangayField, cityField, provinceField] = addressPartFields(prefix);
    const current = form.getFieldsValue(addressPartFields(prefix));
    const merged = { ...current, ...overrides };
    form.setFieldValue(prefix, composeAddress({
      houseNo: merged[houseNoField],
      street: merged[streetField],
      purok: merged[purokField],
      barangay: merged[barangayField],
      city: merged[cityField],
      province: merged[provinceField],
    }));
    // Keep the permanent address mirroring the present address live, for as
    // long as "Same as Present Address" stays checked.
    if (prefix === 'address' && permanentSameAsPresent) copyPresentAddressToPermanent();
  }

  // Court -> Sentencing Court field name pairs — the case is normally
  // sentenced in the same court that received it, so editing one of the
  // Court & Case Data court fields (including the Judge) mirrors that same
  // value into its Sentencing Judge & Court counterpart below. Each
  // destination stays a normal editable input, so the officer can still
  // type over it for the (less common) cases where sentencing happened
  // elsewhere.
  const COURT_TO_SENTENCING_FIELD = {
    judge: 'sentJudge', courtType: 'sentCourtType', courtBranchNo: 'sentBranchNo', courtCity: 'sentCourtCity', courtProvince: 'sentCourtProv',
  };

  // Remembers the last value *this component* mirrored into each Sentencing
  // field, so mirrorToSentencing below can tell "still in sync, keep
  // mirroring" apart from "the officer has since typed their own value here"
  // — otherwise re-editing a Court & Case Data field (even just fixing a
  // typo) would silently blow away a deliberately different Sentencing entry.
  const lastMirroredRef = useRef({});

  // Mirrors a single field's current value into its Sentencing counterpart
  // (see COURT_TO_SENTENCING_FIELD above) — but only while that counterpart
  // is still blank or still holds exactly what was last mirrored into it. If
  // the officer has typed over it, this stops touching it.
  function mirrorToSentencing(field, value) {
    const destField = COURT_TO_SENTENCING_FIELD[field];
    const dest = form.getFieldValue(destField);
    if (dest && dest !== lastMirroredRef.current[field]) return;
    form.setFieldValue(destField, value);
    lastMirroredRef.current[field] = value;
  }

  // Title-cases the Judge field on blur, then re-mirrors the cleaned-up
  // value into Sentencing Judge so the two stay in sync even though the
  // live onChange mirror below copies the raw, not-yet-capitalized text.
  function judgeOnBlur() {
    capitalizeOnBlur('judge')();
    mirrorToSentencing('judge', form.getFieldValue('judge'));
  }

  function recomposeCourt(overrides) {
    const current = form.getFieldsValue(['courtType', 'courtBranchNo', 'courtCity', 'courtProvince']);
    const merged = { ...current, ...overrides };
    form.setFieldValue('courtBranch', composeCourt({
      type: merged.courtType,
      branchNo: merged.courtBranchNo,
      city: merged.courtCity,
      province: merged.courtProvince,
    }));
    Object.entries(overrides).forEach(([field, value]) => mirrorToSentencing(field, value));
  }

  // Supervision Period is a free-typed "Y-M-D" string (e.g. "1-0-0" = 1 year)
  // — parsed here so the End Date can be auto-computed from it + the Start
  // Date. Any piece that isn't a plain integer (blank, still mid-typing,
  // garbled) makes the whole period unparseable, so callers just skip the
  // auto-compute rather than act on a half-typed value.
  function parseSupervisionPeriod(period) {
    if (typeof period !== 'string') return null;
    const parts = period.split('-').map((p) => p.trim());
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    const [years, months, days] = parts.map(Number);
    return { years, months, days };
  }

  // Remembers the End Date value *this component* last auto-computed, so
  // recomputeSupervisionEndDate below can tell "still in sync, keep
  // auto-computing" apart from "the officer has since typed their own End
  // Date" — same trick as lastMirroredRef/mirrorToSentencing above, applied
  // to a single field instead of a set of them.
  const lastAutoEndDateRef = useRef(null);

  // Recomputes Supervision End Date from Supervision Period + Start Date,
  // but only while End Date is still blank or still holds exactly what was
  // last auto-computed here. Once the officer types their own End Date, this
  // stops touching it until Period or Start Date change again.
  function recomputeSupervisionEndDate(overrides) {
    const current = form.getFieldsValue(['supervisionPeriod', 'supervisionStartDate', 'supervisionEndDate']);
    const merged = { ...current, ...overrides };
    const period = parseSupervisionPeriod(merged.supervisionPeriod);
    if (!period || !merged.supervisionStartDate) return;
    const existingEnd = current.supervisionEndDate;
    if (existingEnd && !(lastAutoEndDateRef.current && existingEnd.isSame(lastAutoEndDateRef.current, 'day'))) return;
    const computed = merged.supervisionStartDate.add(period.years, 'year').add(period.months, 'month').add(period.days, 'day');
    form.setFieldValue('supervisionEndDate', computed);
    lastAutoEndDateRef.current = computed;
  }

  // Copies every present-address part (+ its consolidated value) onto the
  // permanent-address fields — used both when "Same as Present Address" is
  // first checked and to keep mirroring afterward (see recomposeAddress).
  function copyPresentAddressToPermanent() {
    const presentFields = addressPartFields('address');
    const permanentFields = addressPartFields('permanentAddress');
    const presentValues = form.getFieldsValue(presentFields);
    const mirrored = Object.fromEntries(permanentFields.map((field, i) => [field, presentValues[presentFields[i]]]));
    mirrored.permanentAddress = form.getFieldValue('address');
    form.setFieldsValue(mirrored);
  }

  // One House No./Street/Purok/Barangay/City/Province row, wired to
  // recompose the given prefix's consolidated field on every change. Shared
  // by the Present Address and Permanent Address blocks below.
  function addressFieldsRow(prefix, disabled = false) {
    const [houseNoField, streetField, purokField, barangayField, cityField, provinceField] = addressPartFields(prefix);
    return (
      <>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="House No." name={houseNoField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [houseNoField]: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Street / Sitio" name={streetField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [streetField]: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Purok" name={purokField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [purokField]: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Barangay" name={barangayField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [barangayField]: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="City / Municipality" name={cityField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [cityField]: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Province" name={provinceField}>
            <Input disabled={disabled} onChange={(e) => recomposeAddress(prefix, { [provinceField]: e.target.value })} />
          </Form.Item>
        </Col>
      </>
    );
  }

  // The Charged With / Convicted Of offense lists store each row's date as a
  // plain "YYYY-MM-DD" string (matched by fmtDate() in the legacy
  // psir-generator, which splits on "-"). getValueProps/normalize below let
  // the field itself stay that ISO string while the DatePicker displays and
  // accepts typed input as MM-DD-YYYY.
  const offenseDateFieldProps = {
    getValueProps: (value) => ({ value: value ? dayjs(value) : undefined }),
    normalize: (value) => (value ? value.format('YYYY-MM-DD') : ''),
  };

  // With a photo, the first row (Last/First/Middle Name) makes room for a
  // fourth cell so the photo lands top-right, in-grid, instead of a
  // dedicated column whose leftover height sits empty below it.
  const nameColSpan = photoSlot ? 6 : 8;

  const identifyingGrid = (
    <Row gutter={[24, 8]}>
      <Col xs={24} sm={12} md={nameColSpan}>
        <Form.Item label="Last Name" name="lastName" rules={[{ required: true, message: 'Last name is required' }]}><Input placeholder="e.g., DELA CRUZ" onBlur={upperCaseOnBlur('lastName')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={nameColSpan}>
        <Form.Item label="First Name" name="firstName" rules={[{ required: true, message: 'First name is required' }]}><Input placeholder="e.g., JUAN" onBlur={upperCaseOnBlur('firstName')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={nameColSpan}>
        <Form.Item label="Middle Name" name="middleName"><Input onBlur={upperCaseOnBlur('middleName')} /></Form.Item>
      </Col>
      {photoSlot && (
        <Col xs={24} sm={12} md={nameColSpan}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>{photoSlot}</div>
        </Col>
      )}
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Alias" name="alias"><Input onBlur={capitalizeOnBlur('alias')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="True Name" name="trueName" tooltip="Only if different from the name above"><Input onBlur={capitalizeOnBlur('trueName')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Birthdate" name="birthdate">
          <DatePicker
            style={{ width: '100%' }}
            format="MM/DD/YYYY"
            onChange={(d) => form.setFieldValue('age', d ? dayjs().diff(d, 'year') : null)}
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Age" name="age" tooltip="Auto-computed from birthdate">
          <InputNumber
            style={{ width: '100%' }}
            disabled
            formatter={(value) => (value === '' || value === null || value === undefined ? '' : `${value} years old`)}
            parser={(value) => (value ? value.replace(/\D/g, '') : '')}
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Place of Birth" name="placeOfBirth"><Input /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Sex" name="sex">
          <Select options={[{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]} allowClear />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Gender Preference" name="genderPref">
          <AutoComplete options={toAutoCompleteOptions(GENDER_PREF_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Marital Status" name="maritalStatus">
          <Select
            allowClear
            options={CIVIL_STATUS_OPTIONS.map((v) => ({ label: v, value: v }))}
            onChange={(v) => {
              // Mirrors the PSIR generator: Single ⇒ spouse "Not Applicable";
              // moving off Single clears an auto-filled "Not Applicable".
              if (v === 'Single') form.setFieldValue('spouse', 'Not Applicable');
              else if (form.getFieldValue('spouse') === 'Not Applicable') form.setFieldValue('spouse', '');
            }}
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Contact Number" name="contactNumber"><Input /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Occupation" name="occupation"><Input /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Educational Attainment" name="education"><Input /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Religion" name="religion">
          <AutoComplete options={toAutoCompleteOptions(RELIGION_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Nationality" name="nationality">
          <AutoComplete options={toAutoCompleteOptions(NATIONALITY_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Mother (Maiden Name)" name="motherName"><Input onBlur={capitalizeOnBlur('motherName')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Father" name="fatherName"><Input onBlur={capitalizeOnBlur('fatherName')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Spouse" name="spouse"><Input onBlur={capitalizeOnBlur('spouse')} /></Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Identifying / Remarkable Features" name="features"><Input /></Form.Item>
      </Col>
    </Row>
  );

  const addressGrid = (
    <>
      <Text strong style={{ display: 'block', margin: '8px 0 8px' }}>Present Address</Text>
      <Row gutter={[24, 8]}>
        {addressFieldsRow('address')}
      </Row>
      <Form.Item name="address" hidden><Input /></Form.Item>
      <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12, fontStyle: 'italic' }}>
        Prints as: {addressPreview || '(blank)'}
      </Text>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '16px 0 8px' }}>
        <Text strong>
          Permanent Address <Text type="secondary" style={{ fontWeight: 400 }}>(if different from Present Address)</Text>
        </Text>
        <Checkbox
          checked={permanentSameAsPresent}
          onChange={(e) => {
            setPermanentSameAsPresent(e.target.checked);
            if (e.target.checked) copyPresentAddressToPermanent();
          }}
        >
          Same as Present Address
        </Checkbox>
      </div>
      <Row gutter={[24, 8]}>
        {addressFieldsRow('permanentAddress', permanentSameAsPresent)}
      </Row>
      <Form.Item name="permanentAddress" hidden><Input /></Form.Item>
      <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12, fontStyle: 'italic' }}>
        Prints as: {permanentAddressPreview || '(blank)'}
      </Text>
    </>
  );

  const courtGrid = (
    <>
      <Row gutter={[24, 8]}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Judge" name="judge" tooltip="'Hon.' is added automatically wherever this prints">
            <Input placeholder="e.g., Joy Angelica P. Santos-Doctor" onChange={(e) => mirrorToSentencing('judge', e.target.value)} onBlur={judgeOnBlur} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Date of Order" name="dateOfOrder" tooltip="Date the court issued the order"><DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" /></Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Date of Order Received in Office" name="dateOrderReceived" tooltip="Date the order was received in this office"><DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" /></Form.Item>
        </Col>
      </Row>
      <Divider style={{ margin: '8px 0 16px' }} />
      <Row gutter={[24, 8]}>
        <Col xs={24} sm={12} md={6}>
          <Form.Item label="Court" name="courtType" tooltip="e.g., RTC, MTC, MTCC, MCTC, FC">
            <AutoComplete
              options={toAutoCompleteOptions(COURT_TYPE_OPTIONS)}
              filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
              onChange={(v) => recomposeCourt({ courtType: v })}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Form.Item label="Branch No." name="courtBranchNo">
            <Input placeholder="e.g., 66" onChange={(e) => recomposeCourt({ courtBranchNo: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Form.Item label="Court City" name="courtCity">
            <Input onChange={(e) => recomposeCourt({ courtCity: e.target.value })} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Form.Item label="Province" name="courtProvince">
            <Input onChange={(e) => recomposeCourt({ courtProvince: e.target.value })} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="courtBranch" hidden><Input /></Form.Item>
      <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12, fontStyle: 'italic' }}>
        Prints as: {courtBranchPreview || '(blank)'}
      </Text>
    </>
  );

  const criminalHistoryExtras = (
    <>
      <Text strong style={{ display: 'block', margin: '8px 0 8px' }}>
        Charged With
      </Text>
      <Form.List name="chargedOffenses">
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <div key={field.key} style={{ position: 'relative', marginBottom: 8 }}>
                <Row gutter={8} align="middle">
                  <Col flex="auto">
                    <Form.Item {...field} name={[field.name, 'text']} noStyle>
                      <Input placeholder="e.g., Sec. 5, Art. II of R.A. 9165" />
                    </Form.Item>
                  </Col>
                  <Col xs={18} sm={6}>
                    <Form.Item {...field} name={[field.name, 'date']} noStyle {...offenseDateFieldProps}>
                      <DatePicker style={{ width: '100%' }} format="MM-DD-YYYY" placeholder="Date charged (MM-DD-YYYY)" />
                    </Form.Item>
                  </Col>
                </Row>
                {fields.length > 1 && (
                  <Button
                    danger
                    shape="circle"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => remove(field.name)}
                    style={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}
                  />
                )}
              </div>
            ))}
            <Button type="dashed" size="small" onClick={() => add({ text: '', date: '' })}>+ Add charge</Button>
          </>
        )}
      </Form.List>

      <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>Convicted Of</Text>
      <Form.List name="convictedOffenses">
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <div key={field.key} style={{ position: 'relative', marginBottom: 8 }}>
                <Row gutter={8} align="middle">
                  <Col flex="auto">
                    <Form.Item {...field} name={[field.name, 'text']} noStyle>
                      <Input placeholder="e.g., Sec. 5, Art. II of R.A. 9165" />
                    </Form.Item>
                  </Col>
                  <Col xs={18} sm={6}>
                    <Form.Item {...field} name={[field.name, 'date']} noStyle {...offenseDateFieldProps}>
                      <DatePicker style={{ width: '100%' }} format="MM-DD-YYYY" placeholder="Date convicted (MM-DD-YYYY)" />
                    </Form.Item>
                  </Col>
                </Row>
                {fields.length > 1 && (
                  <Button
                    danger
                    shape="circle"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => remove(field.name)}
                    style={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}
                  />
                )}
              </div>
            ))}
            <Button type="dashed" size="small" onClick={() => add({ text: '', date: '' })}>+ Add offense</Button>
          </>
        )}
      </Form.List>

      <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>Sentence Details</Text>
      <Form.List name="sentences">
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <div key={field.key} style={{ position: 'relative', marginBottom: 8 }}>
                <Row gutter={8} align="middle">
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'y']} noStyle><InputNumber min={0} placeholder="Min Yrs" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'm']} noStyle><InputNumber min={0} placeholder="Min Mos" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'd']} noStyle><InputNumber min={0} placeholder="Min Days" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'y2']} noStyle><InputNumber min={0} placeholder="Max Yrs" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'm2']} noStyle><InputNumber min={0} placeholder="Max Mos" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={8} sm={3}><Form.Item {...field} name={[field.name, 'd2']} noStyle><InputNumber min={0} placeholder="Max Days" style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={20} sm={6}><Form.Item {...field} name={[field.name, 'fine']} noStyle><InputNumber min={0} placeholder="Fine (₱)" style={{ width: '100%' }} /></Form.Item></Col>
                </Row>
                {fields.length > 1 && (
                  <Button
                    danger
                    shape="circle"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => remove(field.name)}
                    style={{ position: 'absolute', top: -10, right: -10, zIndex: 1 }}
                  />
                )}
              </div>
            ))}
            <Button type="dashed" size="small" onClick={() => add({ y: '', m: '', d: '', y2: '', m2: '', d2: '', fine: '' })}>+ Add sentence</Button>
          </>
        )}
      </Form.List>
      <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12, fontStyle: 'italic' }}>
        Prints as: {sentencePreview || '(blank)'}
      </Text>

      <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>Sentencing Judge &amp; Court</Text>
      <Row gutter={[24, 8]}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Sentencing Judge" name="sentJudge" tooltip="If different from the Judge above. 'Hon.' is added automatically wherever this prints"><Input placeholder="e.g., Mundlyn G. Misal-Martin" onBlur={capitalizeOnBlur('sentJudge')} /></Form.Item>
        </Col>
        <Col xs={24} sm={12} md={4}>
          <Form.Item label="Sentencing Court Type" name="sentCourtType">
            <AutoComplete options={toAutoCompleteOptions(COURT_TYPE_OPTIONS)} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={4}>
          <Form.Item label="Branch No." name="sentBranchNo"><Input /></Form.Item>
        </Col>
        <Col xs={24} sm={12} md={4}>
          <Form.Item label="Sentencing Court City" name="sentCourtCity"><Input /></Form.Item>
        </Col>
        <Col xs={24} sm={12} md={4}>
          <Form.Item label="Sentencing Court Province" name="sentCourtProv"><Input /></Form.Item>
        </Col>
      </Row>

      <Row gutter={[24, 8]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Custodial Status" name="custodialStatus">
            <Radio.Group optionType="button" options={['Bail', 'Detention', 'ROR'].map((v) => ({ label: v, value: v }))} />
          </Form.Item>
        </Col>
        {custodialStatus === 'Detention' && (
          <Col xs={24} sm={12} md={8}>
            <Form.Item label="Detention Facility" name="detFacility" tooltip="Optional — prints as “Detention – ___”">
              <Input />
            </Form.Item>
          </Col>
        )}
        {custodialStatus === 'ROR' && (
          <Col xs={24} sm={12} md={8}>
            <Form.Item label="ROR Custodian" name="rorCustodian"><Input /></Form.Item>
          </Col>
        )}
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Custodial Address" name="custodialAddress" tooltip="Bail / custodian address">
            <Input />
          </Form.Item>
        </Col>
      </Row>

      <Text strong style={{ display: 'block', margin: '8px 0 8px' }}>Prior and Pending Records</Text>
      <Table
        rowKey="agency"
        size="small"
        pagination={false}
        dataSource={priorRecords}
        columns={[
          { title: 'Agency', dataIndex: 'agency', key: 'agency', width: 110 },
          {
            title: 'Criminal Case No.',
            key: 'caseNo',
            render: (_, row, i) => (
              <Input
                disabled={!canEdit}
                value={row.caseNo}
                onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, caseNo: e.target.value } : r)))}
              />
            ),
          },
          {
            title: 'Offense',
            key: 'offense',
            render: (_, row, i) => (
              <Input
                disabled={!canEdit}
                value={row.offense}
                onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, offense: e.target.value } : r)))}
              />
            ),
          },
          {
            title: 'Date Charged',
            key: 'dateCharged',
            render: (_, row, i) => (
              <Input
                disabled={!canEdit}
                value={row.dateCharged}
                onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, dateCharged: e.target.value } : r)))}
              />
            ),
          },
          {
            title: 'Decision / Status',
            key: 'status',
            render: (_, row, i) => (
              <Input
                disabled={!canEdit}
                placeholder={row.placeholder}
                value={row.status}
                onChange={(e) => setPriorRecords((rows) => rows.map((r, ri) => (ri === i ? { ...r, status: e.target.value } : r)))}
              />
            ),
          },
        ]}
      />

      <Divider orientation="center" className="section-title" style={{ marginTop: 24 }}>Socio-Economic Background</Divider>
      <Row gutter={[24, 16]}>
        {SOCIO_ECONOMIC_GROUPS.map((g) => (
          <Col xs={24} md={12} key={g.id}>
            <Form.Item label={g.title} name={`rate_${g.id}`}>
              <Radio.Group
                options={g.options.map((o) => ({ label: o, value: o }))}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 4 }}
              />
            </Form.Item>
          </Col>
        ))}
      </Row>
    </>
  );

  const supervisionGrid = (
    <Row gutter={[24, 8]}>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Supervision Period" name="supervisionPeriod" tooltip="Years-Months-Days, e.g. 1-0-0 for 1 year. Auto-fills the End Date below.">
          <Input placeholder="e.g. 1-0-0" onChange={(e) => recomputeSupervisionEndDate({ supervisionPeriod: e.target.value })} />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Supervision Start Date" name="supervisionStartDate">
          <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" onChange={(d) => recomputeSupervisionEndDate({ supervisionStartDate: d })} />
        </Form.Item>
      </Col>
      <Col xs={24} sm={12} md={8}>
        <Form.Item label="Supervision End Date" name="supervisionEndDate" tooltip="Auto-computed from Period + Start Date; you can still set it manually">
          <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
        </Form.Item>
      </Col>
      <Col xs={24}>
        <Form.Item label="Remarks" name="remarks"><Input.TextArea rows={2} /></Form.Item>
      </Col>
    </Row>
  );

  return (
    <>
      <Row gutter={[24, 8]} style={{ marginBottom: 8 }}>
        <Col xs={24} sm={12} md={8}>
          {/* Docket edits are admin-only once a case exists. */}
          <Form.Item
            label="Docket #"
            name="docketNumber"
            rules={[{ required: true, message: 'Docket number is required' }]}
            tooltip={docketDisabled && !isAdmin ? 'Only admins can change the docket number.' : undefined}
          >
            <Input disabled={docketDisabled} placeholder="e.g., PS-2026-01-00001" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Case Number" name="caseNumber" rules={[{ required: true, message: 'Case number is required' }]}><Input placeholder="e.g., TCR-2026-12345" /></Form.Item>
        </Col>
        {isAdmin && (
          <Col xs={24} sm={12} md={8}>
            {assignedOfficerField === 'form' ? (
              <Form.Item label="Assigned Officer" name="assignedOfficerId" rules={[{ required: true, message: 'Please assign an officer' }]}>
                <Select style={{ width: '100%' }} options={officers.map((o) => ({ label: o.full_name, value: o.id }))} placeholder="Select an officer" />
              </Form.Item>
            ) : (
              <Form.Item label="Assigned Officer" tooltip="Reassigns this case to another officer. Saved with the rest of the case information.">
                <Select
                  style={{ width: '100%' }}
                  value={reassignTo}
                  onChange={setReassignTo}
                  options={officers.map((o) => ({ label: o.full_name, value: o.id }))}
                />
              </Form.Item>
            )}
          </Col>
        )}
      </Row>

      <Divider orientation="center" className="section-title">Identifying Data</Divider>
      {identifyingGrid}

      <Divider orientation="center" className="section-title">Address</Divider>
      {addressGrid}

      <Divider orientation="center" className="section-title">Court &amp; Case Data</Divider>
      {courtGrid}

      <Divider orientation="center" className="section-title">Criminal History</Divider>
      <Row gutter={[24, 8]}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item label="Offense Classification" name="offenseType">
            <Select allowClear options={(enums?.OFFENSE_TYPES || []).map((v) => ({ label: v, value: v }))} />
          </Form.Item>
        </Col>
      </Row>

      {collapseExtras ? (
        <Collapse
          style={{ marginTop: 8, background: '#fafafa' }}
          items={[{
            key: 'extra',
            label: (
              <span>
                <strong>Additional Details</strong>
                <span style={{ color: 'rgba(0,0,0,0.45)', fontWeight: 400 }}>
                  {' '}— offense specifics, custodial status, prior records &amp; socio-economic background. Optional now; can be completed later on Case Information.
                </span>
              </span>
            ),
            children: criminalHistoryExtras,
          }]}
        />
      ) : criminalHistoryExtras}

      <Divider orientation="center" className="section-title" style={{ marginTop: 24 }}>Supervision</Divider>
      {collapseExtras ? (
        <Collapse
          style={{ marginTop: 8, background: '#fafafa' }}
          items={[{
            key: 'supervision',
            label: (
              <span>
                <strong>Supervision Details</strong>
                <span style={{ color: 'rgba(0,0,0,0.45)', fontWeight: 400 }}>
                  {' '}— supervision period, start/end dates &amp; remarks. Optional now; can be completed later on Case Information.
                </span>
              </span>
            ),
            children: supervisionGrid,
          }]}
        />
      ) : supervisionGrid}
    </>
  );
}
