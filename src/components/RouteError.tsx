import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { isStaleBuildError, reloadForNewBuild } from '../lib/lazyWithReload';

/** Shown instead of the router's default "Unexpected Application Error!" screen. */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuildError(error);

  useEffect(() => {
    if (stale) reloadForNewBuild();
  }, [stale]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">
          {stale ? 'The app was updated' : 'Something went wrong on this page'}
        </h1>
        <p className="mt-2 text-sm opacity-70">
          {stale
            ? 'Reload to get the latest version. Your saved work is not affected.'
            : 'Reload the page. If it keeps happening, send a screenshot to sfconsulting@simpliigence.com.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
