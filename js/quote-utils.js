export const SERVICES = ['Refresh Detailing', 'Paint Correction', 'Ceramic Coating', 'Interior Detailing', 'Not sure — please advise'];
export const SERVICE_QUERY = { refresh: SERVICES[0], correction: SERVICES[1], ceramic: SERVICES[2], interior: SERVICES[3] };

export function validateQuote(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Please add your name.';
  if (!values.phone.trim() && !values.email.trim()) errors.phone = 'Add a mobile number or email so we can reply.';
  if (values.phone && !/^\+?[\d\s().-]+$/.test(values.phone)) errors.phone = 'Please check your mobile number.';
  if (values.phone && (values.phone.replace(/\D/g, '').length < 9 || values.phone.replace(/\D/g, '').length > 15)) errors.phone = 'Please check your mobile number.';
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Please check your email, or leave it blank and use your mobile.';
  return errors;
}

export function safePhotoURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith('/v0/b/sunpro-detailing.firebasestorage.app/o/') ? url.href : '';
  } catch { return ''; }
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

export function contactNumber(value) {
  const number = String(value ?? '').trim();
  if (!/^\+?[\d\s().-]+$/.test(number)) return '';
  const clean = number.replace(/[^\d+]/g, '');
  return clean.replace(/\D/g, '').length >= 9 && clean.replace(/\D/g, '').length <= 15 ? clean : '';
}

export function photoProblem(file) {
  if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) || (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))) return 'Please use JPG, PNG, WebP or HEIC photos.';
  if (file.size > 20 * 1024 * 1024) return 'Each original photo must be 20 MB or smaller.';
  if (!file.size) return 'This photo is empty. Please choose another.';
  return '';
}

// A successful response means the notification service accepted the alert,
// not that it has reached an inbox. Never treat this as the enquiry store.
export async function sendNotification(values, photoCount, enquiryId, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new FormData();
    for (const key of ['name', 'phone', 'email', 'vehicle', 'preferredDate', 'service', 'message']) body.append(key, values[key] || 'Not provided');
    body.append('photos', `${photoCount} photo(s) — view at sunprodetail.com/admin.html`);
    body.append('reference', enquiryId);
    const response = await fetchImpl('https://formspree.io/f/mgonoojp', { method: 'POST', body, headers: { Accept: 'application/json' }, signal: controller.signal });
    return response.ok ? 'accepted' : 'failed';
  } catch { return 'failed'; }
  finally { clearTimeout(timer); }
}
