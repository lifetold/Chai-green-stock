// Shared helpers: Supabase client, app state, formatting, UI bits,
// photo capture/upload, barcode scanner and signature pad.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Signed-in user's profile and the company settings row.
export const state = { user: null, profile: null, settings: null };
export const isManager = () => ['admin', 'manager'].includes(state.profile?.role);
export const isAdmin = () => state.profile?.role === 'admin';

// ------------------------------------------------------------------ data
// Throws a readable error instead of returning { error }.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(cleanError(error.message));
  return data;
}
export const rpc = (fn, args) => q(sb.rpc(fn, args));

function cleanError(msg) {
  if (/duplicate key.*product_barcodes/.test(msg)) return 'That barcode is already linked to another product.';
  if (/duplicate key.*sku/.test(msg)) return 'That SKU is already used by another product.';
  if (/duplicate key/.test(msg)) return 'That already exists.';
  if (/row-level security/.test(msg)) return 'You do not have permission to do that.';
  return msg;
}

export async function loadSettings() {
  state.settings = await q(sb.from('settings').select('*').eq('id', 1).single());
  return state.settings;
}

// Look up a product by any of its barcodes (or its SKU).
export async function findByBarcode(code) {
  code = String(code).trim();
  if (!code) return null;
  const bc = await q(sb.from('product_barcodes').select('product_id').eq('barcode', code).maybeSingle());
  const id = bc?.product_id;
  if (id) return q(sb.from('product_stock').select('*').eq('id', id).single());
  return q(sb.from('product_stock').select('*').ilike('sku', code).maybeSingle());
}

// ------------------------------------------------------------------ format
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
export const money = n => (n == null || n === '' ? '—' : gbp.format(Number(n)));
export const num = n => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 }));
export const date = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const isoDate = d => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tiny tagged template: html`<p>${userText}</p>` escapes values. Results of
// html`` (and arrays of them) nest without being escaped again; wrap other
// trusted markup in raw() to insert it as-is.
class Safe extends String {}
export function html(strings, ...vals) {
  return new Safe(strings.reduce((out, s, i) => out + s + (i < vals.length ? toHtml(vals[i]) : ''), ''));
}
export const raw = s => new Safe(String(s ?? ''));
function toHtml(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v instanceof Safe) return String(v);
  return esc(v);
}

// Address-style block: non-empty lines (which may themselves contain newlines) joined with <br>.
export const block = (...lines) => raw(lines.flatMap(l => String(l ?? '').split('\n')).map(l => l.trim()).filter(Boolean).map(esc).join('<br>'));

export const STATUS_LABEL = {
  ok: 'In stock', reorder: 'Reorder', out: 'Out of stock', on_order: 'On order', inactive: 'Inactive',
  unpaid: 'Unpaid', paid: 'Paid', void: 'Void', draft: 'Draft', sent: 'Sent',
  part_received: 'Part received', received: 'Received', cancelled: 'Cancelled',
  open: 'Open', submitted: 'Awaiting approval', approved: 'Approved', 'not started': 'Not started',
  company: 'Company owned', franchise: 'Franchise'
};
export const badge = (status, label) => raw(`<span class="badge ${esc(status)}">${esc(label || STATUS_LABEL[status] || status)}</span>`);

export const REASONS = {
  damaged: 'Damaged', expired: 'Out of date', lost: 'Lost / missing', sample: 'Sample / tasting',
  return_to_supplier: 'Returned to supplier', return_from_store: 'Returned from a store',
  found: 'Found (extra stock)', correction: 'Correction', opening_stock: 'Opening stock', stock_check: 'Stock check'
};
// Reasons where stock goes up rather than down.
export const REASON_ADDS = ['found', 'return_from_store', 'opening_stock'];

// ------------------------------------------------------------------ UI
export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
}
export const fail = e => { console.error(e); toast(e.message || String(e), 'bad'); };

// Opens a modal. `body` is HTML. Returns { el, close }. onClose runs once.
export function modal(title, body, { onClose, wide } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:900px"' : ''}>
    <div class="modal-head"><h2>${esc(title)}</h2><button class="x" aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div></div>`;
  document.body.appendChild(bg);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
    onClose && onClose();
  };
  bg.querySelector('.x').onclick = close;
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  return { el: bg.querySelector('.modal'), close };
}

export function confirmBox(title, message, okLabel = 'Yes', danger = false) {
  return new Promise(resolve => {
    let answered = false;
    const m = modal(title, html`<p>${message}</p>
      <div class="actions"><button class="btn" data-no>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${okLabel}</button></div>`,
      { onClose: () => { if (!answered) resolve(false); } });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-yes]').onclick = () => { answered = true; m.close(); resolve(true); };
  });
}

// Disable a button while an async action runs.
export async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Working…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

export function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${esc(src)}" alt="">`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function options(list, selected, { blank, value = 'id', label = 'name' } = {}) {
  return (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(x => `<option value="${esc(x[value])}" ${x[value] === selected ? 'selected' : ''}>${esc(x[label])}</option>`).join('');
}

// Read a form's named fields into an object ('' becomes null, numbers stay strings).
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

// ------------------------------------------------------------------ photos
const urlCache = new Map();
export async function photoUrl(path) {
  if (!path) return '';
  if (urlCache.has(path)) return urlCache.get(path);
  const { data } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  const url = data?.signedUrl || '';
  urlCache.set(path, url);
  return url;
}

// Fill every <img data-photo="path"> inside root with a signed URL.
export async function hydratePhotos(root) {
  const imgs = [...root.querySelectorAll('img[data-photo]')];
  await Promise.all(imgs.map(async img => {
    img.src = await photoUrl(img.dataset.photo);
    img.onclick = () => lightbox(img.src);
  }));
}

export async function photoStrip(kind, refId) {
  const rows = await q(sb.from('photos').select('path, taken_at').eq('kind', kind).eq('ref_id', refId).order('taken_at'));
  return rows.map(r => `<div class="ph"><img data-photo="${esc(r.path)}" alt=""></div>`).join('');
}

// Shrink a phone photo to max 1600px JPEG before upload.
export function compressImage(file, max = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
    img.src = url;
  });
}

