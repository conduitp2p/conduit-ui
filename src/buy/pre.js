import { state, ensureHttp } from '../state.js';
import { buildSteps, setStep, showResult } from './index.js';

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

function getSourceMode() {
  const el = document.getElementById('sourceMode');
  if (!el) return 'smart';
  const radio = document.querySelector('input[name="sourceSelect"]:checked');
  if (!radio) return el.value || 'smart';
  if (radio.value === 'seeder') {
    const picker = document.getElementById('seederPicker');
    return picker && picker.value ? picker.value : 'smart';
  }
  return radio.value;
}

export async function loadSourceOptions(contentHash) {
  const infoEl = document.getElementById('icsInfo');
  const pickerEl = document.getElementById('seederPicker');
  if (!state.nodeUrl || !contentHash) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/discover-sources/' + contentHash);
    const data = await r.json();
    if (infoEl) {
      infoEl.textContent = `ICS mode: ${data.ics_mode || 'RELEASE'} | ${data.sources?.length || 0} sources (${data.complete_sources || 0} complete)`;
    }
    if (pickerEl && data.sources) {
      pickerEl.innerHTML = '';
      data.sources.filter(s => s.type === 'seeder').forEach(s => {
        const opt = document.createElement('option');
        opt.value = ensureHttp(s.url);
        opt.textContent = `${s.alias || s.url} (${s.latency_ms}ms${s.p2p ? ', P2P' : ''})`;
        pickerEl.appendChild(opt);
      });
    }
  } catch (_) {}
}

export function setupSourcePicker() {
  document.querySelectorAll('input[name="sourceSelect"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const picker = document.getElementById('seederPicker');
      const modeEl = document.getElementById('sourceMode');
      if (picker) picker.style.display = radio.value === 'seeder' ? 'block' : 'none';
      if (modeEl) modeEl.value = radio.value === 'seeder' ? (picker?.value || 'smart') : radio.value;
    });
  });
  const picker = document.getElementById('seederPicker');
  if (picker) {
    picker.addEventListener('change', () => {
      const modeEl = document.getElementById('sourceMode');
      if (modeEl) modeEl.value = picker.value || 'smart';
    });
  }
}

export async function doBuyPre() {
  buildSteps(STEPS_PRE);

  const creatorUrl = ensureHttp(state.selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address available for this listing');
    return;
  }

  if (!state.nodeUrl) {
    showResult(false, 'Set your node URL first (Settings tab)');
    return;
  }

  setStep('preinfo', 'active', 'Fetching G2 public key...');
  let buyerPkHex;
  try {
    const r = await fetch(state.nodeUrl + '/api/pre-info');
    const info = await r.json();
    buyerPkHex = info.buyer_pk_hex;
    if (!buyerPkHex) throw new Error('No buyer_pk_hex in response');
    setStep('preinfo', 'done', 'G2 pk: ' + buyerPkHex.substring(0, 16) + '...');
  } catch (e) {
    setStep('preinfo', 'fail', e.message);
    showResult(false, 'Failed to get buyer PRE key. Is your node running the PRE build?');
    return;
  }

  const sourceMode = getSourceMode();
  setStep('prepurchase', 'active', `Contacting creator... (source: ${sourceMode})`);
  try {
    const outputFile = '/tmp/decrypted-pre-' + Date.now() + '-' + (state.selectedItem.file_name || 'content');
    state.lastOutputFile = outputFile.split('/').pop();

    let seederUrl = null;
    if (sourceMode !== 'smart' && sourceMode !== 'creator' && sourceMode.includes(':')) {
      seederUrl = sourceMode;
    } else if (sourceMode !== 'smart') {
      try {
        const sr = await fetch(state.nodeUrl + '/api/best-source/' + state.selectedItem.content_hash);
        const sd = await sr.json();
        if (sd.source === 'seeder' && sd.source_url) {
          seederUrl = ensureHttp(sd.source_url);
          setStep('prepurchase', 'active', `Source: seeder (${sd.alias || sd.source_url}, ${sd.latency_ms}ms)`);
        }
      } catch (_) {}
    }

    setStep('prepurchase', 'done', state.selectedItem.price_sats + ' sats');

    setStep('pay', 'active', 'Initiating PRE payment...');
    const r = await fetch(state.nodeUrl + '/api/buy-pre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_url: creatorUrl,
        content_hash: state.selectedItem.content_hash,
        seeder_url: seederUrl,
        output: outputFile,
        source_mode: sourceMode,
      }),
    });
    const res = await r.json();
    console.log('PRE buy started:', res);
  } catch (e) {
    setStep('prepurchase', 'fail', e.message);
    showResult(false, 'PRE purchase failed: ' + e.message);
  }
}
