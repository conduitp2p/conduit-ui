import { state } from '../state.js';

export async function loadAdvertiserInfo() {
  if (!state.nodeUrl) return;
  try {
    const r = await fetch(state.nodeUrl + '/api/advertiser/info');
    const info = await r.json();
    const status = document.getElementById('advStatus');
    if (info.enabled) {
      status.innerHTML = '<span class="badge badge-green">Enabled</span>';
      document.getElementById('advEnableHint').style.display = 'none';
      document.getElementById('advPubkey').textContent = info.advertiser_pubkey || '--';

      if (info.total_paid_sats || info.payment_count) {
        document.getElementById('advStatsCard').style.display = 'block';
        document.getElementById('advTotalPaid').textContent = (info.total_paid_sats || 0).toLocaleString();
        document.getElementById('advPaymentCount').textContent = (info.payment_count || 0).toLocaleString();
      }

      const cr = await fetch(state.nodeUrl + '/api/campaigns');
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
