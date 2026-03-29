import './styles.css';
import { initApp } from './app.js';
import { startVersionCheck } from './version-check.js';
import { initImageModal } from './image-modal.js';

initApp();
startVersionCheck();
initImageModal();
