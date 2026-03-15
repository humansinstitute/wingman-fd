const DEFAULT_APP_NPUB = 'npub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5';

export const APP_NPUB = String(import.meta.env.VITE_COWORKER_APP_NPUB || DEFAULT_APP_NPUB).trim();
export const DEFAULT_SUPERBASED_URL = String(import.meta.env.VITE_DEFAULT_SUPERBASED_URL || 'https://sb4.otherstuff.studio').trim();

export function recordFamilyNamespace() {
  return APP_NPUB;
}
