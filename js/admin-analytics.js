import { COLLECTION, EXCLUDE_KEY, STORAGE_KEY, SOURCES, dateRange, perthDay, summarise, trackingURL } from './analytics-core.js';

const MAX_EVENTS = 5000, PAGE_SIZE = 500;
const number = value => Number(value).toLocaleString('ko-KR');
const pageNames = { '/': '홈페이지', '/services.html': '서비스·가격', '/gallery.html': '작업 사진', '/contact.html': '견적 문의', '/locations.html': '위치', '/about.html': '소개', '/faq.html': '자주 묻는 질문' };
export async function loadAnalyticsEvents(db, sdk, range) {
  const events = [];
  let cursor;
  while (events.length < MAX_EVENTS) {
    const constraints = [sdk.where('createdAt', '>=', new Date(range.start)), sdk.where('createdAt', '<=', new Date(range.end)), sdk.orderBy('createdAt', 'desc'), sdk.limit(PAGE_SIZE)];
    if (cursor) constraints.push(sdk.startAfter(cursor));
    const snap = await sdk.getDocs(sdk.query(sdk.collection(db, COLLECTION), ...constraints));
    events.push(...snap.docs.map(doc => doc.data()));
    if (snap.docs.length < PAGE_SIZE) return { events, truncated: false };
    cursor = snap.docs.at(-1);
  }
  return { events, truncated: true };
}

export function createAnalyticsDashboard({ db, sdk, document: d = document, storage, clipboard = d.defaultView?.navigator?.clipboard, now = () => Date.now(), loadEvents = range => loadAnalyticsEvents(db, sdk, range) }) {
  if (!storage) {
    try { storage = d.defaultView.localStorage; }
    catch { storage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } }; }
  }
  const get = id => d.getElementById(id), panel = get('tab-analytics');
  let authorised = false, generation = 0, loading = false;
  const el = (tag, text, cls) => { const node = d.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  function message(text, state = '') { get('analyticsStatus').textContent = text; get('analyticsStatus').dataset.state = state; }
  function clear() {
    for (const id of ['analyticsMetrics', 'analyticsChannels', 'analyticsDays', 'analyticsCampaigns', 'analyticsPages']) get(id).replaceChildren();
    get('analyticsResults').hidden = true;
  }
  function table(target, headings, rows, empty) {
    const holder = get(target); holder.replaceChildren();
    if (!rows.length) { holder.append(el('p', empty, 'analytics-empty')); return; }
    const t = el('table'), thead = el('thead'), tr = el('tr');
    for (const heading of headings) { const th = el('th', heading); th.scope = 'col'; tr.append(th); }
    thead.append(tr); t.append(thead);
    const tbody = el('tbody');
    for (const row of rows) { const r = el('tr'); for (const cell of row) r.append(el('td', cell)); tbody.append(r); }
    t.append(tbody); holder.append(t);
  }
  function render(data, range) {
    const metrics = get('analyticsMetrics'); metrics.replaceChildren();
    for (const [label, key, help] of [['방문자', 'visitors', '기기·브라우저 기준 추정'], ['방문 횟수', 'sessions', '30분 이상 쉬면 새 방문'], ['페이지 조회', 'pageViews', '새로고침 포함'], ['온라인 문의 완료', 'quotes', '문의 저장 성공 이벤트']]) {
      const card = el('div', undefined, 'analytics-metric'); card.append(el('span', label), el('strong', number(data.totals[key])), el('small', help)); metrics.append(card);
    }
    const totals = data.totals;
    get('analyticsClicks').textContent = `문자 버튼 ${number(totals.sms)}회 · 이메일 버튼 ${number(totals.email)}회 · 전화 버튼 ${number(totals.call)}회 · 온라인 견적 버튼 ${number(totals.quoteClicks)}회 · 폼 입력 시작 ${number(totals.quoteStarts)}회`;
    table('analyticsChannels', ['유입 경로', '방문자', '방문', '문자 클릭', '이메일 클릭', '문의 완료'], data.channels.map(row => [SOURCES[row.key], number(row.visitors), number(row.sessions), number(row.sms), number(row.email), number(row.quotes)]), '이 기간에 측정된 방문이 없습니다.');
    const days = new Map(data.days.map(day => [day.key, day]));
    const chart = get('analyticsDays'); chart.replaceChildren();
    const max = Math.max(1, ...data.days.map(day => day.sessions));
    for (let ms = range.start; ms <= range.end; ms += 86400000) {
      const key = perthDay(ms), row = days.get(key), count = row?.sessions || 0;
      const item = el('li'); item.title = `${key}: 방문 ${count}회, 방문자 ${row?.visitors || 0}명`;
      const bar = el('span', undefined, 'analytics-day-bar'); bar.style.height = `${count ? Math.max(3, count / max * 100) : 0}%`;
      item.append(el('span', String(count), 'analytics-day-number'), bar, el('span', key.slice(5), 'analytics-day-label'));
      item.setAttribute('aria-label', item.title); chart.append(item);
    }
    table('analyticsCampaigns', ['캠페인', '방문', '문자 클릭', '이메일 클릭', '문의 완료'], data.campaigns.map(row => [row.key, number(row.sessions), number(row.sms), number(row.email), number(row.quotes)]), '캠페인 링크를 통해 들어온 방문이 아직 없습니다. 아래 링크를 프로필이나 게시물에 사용해 주세요.');
    table('analyticsPages', ['페이지', '조회', '방문자'], data.pages.map(row => [pageNames[row.key] || row.key, number(row.pageViews), number(row.visitors)]), '측정된 페이지 조회가 없습니다.');
    get('analyticsResults').hidden = false;
  }
  async function load() {
    if (!authorised || loading) return;
    const request = ++generation, range = dateRange(Number(get('analyticsPeriod').value), now());
    loading = true; get('refreshAnalytics').disabled = true; panel.setAttribute('aria-busy', 'true');
    clear(); message('방문 통계를 불러오고 있습니다…');
    try {
      const result = await loadEvents(range);
      if (!authorised || request !== generation) return;
      const data = summarise(result.events, range); render(data, range);
      const interval = `${perthDay(range.start)} ~ ${perthDay(range.end)} · 퍼스 시간`;
      message(result.truncated ? `${interval} · 조회 한도 ${number(MAX_EVENTS)}건에 도달했습니다. 아래 수치는 조회된 일부 데이터 기준입니다. 기간을 줄여 확인해 주세요.` : `${interval} · ${new Date(now()).toLocaleTimeString('ko-KR', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit' })} 업데이트${result.events.length ? '' : ' · 아직 수집된 데이터가 없습니다.'}`, result.truncated ? 'warning' : 'ready');
    } catch (error) {
      if (!authorised || request !== generation) return;
      clear();
      message(['permission-denied', 'unauthenticated'].includes(error?.code) ? '통계 읽기 권한을 확인할 수 없습니다. 통계 전용 Firebase 보안 규칙이 적용됐는지 확인한 뒤 다시 로그인해 주세요. 방문자 수를 0으로 표시하지 않습니다.' : '통계를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. 기존 문의와 사진 관리는 계속 사용할 수 있습니다.', 'error');
    } finally {
      if (request === generation) { loading = false; get('refreshAnalytics').disabled = false; panel.setAttribute('aria-busy', 'false'); }
    }
  }
  function authorise(value) {
    authorised = !!value; generation++; loading = false; clear(); get('refreshAnalytics').disabled = false; panel.setAttribute('aria-busy', 'false');
    if (authorised) {
      try {
        // Exclude the owner's browser by default; the owner can change it here.
        if (storage.getItem(EXCLUDE_KEY) === null) storage.setItem(EXCLUDE_KEY, '1');
        get('analyticsExclude').checked = storage.getItem(EXCLUDE_KEY) === '1';
      } catch { get('analyticsExclude').checked = true; }
      message('기간을 선택하고 통계를 확인하세요.');
    } else message('관리자 로그인 후 확인할 수 있습니다.');
  }
  get('refreshAnalytics').addEventListener('click', load);
  get('analyticsPeriod').addEventListener('change', () => { generation++; loading = false; void load(); });
  get('analyticsExclude').addEventListener('change', event => {
    try { storage.setItem(EXCLUDE_KEY, event.target.checked ? '1' : '0'); if (event.target.checked) storage.removeItem(STORAGE_KEY); }
    catch { message('브라우저 저장 설정을 변경할 수 없습니다.', 'warning'); }
  });
  function link() {
    const campaign = get('analyticsCampaign').value.trim();
    if (campaign && !/^[a-z0-9_-]{1,64}$/i.test(campaign)) { get('trackingLinkStatus').textContent = '캠페인 이름은 영문·숫자·밑줄·하이픈으로 64자 이내로 적어 주세요.'; get('copyTrackingLink').disabled = true; return; }
    get('trackingLink').value = trackingURL(get('analyticsSource').value, campaign, get('analyticsTarget').value);
    get('copyTrackingLink').disabled = false; get('trackingLinkStatus').textContent = '';
  }
  for (const id of ['analyticsSource', 'analyticsCampaign', 'analyticsTarget']) get(id).addEventListener('input', link);
  get('copyTrackingLink').addEventListener('click', async () => {
    try { await clipboard.writeText(get('trackingLink').value); get('trackingLinkStatus').textContent = '복사했습니다. 해당 채널의 프로필·게시물 링크로 사용하세요.'; }
    catch { get('trackingLink').focus(); get('trackingLink').select(); get('trackingLinkStatus').textContent = '링크를 선택했습니다. 복사해서 사용하세요.'; }
  });
  link();
  return { load, authorise };
}
