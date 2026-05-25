import { createBrowserRouter } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import DashboardPage from '../pages/DashboardPage';
import TeamRosterPage from '../pages/TeamRosterPage';
import ActualHoursPage from '../pages/ActualHoursPage';
import ProjectPipelinePage from '../pages/ProjectPipelinePage';
import PipelinePage from '../pages/PipelinePage';
import ForecastingPage from '../pages/ForecastingPage';
import FinancialsPage from '../pages/FinancialsPage';
import SettingsPage from '../pages/SettingsPage';
import HiringForecastPage from '../pages/HiringForecastPage';
import ConciergePage from '../pages/ConciergePage';
import IndiaStaffingPage from '../pages/IndiaStaffingPage';
import USStaffingPage from '../pages/USStaffingPage';
import OpenBenchPage from '../pages/OpenBenchPage';
import IndiaRosterPage from '../pages/IndiaRosterPage';
import IndiaHiringForecastPage from '../pages/IndiaHiringForecastPage';
import USRosterPage from '../pages/USRosterPage';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        // Home
        { index: true, element: <DashboardPage /> },

        // Projects section
        { path: 'team', element: <TeamRosterPage /> },              // "Project Team"
        { path: 'actual-hours', element: <ActualHoursPage /> },      // NEW — Zoho People actuals
        { path: 'projects', element: <ProjectPipelinePage /> },      // Current Projects
        { path: 'pipeline', element: <PipelinePage /> },             // Pipeline Projects
        { path: 'forecasting', element: <ForecastingPage /> },       // "Utilization Forecast"
        { path: 'hiring-forecast', element: <HiringForecastPage /> },
        { path: 'financials', element: <FinancialsPage /> },

        // India T&M section
        { path: 'india-staffing', element: <IndiaStaffingPage /> },         // "India Demand"
        { path: 'india-roster', element: <IndiaRosterPage /> },             // NEW
        { path: 'india-hiring-forecast', element: <IndiaHiringForecastPage /> }, // NEW

        // US T&M section
        { path: 'us-staffing', element: <USStaffingPage /> },        // "US Demand"
        { path: 'us-roster', element: <USRosterPage /> },            // NEW
        { path: 'open-bench', element: <OpenBenchPage /> },

        // Other
        { path: 'concierge', element: <ConciergePage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);
