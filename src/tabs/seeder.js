import { state } from '../state.js';

export async function registerSeed() {
  const filePath = document.getElementById('seedFilePath').value.trim();
  const encHash = document.getElementById('seedEncHash').value.trim();
  const price = parseInt(document.getElementById('seedPrice').value, 10);
  const statusEl = document.getElementById('seedStatus');

  if (!filePath) { statusEl.textContent = 'Encrypted file path is required'; statusEl.style.color = '#f85149'; return; }
  if (!encHash) { statusEl.textContent = 'Encrypted hash is required'; statusEl.style.color = '#f85149'; return; }
  if (!price || price < 1) { statusEl.textContent = 'Transport price must be at least 1 sat'; statusEl.style.color = '#f85149'; return; }
  if (!state.nodeUrl) { statusEl.textContent = 'Connect to a node first (Settings tab)'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Registering seed...';
  statusEl.style.color = '#8b949e';

  try {
    const r = await fetch(state.nodeUrl + '/api/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encrypted_file: filePath,
        encrypted_hash: encHash,
        transport_price: price,
      }),
    });
    const data = await r.json();
    if (data.error) {
      statusEl.textContent = 'Error: ' + data.error;
      statusEl.style.color = '#f85149';
    } else {
      statusEl.textContent = 'Seed registered successfully';
      statusEl.style.color = '#3fb950';
      setTimeout(() => loadSeederInfo(), 2000);
    }
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

export async function loadSeederInfo() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/catalog');
    const data = await r.json();
    const items = (data.items || data.catalog || (Array.isArray(data) ? data : [])).filter(i =>
      (i.transport_price && i.transport_price > 0) ||
      (i.chunks_held && i.chunks_held.length > 0)
    );
    const table = document.getElementById('seederTable');
    while (table.rows.length > 1) table.deleteRow(1);
    document.getElementById('noSeeds').style.display = items.length ? 'none' : 'block';
    items.forEach(item => {
      const row = table.insertRow();
      row.innerHTML = `
        <td>${item.file_name || '--'}</td>
        <td>${item.chunk_count || (item.chunks_held || []).length || '--'}</td>
        <td class="price">${item.transport_price || 0} sats</td>
        <td class="mono" title="${item.encrypted_hash || ''}">${(item.encrypted_hash || '').slice(0, 16)}...</td>
      `;
    });
  } catch (e) {}
}
