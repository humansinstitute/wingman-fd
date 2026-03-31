import './styles.css';
import { initApp } from './app.js';
import { startVersionCheck } from './version-check.js';
import { initImageModal } from './image-modal.js';
import { registerBuildServiceWorker } from './service-worker-registration.js';

initApp();
registerBuildServiceWorker();
startVersionCheck();
initImageModal();
