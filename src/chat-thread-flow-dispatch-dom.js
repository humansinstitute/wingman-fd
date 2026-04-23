import Alpine from 'alpinejs';

let dispatchBridgeRegistered = false;
let lastDispatchInvocation = {
  key: null,
  at: 0,
};

function getDispatchButtonTarget(event) {
  const rawTarget = event?.target || null;
  const element = rawTarget?.nodeType === Node.TEXT_NODE
    ? rawTarget.parentElement
    : rawTarget;
  if (!element || typeof element.closest !== 'function') return null;
  return element.closest('[data-chat-thread-flow-dispatch]');
}

function shouldSkipDuplicateInvocation(recordId, sourceSurface) {
  const now = Date.now();
  const key = `${recordId}:${sourceSurface}`;
  if (lastDispatchInvocation.key === key && (now - lastDispatchInvocation.at) < 750) {
    return true;
  }
  lastDispatchInvocation = { key, at: now };
  return false;
}

function triggerDispatchFromEvent(event) {
  const button = getDispatchButtonTarget(event);
  if (!button) return false;

  const store = Alpine.store('chat');
  if (!store || typeof store.openChatThreadFlowDispatch !== 'function') return false;

  const recordId = String(button.getAttribute('data-record-id') || '').trim();
  const sourceSurface = String(button.getAttribute('data-source-surface') || 'main_feed').trim() || 'main_feed';
  if (!recordId || shouldSkipDuplicateInvocation(recordId, sourceSurface)) return false;

  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  void store.openChatThreadFlowDispatch(recordId, sourceSurface);
  return true;
}

function handleDispatchButtonPointerDown(event) {
  triggerDispatchFromEvent(event);
}

function handleDispatchButtonClick(event) {
  triggerDispatchFromEvent(event);
}

export function initChatThreadFlowDispatchDomBridge() {
  if (dispatchBridgeRegistered || typeof document === 'undefined') return;
  dispatchBridgeRegistered = true;
  document.addEventListener('pointerdown', handleDispatchButtonPointerDown, true);
  document.addEventListener('click', handleDispatchButtonClick, true);
}
