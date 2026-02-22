export const state = {
  nodeUrl: localStorage.getItem('conduit_nodeUrl') || '',
  registryUrl: localStorage.getItem('conduit_registryUrl') || '',
  nodeInfo: null,
  catalog: [],
  selectedItem: null,
  eventSource: null,
  events: [],
  eventFilter: 'all',
  lastOutputFile: '',
  refreshTimer: null,
  purchases: JSON.parse(localStorage.getItem('conduit_purchases') || '[]'),
  devMode: localStorage.getItem('conduit_devMode') === '1',
  netGraphBuilt: false,
  obFundPoll: null,
};

export function toggleDevMode(on) {
  state.devMode = on;
  localStorage.setItem('conduit_devMode', on ? '1' : '0');
  document.body.classList.toggle('dev-mode', on);
  document.getElementById('devModeToggle').checked = on;
}

export function ensureHttp(addr) {
  if (!addr) return '';
  if (addr.startsWith('http://') || addr.startsWith('https://')) return addr;
  return 'http://' + addr;
}

export function getMode() {
  if (!state.devMode) return 'pre';
  return document.querySelector('input[name="buyMode"]:checked').value;
}
