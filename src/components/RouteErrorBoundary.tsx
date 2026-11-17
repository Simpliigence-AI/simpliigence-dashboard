import { useEffect, useState } from 'react';
import { useRouteError } from 'react-router-dom';
import {
  canAutoReloadForStaleChunk,
  isStaleChunkError,
  reloadOnceForStaleChunk,
} from '../lib/staleChunk';

/**
 * Root errorElement (AppDesk #2540). Replaces React Router's default
 * developer error screen. A stale code chunk (the app was updated while the
 * tab was open) reloads the page once; anything else shows a plain message
 * with a Reload button.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);
  const [autoReload] = useState(() => stale && canAutoReloadForStaleChunk());

  useEffect(() => {
    if (autoReload) reloadOnceForStaleChunk();
  }, [autoReload]);

  if (autoReload) {
    return (
      <div className="p-8 text-sm text-muted" aria-busy="true">
        Loading the latest version of the dashboard…
      </div>
    );
  }

  const detail = error instanceof Error ? error.message : '';
  return (
    <div className="p-8 max-w-xl space-y-3">
      <h1 className="text-lg font-semibold">This page didn't load</h1>
      <p className="text-sm">
        {stale
          ? 'The dashboard was updated while this tab was open. Reload to get the latest version.'
          : 'Something went wrong while opening this page. Reloading usually fixes it.'}
      </p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 text-sm"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
