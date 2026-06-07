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
import TADailyLogPage from '../pages/TADailyLogPage';
import CandidatesPage from '../pages/CandidatesPage';
import TAMetricsPage from '../pages/TAMetricsPage';
import ProfileFormatPage from '../pages/ProfileFormatPage';
import AccountsPage from '../pages/AccountsPage';
import MyTimePage from '../pages/MyTimePage';
import TeamTimePage from '../pages/TeamTimePage';
import UsersPage from '../pages/admin/UsersPage';
import ActivityPage from '../pages/admin/ActivityPage';
import AuditLogPage from '../pages/admin/AuditLogPage';
import { AdminOnly } from '../components/AdminOnly';
import { EmployeeRedirect } from '../components/EmployeeRedirect';
import { RoleOnly } from '../components/RoleOnly';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        // Home — employees redirect to /my-time, everyone else sees the dashboard
        { index: true, element: <EmployeeRedirect><DashboardPage /></EmployeeRedirect> },

        // My Time — visible to everyone
        { path: 'my-time', element: <MyTimePage /> },
        // Team Time — manager/admin approval queue (page itself enforces the role gate)
        { path: 'my-team-time', element: <TeamTimePage /> },

        // Projects section — admin only. TA Managers (role='manager') see
        // these in neither the sidebar nor when typing the URL directly.
        { path: 'team', element: <RoleOnly allow={['admin']}><TeamRosterPage /></RoleOnly> },
        { path: 'actual-hours', element: <RoleOnly allow={['admin']}><ActualHoursPage /></RoleOnly> },
        { path: 'projects', element: <RoleOnly allow={['admin']}><ProjectPipelinePage /></RoleOnly> },
        { path: 'pipeline', element: <RoleOnly allow={['admin']}><PipelinePage /></RoleOnly> },
        { path: 'forecasting', element: <RoleOnly allow={['admin']}><ForecastingPage /></RoleOnly> },
        { path: 'hiring-forecast', element: <RoleOnly allow={['admin']}><HiringForecastPage /></RoleOnly> },
        { path: 'financials', element: <RoleOnly allow={['admin']}><FinancialsPage /></RoleOnly> },

        // India T&M section
        { path: 'india-staffing', element: <IndiaStaffingPage /> },         // "India Demand"
        { path: 'india-roster', element: <IndiaRosterPage /> },             // NEW
        { path: 'india-hiring-forecast', element: <IndiaHiringForecastPage /> }, // NEW
        { path: 'ta-daily-log', element: <TADailyLogPage /> },              // NEW — TA "My Day"
        { path: 'ta-metrics', element: <TAMetricsPage /> },                 // NEW — TA performance dashboard
        { path: 'candidates', element: <CandidatesPage /> },                // NEW — bulk candidate CRUD
        { path: 'profile-format', element: <ProfileFormatPage /> },         // NEW — Claude-powered resume reformatter

        // US T&M section
        { path: 'us-staffing', element: <USStaffingPage /> },        // "US Demand"
        { path: 'us-roster', element: <USRosterPage /> },            // NEW
        { path: 'open-bench', element: <OpenBenchPage /> },

        // Admin section — gated by AdminOnly (is_admin on authorized_users)
        { path: 'admin/users',    element: <AdminOnly><UsersPage /></AdminOnly> },
        { path: 'admin/activity', element: <AdminOnly><ActivityPage /></AdminOnly> },
        { path: 'admin/audit',    element: <AdminOnly><AuditLogPage /></AdminOnly> },

        // Account Management
        { path: 'accounts', element: <AccountsPage /> },

        // Other
        { path: 'concierge', element: <ConciergePage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);
