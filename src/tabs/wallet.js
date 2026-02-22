import { state, ensureHttp } from '../state.js';

export async function updateWallet() {
  if (!state.nodeInfo) return;
  document.getElementById('nodeId').textContent = state.nodeInfo.node_id.slice(0, 12) + '...';
  document.getElementById('walletNodeId').textContent = state.nodeInfo.node_id;

  try {
    const p2pRes = await fetch(state.nodeUrl + '/api/p2p-info');
    const p2pInfo = await p2pRes.json();
    if (p2pInfo.enabled) {
      document.getElementById('p2pInfoBlock').style.display = 'block';
      document.getElementById('p2pNodeId').textContent = 'iroh: ' + p2pInfo.node_id;
    } else {
      document.getElementById('p2pInfoBlock').style.display = 'none';
    }
  } catch (e) {
    document.getElementById('p2pInfoBlock').style.display = 'none';
  }
  document.getElementById('wOnchain').textContent = (state.nodeInfo.onchain_balance_sats || 0).toLocaleString();
  document.getElementById('wLightning').textContent = (state.nodeInfo.lightning_balance_sats || 0).toLocaleString();
  document.getElementById('walletOnchain').textContent = (state.nodeInfo.onchain_balance_sats || 0).toLocaleString();
  document.getElementById('walletSpendable').textContent = (state.nodeInfo.spendable_onchain_sats || 0).toLocaleString();

  const channels = state.nodeInfo.channels || [];
  document.getElementById('wChannels').textContent = channels.length + ' (' + channels.filter(c => c.usable).length + ' usable)';

  const table = document.getElementById('channelTable');
  while (table.rows.length > 1) table.deleteRow(1);
  document.getElementById('noChannels').style.display = channels.length ? 'none' : 'block';
  channels.forEach(ch => {
    const row = table.insertRow();
    const ucid = ch.user_channel_id || '';
    const cpId = ch.counterparty_node_id || '';
    row.innerHTML = `
      <td class="mono">${cpId.slice(0, 16)}...</td>
      <td class="price">${(ch.channel_value_sats || ch.value_sats || 0).toLocaleString()} sats</td>
      <td>${Math.round((ch.outbound_capacity_msat || ch.outbound_msat || 0) / 1000).toLocaleString()} sats</td>
      <td>${Math.round((ch.inbound_capacity_msat || ch.inbound_msat || 0) / 1000).toLocaleString()} sats</td>
      <td><span class="badge ${ch.usable ? 'badge-green' : 'badge-yellow'}">${ch.usable ? 'Usable' : ch.is_channel_ready || ch.ready ? 'Ready' : 'Pending'}</span></td>
      <td><button class="btn btn-secondary" style="font-size:10px;padding:2px 8px;color:#f85149;" onclick="closeChannel('${ucid}','${cpId}')">Close</button></td>
    `;
  });
}

export async function fetchAddress() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/address');
    const data = await r.json();
    if (data.address) {
      document.getElementById('walletAddress').textContent = data.address;
    }
  } catch (e) {
    document.getElementById('walletAddress').textContent = 'Failed to fetch address';
  }
}

export function copyAddress() {
  const addr = document.getElementById('walletAddress').textContent;
  if (!addr || addr === '--' || addr.startsWith('Failed')) return;
  navigator.clipboard.writeText(addr).then(() => {
    const el = document.getElementById('walletAddress');
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.style.color = '#3fb950';
    setTimeout(() => { el.textContent = orig; el.style.color = ''; }, 1500);
  });
}

export async function openChannel() {
  const nid = document.getElementById('openChNodeId').value.trim();
  const addr = document.getElementById('openChAddr').value.trim();
  const amount = parseInt(document.getElementById('openChAmount').value, 10);
  const statusEl = document.getElementById('openChStatus');

  if (!nid || !addr || !amount) {
    statusEl.textContent = 'All fields are required';
    statusEl.style.color = '#f85149';
    return;
  }

  statusEl.textContent = 'Opening channel...';
  statusEl.style.color = '#8b949e';
  document.getElementById('openChBtn').disabled = true;

  try {
    const r = await fetch(state.nodeUrl + '/api/channels/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nid, addr: addr, amount_sats: amount })
    });
    const data = await r.json();
    if (r.ok) {
      statusEl.textContent = data.message || 'Channel opening initiated';
      statusEl.style.color = '#3fb950';
      setTimeout(() => updateWallet(), 3000);
    } else {
      statusEl.textContent = data.error || 'Failed';
      statusEl.style.color = '#f85149';
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#f85149';
  }
  document.getElementById('openChBtn').disabled = false;
}

export async function closeChannel(userChannelId, counterpartyNodeId) {
  if (!confirm('Close this channel? Funds will return on-chain.')) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/channels/' + userChannelId + '/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counterparty_node_id: counterpartyNodeId })
    });
    const data = await r.json();
    if (r.ok) {
      alert(data.message || 'Channel close initiated');
      setTimeout(() => updateWallet(), 3000);
    } else {
      alert('Error: ' + (data.error || 'Failed'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

export async function loadPeerSuggestions() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/channels/peers');
    const data = await r.json();
    const peers = data.peers || [];
    if (!peers.length) return;
    const container = document.getElementById('peerList');
    const wrapper = document.getElementById('peerSuggestions');
    container.innerHTML = '';
    wrapper.style.display = 'block';
    peers.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'font-size:11px;padding:4px 10px;';
      btn.textContent = p.alias || p.node_id.slice(0, 12) + '...';
      btn.title = p.node_id + ' @ ' + p.addr;
      btn.addEventListener('click', () => {
        document.getElementById('openChNodeId').value = p.node_id;
        const host = p.addr.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const parts = host.split(':');
        const ln_addr = parts.length >= 2 ? parts[0] + ':9735' : host + ':9735';
        document.getElementById('openChAddr').value = ln_addr;
      });
      container.appendChild(btn);
    });
  } catch (e) {}
}

export function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(async () => {
    if (!state.nodeUrl) return;
    try {
      const r = await fetch(state.nodeUrl + '/api/info');
      state.nodeInfo = await r.json();
      updateWallet();
    } catch (e) {}
  }, 30000);
}
