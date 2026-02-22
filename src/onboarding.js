import { state } from './state.js';
import { updateWallet, fetchAddress, loadPeerSuggestions, startAutoRefresh } from './tabs/wallet.js';
import { connectSSE } from './sse.js';
import { loadCatalog } from './tabs/library.js';
import { loadCreatorCatalog } from './tabs/creator.js';
import { renderCollection } from './tabs/collection.js';
import { loadAdvertiserInfo } from './tabs/advertiser.js';
import { loadSeederInfo } from './tabs/seeder.js';
import { loadTrustList } from './tabs/settings.js';

export function shouldShowOnboarding() {
  if (localStorage.getItem('conduit_onboarded') === '1') return false;
  return !state.nodeUrl;
}

export function showOnboarding() {
  document.getElementById('onboardingOverlay').classList.remove('hidden');
  if (state.nodeUrl) document.getElementById('obNodeUrl').value = state.nodeUrl;
  if (state.registryUrl) document.getElementById('obRegistryUrl').value = state.registryUrl;
}

export function obGoStep(n) {
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

export async function obConnect() {
  const url = document.getElementById('obNodeUrl').value.trim().replace(/\/+$/, '');
  const regUrl = document.getElementById('obRegistryUrl').value.trim().replace(/\/+$/, '');
  const statusEl = document.getElementById('obConnStatus');
  if (!url) { statusEl.textContent = 'Enter a node URL'; statusEl.style.color = '#f85149'; return; }

  statusEl.textContent = 'Connecting...'; statusEl.style.color = '#8b949e';
  try {
    const r = await fetch(url + '/api/info');
    const info = await r.json();
    state.nodeUrl = url;
    state.registryUrl = regUrl;
    localStorage.setItem('conduit_nodeUrl', state.nodeUrl);
    localStorage.setItem('conduit_registryUrl', state.registryUrl);
    state.nodeInfo = info;
    document.getElementById('settNodeUrl').value = state.nodeUrl;
    document.getElementById('settRegistryUrl').value = state.registryUrl;
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
  if (state.obFundPoll) clearInterval(state.obFundPoll);
  try {
    const r = await fetch(state.nodeUrl + '/api/address');
    const d = await r.json();
    if (d.address) document.getElementById('obFundAddr').textContent = d.address;
  } catch (_) {}
  obUpdateBalance();
  state.obFundPoll = setInterval(obUpdateBalance, 10000);
}

async function obUpdateBalance() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/info');
    const info = await r.json();
    state.nodeInfo = info;
    const bal = info.onchain_balance_sats || 0;
    document.getElementById('obBalance').textContent = bal.toLocaleString() + ' sats';
    if (bal >= 20000) {
      document.getElementById('obFundStatus').textContent = 'Balance sufficient! You can proceed.';
      document.getElementById('obFundStatus').style.color = '#3fb950';
    }
    if (info.channels && info.channels.some(c => c.usable)) {
      clearInterval(state.obFundPoll);
      obGoStep(4);
    }
  } catch (_) {}
}

export function obCopyAddr() {
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
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/channels/peers');
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

export async function obOpenChannel() {
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
    const r = await fetch(state.nodeUrl + '/api/channels/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nid, addr: addr, amount_sats: amount })
    });
    const data = await r.json();
    if (r.ok) {
      statusEl.innerHTML = '<span style="color:#3fb950;">Channel opening initiated!</span> Waiting for confirmation (may take a few minutes)...';
      const poll = setInterval(async () => {
        try {
          const ir = await fetch(state.nodeUrl + '/api/info');
          const info = await ir.json();
          state.nodeInfo = info;
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

export function obFinish() {
  if (state.obFundPoll) clearInterval(state.obFundPoll);
  localStorage.setItem('conduit_onboarded', '1');
  document.getElementById('onboardingOverlay').classList.add('hidden');
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const libBtn = document.querySelector('.tab-bar button[data-tab="library"]');
  libBtn.classList.add('active');
  document.getElementById('tab-library').classList.add('active');
}
