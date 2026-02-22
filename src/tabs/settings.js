import { state } from '../state.js';
import { updateWallet, fetchAddress, loadPeerSuggestions, startAutoRefresh } from './wallet.js';
import { connectSSE } from '../sse.js';
import { loadCatalog } from './library.js';
import { loadCreatorCatalog } from './creator.js';
import { renderCollection, loadReceipts } from './collection.js';
import { loadAdvertiserInfo } from './advertiser.js';
import { loadSeederInfo } from './seeder.js';

export async function connectNode() {
  state.nodeUrl = document.getElementById('settNodeUrl').value.trim().replace(/\/+$/, '');
  state.registryUrl = document.getElementById('settRegistryUrl').value.trim().replace(/\/+$/, '');
  localStorage.setItem('conduit_nodeUrl', state.nodeUrl);
  localStorage.setItem('conduit_registryUrl', state.registryUrl);

  if (!state.nodeUrl) {
    document.getElementById('settStatus').textContent = 'Enter a Node URL';
    return;
  }

  document.getElementById('settStatus').textContent = 'Connecting...';
  try {
    const r = await fetch(state.nodeUrl + '/api/info');
    state.nodeInfo = await r.json();
    document.getElementById('settStatus').textContent = 'Connected';
    document.getElementById('settStatus').className = 'status ok';
    const badge = document.getElementById('nodeStatusBadge');
    badge.textContent = 'connected';
    badge.style.background = 'rgba(63,185,80,0.15)';
    badge.style.color = '#3fb950';
    updateWallet();
    fetchAddress();
    connectSSE();
    loadCatalog();
    loadCreatorCatalog();
    renderCollection();
    loadReceipts();
    loadAdvertiserInfo();
    loadSeederInfo();
    loadTrustList();
    loadPeerSuggestions();
    startAutoRefresh();
  } catch (e) {
    document.getElementById('settStatus').textContent = 'Failed: ' + e.message;
    document.getElementById('settStatus').className = 'status';
  }
}

export async function loadTrustList() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/trusted-manufacturers');
    const data = await r.json();
    const items = data.items || [];
    const container = document.getElementById('trustListContainer');
    if (!items.length) {
      container.innerHTML = '<p class="empty">No trusted manufacturers yet</p>';
      return;
    }
    let html = '<table><tr><th>Name</th><th>Public Key</th><th></th></tr>';
    items.forEach(m => {
      html += `<tr>
        <td>${m.name}</td>
        <td class="mono">${m.pk_hex.slice(0, 20)}...${m.pk_hex.slice(-8)}</td>
        <td><button class="btn" style="padding:2px 8px;font-size:11px;" onclick="removeTrustedManufacturer('${m.pk_hex}')">Remove</button></td>
      </tr>`;
    });
    html += '</table>';
    container.innerHTML = html;
  } catch (e) {
    document.getElementById('trustListContainer').innerHTML = '<p class="empty">Failed to load: ' + e.message + '</p>';
  }
}

export async function addTrustedManufacturer() {
  const pk = document.getElementById('trustPkHex').value.trim();
  const name = document.getElementById('trustName').value.trim();
  const status = document.getElementById('trustStatus');
  if (!pk || !name) { status.textContent = 'Both fields required'; status.style.color = '#f85149'; return; }
  if (!state.nodeUrl) { status.textContent = 'Connect to node first'; status.style.color = '#f85149'; return; }
  try {
    const r = await fetch(state.nodeUrl + '/api/trusted-manufacturers', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ pk_hex: pk, name: name })
    });
    const data = await r.json();
    if (r.ok) {
      status.textContent = 'Added'; status.style.color = '#3fb950';
      document.getElementById('trustPkHex').value = '';
      document.getElementById('trustName').value = '';
      loadTrustList();
    } else {
      status.textContent = data.error || 'Failed'; status.style.color = '#f85149';
    }
  } catch (e) {
    status.textContent = 'Error: ' + e.message; status.style.color = '#f85149';
  }
}

export async function removeTrustedManufacturer(pkHex) {
  if (!state.nodeUrl) return;
  try {
    await fetch(state.nodeUrl + '/api/trusted-manufacturers/' + pkHex, { method: 'DELETE' });
    loadTrustList();
  } catch (e) {}
}
