// Shared, dependency-free analytics logic. Never put contact/form data in events.
export const COLLECTION = 'websiteAnalytics';
export const SESSION_MS = 30 * 60 * 1000;
export const VISITOR_MS = 30 * 86400000;
export const STORAGE_KEY = 'sunpro.analytics.v1';
export const EXCLUDE_KEY = 'sunpro.analytics.exclude';
export const EVENTS = ['page_view', 'text_quote_click', 'email_quote_click', 'call_click', 'online_quote_click', 'quote_start', 'quote_saved', 'quote_error', 'quote_notification_failed'];
export const SOURCES = {
  facebook: 'Facebook', instagram: 'Instagram', google: 'Google 검색·지도', bing: 'Bing',
  tiktok: 'TikTok', youtube: 'YouTube', email: '이메일 링크', qr: 'QR 코드',
  referral: '다른 사이트', direct: '직접 방문·출처 미확인', other: '기타 캠페인'
};
export const MEDIA = ['social', 'organic', 'business_profile', 'email', 'qr', 'referral', 'direct', 'paid', 'other'];
export const PUBLIC_PAGES = ['/', '/services.html', '/gallery.html', '/contact.html', '/locations.html', '/about.html', '/faq.html'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const campaignToken = value => /^[a-z0-9_-]{1,64}$/i.test(value || '') ? value.toLowerCase() : '';
export function pagePath(path) { return path === '/index.html' ? '/' : PUBLIC_PAGES.includes(path) ? path : ''; }
const domainIs = (host, domain) => host === domain || host.endsWith('.' + domain);
export function attribution(href, referrer = '') {
  const url = new URL(href);
  const tag = (url.searchParams.get('utm_source') || '').trim().toLowerCase();
  const aliases = { fb: 'facebook', ig: 'instagram', google_business: 'google', google_business_profile: 'google', gbp: 'google', newsletter: 'email', community: 'referral' };
  const tagged = !!tag;
  let source = tagged ? (aliases[tag] || (Object.hasOwn(SOURCES, tag) ? tag : 'other')) : 'direct';
  let medium = tagged ? ({ facebook: 'social', instagram: 'social', google: 'organic', bing: 'organic', tiktok: 'social', youtube: 'social', email: 'email', qr: 'qr', referral: 'referral' }[source] || 'other') : 'direct';
  const requestedMedium = url.searchParams.get('utm_medium');
  if (tagged && MEDIA.includes(requestedMedium)) medium = requestedMedium;
  if (!tagged) {
    try {
      const host = new URL(referrer).hostname.toLowerCase();
      if (![url.hostname, 'sunprodetail.com', 'www.sunprodetail.com'].includes(host)) {
        if (domainIs(host, 'instagram.com')) source = 'instagram';
        else if (domainIs(host, 'facebook.com') || host === 'fb.com') source = 'facebook';
        else if (/(^|\.)google\.(com|com\.au|co\.uk)$/.test(host)) source = 'google';
        else if (domainIs(host, 'bing.com')) source = 'bing';
        else if (domainIs(host, 'tiktok.com')) source = 'tiktok';
        else if (domainIs(host, 'youtube.com') || host === 'youtu.be') source = 'youtube';
        else source = 'referral';
        medium = ['google', 'bing'].includes(source) ? 'organic' : source === 'referral' ? 'referral' : 'social';
      }
    } catch { /* no usable referrer */ }
    if (source === 'direct' && url.searchParams.has('fbclid')) { source = 'facebook'; medium = 'social'; }
  }
  return { source, medium, campaign: tagged ? campaignToken(url.searchParams.get('utm_campaign')) : '', explicit: tagged };
}
export function nextIdentity(previous, incoming, now, uuid) {
  const visitorOK = previous && UUID.test(previous.visitorId || '') && previous.visitorSince <= now && now - previous.visitorSince < VISITOR_MS;
  const sameTag = !incoming.explicit || (incoming.source === previous?.source && incoming.medium === previous?.medium && incoming.campaign === previous?.campaign);
  const sessionOK = visitorOK && UUID.test(previous.sessionId || '') && previous.lastAt <= now && now - previous.lastAt < SESSION_MS && Object.hasOwn(SOURCES, previous.source) && MEDIA.includes(previous.medium) && sameTag;
  return {
    visitorId: visitorOK ? previous.visitorId : uuid(), visitorSince: visitorOK ? previous.visitorSince : now,
    sessionId: sessionOK ? previous.sessionId : uuid(), lastAt: now,
    source: sessionOK ? previous.source : incoming.source,
    medium: sessionOK ? previous.medium : incoming.medium,
    campaign: sessionOK ? campaignToken(previous.campaign) : incoming.campaign
  };
}
export function perthDay(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); }
export function dateRange(days, now = Date.now()) {
  if (![1, 7, 30, 90].includes(Number(days))) throw new Error('Invalid period');
  const midnight = Date.parse(perthDay(now) + 'T00:00:00+08:00');
  return { start: midnight - (Number(days) - 1) * 86400000, end: now };
}
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value);
export function summarise(events, range) {
  const valid = events.filter(e => EVENTS.includes(e.event) && UUID.test(e.visitorId || '') && UUID.test(e.sessionId || '') && Object.hasOwn(SOURCES, e.source) && pagePath(e.page) && millis(e.createdAt) >= range.start && millis(e.createdAt) <= range.end).sort((a, b) => millis(a.createdAt) - millis(b.createdAt));
  const sessions = new Map(), visitors = new Set(), days = new Map(), channels = new Map(), campaigns = new Map(), pages = new Map();
  const totals = { visitors: 0, sessions: 0, pageViews: 0, sms: 0, email: 0, call: 0, quoteClicks: 0, quoteStarts: 0, quotes: 0 };
  const metrics = { page_view: 'pageViews', text_quote_click: 'sms', email_quote_click: 'email', call_click: 'call', online_quote_click: 'quoteClicks', quote_start: 'quoteStarts', quote_saved: 'quotes' };
  function group(map, key) {
    if (!map.has(key)) map.set(key, { key, visitors: new Set(), sessions: new Set(), pageViews: 0, sms: 0, email: 0, call: 0, quoteClicks: 0, quoteStarts: 0, quotes: 0 });
    return map.get(key);
  }
  for (const e of valid) {
    if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, { source: e.source, campaign: campaignToken(e.campaign), medium: e.medium });
    const session = sessions.get(e.sessionId);
    visitors.add(e.visitorId);
    const daily = group(days, perthDay(millis(e.createdAt)));
    const channel = group(channels, session.source);
    const groups = [daily, channel];
    if (session.campaign) groups.push(group(campaigns, session.source + ' / ' + session.campaign));
    if (e.event === 'page_view') groups.push(group(pages, pagePath(e.page)));
    for (const g of groups) {
      g.visitors.add(e.visitorId); g.sessions.add(e.sessionId);
      if (metrics[e.event]) g[metrics[e.event]]++;
    }
    if (metrics[e.event]) totals[metrics[e.event]]++;
  }
  totals.visitors = visitors.size; totals.sessions = sessions.size;
  const serialise = map => Array.from(map.values(), g => ({ ...g, visitors: g.visitors.size, sessions: g.sessions.size }));
  return { totals, channels: serialise(channels).sort((a, b) => b.sessions - a.sessions), days: serialise(days), campaigns: serialise(campaigns).sort((a, b) => b.sessions - a.sessions), pages: serialise(pages).sort((a, b) => b.pageViews - a.pageViews) };
}
export function trackingURL(source, campaign = 'profile', target = '/') {
  const medium = { facebook: 'social', instagram: 'social', google: 'business_profile', email: 'email', qr: 'qr', referral: 'referral' }[source];
  if (!medium || !pagePath(target)) throw new Error('Unsupported tracking link');
  const url = new URL(pagePath(target), 'https://sunprodetail.com');
  url.searchParams.set('utm_source', source); url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaignToken(campaign) || 'profile');
  if (target === '/contact.html') url.hash = 'book';
  return url.href;
}
