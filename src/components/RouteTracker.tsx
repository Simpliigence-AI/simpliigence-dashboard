/**
 * Mounted inside the RouterProvider tree. Fires `recordPageView()` on every
 * route change so we capture which pages each user visits and for how long.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { recordPageView } from '../lib/analytics';

export function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    // Fire-and-forget — analytics shouldn't block UI.
    void recordPageView(location.pathname);
  }, [location.pathname]);
  return null;
}
