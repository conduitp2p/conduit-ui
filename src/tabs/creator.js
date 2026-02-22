import { state } from '../state.js';
import { fmtSize } from '../utils.js';

export async function registerContent() {
  const filePath = document.getElementById('regFilePath').value.trim();
  const price = parseInt(document.getElementById('regPrice').value, 10);
  const statusEl = document.getElementById('regStatus');

  if (!filePath) { statusEl.textContent = 'File path is required'; statusEl.style.color = '#f85149'; return; }
  if (!price || price < 1) { statusEl.textContent = 'Price must be at least 1 sat'; statusEl.style.color = '#f85149'; return; }
  if (!state.nodeUrl) { statusEl.textContent = 'Connect to a node first (Settings tab)'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Registering...';
  statusEl.style.color = '#8b949e';

  try {
    const r = await fetch(state.nodeUrl + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, price: price }),
    });
    const data = await r.json();
    if (data.error) {
      statusEl.textContent = 'Error: ' + data.error;
      statusEl.style.color = '#f85149';
    } else {
      statusEl.textContent = 'Registration started — encrypting and cataloging...';
      statusEl.style.color = '#3fb950';
      setTimeout(() => loadCreatorCatalog(), 3000);
    }
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

export function handleCreatorEvent(ev) {
  if (ev.event_type === 'REGISTERED' || ev.event_type === 'ALREADY_REGISTERED') {
    loadCreatorCatalog();
  }
}

export async function loadCreatorCatalog() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/catalog');
    const data = await r.json();
    const allItems = data.items || data.catalog || (Array.isArray(data) ? data : []);
    const items = allItems.filter(i => (i.price_sats && i.price_sats > 0) || (i.content_hash && i.content_hash.length > 0));
    const table = document.getElementById('creatorCatalogTable');
    while (table.rows.length > 1) table.deleteRow(1);
    document.getElementById('noCreatorCatalog').style.display = items.length ? 'none' : 'block';
    items.forEach(item => {
      const row = table.insertRow();
      row.innerHTML = `
        <td>${item.file_name || '--'}</td>
        <td class="price">${item.price_sats || 0} sats</td>
        <td>${fmtSize(item.size_bytes || 0)}</td>
        <td class="mono dev-only dev-only-table-cell" title="${item.content_hash || ''}">${(item.content_hash || '').slice(0, 16)}...</td>
      `;
    });
  } catch (e) {}
}
