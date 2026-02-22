import { state, ensureHttp } from '../state.js';
import { buildSteps, setStep, showResult } from './index.js';

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

export async function doBuyChunked(mode) {
  buildSteps(STEPS_CHUNKED);

  const creatorUrl = ensureHttp(state.selectedItem.creator_address);
  if (!creatorUrl) {
    showResult(false, 'No creator address available for this listing');
    return;
  }

  setStep('invoice', 'active', 'Contacting creator...');
  let invoiceData;
  try {
    const r = await fetch(creatorUrl + '/api/invoice/' + state.selectedItem.content_hash, {
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

  let seederUrls = [];
  if (mode === 'seeder' || mode === 'chunked') {
    try {
      const dr = await fetch(state.registryUrl + '/api/discover/' + state.selectedItem.content_hash);
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
    encrypted_hash: invoiceData.encrypted_hash || state.selectedItem.encrypted_hash || '',
    hash: state.selectedItem.content_hash,
    output: '/tmp/decrypted-' + Date.now() + '-' + (state.selectedItem.file_name || 'content'),
    seeder_urls: seederUrls,
  };
  try {
    const r = await fetch(state.nodeUrl + '/api/buy', {
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
