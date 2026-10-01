// Local event hooks only. No analytics service, cookies or personal data are
// sent by this file. Connect a verified measurement property before publishing
// any analytics integration.
window.sunproTrack = function (event, detail = {}) {
  const allowed = new Set(['text_quote_click', 'email_quote_click', 'online_quote_click', 'quote_start', 'quote_saved', 'quote_error', 'quote_notification_failed']);
  if (!allowed.has(event)) return;
  const payload = { event, page: location.pathname };
  if (['refresh', 'correction', 'ceramic', 'interior', 'unsure'].includes(detail.service)) payload.service = detail.service;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
};
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (href.startsWith('sms:')) window.sunproTrack('text_quote_click');
  else if (href.startsWith('mailto:')) window.sunproTrack('email_quote_click');
  else if (href.includes('contact.html') || href === '#book') window.sunproTrack('online_quote_click');
});
document.querySelectorAll('.nav').forEach(nav => {
  const toggle = document.querySelector('.menu-toggle');
  const close = () => { nav.classList.remove('is-open'); toggle?.setAttribute('aria-expanded', 'false'); };
  nav.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && nav.classList.contains('is-open')) { close(); toggle?.focus(); } });
});
