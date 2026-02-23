import { state, getMode } from '../state.js';
import { fmtSize } from '../utils.js';
import { isPurchased } from '../tabs/library.js';
import { tryPreview, recordPurchase } from '../tabs/collection.js';
import { doBuyPre, setupSourcePicker, loadSourceOptions } from './pre.js';
import { doBuyDirect } from './direct.js';
import { doBuyChunked } from './chunked.js';
import { doBuyAdSubsidized } from './ad.js';

export function buildSteps(steps) {
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

export function setStep(id, stepState, detail) {
  const el = document.getElementById('step-' + id);
  if (!el) return;
  el.className = 'step ' + stepState;
  if (detail !== undefined) el.querySelector('.detail').textContent = detail;
}

export function showResult(ok, msg) {
  const el = document.getElementById('buyResult');
  el.style.display = 'block';
  el.style.background = ok ? '#1a2f1a' : '#2f1a1a';
  el.style.color = ok ? '#3fb950' : '#f85149';
  el.textContent = msg;
  document.getElementById('buyBtn').disabled = false;
}

export async function doBuy() {
  if (!state.selectedItem) return;

  if (isPurchased(state.selectedItem.content_hash)) {
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

export function setupBuyButton() {
  document.getElementById('buyBtn').addEventListener('click', doBuy);
  setupSourcePicker();
}

export function onItemSelected(contentHash) {
  loadSourceOptions(contentHash);
}

export function handleBuyerEvent(ev) {
  const mode = getMode();
  switch (ev.event_type) {

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
      setStep('fetch', 'active', `${ev.data.total || 0} sources found`);
      break;
    case 'ICS_PLAN':
      setStep('fetch', 'active', `ICS ${ev.data.mode || '?'}: ${ev.data.chunk_count || '?'} chunks from ${ev.data.total_sources || '?'} sources`);
      break;
    case 'ICS_DOWNLOAD_START':
      setStep('fetch', 'active', ev.data.message || 'ICS downloading...');
      break;
    case 'DOWNLOADING_CHUNKS':
      setStep('fetch', 'active', '0/' + (ev.data.chunks || '?') + ' chunks from ' + (ev.data.source || 'seeder'));
      break;
    case 'CHUNK_PROGRESS':
      setStep('fetch', 'active', (ev.data.received || ev.data.current || '?') + '/' + (ev.data.total || '?') + ' chunks');
      break;
    case 'CHUNKS_DOWNLOADED':
      setStep('fetch', 'done', fmtSize(ev.data.total_bytes || 0) + (ev.data.ics_mode ? ` (${ev.data.ics_mode})` : ''));
      setStep('decrypt', 'active', 'Decrypting...');
      break;

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

    case 'CHUNKS_DECRYPTED':
      setStep('decrypt', 'done', ev.data.chunk_count ? ev.data.chunk_count + ' chunks' : 'Decrypted');
      setStep('verify', 'active', 'Verifying...');
      break;

    case 'FILE_SAVED':
      showResult(true, 'Content purchased and verified!');
      tryPreview(ev.data);
      recordPurchase(ev.data);
      break;

    case 'CONTENT_PAYING': setStep('cpay', 'active', 'Sending payment...'); break;
    case 'CONTENT_PAYMENT_SENT': setStep('cpay', 'done', 'HTLC in flight'); setStep('chtlc', 'active'); break;
    case 'CONTENT_PAID': setStep('chtlc', 'done', 'K received'); setStep('cmeta', 'active', 'Fetching...'); break;
    case 'CONTENT_PAYMENT_FAILED': setStep('cpay', 'fail', ev.data.reason || 'Failed'); showResult(false, 'Content payment failed'); break;

    case 'CHUNK_META_RECEIVED': setStep('cmeta', 'done', ev.data.chunk_count ? ev.data.chunk_count + ' chunks' : ''); setStep('cbit', 'active'); break;
    case 'CHUNK_PLAN': setStep('cbit', 'done', ev.data.total_chunks ? ev.data.total_chunks + ' chunks planned' : ''); break;

    case 'TRANSPORT_PAYING': setStep('tpay', 'active', 'Paying seeders...'); break;
    case 'TRANSPORT_PAYMENT_SENT': setStep('tpay', 'done', 'HTLC in flight'); setStep('thtlc', 'active'); break;
    case 'TRANSPORT_PAID': setStep('thtlc', 'done', 'Transport key received'); setStep('down', 'active'); break;
    case 'TRANSPORT_PAYMENT_FAILED': setStep('tpay', 'fail', 'Failed'); showResult(false, 'Transport payment failed'); break;
    case 'CHUNK_DOWNLOADED': setStep('down', 'active', ev.data.progress || ev.data.message || ''); break;
    case 'CHUNK_VERIFIED': setStep('down', 'active', 'Chunk ' + (ev.data.index ?? '') + ' verified'); break;
    case 'CHUNK_DOWNLOAD_FAILED': setStep('down', 'fail', ev.data.error || 'Failed'); break;

    case 'CHUNKS_DOWNLOADING': setStep('down', 'active', ev.data.progress || ''); break;
    case 'CHUNKS_DOWNLOADED': setStep('down', 'done'); setStep('assem', 'active'); break;
    case 'ASSEMBLED': setStep('assem', 'done'); setStep('decrypt', 'active'); break;
  }
}
