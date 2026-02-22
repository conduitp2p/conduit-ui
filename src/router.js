import { state } from './state.js';
import { loadNetworkGraph } from './tabs/network.js';

export function setupTabs() {
  document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'network' && !state.netGraphBuilt) loadNetworkGraph();
    });
  });

  document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'network' && state.nodeUrl) loadNetworkGraph();
    });
  });
}
