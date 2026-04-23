import './styles.css';
import { initApp } from './app.js';
import { maybePerformHardReset } from './hard-reset.js';
import { startVersionCheck } from './version-check.js';
import { initImageModal } from './image-modal.js';
import { registerBuildServiceWorker } from './service-worker-registration.js';
import { initChatThreadFlowDispatchDomBridge } from './chat-thread-flow-dispatch-dom.js';

async function boot() {
  if (await maybePerformHardReset()) return;
  initApp();
  initChatThreadFlowDispatchDomBridge();
  registerBuildServiceWorker();
  startVersionCheck();
  initImageModal();
}

void boot();
