// Text-alert safety helpers. Item names, units and batch labels are typed by
// shop staff and end up inside SMS bodies sent from GroundWorks' registered
// number, so they are flattened to short plain text first (no links, no
// line breaks), and only US/Canada numbers are ever texted.

export const MAX_ALERT_RECIPIENTS = 5;

// Same shape the database enforces on alert_recipients.phone.
const US_CA_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export function isAlertPhone(phone: string): boolean {
  return US_CA_E164.test(phone);
}

export function cleanForSms(text: string, maxLength: number): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}

// The numbers a shop's alerts may go to: well-formed, de-duplicated, capped.
export function alertablePhones(phones: string[]): string[] {
  return Array.from(new Set(phones.filter(isAlertPhone))).slice(0, MAX_ALERT_RECIPIENTS);
}
