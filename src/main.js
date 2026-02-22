import './dashboard.css';
import { state, toggleDevMode } from './state.js';
import { setupTabs } from './router.js';
import { shouldShowOnboarding, showOnboarding, obConnect, obGoStep, obCopyAddr, obOpenChannel, obFinish } from './onboarding.js';
import { connectSSE, setupEventFilter } from './sse.js';
import { updateWallet, fetchAddress, copyAddress, openChannel, closeChannel, loadPeerSuggestions, startAutoRefresh } from './tabs/wallet.js';
import { registerContent, loadCreatorCatalog } from './tabs/creator.js';
import { loadCatalog, renderCatalog } from './tabs/library.js';
import { renderCollection, removePurchase } from './tabs/collection.js';
import { registerSeed, loadSeederInfo } from './tabs/seeder.js';
import { loadAdvertiserInfo } from './tabs/advertiser.js';
import { loadNetworkGraph } from './tabs/network.js';
import { initEvents } from './tabs/events.js';
import { connectNode, loadTrustList, addTrustedManufacturer, removeTrustedManufacturer } from './tabs/settings.js';
import { setupBuyButton } from './buy/index.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

toggleDevMode(state.devMode);

document.getElementById('settNodeUrl').value = state.nodeUrl;
document.getElementById('settRegistryUrl').value = state.registryUrl;

setupTabs();
setupEventFilter();
setupBuyButton();
initEvents();

if (shouldShowOnboarding()) showOnboarding();

renderCollection();
if (state.nodeUrl) {
  connectNode();
}

// Expose functions used by HTML onclick attributes
window.toggleDevMode = toggleDevMode;
window.obConnect = obConnect;
window.obGoStep = obGoStep;
window.obCopyAddr = obCopyAddr;
window.obOpenChannel = obOpenChannel;
window.obFinish = obFinish;
window.connectNode = connectNode;
window.copyAddress = copyAddress;
window.fetchAddress = fetchAddress;
window.openChannel = openChannel;
window.closeChannel = closeChannel;
window.registerContent = registerContent;
window.loadCreatorCatalog = loadCreatorCatalog;
window.loadCatalog = loadCatalog;
window.renderCollection = renderCollection;
window.removePurchase = removePurchase;
window.registerSeed = registerSeed;
window.loadSeederInfo = loadSeederInfo;
window.loadAdvertiserInfo = loadAdvertiserInfo;
window.addTrustedManufacturer = addTrustedManufacturer;
window.removeTrustedManufacturer = removeTrustedManufacturer;
