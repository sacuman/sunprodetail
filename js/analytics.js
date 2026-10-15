import { FIREBASE_CONFIG } from './firebase-config.js';
import { COLLECTION, EVENTS, STORAGE_KEY, EXCLUDE_KEY, pagePath, attribution, nextIdentity } from './analytics-core.js';

// Writes go only to the site's existing Firebase project. No names, contact
// fields, photo URLs, full referrers, query strings or user-agent are stored.
export function initAnalytics(w = window, fetchImpl = w.fetch?.bind(w)) {
  if (w.sunproAnalytics) return w.sunproAnalytics;
  const d = w.document, lastEvents = new Map();
  let status = 'idle', inFlight = 0, pageSent = false;
  function excluded() {
    try {
      return w.localStorage.getItem(EXCLUDE_KEY) === '1' || w.navigator.globalPrivacyControl === true || w.navigator.doNotTrack === '1' || w.doNotTrack === '1';
    } catch { return true; }
  }
  function eligible() {
    return pagePath(w.location.pathname) && ['sunprodetail.com', 'www.sunprodetail.com'].includes(w.location.hostname) && !excluded() && !/bot|crawler|spider|headless|lighthouse|prerender/i.test(w.navigator.userAgent) && typeof fetchImpl === 'function';
  }
  async function track(event, detail = {}) {
    if (!EVENTS.includes(event) || !eligible() || inFlight >= 6) return false;
    const now = Date.now();
    if (event !== 'page_view' && now - (lastEvents.get(event) || 0) < 1500) return false;
    let identity;
    try {
      let previous;
      try { previous = JSON.parse(w.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { previous = null; }
      identity = nextIdentity(previous, attribution(w.location.href, d.referrer), now, () => w.crypto.randomUUID());
      w.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } catch { status = 'excluded'; return false; }
    lastEvents.set(event, now);
    const values = {
      version: 1, event, page: pagePath(w.location.pathname), visitorId: identity.visitorId, sessionId: identity.sessionId,
      source: identity.source, medium: identity.medium, campaign: identity.campaign,
      device: w.innerWidth <= 767 ? 'mobile' : w.innerWidth <= 1100 ? 'tablet' : 'desktop',
      service: ['refresh', 'correction', 'ceramic', 'interior', 'unsure'].includes(detail.service) ? detail.service : ''
    };
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]));
    const name = `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${COLLECTION}/${w.crypto.randomUUID()}`;
    const body = JSON.stringify({ writes: [{ update: { name, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }] });
    inFlight++;
    try {
      // keepalive allows an enquiry-link click to finish while navigating away.
      const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' });
      status = response.ok ? 'ready' : 'unavailable';
      return response.ok;
    } catch { status = 'unavailable'; return false; }
    finally { inFlight--; }
  }
  function setExcluded(value) {
    try { w.localStorage.setItem(EXCLUDE_KEY, value ? '1' : '0'); if (value) w.localStorage.removeItem(STORAGE_KEY); } catch {}
    status = value ? 'excluded' : 'idle';
  }
  const api = { track, setExcluded, get status() { return status; } };
  w.sunproAnalytics = api;
  w.addEventListener('sunpro:track', e => { void track(e.detail?.event, e.detail || {}); });
  function pageView() {
    if (!pageSent && d.visibilityState !== 'hidden') { pageSent = true; void track('page_view'); }
  }
  d.addEventListener('visibilitychange', pageView); pageView();
  w.addEventListener('pageshow', event => { if (event.persisted) void track('page_view'); });
  const footer = d.querySelector('footer');
  if (footer) {
    const notice = d.createElement('details'); notice.className = 'site-statistics-notice';
    const summary = d.createElement('summary'); summary.textContent = 'Website statistics & privacy';
    const text = d.createElement('p'); text.textContent = 'We use a random browser ID (renewed after 30 days) to count visits, referral channels and enquiry-button clicks in our existing Google Firebase database. We do not include your name, contact details, form contents or photos in these statistics. Your browser’s Do Not Track and Global Privacy Control preferences are respected.';
    const button = d.createElement('button'); button.type = 'button';
    const label = () => { button.textContent = excluded() ? 'Statistics disabled on this browser' : 'Disable statistics on this browser'; button.disabled = excluded(); };
    button.addEventListener('click', () => { setExcluded(true); label(); }); label();
    notice.append(summary, text, button); footer.append(notice);
  }
  return api;
}
if (typeof window !== 'undefined') initAnalytics(window);
