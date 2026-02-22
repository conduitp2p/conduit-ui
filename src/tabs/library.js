import { state, ensureHttp } from '../state.js';
import { fmtSize } from '../utils.js';
import { onItemSelected } from '../buy/index.js';

export async function loadCatalog() {
  if (!state.registryUrl) {
    document.getElementById('noLibraryCatalog').textContent = 'Enter a Registry URL in Settings to browse content';
    return;
  }
  document.getElementById('noLibraryCatalog').textContent = 'Loading...';
  try {
    const r = await fetch(state.registryUrl + '/api/listings');
    const data = await r.json();
    state.catalog = data.items || data.listings || (Array.isArray(data) ? data : []);
    renderCatalog();
  } catch (e) {
    document.getElementById('noLibraryCatalog').textContent = 'Failed to load catalog: ' + e.message;
  }
}

export function isPurchased(contentHash) {
  return state.purchases.some(p => p.content_hash === contentHash);
}

export function renderCatalog() {
  const container = document.getElementById('libraryCatalog');
  container.innerHTML = '';
  if (!state.catalog.length) {
    container.innerHTML = '<p class="empty">No content available on registry</p>';
    return;
  }
  state.catalog.forEach(item => {
    const div = document.createElement('div');
    div.className = 'catalog-item' + (state.selectedItem && state.selectedItem.content_hash === item.content_hash ? ' selected' : '');
    const ext = (item.file_name || '').split('.').pop().toUpperCase();
    let creator = '';
    if (item.creator_address) {
      try { creator = ' from ' + new URL(ensureHttp(item.creator_address)).hostname; }
      catch { creator = ' from ' + item.creator_address.replace(/:\d+$/, ''); }
    }
    const owned = isPurchased(item.content_hash) ? '<span class="owned-badge">OWNED</span>' : '';
    const pre = item.pre_c1_hex ? '<span class="pre-badge">PRE</span>' : '';
    const device = (item.playback_policy === 'device_required' || item.playback_policy === 'device_recommended')
      ? '<span class="device-badge">DEVICE</span>' : '';
    div.innerHTML = `
      <div>
        <div class="name">${item.file_name || 'Unknown'}${pre}${device}${owned}</div>
        <div class="meta">${ext} &middot; ${fmtSize(item.size_bytes || 0)}${creator}</div>
      </div>
      <div class="price">${item.price_sats || 0} sats</div>
    `;
    div.addEventListener('click', () => selectItem(item));
    container.appendChild(div);
  });
}

export function selectItem(item) {
  state.selectedItem = item;
  renderCatalog();
  document.getElementById('buyCard').style.display = 'block';
  document.getElementById('buyTitle').textContent = item.file_name || 'Unknown';
  document.getElementById('buyMeta').textContent = `${fmtSize(item.size_bytes || 0)} | ${item.price_sats || 0} sats`;
  document.getElementById('buyHash').textContent = item.content_hash || '';
  document.getElementById('buyCreatorAddr').textContent = item.creator_address ? 'Creator: ' + item.creator_address : '';
  document.getElementById('buyBtn').disabled = false;
  document.getElementById('buyProgress').style.display = 'none';
  document.getElementById('buyProgress').innerHTML = '';
  document.getElementById('buyResult').style.display = 'none';
  document.getElementById('buyPreview').style.display = 'none';
  const radio = document.querySelector('input[name="buyMode"][value="pre"]');
  if (radio) radio.checked = true;
  onItemSelected(item.content_hash);
  const notice = document.getElementById('deviceNotice');
  if (item.playback_policy === 'device_required') {
    notice.textContent = 'This content requires a verified TEE device for playback.';
    notice.style.display = 'block';
  } else if (item.playback_policy === 'device_recommended') {
    notice.textContent = 'This content is best viewed on a verified TEE device.';
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }
}
