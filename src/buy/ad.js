import { state, ensureHttp } from '../state.js';
import { buildSteps, setStep, showResult } from './index.js';

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

export async function doBuyAdSubsidized() {
  buildSteps(STEPS_AD);

  const creatorUrl = ensureHttp(state.selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address for this listing');
    return;
  }

  const advertiserUrl = prompt('Enter advertiser node URL (e.g. http://ip:port):', '');
  if (!advertiserUrl) { showResult(false, 'Advertiser URL required'); return; }

  setStep('adinv', 'active', 'Requesting invoices from creator...');

  let adInvoice;
  try {
    const r = await fetch(creatorUrl + '/api/ad-invoice/' + state.selectedItem.content_hash, {
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
    const ir = await fetch(state.nodeUrl + '/api/info');
    const id = await ir.json();
    buyerNodeId = id.node_id || '';
  } catch (e) {}

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

  setStep('keypay', 'active', 'Paying 1 sat...');
  const encFilename = adInvoice.enc_filename || '';
  const encUrl = creatorUrl + '/api/enc/' + encFilename;
  const baseName = (adInvoice.file_name || 'content').replace(/\.[^.]+$/, '');
  const ext = (adInvoice.file_name || '').split('.').pop() || 'bin';
  const outputFile = 'decrypted-' + Date.now() + '-' + baseName + '.' + ext;
  state.lastOutputFile = outputFile;

  try {
    const r = await fetch(state.nodeUrl + '/api/buy', {
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
