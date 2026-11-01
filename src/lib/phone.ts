// Phone numbers for text alerts. People type them the way they say them
// ("(555) 123-4567", "555.123.4567", "1 555 123 4567"); Twilio needs the
// international form (+15551234567). This turns the first into the second, or
// says it can't, so a bad number is caught at the form instead of failing
// silently when an alert should have gone out.

// Text alerts go to US and Canadian numbers only (the same rule the database
// enforces on alert_recipients.phone). They can be typed without a country
// code, or as +1.
export function normalizePhone(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/[^\d\s().+-]/.test(text)) return null; // letters and other characters
  if (text.slice(1).includes("+")) return null; // "+" only belongs at the very start
  const digits = text.replace(/\D/g, "");

  // US/Canada area codes and exchanges never start with 0 or 1.
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  return null;
}

// +15551234567 -> (555) 123-4567; anything else is shown as stored.
export function formatPhone(e164: string): string {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
