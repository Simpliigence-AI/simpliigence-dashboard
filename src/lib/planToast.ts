/** Toasts for the project-plan pages (kept out of .tsx so fast refresh stays happy). */

/** Non-blocking toast. window.alert would freeze the tab mid-edit. */
export function toast(msg: string, tone: 'error' | 'ok' = 'error') {
  const el = document.createElement('div');
  el.textContent = msg;
  el.className = `fixed bottom-4 right-4 z-50 max-w-sm rounded-lg text-white text-sm px-4 py-3 shadow-lg ${tone === 'ok' ? 'bg-green' : 'bg-rose'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), tone === 'ok' ? 2500 : 5000);
}

export function alertError(err: unknown) {
  toast((err as Error)?.message ?? String(err), 'error');
}
