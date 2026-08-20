import { message } from 'antd';

// antd's Form.validateFields() rejects with { errorFields: [{ name, errors }] }
// when a required field is missing/invalid. The form already renders that
// field red inline, but the field can be out of view (a collapsed
// "Additional Details" section, an inactive tab) so the save silently
// appears to do nothing — surface it as a toast too. Returns true when it
// recognized (and reported) a validation error, so callers can skip their
// generic error handling.
export function reportValidationError(err) {
  const fields = err?.errorFields;
  if (!fields?.length) return false;
  const texts = fields.map((f) => f.errors?.[0]).filter(Boolean);
  const extra = texts.length > 1 ? ` (+${texts.length - 1} more required field${texts.length > 2 ? 's' : ''})` : '';
  message.error(`${texts[0] || 'Please fill in the required fields.'}${extra}`);
  return true;
}