export async function uploadBlob(folder, blob, ext = 'jpg') {
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('photos').upload(path, blob, {
    contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false
  });
  if (error) throw new Error('Photo upload failed: ' + error.message);
  return path;
}

// A "take photo" tile plus thumbnails. Photos upload as soon as they're taken
// so nothing is lost if the signal drops at the end. Returns { paths(), busy() }.
export function photoPicker(container, folder, { label = 'Take photo', onAdd } = {}) {
  const paths = [];
  let pending = 0;
  container.classList.add('photos');
  container.innerHTML = `<label class="photo-add"><span class="ico">📷</span>${esc(label)}
    <input type="file" accept="image/*" capture="environment" multiple></label>`;
  const add = container.querySelector('.photo-add');
  add.querySelector('input').onchange = async e => {
    for (const file of e.target.files) {
      const tile = document.createElement('div');
      tile.className = 'ph';
      tile.innerHTML = '<img alt="" style="opacity:.4">';
      container.insertBefore(tile, add);
      const preview = URL.createObjectURL(file);
      const img = tile.querySelector('img');
      img.src = preview;
      pending++;
      try {
        const blob = await compressImage(file);
        const path = await uploadBlob(folder, blob);
        paths.push(path);
        img.style.opacity = 1;
        if (onAdd) { await onAdd(path); continue; }
        img.onclick = () => lightbox(preview);
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '×';
        del.title = 'Remove photo';
        del.onclick = () => { paths.splice(paths.indexOf(path), 1); tile.remove(); };
        tile.appendChild(del);
      } catch (err) {
        tile.remove();
        fail(err);
      } finally {
        pending--;
      }
    }
    e.target.value = '';
  };
  return { paths: () => [...paths], busy: () => pending > 0 };
}

// ------------------------------------------------------------------ signature
export function signaturePad(wrap) {
  wrap.classList.add('sig-wrap');
  wrap.innerHTML = '<canvas></canvas><div class="sig-line"></div><button type="button" class="btn small clear">Clear</button>';
  const canvas = wrap.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = r.width * ratio;
    canvas.height = r.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    dirty = false;
  };
  requestAnimationFrame(size);
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  wrap.querySelector('.clear').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; };
  return {
    isEmpty: () => !dirty,
    toBlob: () => new Promise(r => canvas.toBlob(r, 'image/png'))
  };
}

// ------------------------------------------------------------------ scanner
// A scan box: type / USB-scanner input plus a camera button.
// onCode(code) is called for each barcode read.
export function scanner(container, onCode, { placeholder = 'Scan or type a barcode', continuous = true } = {}) {
  const id = 'reader-' + Math.random().toString(36).slice(2, 8);
  container.classList.add('scan-box');
  container.innerHTML = `
    <form class="scan-input" autocomplete="off">
      <input type="text" inputmode="numeric" placeholder="${esc(placeholder)}" aria-label="Barcode">
      <button class="btn" type="submit">Add</button>
      <button class="btn primary" type="button" data-cam>📷 Scan</button>
    </form>
    <div id="${id}" class="reader hidden"></div>`;
  const form = container.querySelector('form');
  const input = form.querySelector('input');
  const camBtn = form.querySelector('[data-cam]');
  const readerEl = container.querySelector('#' + id);
  let cam = null, lastCode = '', lastAt = 0;

  form.onsubmit = e => {
    e.preventDefault();
    const code = input.value.trim();
    input.value = '';
    if (code) onCode(code);
  };

  async function start() {
    if (!window.Html5Qrcode) return toast('Camera scanner did not load. Type the barcode instead.', 'bad');
    readerEl.classList.remove('hidden');
    camBtn.textContent = 'Stop camera';
    const F = window.Html5QrcodeSupportedFormats;
    cam = new window.Html5Qrcode(id, {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE, F.DATA_MATRIX],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });
    try {
      await cam.start({ facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.min(w * 0.9, 360), height: Math.min(h * 0.5, 180) }) },
        code => {
          // the camera reads the same code many times a second; ignore repeats for 2s
          const now = Date.now();
          if (code === lastCode && now - lastAt < 2000) return;
          lastCode = code; lastAt = now;
          if (navigator.vibrate) navigator.vibrate(60);
          onCode(code);
          if (!continuous) stop();
        });
    } catch (err) {
      stop();
      toast('Could not open the camera. Allow camera access in your browser settings, or type the barcode.', 'bad');
    }
  }
  async function stop() {
    camBtn.textContent = '📷 Scan';
    readerEl.classList.add('hidden');
    if (cam) {
      try { if (cam.isScanning) await cam.stop(); cam.clear(); } catch (e) { /* already stopped */ }
      cam = null;
    }
  }
  camBtn.onclick = () => (cam ? stop() : start());
  return { stop, focus: () => input.focus() };
}

// Stop any running camera when the page changes.
export const cleanups = [];
export function onLeave(fn) { cleanups.push(fn); }
export function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } }
