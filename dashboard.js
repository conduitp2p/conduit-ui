// ================================================================
// Service Worker
// ================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ================================================================
// State
// ================================================================
let nodeUrl = localStorage.getItem('conduit_nodeUrl') || '';
let registryUrl = localStorage.getItem('conduit_registryUrl') || '';
let nodeInfo = null;
let catalog = [];
let selectedItem = null;
let eventSource = null;
let events = [];
let eventFilter = 'all';
let lastOutputFile = '';
let refreshTimer = null;
let purchases = JSON.parse(localStorage.getItem('conduit_purchases') || '[]');
let devMode = localStorage.getItem('conduit_devMode') === '1';

function toggleDevMode(on) {
  devMode = on;
  localStorage.setItem('conduit_devMode', on ? '1' : '0');
  document.body.classList.toggle('dev-mode', on);
  document.getElementById('devModeToggle').checked = on;
}
toggleDevMode(devMode);

// Ensure a URL has an http:// prefix (registry creator_address often omits it)
function ensureHttp(addr) {
  if (!addr) return '';
  if (addr.startsWith('http://') || addr.startsWith('https://')) return addr;
  return 'http://' + addr;
}

// Populate settings from storage
document.getElementById('settNodeUrl').value = nodeUrl;
document.getElementById('settRegistryUrl').value = registryUrl;

// ================================================================
// Onboarding wizard
// ================================================================
let obFundPoll = null;

function shouldShowOnboarding() {
  if (localStorage.getItem('conduit_onboarded') === '1') return false;
  return !nodeUrl;
}

function showOnboarding() {
  document.getElementById('onboardingOverlay').classList.remove('hidden');
  if (nodeUrl) document.getElementById('obNodeUrl').value = nodeUrl;
  if (registryUrl) document.getElementById('obRegistryUrl').value = registryUrl;
}

function obGoStep(n) {
  document.querySelectorAll('.onboard-section').forEach(s => s.classList.remove('active'));
  document.getElementById('ob-step' + n).classList.add('active');
  document.querySelectorAll('.onboard-step').forEach(s => {
    const step = parseInt(s.dataset.ob);
    s.classList.remove('active', 'done');
    if (step < n) s.classList.add('done');
    if (step === n) s.classList.add('active');
  });
  if (n === 2) obStartFundPolling();
  if (n === 3) obLoadPeers();
}

async function obConnect() {
  const url = document.getElementById('obNodeUrl').value.trim().replace(/\/+$/, '');
  const regUrl = document.getElementById('obRegistryUrl').value.trim().replace(/\/+$/, '');
  const statusEl = document.getElementById('obConnStatus');
  if (!url) { statusEl.textContent = 'Enter a node URL'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Connecting...'; statusEl.style.color = '#8b949e';
  try {
    const r = await fetch(url + '/api/info');
    const info = await r.json();
    nodeUrl = url;
    registryUrl = regUrl;
    localStorage.setItem('conduit_nodeUrl', nodeUrl);
    localStorage.setItem('conduit_registryUrl', registryUrl);
    nodeInfo = info;
    document.getElementById('settNodeUrl').value = nodeUrl;
    document.getElementById('settRegistryUrl').value = registryUrl;
    statusEl.textContent = 'Connected to ' + (info.node_alias || info.node_id.slice(0,12) + '...');
    statusEl.style.color = '#3fb950';

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

    if (info.channels && info.channels.length > 0 && info.channels.some(c => c.usable)) {
      obGoStep(4);
    } else if (info.onchain_balance_sats > 20000) {
      obGoStep(3);
    } else {
      obGoStep(2);
    }
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

async function obStartFundPolling() {
  if (obFundPoll) clearInterval(obFundPoll);
  try {
    const r = await fetch(nodeUrl + '/api/address');
    const d = await r.json();
    if (d.address) document.getElementById('obFundAddr').textContent = d.address;
  } catch (_) {}
  obUpdateBalance();
  obFundPoll = setInterval(obUpdateBalance, 10000);
}

async function obUpdateBalance() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/info');
    const info = await r.json();
    nodeInfo = info;
    const bal = info.onchain_balance_sats || 0;
    document.getElementById('obBalance').textContent = bal.toLocaleString() + ' sats';
    if (bal >= 20000) {
      document.getElementById('obFundStatus').textContent = 'Balance sufficient! You can proceed.';
      document.getElementById('obFundStatus').style.color = '#3fb950';
    }
    if (info.channels && info.channels.some(c => c.usable)) {
      clearInterval(obFundPoll);
      obGoStep(4);
    }
  } catch (_) {}
}

function obCopyAddr() {
  const addr = document.getElementById('obFundAddr').textContent;
  if (!addr || addr.startsWith('Loading')) return;
  navigator.clipboard.writeText(addr).then(() => {
    const el = document.getElementById('obFundAddr');
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.style.color = '#3fb950';
    setTimeout(() => { el.textContent = orig; el.style.color = ''; }, 1500);
  });
}

async function obLoadPeers() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/channels/peers');
    const data = await r.json();
    const peers = data.peers || [];
    const container = document.getElementById('obPeerBtns');
    container.innerHTML = '';
    peers.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'font-size:11px;padding:4px 10px;';
      btn.textContent = p.alias || p.node_id.slice(0, 12) + '...';
      btn.title = p.node_id;
      btn.addEventListener('click', () => {
        document.getElementById('obChNodeId').value = p.node_id;
        const host = p.addr.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const parts = host.split(':');
        document.getElementById('obChAddr').value = parts[0] + ':9735';
      });
      container.appendChild(btn);
    });
  } catch (_) {}
}

async function obOpenChannel() {
  const nid = document.getElementById('obChNodeId').value.trim();
  const addr = document.getElementById('obChAddr').value.trim();
  const amount = parseInt(document.getElementById('obChAmount').value, 10);
  const statusEl = document.getElementById('obChStatus');

  if (!nid || !addr || !amount) {
    statusEl.textContent = 'All fields are required';
    statusEl.style.color = '#f85149';
    return;
  }

  statusEl.textContent = 'Opening channel...';
  statusEl.style.color = '#8b949e';
  document.getElementById('obChBtn').disabled = true;

  try {
    const r = await fetch(nodeUrl + '/api/channels/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nid, addr: addr, amount_sats: amount })
    });
    const data = await r.json();
    if (r.ok) {
      statusEl.innerHTML = '<span style="color:#3fb950;">Channel opening initiated!</span> Waiting for confirmation (may take a few minutes)...';
      const poll = setInterval(async () => {
        try {
          const ir = await fetch(nodeUrl + '/api/info');
          const info = await ir.json();
          nodeInfo = info;
          updateWallet();
          if (info.channels && info.channels.some(c => c.usable)) {
            clearInterval(poll);
            obGoStep(4);
          }
        } catch (_) {}
      }, 15000);
    } else {
      statusEl.textContent = data.error || 'Failed';
      statusEl.style.color = '#f85149';
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#f85149';
  }
  document.getElementById('obChBtn').disabled = false;
}

function obFinish() {
  if (obFundPoll) clearInterval(obFundPoll);
  localStorage.setItem('conduit_onboarded', '1');
  document.getElementById('onboardingOverlay').classList.add('hidden');
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const libBtn = document.querySelector('.tab-bar button[data-tab="library"]');
  libBtn.classList.add('active');
  document.getElementById('tab-library').classList.add('active');
}

if (shouldShowOnboarding()) showOnboarding();

// ================================================================
// Tabs
// ================================================================
document.querySelectorAll('.tab-bar button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'network' && !netGraphBuilt) loadNetworkGraph();
  });
});

// ================================================================
// Connect to node
// ================================================================
async function connectNode() {
  nodeUrl = document.getElementById('settNodeUrl').value.trim().replace(/\/+$/, '');
  registryUrl = document.getElementById('settRegistryUrl').value.trim().replace(/\/+$/, '');
  localStorage.setItem('conduit_nodeUrl', nodeUrl);
  localStorage.setItem('conduit_registryUrl', registryUrl);

  if (!nodeUrl) {
    document.getElementById('settStatus').textContent = 'Enter a Node URL';
    return;
  }

  document.getElementById('settStatus').textContent = 'Connecting...';
  try {
    const r = await fetch(nodeUrl + '/api/info');
    nodeInfo = await r.json();
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

// ================================================================
// Trusted Manufacturers
// ================================================================
async function loadTrustList() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/trusted-manufacturers');
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

async function addTrustedManufacturer() {
  const pk = document.getElementById('trustPkHex').value.trim();
  const name = document.getElementById('trustName').value.trim();
  const status = document.getElementById('trustStatus');
  if (!pk || !name) { status.textContent = 'Both fields required'; status.style.color = '#f85149'; return; }
  if (!nodeUrl) { status.textContent = 'Connect to node first'; status.style.color = '#f85149'; return; }
  try {
    const r = await fetch(nodeUrl + '/api/trusted-manufacturers', {
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

async function removeTrustedManufacturer(pkHex) {
  if (!nodeUrl) return;
  try {
    await fetch(nodeUrl + '/api/trusted-manufacturers/' + pkHex, { method: 'DELETE' });
    loadTrustList();
  } catch (e) {}
}

// ================================================================
// Auto-refresh (balance + catalogs every 30s)
// ================================================================
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!nodeUrl) return;
    try {
      const r = await fetch(nodeUrl + '/api/info');
      nodeInfo = await r.json();
      updateWallet();
    } catch (e) {}
  }, 30000);
}

// ================================================================
// Wallet
// ================================================================
async function updateWallet() {
  if (!nodeInfo) return;
  document.getElementById('nodeId').textContent = nodeInfo.node_id.slice(0, 12) + '...';
  document.getElementById('walletNodeId').textContent = nodeInfo.node_id;

  try {
    const p2pRes = await fetch(nodeUrl + '/api/p2p-info');
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
  document.getElementById('wOnchain').textContent = (nodeInfo.onchain_balance_sats || 0).toLocaleString();
  document.getElementById('wLightning').textContent = (nodeInfo.lightning_balance_sats || 0).toLocaleString();
  document.getElementById('walletOnchain').textContent = (nodeInfo.onchain_balance_sats || 0).toLocaleString();
  document.getElementById('walletSpendable').textContent = (nodeInfo.spendable_onchain_sats || 0).toLocaleString();

  const channels = nodeInfo.channels || [];
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

async function fetchAddress() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/address');
    const data = await r.json();
    if (data.address) {
      document.getElementById('walletAddress').textContent = data.address;
    }
  } catch (e) {
    document.getElementById('walletAddress').textContent = 'Failed to fetch address';
  }
}

function copyAddress() {
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

// ================================================================
// Channel management
// ================================================================
async function openChannel() {
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
    const r = await fetch(nodeUrl + '/api/channels/open', {
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

async function closeChannel(userChannelId, counterpartyNodeId) {
  if (!confirm('Close this channel? Funds will return on-chain.')) return;
  try {
    const r = await fetch(nodeUrl + '/api/channels/' + userChannelId + '/close', {
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

async function loadPeerSuggestions() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/channels/peers');
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

// ================================================================
// SSE events (history backfill then live stream)
// ================================================================
async function connectSSE() {
  if (eventSource) eventSource.close();
  // Backfill from persistent log (oldest-first from API; prepend in reverse so newest at top)
  try {
    const r = await fetch(nodeUrl + '/api/events/history?limit=500');
    const history = await r.json();
    if (Array.isArray(history) && history.length) {
      for (let i = history.length - 1; i >= 0; i--) {
        const ev = history[i];
        events.unshift(ev);
        renderEvent(ev);
      }
      if (events.length > 500) events.splice(500);
    }
  } catch (e) {}
  eventSource = new EventSource(nodeUrl + '/api/events');
  eventSource.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data);
      events.unshift(ev);
      if (events.length > 500) events.pop();
      renderEvent(ev);
      handleBuyerEvent(ev);
      handleCreatorEvent(ev);
    } catch (e) {}
  };
  eventSource.onerror = () => {
    document.getElementById('nodeId').textContent = 'SSE disconnected — reconnecting...';
  };
}

function renderEvent(ev) {
  if (eventFilter !== 'all' && ev.role !== eventFilter) return;
  document.getElementById('noEvents').style.display = 'none';
  const list = document.getElementById('eventList');
  const div = document.createElement('div');
  div.className = 'event-item';
  const ts = ev.timestamp ? ev.timestamp.split('T').pop().split('.')[0] || ev.timestamp : '';
  div.innerHTML = `
    <span class="time">${ts}</span>
    <span class="role-tag ${ev.role || ''}">${ev.role || '?'}</span>
    <span class="type">${ev.event_type || ''}</span>
    <span class="payload">${JSON.stringify(ev.data || {}).slice(0, 120)}</span>
  `;
  list.prepend(div);
}

// Event filter buttons
document.querySelectorAll('#eventFilter button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#eventFilter button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    eventFilter = btn.dataset.filter;
    document.getElementById('eventList').innerHTML = '';
    document.getElementById('noEvents').style.display = events.length ? 'none' : 'block';
    events.forEach(ev => renderEvent(ev));
  });
});

// ================================================================
// Creator: register content
// ================================================================
async function registerContent() {
  const filePath = document.getElementById('regFilePath').value.trim();
  const price = parseInt(document.getElementById('regPrice').value, 10);
  const statusEl = document.getElementById('regStatus');

  if (!filePath) { statusEl.textContent = 'File path is required'; statusEl.style.color = '#f85149'; return; }
  if (!price || price < 1) { statusEl.textContent = 'Price must be at least 1 sat'; statusEl.style.color = '#f85149'; return; }
  if (!nodeUrl) { statusEl.textContent = 'Connect to a node first (Settings tab)'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Registering...';
  statusEl.style.color = '#8b949e';

  try {
    const r = await fetch(nodeUrl + '/api/register', {
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
      // Refresh catalog after a short delay to pick up the new entry
      setTimeout(() => loadCreatorCatalog(), 3000);
    }
  } catch (e) {
    statusEl.textContent = 'Failed: ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

// Handle creator SSE events (auto-refresh catalog on REGISTERED)
function handleCreatorEvent(ev) {
  if (ev.event_type === 'REGISTERED' || ev.event_type === 'ALREADY_REGISTERED') {
    loadCreatorCatalog();
  }
}

// ================================================================
// Creator catalog display
// ================================================================
async function loadCreatorCatalog() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/catalog');
    const data = await r.json();
    const allItems = data.items || data.catalog || (Array.isArray(data) ? data : []);
    // Creator entries have price_sats > 0 or a non-empty content_hash; exclude seeder-only entries
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

// ================================================================
// Library (buyer catalog from registry)
// ================================================================
async function loadCatalog() {
  if (!registryUrl) {
    document.getElementById('noLibraryCatalog').textContent = 'Enter a Registry URL in Settings to browse content';
    return;
  }
  document.getElementById('noLibraryCatalog').textContent = 'Loading...';
  try {
    const r = await fetch(registryUrl + '/api/listings');
    const data = await r.json();
    // Registry returns { items: [...] }
    catalog = data.items || data.listings || (Array.isArray(data) ? data : []);
    renderCatalog();
  } catch (e) {
    document.getElementById('noLibraryCatalog').textContent = 'Failed to load catalog: ' + e.message;
  }
}

function isPurchased(contentHash) {
  return purchases.some(p => p.content_hash === contentHash);
}

function renderCatalog() {
  const container = document.getElementById('libraryCatalog');
  container.innerHTML = '';
  if (!catalog.length) {
    container.innerHTML = '<p class="empty">No content available on registry</p>';
    return;
  }
  catalog.forEach(item => {
    const div = document.createElement('div');
    div.className = 'catalog-item' + (selectedItem && selectedItem.content_hash === item.content_hash ? ' selected' : '');
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

function selectItem(item) {
  selectedItem = item;
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
  loadSourceOptions(item.content_hash);
  // Show device notice for TEE-required content
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

// ================================================================
// Source picker (ICS)
// ================================================================
async function loadSourceOptions(contentHash) {
  const infoEl = document.getElementById('icsInfo');
  const pickerEl = document.getElementById('seederPicker');
  if (!nodeUrl || !contentHash) return;
  try {
    const r = await fetch(nodeUrl + '/api/discover-sources/' + contentHash);
    const data = await r.json();
    if (infoEl) {
      infoEl.textContent = 'ICS mode: ' + (data.ics_mode || 'RELEASE') + ' | ' + (data.sources?.length || 0) + ' sources (' + (data.complete_sources || 0) + ' complete)';
    }
    if (pickerEl && data.sources) {
      pickerEl.innerHTML = '';
      data.sources.filter(function(s) { return s.type === 'seeder'; }).forEach(function(s) {
        const opt = document.createElement('option');
        opt.value = ensureHttp(s.url);
        opt.textContent = (s.alias || s.url) + ' (' + s.latency_ms + 'ms' + (s.p2p ? ', P2P' : '') + ')';
        pickerEl.appendChild(opt);
      });
    }
  } catch (_) {}
}

(function setupSourcePicker() {
  document.querySelectorAll('input[name="sourceSelect"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      const picker = document.getElementById('seederPicker');
      const modeEl = document.getElementById('sourceMode');
      if (picker) picker.style.display = radio.value === 'seeder' ? 'block' : 'none';
      if (modeEl) modeEl.value = radio.value === 'seeder' ? (picker?.value || 'smart') : radio.value;
    });
  });
  const picker = document.getElementById('seederPicker');
  if (picker) {
    picker.addEventListener('change', function() {
      const modeEl = document.getElementById('sourceMode');
      if (modeEl) modeEl.value = picker.value || 'smart';
    });
  }
})();

// ================================================================
// Buy flow
// ================================================================
document.getElementById('buyBtn').addEventListener('click', doBuy);

function getMode() {
  if (!devMode) return 'pre';
  return document.querySelector('input[name="buyMode"]:checked').value;
}

async function doBuy() {
  if (!selectedItem) return;

  if (isPurchased(selectedItem.content_hash)) {
    if (!confirm('You already own this asset. Purchase again?')) return;
  }

  const mode = getMode();
  document.getElementById('buyBtn').disabled = true;
  document.getElementById('buyResult').style.display = 'none';
  document.getElementById('buyPreview').style.display = 'none';

  if (mode === 'pre') await doBuyPre();
  else if (mode === 'direct') await doBuyDirect();
  else if (mode === 'ad') await doBuyAdSubsidized();
  else await doBuyChunked(mode);
}

// Progress step helpers
function buildSteps(steps) {
  const container = document.getElementById('buyProgress');
  container.innerHTML = '';
  container.style.display = 'block';
  steps.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'step';
    div.id = 'step-' + s.id;
    div.innerHTML = `<span class="num">${i + 1}</span><span class="text">${s.text}</span><span class="detail"></span>`;
    container.appendChild(div);
  });
}

function setStep(id, state, detail) {
  const el = document.getElementById('step-' + id);
  if (!el) return;
  el.className = 'step ' + state;
  if (detail !== undefined) el.querySelector('.detail').textContent = detail;
}

function showResult(ok, msg) {
  const el = document.getElementById('buyResult');
  el.style.display = 'block';
  el.style.background = ok ? '#1a2f1a' : '#2f1a1a';
  el.style.color = ok ? '#3fb950' : '#f85149';
  el.textContent = msg;
  document.getElementById('buyBtn').disabled = false;
}

// --- PRE buy ---
const STEPS_PRE = [
  { id: 'preinfo', text: 'Getting buyer PRE public key' },
  { id: 'prepurchase', text: 'Requesting PRE invoice from creator' },
  { id: 'pay', text: 'Paying Lightning invoice' },
  { id: 'htlc', text: 'HTLC settling (preimage = SHA-256(rk))' },
  { id: 'prekey', text: 'Recovering AES key via PRE' },
  { id: 'fetch', text: 'Downloading encrypted chunks' },
  { id: 'decrypt', text: 'Decrypting with recovered key' },
  { id: 'verify', text: 'Verifying plaintext H(F)' },
];

async function doBuyPre() {
  buildSteps(STEPS_PRE);

  const creatorUrl = ensureHttp(selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address available for this listing');
    return;
  }

  if (!nodeUrl) {
    showResult(false, 'Set your node URL first (Settings tab)');
    return;
  }

  // Step 1: Get buyer's PRE public key from local node
  setStep('preinfo', 'active', 'Fetching G2 public key...');
  let buyerPkHex;
  try {
    const r = await fetch(nodeUrl + '/api/pre-info');
    const info = await r.json();
    buyerPkHex = info.buyer_pk_hex;
    if (!buyerPkHex) throw new Error('No buyer_pk_hex in response');
    setStep('preinfo', 'done', 'G2 pk: ' + buyerPkHex.substring(0, 16) + '...');
  } catch (e) {
    setStep('preinfo', 'fail', e.message);
    showResult(false, 'Failed to get buyer PRE key. Is your node running the PRE build?');
    return;
  }

  // Step 2: Call creator /api/pre-purchase with buyer pk
  const sourceMode = (function() {
    const el = document.getElementById('sourceMode');
    if (!el) return 'smart';
    const radio = document.querySelector('input[name="sourceSelect"]:checked');
    if (!radio) return el.value || 'smart';
    if (radio.value === 'seeder') {
      const picker = document.getElementById('seederPicker');
      return picker && picker.value ? picker.value : 'smart';
    }
    return radio.value;
  })();
  setStep('prepurchase', 'active', `Contacting creator... (source: ${sourceMode})`);
  try {
    const outputFile = '/tmp/decrypted-pre-' + Date.now() + '-' + (selectedItem.file_name || 'content');
    lastOutputFile = outputFile.split('/').pop();

    let seederUrl = null;
    if (sourceMode !== 'smart' && sourceMode !== 'creator' && sourceMode.includes(':')) {
      seederUrl = sourceMode;
    } else if (sourceMode !== 'smart') {
      try {
        const sr = await fetch(nodeUrl + '/api/best-source/' + selectedItem.content_hash);
        const sd = await sr.json();
        if (sd.source === 'seeder' && sd.source_url) {
          seederUrl = ensureHttp(sd.source_url);
          setStep('prepurchase', 'active', `Source: seeder (${sd.alias || sd.source_url}, ${sd.latency_ms}ms)`);
        }
      } catch (_) { /* no seeder available, use creator directly */ }
    }

    setStep('prepurchase', 'done', selectedItem.price_sats + ' sats');

    // Step 3: Trigger PRE buy on local node (it handles everything)
    setStep('pay', 'active', 'Initiating PRE payment...');
    const r = await fetch(nodeUrl + '/api/buy-pre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_url: creatorUrl,
        content_hash: selectedItem.content_hash,
        seeder_url: seederUrl,
        output: outputFile,
        source_mode: sourceMode,
      }),
    });
    const res = await r.json();
    console.log('PRE buy started:', res);
    // SSE events will drive the remaining step updates
  } catch (e) {
    setStep('prepurchase', 'fail', e.message);
    showResult(false, 'PRE purchase failed: ' + e.message);
  }
}

// --- Direct buy ---
const STEPS_DIRECT = [
  { id: 'invoice', text: 'Requesting invoice from creator' },
  { id: 'pay', text: 'Paying creator invoice' },
  { id: 'htlc', text: 'HTLC settling' },
  { id: 'fetch', text: 'Fetching encrypted content' },
  { id: 'decrypt', text: 'Decrypting with K' },
  { id: 'verify', text: 'Verifying plaintext H(F)' },
];

async function doBuyDirect() {
  buildSteps(STEPS_DIRECT);

  const creatorUrl = ensureHttp(selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address available for this listing');
    return;
  }

  // Step 1: Request invoice from creator
  setStep('invoice', 'active', 'Contacting creator...');
  let invoiceData;
  try {
    const r = await fetch(creatorUrl + '/api/invoice/' + selectedItem.content_hash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    invoiceData = await r.json();
    if (invoiceData.error) {
      setStep('invoice', 'fail', invoiceData.error);
      showResult(false, invoiceData.error);
      return;
    }
    setStep('invoice', 'done', invoiceData.price_sats + ' sats');
  } catch (e) {
    setStep('invoice', 'fail', e.message);
    showResult(false, 'Failed to get invoice: ' + e.message);
    return;
  }

  // Step 2: Pay invoice via local buyer node
  setStep('pay', 'active', 'Sending payment...');
  const encUrl = creatorUrl + '/api/enc/' + (invoiceData.enc_filename || '');
  const outputFile = '/tmp/decrypted-' + Date.now() + '-' + (invoiceData.file_name || 'content');
  lastOutputFile = outputFile.split('/').pop();

  try {
    const r = await fetch(nodeUrl + '/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice: invoiceData.bolt11,
        enc_url: encUrl,
        hash: invoiceData.content_hash,
        output: outputFile,
      }),
    });
    const res = await r.json();
    console.log('Direct buy started:', res);
    // SSE events will update the remaining steps
  } catch (e) {
    setStep('pay', 'fail', e.message);
    showResult(false, 'Failed: ' + e.message);
  }
}

// --- Chunked / seeder buy ---
const STEPS_CHUNKED = [
  { id: 'invoice', text: 'Requesting invoice from creator' },
  { id: 'cpay', text: 'Paying creator (content key K)' },
  { id: 'chtlc', text: 'Content HTLC settling' },
  { id: 'cmeta', text: 'Fetching chunk metadata' },
  { id: 'cbit', text: 'Querying seeder bitfields' },
  { id: 'tpay', text: 'Paying seeders (transport)' },
  { id: 'thtlc', text: 'Transport HTLC settling' },
  { id: 'down', text: 'Downloading & verifying chunks' },
  { id: 'assem', text: 'Reassembling content' },
  { id: 'decrypt', text: 'Decrypting with K' },
  { id: 'verify', text: 'Verifying plaintext H(F)' },
];

async function doBuyChunked(mode) {
  buildSteps(STEPS_CHUNKED);

  const creatorUrl = ensureHttp(selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address available for this listing');
    return;
  }

  // Step 1: Request invoice from creator
  setStep('invoice', 'active', 'Contacting creator...');
  let invoiceData;
  try {
    const r = await fetch(creatorUrl + '/api/invoice/' + selectedItem.content_hash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    invoiceData = await r.json();
    if (invoiceData.error) {
      setStep('invoice', 'fail', invoiceData.error);
      showResult(false, invoiceData.error);
      return;
    }
    setStep('invoice', 'done', invoiceData.price_sats + ' sats');
  } catch (e) {
    setStep('invoice', 'fail', e.message);
    showResult(false, 'Failed to get invoice: ' + e.message);
    return;
  }

  setStep('cpay', 'active', 'Starting...');

  // Discover seeders from registry
  let seederUrls = [];
  if (mode === 'seeder' || mode === 'chunked') {
    try {
      const dr = await fetch(registryUrl + '/api/discover/' + selectedItem.content_hash);
      const dd = await dr.json();
      seederUrls = (dd.seeders || dd.items || []).map(s => ensureHttp(s.seeder_address)).filter(Boolean);
    } catch (e) {}
    if (seederUrls.length === 0) {
      showResult(false, 'No seeders found for this content. Try Direct mode instead.');
      return;
    }
  }

  const body = {
    mode: mode,
    content_invoice: invoiceData.bolt11,
    encrypted_hash: invoiceData.encrypted_hash || selectedItem.encrypted_hash || '',
    hash: selectedItem.content_hash,
    output: '/tmp/decrypted-' + Date.now() + '-' + (selectedItem.file_name || 'content'),
    seeder_urls: seederUrls,
  };
  try {
    const r = await fetch(nodeUrl + '/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await r.json();
    console.log('Buy started:', res);
  } catch (e) {
    setStep('cpay', 'fail', e.message);
    showResult(false, 'Failed: ' + e.message);
  }
}

// --- Ad-subsidized buy (two-payment flow) ---
const STEPS_AD = [
  { id: 'adinv', text: 'Requesting ad-subsidized invoices' },
  { id: 'adwatch', text: 'Watching sponsored ad' },
  { id: 'adattest', text: 'Obtaining attestation token' },
  { id: 'keypay', text: 'Buyer paying 1 sat (learn K)' },
  { id: 'keyhtlc', text: 'Key HTLC settling' },
  { id: 'adpay', text: 'Advertiser paying content price' },
  { id: 'adhtlc', text: 'Subsidy HTLC settling' },
  { id: 'fetch', text: 'Fetching encrypted content' },
  { id: 'decrypt', text: 'Decrypting with K' },
  { id: 'verify', text: 'Verifying plaintext H(F)' },
];

async function doBuyAdSubsidized() {
  buildSteps(STEPS_AD);

  const creatorUrl = ensureHttp(selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address for this listing');
    return;
  }

  // Prompt for advertiser URL
  const advertiserUrl = prompt('Enter advertiser node URL (e.g. http://ip:port):', '');
  if (!advertiserUrl) { showResult(false, 'Advertiser URL required'); return; }

  setStep('adinv', 'active', 'Requesting invoices from creator...');

  let adInvoice;
  try {
    const r = await fetch(creatorUrl + '/api/ad-invoice/' + selectedItem.content_hash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advertiser_url: advertiserUrl }),
    });
    adInvoice = await r.json();
    if (adInvoice.error) { setStep('adinv', 'fail', adInvoice.error); showResult(false, adInvoice.error); return; }
  } catch (e) { setStep('adinv', 'fail', e.message); showResult(false, e.message); return; }

  setStep('adinv', 'done', 'Two invoices received (1 sat + ' + adInvoice.price_sats + ' sats)');

  let buyerNodeId = '';
  try {
    const ir = await fetch(nodeUrl + '/api/info');
    const id = await ir.json();
    buyerNodeId = id.node_id || '';
  } catch (e) {}

  // Start ad session
  setStep('adwatch', 'active', 'Starting ad session...');
  let sessionData;
  try {
    const r = await fetch(advertiserUrl + '/api/campaigns/' + adInvoice.campaign_id + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_pubkey: buyerNodeId }),
    });
    sessionData = await r.json();
    if (sessionData.error) { setStep('adwatch', 'fail', sessionData.error); showResult(false, sessionData.error); return; }
  } catch (e) { setStep('adwatch', 'fail', e.message); showResult(false, e.message); return; }

  // Display ad with countdown
  const overlay = document.getElementById('adOverlay');
  const video = document.getElementById('adVideo');
  const timer = document.getElementById('adTimer');
  const fill = document.getElementById('adProgressFill');
  overlay.style.display = 'flex';
  const dMs = sessionData.duration_ms || 15000;
  const dSec = Math.ceil(dMs / 1000);
  video.src = advertiserUrl + '/api/campaigns/' + adInvoice.campaign_id + '/creative';
  video.play().catch(() => {});
  let rem = dSec;
  timer.textContent = rem + 's';
  fill.style.width = '0%';

  await new Promise(resolve => {
    const iv = setInterval(() => {
      rem--;
      timer.textContent = rem > 0 ? rem + 's' : 'Done!';
      fill.style.width = Math.min(100, ((dSec - rem) / dSec) * 100) + '%';
      setStep('adwatch', 'active', rem > 0 ? rem + 's remaining' : 'Complete');
      if (rem <= 0) { clearInterval(iv); resolve(); }
    }, 1000);
  });
  video.pause();
  overlay.style.display = 'none';
  setStep('adwatch', 'done', 'Ad viewed (' + dSec + 's)');

  // Get attestation token
  setStep('adattest', 'active', 'Requesting token...');
  let attestation;
  try {
    const r = await fetch(advertiserUrl + '/api/campaigns/' + adInvoice.campaign_id + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionData.session_id, buyer_pubkey: buyerNodeId }),
    });
    attestation = await r.json();
    if (attestation.error) { setStep('adattest', 'fail', attestation.error); showResult(false, attestation.error); return; }
  } catch (e) { setStep('adattest', 'fail', e.message); showResult(false, e.message); return; }
  setStep('adattest', 'done', 'Token received');

  // Payment 1: Buyer pays 1 sat to learn K
  setStep('keypay', 'active', 'Paying 1 sat...');
  const encFilename = adInvoice.enc_filename || '';
  const encUrl = creatorUrl + '/api/enc/' + encFilename;
  const baseName = (adInvoice.file_name || 'content').replace(/\.[^.]+$/, '');
  const ext = (adInvoice.file_name || '').split('.').pop() || 'bin';
  const outputFile = 'decrypted-' + Date.now() + '-' + baseName + '.' + ext;
  lastOutputFile = outputFile;

  try {
    const r = await fetch(nodeUrl + '/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice: adInvoice.buyer_invoice,
        enc_url: encUrl,
        hash: adInvoice.content_hash,
        output: '/tmp/' + outputFile,
      }),
    });
    const res = await r.json();
    console.log('Ad buy Payment 1 (key) started:', res);
  } catch (e) { setStep('keypay', 'fail', e.message); showResult(false, e.message); return; }

  // Payment 2: Advertiser pays content price (K_ad, not K)
  setStep('adpay', 'active', 'Advertiser paying ' + adInvoice.price_sats + ' sats...');
  try {
    const r = await fetch(advertiserUrl + '/api/campaigns/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bolt11_invoice: adInvoice.advertiser_invoice,
        attestation_token: attestation.token,
        attestation_payload: attestation.payload,
      }),
    });
    const res = await r.json();
    if (res.status !== 'payment_sent') {
      setStep('adpay', 'fail', res.status || 'Unknown error');
    } else {
      setStep('adpay', 'done', 'Subsidy paid (K_ad, not K)');
      setStep('adhtlc', 'active', 'Settling...');
    }
  } catch (e) { setStep('adpay', 'fail', e.message); }
}

// ================================================================
// Handle SSE events for buy progress
// ================================================================
function handleBuyerEvent(ev) {
  const mode = getMode();
  switch (ev.event_type) {

    // ---- PRE-specific events ----
    case 'PRE_BUY_START':
      setStep('pay', 'active', 'Contacting creator...');
      break;
    case 'PRE_PURCHASE_RECEIVED':
      setStep('prepurchase', 'done', (ev.data.price_sats || '?') + ' sats');
      setStep('pay', 'active', 'Paying invoice...');
      break;
    case 'PRE_PAYMENT_CONFIRMED':
      setStep('htlc', 'done', 'Preimage = SHA-256(rk)');
      setStep('prekey', 'active', 'Decrypting via PRE...');
      break;
    case 'PRE_KEY_RECOVERED':
      setStep('prekey', 'done', 'AES key recovered');
      setStep('fetch', 'active', 'Downloading chunks...');
      break;
    case 'SOURCES_DISCOVERED':
      setStep('fetch', 'active', (ev.data.total || 0) + ' sources found');
      break;
    case 'ICS_PLAN':
      setStep('fetch', 'active', 'ICS ' + (ev.data.mode || '?') + ': ' + (ev.data.chunk_count || '?') + ' chunks from ' + (ev.data.total_sources || '?') + ' sources');
      break;
    case 'ICS_DOWNLOAD_START':
      setStep('fetch', 'active', ev.data.message || 'ICS downloading...');
      break;
    case 'DOWNLOADING_CHUNKS':
      setStep('fetch', 'active', '0/' + (ev.data.chunks || '?') + ' chunks from ' + (ev.data.source || 'seeder'));
      break;
    case 'CHUNK_PROGRESS':
      setStep('fetch', 'active', (ev.data.current || '?') + '/' + (ev.data.total || '?') + ' chunks');
      break;
    case 'CHUNKS_DOWNLOADED':
      setStep('fetch', 'done', fmtSize(ev.data.total_bytes || 0) + (ev.data.ics_mode ? ' (' + ev.data.ics_mode + ')' : ''));
      setStep('decrypt', 'active', 'Decrypting...');
      break;

    // ---- General events ----
    case 'FETCHING_ENC':
      setStep('fetch', 'active', 'Downloading...'); break;
    case 'ENC_FETCHED':
      setStep('fetch', 'done', fmtSize(ev.data.bytes || 0)); break;
    case 'FETCH_FAILED':
      setStep('fetch', 'fail', ev.data.error || 'Failed'); showResult(false, 'Download failed'); break;
    case 'BUY_ERROR':
      showResult(false, ev.data.message || 'Error'); break;
    case 'COUNTDOWN':
      if (mode === 'ad') setStep('keypay', 'active', ev.data.message || '');
      else setStep('pay', 'active', ev.data.message || '');
      break;

    case 'PAYING_INVOICE':
      if (mode === 'ad') setStep('keypay', 'active', '1 sat invoice sent');
      else setStep('pay', 'active', 'Invoice sent');
      break;
    case 'PAYMENT_SENT':
      if (mode === 'ad') { setStep('keypay', 'done', 'HTLC in flight'); setStep('keyhtlc', 'active'); }
      else { setStep('pay', 'done', 'HTLC in flight'); setStep('htlc', 'active'); }
      break;
    case 'PAYMENT_CONFIRMED':
      if (mode === 'ad') { setStep('keyhtlc', 'done', 'K received'); setStep('fetch', 'active'); }
      else { setStep('htlc', 'done', 'Preimage received'); setStep('fetch', 'active'); }
      break;
    case 'PAYMENT_FAILED':
      if (mode === 'ad') setStep('keypay', 'fail', ev.data.reason || 'Failed');
      else setStep('pay', 'fail', ev.data.reason || 'Failed');
      showResult(false, 'Payment failed');
      break;

    // Ad-specific hold-and-claim events
    case 'AD_HTLC_BUYER_ARRIVED': setStep('keyhtlc', 'done', 'Buyer HTLC held'); break;
    case 'AD_HTLC_ADVERTISER_ARRIVED': setStep('adhtlc', 'done', 'Ad HTLC held'); break;
    case 'AD_BOTH_HTLCS_READY': setStep('adhtlc', 'done', 'Both HTLCs — claiming'); break;
    case 'AD_CLAIMED_BUYER': setStep('keyhtlc', 'done', 'K revealed — decrypting'); setStep('fetch', 'active'); break;
    case 'AD_CLAIMED_ADVERTISER': setStep('adhtlc', 'done', 'K_ad claimed (meaningless)'); break;

    case 'DECRYPTING': setStep('decrypt', 'active', 'Decrypting...'); break;
    case 'DECRYPTED':
    case 'CONTENT_DECRYPTED':
      setStep('decrypt', 'done', ev.data.chunks ? ev.data.chunks + ' chunks' : 'Decrypted');
      setStep('verify', 'active', 'Verifying...');
      break;
    case 'VERIFYING': setStep('verify', 'active', 'Verifying...'); break;
    case 'VERIFIED':
    case 'HASH_VERIFIED':
      if (ev.data.matches === false) {
        setStep('verify', 'fail', 'Mismatch!');
        showResult(false, 'Verification failed — content hash mismatch');
      } else {
        setStep('verify', 'done', 'Verified');
      }
      break;
    case 'HASH_MISMATCH':
    case 'VERIFICATION_FAILED': setStep('verify', 'fail', 'Mismatch!'); showResult(false, 'Verification failed'); break;

    // Chunked mode decrypt/verify
    case 'CHUNKS_DECRYPTED':
      setStep('decrypt', 'done', ev.data.chunk_count ? ev.data.chunk_count + ' chunks' : 'Decrypted');
      setStep('verify', 'active', 'Verifying...');
      break;

    case 'FILE_SAVED':
      showResult(true, 'Content purchased and verified!');
      tryPreview(ev.data);
      recordPurchase(ev.data);
      break;

    // Chunked mode events — creator payment
    case 'CONTENT_PAYING': setStep('cpay', 'active', 'Sending payment...'); break;
    case 'CONTENT_PAYMENT_SENT': setStep('cpay', 'done', 'HTLC in flight'); setStep('chtlc', 'active'); break;
    case 'CONTENT_PAID': setStep('chtlc', 'done', 'K received'); setStep('cmeta', 'active', 'Fetching...'); break;
    case 'CONTENT_PAYMENT_FAILED': setStep('cpay', 'fail', ev.data.reason || 'Failed'); showResult(false, 'Content payment failed'); break;

    // Chunked mode events — chunk metadata
    case 'CHUNK_META_RECEIVED': setStep('cmeta', 'done', ev.data.chunk_count ? ev.data.chunk_count + ' chunks' : ''); setStep('cbit', 'active'); break;
    case 'CHUNK_PLAN': setStep('cbit', 'done', ev.data.total_chunks ? ev.data.total_chunks + ' chunks planned' : ''); break;

    // Chunked mode events — transport payment + download
    case 'TRANSPORT_PAYING': setStep('tpay', 'active', 'Paying seeders...'); break;
    case 'TRANSPORT_PAYMENT_SENT': setStep('tpay', 'done', 'HTLC in flight'); setStep('thtlc', 'active'); break;
    case 'TRANSPORT_PAID': setStep('thtlc', 'done', 'Transport key received'); setStep('down', 'active'); break;
    case 'TRANSPORT_PAYMENT_FAILED': setStep('tpay', 'fail', 'Failed'); showResult(false, 'Transport payment failed'); break;
    case 'CHUNK_DOWNLOADED': setStep('down', 'active', ev.data.progress || ev.data.message || ''); break;
    case 'CHUNK_VERIFIED': setStep('down', 'active', 'Chunk ' + (ev.data.index ?? '') + ' verified'); break;
    case 'CHUNK_DOWNLOAD_FAILED': setStep('down', 'fail', ev.data.error || 'Failed'); break;

    // Chunked mode events — reassembly
    case 'CHUNKS_DOWNLOADING': setStep('down', 'active', ev.data.progress || ''); break;
    case 'CHUNKS_DOWNLOADED': setStep('down', 'done'); setStep('assem', 'active'); break;
    case 'ASSEMBLED': setStep('assem', 'done'); setStep('decrypt', 'active'); break;
  }
}

function tryPreview(data) {
  const container = document.getElementById('buyPreview');
  const file = data.output || data.path || '';
  if (!file || !nodeUrl) return;
  const url = nodeUrl + '/api/decrypted/' + file.split('/').pop();
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

// ================================================================
// Collection: purchase history (localStorage)
// ================================================================
function recordPurchase(data) {
  if (!selectedItem) return;
  const purchase = {
    content_hash: selectedItem.content_hash || '',
    file_name: selectedItem.file_name || data.path?.split('/').pop() || 'unknown',
    price_sats: selectedItem.price_sats || 0,
    size_bytes: selectedItem.size_bytes || data.bytes || 0,
    output_path: data.path || data.output || '',
    purchased_at: new Date().toISOString(),
    mode: getMode(),
    creator_address: selectedItem.creator_address || '',
  };
  // Avoid duplicates (same content_hash)
  const existing = purchases.findIndex(p => p.content_hash === purchase.content_hash);
  if (existing >= 0) purchases[existing] = purchase;
  else purchases.unshift(purchase);
  localStorage.setItem('conduit_purchases', JSON.stringify(purchases));
  renderCollection();
  loadReceipts();
  renderCatalog();
}

function renderCollection() {
  const container = document.getElementById('collectionList');
  const emptyMsg = document.getElementById('noCollection');
  if (!container) return;
  container.innerHTML = '';
  emptyMsg.style.display = purchases.length ? 'none' : 'block';
  purchases.forEach((p, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid #21262d;border-radius:8px;margin-bottom:8px;background:#161b22;';
    const ext = (p.file_name || '').split('.').pop().toUpperCase();
    const fileName = p.output_path ? p.output_path.split('/').pop() : '';
    const previewUrl = fileName && nodeUrl ? nodeUrl + '/api/decrypted/' + fileName : '';
    const date = p.purchased_at ? new Date(p.purchased_at).toLocaleDateString() : '';
    const modeLabel = p.mode === 'ad' ? 'Ad-subsidized' : p.mode === 'chunked' ? 'Chunked' : p.mode === 'seeder' ? 'Seeder' : 'Direct';
    div.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;color:#e6edf3;">${p.file_name || 'Unknown'}</div>
        <div style="font-size:11px;color:#8b949e;margin-top:2px;">
          ${ext} &middot; ${fmtSize(p.size_bytes || 0)} &middot; ${p.price_sats} sats &middot; ${date}
          ${devMode ? ' &middot; ' + modeLabel : ''}
        </div>
        ${devMode ? `<div class="mono" style="font-size:10px;color:#484f58;margin-top:2px;">${(p.content_hash || '').slice(0, 32)}...</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;">
        ${previewUrl ? `<a href="${previewUrl}" target="_blank" class="btn btn-secondary" style="font-size:11px;padding:4px 10px;text-decoration:none;">Open</a>` : ''}
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;color:#f85149;" onclick="removePurchase(${idx})">Remove</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function removePurchase(idx) {
  purchases.splice(idx, 1);
  localStorage.setItem('conduit_purchases', JSON.stringify(purchases));
  renderCollection();
}

// ================================================================
// Receipts: server-side cryptographic purchase proofs
// ================================================================
async function loadReceipts() {
  const container = document.getElementById('receiptsList');
  const emptyMsg = document.getElementById('noReceipts');
  if (!container || !nodeUrl) return;
  try {
    const resp = await fetch(nodeUrl + '/api/receipts');
    const data = await resp.json();
    const items = data.receipts || [];
    container.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = items.length ? 'none' : 'block';
    items.forEach(r => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px;border:1px solid #21262d;border-radius:8px;margin-bottom:8px;background:#161b22;';
      const date = r.timestamp ? new Date(r.timestamp * 1000).toLocaleDateString() : '';
      const badge = r.valid
        ? '<span style="color:#3fb950;font-size:11px;font-weight:600;">VERIFIED</span>'
        : '<span style="color:#f0883e;font-size:11px;font-weight:600;">UNVERIFIED</span>';
      const checksHtml = (r.checks || []).map(c =>
        `<span style="color:${c.passed ? '#3fb950' : '#f85149'};font-size:10px;" title="${c.detail}">${c.passed ? '\u2713' : '\u2717'} ${c.name}</span>`
      ).join(' &middot; ');
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-weight:600;color:#e6edf3;">${r.file_name || 'Unknown'}</span>
            <span style="font-size:11px;color:#8b949e;margin-left:8px;">${r.price_sats} sats &middot; ${date}</span>
          </div>
          ${badge}
        </div>
        <div style="margin-top:6px;">${checksHtml}</div>
        ${devMode ? `<div class="mono" style="font-size:10px;color:#484f58;margin-top:4px;">${(r.content_hash || '').slice(0,32)}... &middot; creator: ${(r.creator_pubkey || '').slice(0,16)}...</div>` : ''}
      `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<p style="color:#f85149;font-size:12px;">Failed to load receipts</p>';
  }
}

// ================================================================
// Seeder: register + display
// ================================================================
async function registerSeed() {
  const filePath = document.getElementById('seedFilePath').value.trim();
  const encHash = document.getElementById('seedEncHash').value.trim();
  const price = parseInt(document.getElementById('seedPrice').value, 10);
  const statusEl = document.getElementById('seedStatus');

  if (!filePath) { statusEl.textContent = 'Encrypted file path is required'; statusEl.style.color = '#f85149'; return; }
  if (!encHash) { statusEl.textContent = 'Encrypted hash is required'; statusEl.style.color = '#f85149'; return; }
  if (!price || price < 1) { statusEl.textContent = 'Transport price must be at least 1 sat'; statusEl.style.color = '#f85149'; return; }
  if (!nodeUrl) { statusEl.textContent = 'Connect to a node first (Settings tab)'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Registering seed...';
  statusEl.style.color = '#8b949e';

  try {
    const r = await fetch(nodeUrl + '/api/seed', {
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

async function loadSeederInfo() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/catalog');
    const data = await r.json();
    // Seeder entries have transport_price > 0 or chunks_held
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

// ================================================================
// Advertiser info
// ================================================================
async function loadAdvertiserInfo() {
  if (!nodeUrl) return;
  try {
    const r = await fetch(nodeUrl + '/api/advertiser/info');
    const info = await r.json();
    const status = document.getElementById('advStatus');
    if (info.enabled) {
      status.innerHTML = '<span class="badge badge-green">Enabled</span>';
      document.getElementById('advEnableHint').style.display = 'none';
      document.getElementById('advPubkey').textContent = info.advertiser_pubkey || '--';

      // Show stats if available
      if (info.total_paid_sats || info.payment_count) {
        document.getElementById('advStatsCard').style.display = 'block';
        document.getElementById('advTotalPaid').textContent = (info.total_paid_sats || 0).toLocaleString();
        document.getElementById('advPaymentCount').textContent = (info.payment_count || 0).toLocaleString();
      }

      // Load campaigns
      const cr = await fetch(nodeUrl + '/api/campaigns');
      const cdata = await cr.json();
      const campaigns = cdata.campaigns || [];
      const table = document.getElementById('advCampaignTable');
      while (table.rows.length > 1) table.deleteRow(1);
      document.getElementById('noCampaigns').style.display = campaigns.length ? 'none' : 'block';
      campaigns.forEach(c => {
        const pct = c.budget_total_sats > 0 ? Math.round(c.budget_spent_sats / c.budget_total_sats * 100) : 0;
        const row = table.insertRow();
        row.innerHTML = `
          <td>${c.name || '--'}</td>
          <td class="price">${c.subsidy_sats || 0} sats</td>
          <td>${(c.budget_spent_sats || 0).toLocaleString()} sats</td>
          <td>${(c.budget_total_sats || 0).toLocaleString()} sats (${pct}% used)</td>
          <td>${(c.duration_ms || 0) / 1000}s</td>
          <td><span class="badge ${c.active ? 'badge-green' : 'badge-red'}">${c.active ? 'Active' : 'Paused'}</span></td>
        `;
      });
    } else {
      status.innerHTML = '<span class="badge badge-yellow">Not enabled</span>';
      document.getElementById('advEnableHint').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('advStatus').innerHTML = '<span class="badge badge-red">Error</span> <span style="font-size:12px;color:#8b949e;">' + e.message + '</span>';
  }
}

// ================================================================
// Network visualization (Scope 2: full network via fan-out)
// ================================================================
let netGraphBuilt = false;

async function loadNetworkGraph() {
  const status = document.getElementById('netStatus');
  const container = document.getElementById('networkGraph');
  if (!nodeUrl) { status.textContent = 'Connect to a node first (Settings tab).'; return; }

  status.textContent = 'Discovering network...';

  // -- 1. Collect data from this node + registry + all discovered nodes --
  const nodes = new Map();   // pubkey -> { id, label, role, address, channels:[] }
  const channels = [];       // { source, target, capacity, outbound, inbound, usable }
  const contentEdges = [];   // { creatorPk, seederPk, fileName }
  const seenChannels = new Set();

  function addNode(pk, role, address, alias) {
    if (!pk) return;
    const existing = nodes.get(pk);
    if (existing) {
      if (role !== 'peer' && existing.role === 'peer') existing.role = role;
      if (address && !existing.address) existing.address = address;
      if (alias && !existing.alias) { existing.alias = alias; existing.label = alias; }
    } else {
      const displayLabel = alias || (pk.slice(0, 8) + '...');
      nodes.set(pk, { id: pk, label: displayLabel, alias: alias || '', role: role || 'peer', address: address || '' });
    }
  }

  function addChannels(ownerPk, chList) {
    (chList || []).forEach(ch => {
      const cpk = ch.counterparty_node_id;
      if (!cpk) return;
      const key = [ownerPk, cpk].sort().join(':') + ':' + (ch.channel_id || ch.value_sats);
      if (seenChannels.has(key)) return;
      seenChannels.add(key);
      addNode(cpk, 'peer', '');
      channels.push({
        source: ownerPk, target: cpk,
        capacity: ch.value_sats || ch.channel_value_sats || 0,
        outbound: Math.round((ch.outbound_msat || ch.outbound_capacity_msat || 0) / 1000),
        inbound: Math.round((ch.inbound_msat || ch.inbound_capacity_msat || 0) / 1000),
        usable: ch.usable || ch.is_usable || false,
        ready: ch.ready || ch.is_channel_ready || false,
      });
    });
  }

  // Fetch with timeout helper
  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 5000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }

  // -- 1a. This node's info --
  let selfPk = null;
  try {
    const info = await fetchJson(nodeUrl + '/api/info', 5000);
    if (info && info.node_id) {
      selfPk = info.node_id;
      addNode(selfPk, 'self', nodeUrl, info.node_alias || '');
      addChannels(selfPk, info.channels);
      try {
        const p2p = await fetchJson(nodeUrl + '/api/p2p-info', 3000);
        if (p2p && p2p.enabled && nodes.has(selfPk)) {
          nodes.get(selfPk).p2pNodeId = p2p.node_id;
        }
      } catch (_) {}
    }
  } catch (e) {}

  // -- 1b. Registry data --
  let listings = [], seeders = [];
  if (registryUrl) {
    const [lr, sr] = await Promise.all([
      fetchJson(registryUrl + '/api/listings', 5000),
      fetchJson(registryUrl + '/api/seeders?all=1', 5000),
    ]);
    listings = (lr && lr.items) || [];
    seeders = (sr && sr.items) || [];
  }

  // Index creators and seeders
  const creatorAddrs = new Map();
  listings.forEach(l => {
    const pk = l.creator_pubkey;
    const addr = ensureHttp(l.creator_address || l.creator_ln_address);
    if (pk) { addNode(pk, 'creator', addr, l.creator_alias || ''); creatorAddrs.set(pk, addr); }
  });

  const seederAddrs = new Map();
  seeders.forEach(s => {
    const pk = s.seeder_pubkey;
    const addr = ensureHttp(s.seeder_address || s.seeder_ln_address);
    if (pk) { addNode(pk, 'seeder', addr, s.seeder_alias || ''); seederAddrs.set(pk, addr); }
  });

  // Build content edges: which seeders carry which creators' content
  const contentMap = new Map();
  listings.forEach(l => { if (l.encrypted_hash && l.creator_pubkey) contentMap.set(l.encrypted_hash, l); });
  seeders.forEach(s => {
    const listing = contentMap.get(s.encrypted_hash);
    if (listing && listing.creator_pubkey && s.seeder_pubkey && listing.creator_pubkey !== s.seeder_pubkey) {
      const key = listing.creator_pubkey + ':' + s.seeder_pubkey;
      if (!contentEdges.find(e => e.key === key)) {
        contentEdges.push({ key, creatorPk: listing.creator_pubkey, seederPk: s.seeder_pubkey, fileName: listing.file_name || '' });
      }
    }
  });

  // -- 1c. Fan out to all discovered node addresses --
  status.textContent = 'Querying discovered nodes...';
  const addressesToQuery = new Set();
  creatorAddrs.forEach((addr) => { if (addr && addr !== nodeUrl) addressesToQuery.add(addr); });
  seederAddrs.forEach((addr) => { if (addr && addr !== nodeUrl) addressesToQuery.add(addr); });
  // Also check channel peers that might have known addresses
  nodes.forEach(n => { if (n.address && n.address !== nodeUrl) addressesToQuery.add(n.address); });

  const fanOutResults = await Promise.allSettled(
    [...addressesToQuery].map(addr => fetchJson(addr + '/api/info', 4000))
  );
  fanOutResults.forEach(r => {
    if (r.status === 'fulfilled' && r.value && r.value.node_id) {
      const info = r.value;
      if (info.node_alias) {
        const existingNode = nodes.get(info.node_id);
        if (existingNode && !existingNode.alias) {
          existingNode.alias = info.node_alias;
          existingNode.label = info.node_alias;
        }
      }
      addChannels(info.node_id, info.channels);
    }
  });

  // Detect advertiser: node with /api/campaigns endpoint
  const advChecks = await Promise.allSettled(
    [...addressesToQuery].map(async addr => {
      const r = await fetchJson(addr + '/api/campaigns', 3000);
      if (r && (r.campaigns !== undefined)) {
        // Find which node this address belongs to
        for (const [pk, n] of nodes) {
          if (n.address === addr && n.role !== 'self') { n.role = 'advertiser'; break; }
        }
      }
    })
  );

  // -- 2. Build D3 graph --
  const nodeArr = [...nodes.values()];
  const linkArr = [];

  // Channel edges
  channels.forEach(ch => {
    if (nodes.has(ch.source) && nodes.has(ch.target)) {
      linkArr.push({
        source: ch.source, target: ch.target,
        type: 'channel', capacity: ch.capacity,
        outbound: ch.outbound, inbound: ch.inbound,
        usable: ch.usable, ready: ch.ready,
      });
    }
  });

  // Content edges
  contentEdges.forEach(ce => {
    if (nodes.has(ce.creatorPk) && nodes.has(ce.seederPk)) {
      linkArr.push({
        source: ce.creatorPk, target: ce.seederPk,
        type: 'content', fileName: ce.fileName,
      });
    }
  });

  status.textContent = nodeArr.length + ' nodes, ' + channels.length + ' channels, ' + contentEdges.length + ' content links';

  renderNetworkGraph(container, nodeArr, linkArr, selfPk);
}

function renderNetworkGraph(container, nodeArr, linkArr, selfPk) {
  // Clear previous SVG
  d3.select(container).select('svg').remove();

  const width = container.clientWidth;
  const height = container.clientHeight || 520;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height]);

  // Zoom
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.3, 5]).on('zoom', (e) => g.attr('transform', e.transform)));

  // Role colors
  const roleColor = { self: '#f0883e', creator: '#58a6ff', seeder: '#3fb950', advertiser: '#bc8cff', peer: '#8b949e' };
  const roleRadius = { self: 18, creator: 14, seeder: 12, advertiser: 13, peer: 10 };

  // Arrow marker for content edges
  svg.append('defs').append('marker')
    .attr('id', 'arrowContent').attr('viewBox', '0 -4 8 8').attr('refX', 24).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#30363d');

  // Force simulation
  const sim = d3.forceSimulation(nodeArr)
    .force('link', d3.forceLink(linkArr).id(d => d.id).distance(d => d.type === 'channel' ? 140 : 200))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => (roleRadius[d.role] || 10) + 8));

  // Links
  const link = g.append('g').selectAll('line').data(linkArr).join('line')
    .attr('stroke', d => d.type === 'channel' ? (d.usable ? '#58a6ff' : '#484f58') : '#30363d')
    .attr('stroke-width', d => {
      if (d.type === 'content') return 1;
      return Math.max(1.5, Math.min(5, (d.capacity || 0) / 50000));
    })
    .attr('stroke-dasharray', d => d.type === 'content' ? '4,4' : null)
    .attr('marker-end', d => d.type === 'content' ? 'url(#arrowContent)' : null)
    .attr('pointer-events', 'stroke');

  // Node groups
  const node = g.append('g').selectAll('g').data(nodeArr).join('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Node circles
  node.append('circle')
    .attr('r', d => roleRadius[d.role] || 10)
    .attr('fill', d => roleColor[d.role] || '#8b949e')
    .attr('stroke', d => d.role === 'self' ? '#f0883e' : '#21262d')
    .attr('stroke-width', d => d.role === 'self' ? 3 : 1.5);

  // Node labels (alias or role name)
  node.append('text')
    .text(d => {
      if (d.alias) return d.alias;
      if (d.role === 'self') return 'You';
      return d.role.charAt(0).toUpperCase() + d.role.slice(1);
    })
    .attr('dy', d => (roleRadius[d.role] || 10) + 14)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.alias ? '#e6edf3' : '#8b949e')
    .attr('font-size', '11px')
    .attr('font-weight', d => (d.role === 'self' || d.alias) ? '600' : '400');

  // Pubkey below name
  node.append('text')
    .text(d => d.id.slice(0, 8) + '...')
    .attr('dy', d => (roleRadius[d.role] || 10) + 26)
    .attr('text-anchor', 'middle')
    .attr('fill', '#484f58')
    .attr('font-size', '9px')
    .attr('font-family', "'SF Mono', monospace");

  // Tooltip
  const tooltip = d3.select('#netTooltip');

  node.on('mouseenter', (e, d) => {
    let html = '';
    if (d.alias) html += '<span class="tt-label">Alias:</span> <span class="tt-value" style="font-weight:700;">' + d.alias + '</span><br>';
    html += '<span class="tt-label">Node ID:</span> <span class="tt-value">' + d.id.slice(0, 24) + '...</span><br>';
    html += '<span class="tt-label">Role:</span> <span class="tt-value">' + d.role + '</span><br>';
    if (d.address) html += '<span class="tt-label">Address:</span> <span class="tt-value">' + d.address + '</span><br>';
    if (d.p2pNodeId) html += '<span class="tt-label">P2P (iroh):</span> <span class="tt-value">' + d.p2pNodeId.slice(0, 16) + '...</span><br>';
    // Find channels for this node
    const nodeChannels = linkArr.filter(l => l.type === 'channel' && (l.source.id === d.id || l.target.id === d.id));
    if (nodeChannels.length) {
      html += '<span class="tt-label">Channels:</span> <span class="tt-value">' + nodeChannels.length + '</span><br>';
      let totalCap = 0;
      nodeChannels.forEach(c => totalCap += (c.capacity || 0));
      html += '<span class="tt-label">Total capacity:</span> <span class="tt-value">' + totalCap.toLocaleString() + ' sats</span>';
    }
    tooltip.html(html).style('display', 'block');
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mouseleave', () => tooltip.style('display', 'none'));

  // Channel edge tooltips
  link.on('mouseenter', (e, d) => {
    let html = '';
    if (d.type === 'channel') {
      html += '<span class="tt-label">Channel</span><br>';
      html += '<span class="tt-label">Capacity:</span> <span class="tt-value">' + (d.capacity || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Outbound:</span> <span class="tt-value">' + (d.outbound || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Inbound:</span> <span class="tt-value">' + (d.inbound || 0).toLocaleString() + ' sats</span><br>';
      html += '<span class="tt-label">Status:</span> <span class="tt-value">' + (d.usable ? 'Usable' : d.ready ? 'Ready' : 'Pending') + '</span>';
    } else {
      html += '<span class="tt-label">Content link</span><br>';
      if (d.fileName) html += '<span class="tt-label">File:</span> <span class="tt-value">' + d.fileName + '</span>';
    }
    tooltip.html(html).style('display', 'block');
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    tooltip.style('left', (e.clientX - rect.left + 14) + 'px').style('top', (e.clientY - rect.top - 10) + 'px');
  })
  .on('mouseleave', () => tooltip.style('display', 'none'));

  // Simulation tick
  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// Hook into tab switching: load network when tab is activated
const origTabHandler = document.querySelectorAll('.tab-bar button');
origTabHandler.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'network' && nodeUrl) loadNetworkGraph();
  });
});

// ================================================================
// Utility
// ================================================================
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ================================================================
// Auto-connect on load
// ================================================================
renderCollection();  // Show purchases from localStorage immediately
if (nodeUrl) {
  connectNode();
}
