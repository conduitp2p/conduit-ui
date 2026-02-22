import { state, getMode } from '../state.js';
import { fmtSize } from '../utils.js';
import { renderCatalog } from './library.js';

export function recordPurchase(data) {
  if (!state.selectedItem) return;
  const purchase = {
    content_hash: state.selectedItem.content_hash || '',
    file_name: state.selectedItem.file_name || data.path?.split('/').pop() || 'unknown',
    price_sats: state.selectedItem.price_sats || 0,
    size_bytes: state.selectedItem.size_bytes || data.bytes || 0,
    output_path: data.path || data.output || '',
    purchased_at: new Date().toISOString(),
    mode: getMode(),
    creator_address: state.selectedItem.creator_address || '',
  };
  const existing = state.purchases.findIndex(p => p.content_hash === purchase.content_hash);
  if (existing >= 0) state.purchases[existing] = purchase;
  else state.purchases.unshift(purchase);
  localStorage.setItem('conduit_purchases', JSON.stringify(state.purchases));
  renderCollection();
  renderCatalog();
}

export function renderCollection() {
  const container = document.getElementById('collectionList');
  const emptyMsg = document.getElementById('noCollection');
  if (!container) return;
  container.innerHTML = '';
  emptyMsg.style.display = state.purchases.length ? 'none' : 'block';
  state.purchases.forEach((p, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid #21262d;border-radius:8px;margin-bottom:8px;background:#161b22;';
    const ext = (p.file_name || '').split('.').pop().toUpperCase();
    const fileName = p.output_path ? p.output_path.split('/').pop() : '';
    const previewUrl = fileName && state.nodeUrl ? state.nodeUrl + '/api/decrypted/' + fileName : '';
    const date = p.purchased_at ? new Date(p.purchased_at).toLocaleDateString() : '';
    const modeLabel = p.mode === 'ad' ? 'Ad-subsidized' : p.mode === 'chunked' ? 'Chunked' : p.mode === 'seeder' ? 'Seeder' : 'Direct';
    div.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;color:#e6edf3;">${p.file_name || 'Unknown'}</div>
        <div style="font-size:11px;color:#8b949e;margin-top:2px;">
          ${ext} &middot; ${fmtSize(p.size_bytes || 0)} &middot; ${p.price_sats} sats &middot; ${date}
          ${state.devMode ? ' &middot; ' + modeLabel : ''}
        </div>
        ${state.devMode ? `<div class="mono" style="font-size:10px;color:#484f58;margin-top:2px;">${(p.content_hash || '').slice(0, 32)}...</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;">
        ${previewUrl ? `<a href="${previewUrl}" target="_blank" class="btn btn-secondary" style="font-size:11px;padding:4px 10px;text-decoration:none;">Open</a>` : ''}
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;color:#f85149;" onclick="removePurchase(${idx})">Remove</button>
      </div>
    `;
    container.appendChild(div);
  });
}

export function removePurchase(idx) {
  state.purchases.splice(idx, 1);
  localStorage.setItem('conduit_purchases', JSON.stringify(state.purchases));
  renderCollection();
}

export function tryPreview(data) {
  const container = document.getElementById('buyPreview');
  const file = data.output || data.path || '';
  if (!file || !state.nodeUrl) return;
  const url = state.nodeUrl + '/api/decrypted/' + file.split('/').pop();
  const ext = file.split('.').pop().toLowerCase();
  const fname = file.split('/').pop();
  container.style.display = 'block';
  if (['mp3', 'ogg', 'wav', 'opus', 'flac', 'aac', 'm4a'].includes(ext)) {
    container.innerHTML = `<audio controls src="${url}" style="width:100%;"></audio>`;
  } else if (['mp4', 'webm', 'mov'].includes(ext)) {
    container.innerHTML = `<video controls src="${url}" style="width:100%;"></video>`;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    container.innerHTML = `<img src="${url}" alt="Preview">`;
  } else if (ext === 'pdf') {
    container.innerHTML = `<embed src="${url}" type="application/pdf" style="width:100%;height:500px;">
      <p><a href="${url}" target="_blank" class="btn btn-secondary">Open PDF: ${fname}</a></p>`;
  } else {
    container.innerHTML = `<div style="text-align:center;padding:1.5rem;">
      <div style="font-size:2rem;margin-bottom:0.5rem;">📄</div>
      <div style="color:#888;margin-bottom:0.8rem;">${ext.toUpperCase()} file &middot; ${fname}</div>
      <a href="${url}" target="_blank" class="btn btn-secondary" style="display:inline-block;padding:0.5rem 1.2rem;background:#222;color:#fff;border-radius:6px;text-decoration:none;">Download</a>
    </div>`;
  }
}
