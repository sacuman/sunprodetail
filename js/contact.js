import { FIREBASE_CONFIG } from './firebase-config.js';
import { SERVICES, SERVICE_QUERY, validateQuote, photoProblem, sendNotification } from './quote-utils.js';

let backendPromise;
export function loadBackend() {
  if (!backendPromise) backendPromise = Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
  ]).then(([appSDK, storageSDK, dbSDK]) => {
    const app = appSDK.initializeApp(FIREBASE_CONFIG);
    const storage = storageSDK.getStorage(app);
    const db = dbSDK.getFirestore(app);
    return {
      async upload(file, onProgress) {
        const reference = storageSDK.ref(storage, `enquiries/${crypto.randomUUID()}.jpg`);
        await new Promise((resolve, reject) => {
          const task = storageSDK.uploadBytesResumable(reference, file, { contentType: 'image/jpeg' });
          const timeout = setTimeout(() => task.cancel(), 120000);
          task.on('state_changed', snap => onProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0), error => { clearTimeout(timeout); reject(error); }, () => { clearTimeout(timeout); resolve(); });
        });
        return storageSDK.getDownloadURL(reference);
      },
      async save(values) { const saved = await dbSDK.addDoc(dbSDK.collection(db, 'enquiries'), values); return saved.id; }
    };
  }).catch(error => { backendPromise = undefined; throw error; });
  return backendPromise;
}

export async function preparePhoto(file) {
  const problem = photoProblem(file);
  if (problem) throw new Error(problem);
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    try { await image.decode(); }
    catch { throw new Error('This photo format could not be opened. Please choose a JPG, PNG or WebP, or send the photo by text.'); }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    if (!blob || blob.size > 4 * 1024 * 1024) throw new Error('This photo is too large to prepare. Please choose a smaller photo.');
    return new File([blob], 'vehicle-photo.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(source); }
}

export function initContact({ backendLoader = loadBackend, notify = sendNotification, prepare = preparePhoto } = {}) {
  const get = id => document.getElementById(id);
  const form = get('contactForm');
  if (!form || form.dataset.ready) return;
  const status = get('formStatus'), button = get('submitBtn'), input = get('photoInput');
  const modal = get('successModal'), modalCard = modal.querySelector('[role="dialog"]');
  const fields = ['name', 'phone', 'email', 'vehicle', 'preferredDate', 'service', 'message'];
  let selected = [], submitting = false, preparing = false, started = false;
  let returnFocus;
  const track = event => window.sunproTrack?.(event);
  const showStatus = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error); };
  const lock = busy => {
    form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = busy; });
    form.setAttribute('aria-busy', String(busy));
  };
  function renderPhotos() {
    get('photoPreviewGrid').replaceChildren();
    selected.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'photo-preview-item';
      const image = document.createElement('img'); image.src = item.preview; image.alt = `Selected vehicle photo ${index + 1}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'photo-preview-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
      remove.disabled = submitting || preparing;
      remove.addEventListener('click', () => {
        if (submitting || preparing) return;
        URL.revokeObjectURL(item.preview); selected = selected.filter(photo => photo !== item); renderPhotos(); input.focus();
      });
      card.append(image, remove); get('photoPreviewGrid').append(card);
    });
    get('photoCountLabel').style.display = selected.length ? 'block' : 'none';
    get('photoCountLabel').textContent = `${selected.length} of 10 photos selected`;
  }
  input.addEventListener('change', async () => {
    if (submitting || preparing) return;
    const files = Array.from(input.files); input.value = '';
    preparing = true; lock(true); button.textContent = 'Preparing photos…';
    const problems = [];
    try {
      for (const file of files) {
        if (selected.length >= 10) { problems.push('You can add up to 10 photos. Extra photos were not added.'); break; }
        try {
          const prepared = await prepare(file);
          if (selected.reduce((sum, photo) => sum + photo.file.size, 0) + prepared.size > 20 * 1024 * 1024) { problems.push('Please use fewer photos; the total upload must stay under 20 MB.'); break; }
          selected.push({ file: prepared, preview: URL.createObjectURL(prepared), uploadedURL: '' });
        } catch (error) { problems.push(error.message); }
      }
    } finally {
      preparing = false; renderPhotos(); lock(false); button.textContent = 'Send Quote Request';
      get('photoStatus').textContent = [...new Set(problems)].join(' ');
    }
  });
  for (const field of ['name', 'phone', 'email']) get(field).addEventListener('input', () => {
    get(field).removeAttribute('aria-invalid'); get(`${field}Error`).textContent = '';
  });
  form.addEventListener('input', () => { if (!started) { started = true; track('quote_start'); } });
  const requested = SERVICE_QUERY[new URLSearchParams(location.search).get('service')];
  if (requested) get('service').value = requested;

  function closeModal() {
    modal.hidden = true; document.body.style.overflow = ''; returnFocus?.focus();
  }
  get('closeModal').addEventListener('click', closeModal);
  get('successBackdrop').addEventListener('click', closeModal);
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('a[href], button:not([disabled])')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modalCard)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || preparing) return;
    const values = Object.fromEntries(fields.map(field => [field, get(field).value.trim()]));
    const errors = validateQuote(values);
    for (const field of ['name', 'phone', 'email']) {
      get(`${field}Error`).textContent = errors[field] || '';
      get(field).setAttribute('aria-invalid', String(Boolean(errors[field])));
    }
    if (Object.keys(errors).length) { showStatus('Please check the highlighted details.', true); get(Object.keys(errors)[0]).focus(); return; }
    values.service = SERVICES.includes(values.service) ? values.service : SERVICES[4];
    submitting = true; lock(true); returnFocus = button;
    button.textContent = 'Sending…'; showStatus('Sending your enquiry. Please keep this page open.');
    const progress = get('uploadProgress'), bar = get('uploadBar');
    progress.style.display = 'block'; bar.style.width = '0%'; get('uploadStatus').textContent = 'Connecting…';
    const slow = setTimeout(() => showStatus('This is taking longer than usual. Please keep this page open; your enquiry is still being processed.'), 20000);
    let savedId;
    try {
      const backend = await backendLoader();
      for (let i = 0; i < selected.length; i++) {
        const photo = selected[i];
        get('uploadStatus').textContent = `Uploading photo ${i + 1} of ${selected.length}…`;
        if (!photo.uploadedURL) photo.uploadedURL = await backend.upload(photo.file, ratio => { bar.style.width = `${Math.round(((i + ratio) / selected.length) * 85)}%`; });
      }
      get('uploadStatus').textContent = 'Saving enquiry…'; bar.style.width = '90%';
      const urls = selected.map(photo => photo.uploadedURL);
      savedId = await backend.save({ ...values, photos: urls, photoCount: urls.length, status: 'new', submittedAt: Date.now() });
      track('quote_saved');
      // The saved database record is authoritative. Notification failure must
      // never ask the customer to re-submit an already saved enquiry.
      let notification = 'failed';
      try { notification = await notify(values, urls.length, savedId); } catch {}
      if (notification !== 'accepted') track('quote_notification_failed');
      clearTimeout(slow); bar.style.width = '100%';
      get('successText').textContent = `Your enquiry has been saved. Reference: ${savedId}. We will review your details and reply by text or email with pricing and available dates.`;
      modal.hidden = false; document.body.style.overflow = 'hidden'; modalCard.focus();
      selected.forEach(photo => URL.revokeObjectURL(photo.preview)); selected = []; renderPhotos();
      form.reset(); started = false; showStatus('Your enquiry has been saved.');
    } catch {
      if (savedId) { showStatus('Your enquiry has been saved. Please do not submit it again.'); }
      else { showStatus('We could not confirm your enquiry. Your details are still here. Check your connection and try again, or text 0416 795 345.', true); track('quote_error'); }
    } finally {
      clearTimeout(slow); progress.style.display = 'none'; submitting = false; lock(false); button.textContent = 'Send Quote Request';
    }
  });
  form.dataset.ready = 'true'; button.disabled = false; showStatus('');
}

if (typeof document !== 'undefined') initContact();
