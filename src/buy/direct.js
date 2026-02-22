import { state, ensureHttp } from '../state.js';
import { buildSteps, setStep, showResult } from './index.js';

const STEPS_DIRECT = [
  { id: 'invoice', text: 'Requesting invoice from creator' },
  { id: 'pay', text: 'Paying creator invoice' },
  { id: 'htlc', text: 'HTLC settling' },
  { id: 'fetch', text: 'Fetching encrypted content' },
  { id: 'decrypt', text: 'Decrypting with K' },
  { id: 'verify', text: 'Verifying plaintext H(F)' },
];

export async function doBuyDirect() {
  buildSteps(STEPS_DIRECT);

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

  setStep('pay', 'active', 'Sending payment...');
  const encUrl = creatorUrl + '/api/enc/' + (invoiceData.enc_filename || '');
  const outputFile = '/tmp/decrypted-' + Date.now() + '-' + (invoiceData.file_name || 'content');
  state.lastOutputFile = outputFile.split('/').pop();

  try {
    const r = await fetch(state.nodeUrl + '/api/buy', {
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
  } catch (e) {
    setStep('pay', 'fail', e.message);
    showResult(false, 'Failed: ' + e.message);
  }
}
