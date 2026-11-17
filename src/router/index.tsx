import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const TeamRosterPage = lazy(() => import('../pages/TeamRosterPage'));
const ActualHoursPage = lazy(() => import('../pages/ActualHoursPage'));
const ProjectPipelinePage = lazy(() => import('../pages/ProjectPipelinePage'));
const ForecastingPage = lazy(() => import('../pages/ForecastingPage'));
const FinancialsPage = lazy(() => import('../pages/FinancialsPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const ConciergePage = lazy(() => import('../pages/ConciergePage'));
const IndiaStaffingPage = lazy(() => import('../pages/IndiaStaffingPage'));
const USStaffingPage = lazy(() => import('../pages/USStaffingPage'));
const OpenBenchPage = lazy(() => import('../pages/OpenBenchPage'));
const IndiaRosterPage = lazy(() => import('../pages/IndiaRosterPage'));
const IndiaHiringForecastPage = lazy(() => import('../pages/IndiaHiringForecastPage'));
const USRosterPage = lazy(() => import('../pages/USRosterPage'));
const TnmAccountsPage = lazy(() => import('../pages/TnmAccountsPage'));
const TADailyLogPage = lazy(() => import('../pages/TADailyLogPage'));
const CandidatesPage = lazy(() => import('../pages/CandidatesPage'));
const TAMetricsPage = lazy(() => import('../pages/TAMetricsPage'));
const IndiaDemandAnalyticsPage = lazy(() => import('../pages/IndiaDemandAnalyticsPage'));
const MarginCalculatorPage = lazy(() => import('../pages/MarginCalculatorPage'));
const ProfileFormatPage = lazy(() => import('../pages/ProfileFormatPage'));
const VendorsPage = lazy(() => import('../pages/VendorsPage'));
const HiringRadarPage = lazy(() => import('../pages/HiringRadarPage'));
const ScreeningsPage = lazy(() => import('../pages/ScreeningsPage'));
const DialerPage = lazy(() => import('../pages/DialerPage'));
const HomePage = lazy(() => import('../pages/HomePage'));
const CheckinsPage = lazy(() => import('../pages/CheckinsPage'));
const MyTimePage = lazy(() => import('../pages/MyTimePage'));
const TeamTimePage = lazy(() => import('../pages/TeamTimePage'));
const TeamLeavePage = lazy(() => import('../pages/TeamLeavePage'));
const LeavePage = lazy(() => import('../pages/LeavePage'));
const UsersPage = lazy(() => import('../pages/admin/UsersPage'));
const ActivityPage = lazy(() => import('../pages/admin/ActivityPage'));
const AuditLogPage = lazy(() => import('../pages/admin/AuditLogPage'));
const LeaveAdminPage = lazy(() => import('../pages/admin/LeaveAdminPage'));
const AccessMatrixPage = lazy(() => import('../pages/admin/AccessMatrixPage'));
const CheckinAdminPage = lazy(() => import('../pages/admin/CheckinAdminPage'));
const ProjectPlansPage = lazy(() => import('../pages/ProjectPlansPage'));
const ProjectPlanDetailPage = lazy(() => import('../pages/project-plans/ProjectPlanDetailPage'));
const DeliveryHomePage = lazy(() => import('../pages/DeliveryHomePage'));
import { AdminOnly } from '../components/AdminOnly';
import { EmployeeRedirect } from '../components/EmployeeRedirect';
import { RoleOnly } from '../components/RoleOnly';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        // Home — employees redirect to /my-time, everyone else sees the dashboard
        { index: true, element: <EmployeeRedirect><DashboardPage /></EmployeeRedirect> },

        // Check-ins — monthly scorecards across every corporate function.
        // Page-level: anyone with the tab can read and work their card; the
        // database decides what a locked forecast lets them change.
        { path: 'checkins', element: <CheckinsPage /> },

        // My Time — visible to everyone
        { path: 'my-time', element: <MyTimePage /> },
        // Team Time — manager/admin approval queue (page itself enforces the role gate)
        { path: 'my-team-time', element: <TeamTimePage /> },
        // Leave — everyone; approvals tab is auto-shown for anyone with reports
        { path: 'leave', element: <LeavePage /> },
        // Team Leave — manager/admin view of ALL employees' leave requests
        // (the page itself enforces the admin+manager role gate).
        { path: 'team-leave', element: <TeamLeavePage /> },

        // Projects section — admin only. TA Managers (role='manager') see
        // these in neither the sidebar nor when typing the URL directly.
        { path: 'team', element: <RoleOnly allow={['admin']}><TeamRosterPage /></RoleOnly> },
        { path: 'actual-hours', element: <RoleOnly allow={['admin']}><ActualHoursPage /></RoleOnly> },
        { path: 'projects', element: <RoleOnly allow={['admin']}><ProjectPipelinePage /></RoleOnly> },
        { path: 'pipeline', element: <Navigate to="/projects" replace /> }, // retired Nov 2026
        // Gated by the 'project-plans' tab (role + per-user grants), not by role alone —
        // BAs and project leads with role='employee' own plans too. Pages redirect if denied.
        // Delivery Home — gated by the 'project-plans' tab like the plans themselves.
        { path: 'delivery-home', element: <DeliveryHomePage /> },
        { path: 'project-plans', element: <ProjectPlansPage /> },
        { path: 'project-plans/:id', element: <ProjectPlanDetailPage /> },
        { path: 'forecasting', element: <RoleOnly allow={['admin']}><ForecastingPage /></RoleOnly> },
        { path: 'hiring-forecast', element: <Navigate to="/home" replace /> }, // retired — India Hiring Forecast remains
        { path: 'financials', element: <RoleOnly allow={['admin']}><FinancialsPage /></RoleOnly> },

        // India T&M section
        { path: 'india-staffing', element: <IndiaStaffingPage /> },         // "India Demand"
        { path: 'india-demand-analytics', element: <IndiaDemandAnalyticsPage /> }, // NEW — raised/closed/why-not, on demand
        { path: 'india-roster', element: <IndiaRosterPage /> },             // NEW
        { path: 'india-hiring-forecast', element: <IndiaHiringForecastPage /> }, // NEW
        { path: 'ta-daily-log', element: <TADailyLogPage /> },              // NEW — TA "My Day"
        { path: 'ta-metrics', element: <TAMetricsPage /> },                 // NEW — TA performance dashboard
        { path: 'margin-calculator', element: <MarginCalculatorPage /> },   // client budget -> approved candidate cost
        { path: 'candidates', element: <CandidatesPage /> },                // NEW — bulk candidate CRUD
        { path: 'profile-format', element: <ProfileFormatPage /> },         // NEW — Claude-powered resume reformatter

        // US T&M section
        { path: 'us-staffing', element: <USStaffingPage /> },        // "US Demand"
        { path: 'us-roster', element: <USRosterPage /> },            // NEW
        { path: 'tnm-accounts', element: <TnmAccountsPage /> },      // NEW — SI + End Client accounts + prospects
        { path: 'open-bench', element: <OpenBenchPage /> },

        // Admin section — gated by AdminOnly (is_admin on authorized_users)
        { path: 'admin/users',    element: <AdminOnly><UsersPage /></AdminOnly> },
        { path: 'admin/activity', element: <AdminOnly><ActivityPage /></AdminOnly> },
        { path: 'admin/audit',    element: <AdminOnly><AuditLogPage /></AdminOnly> },
        { path: 'admin/leave',    element: <AdminOnly><LeaveAdminPage /></AdminOnly> },
        { path: 'admin/access',   element: <AdminOnly><AccessMatrixPage /></AdminOnly> },
        { path: 'admin/checkins', element: <AdminOnly><CheckinAdminPage /></AdminOnly> },

        // Account Management
        { path: 'accounts', element: <Navigate to="/home" replace /> }, // Sales & Accounts retired Nov 2026
        { path: 'vendors',  element: <VendorsPage /> },
        { path: 'gtm-list', element: <Navigate to="/home" replace /> },  // Sales & Accounts retired Nov 2026
        { path: 'hiring-radar', element: <HiringRadarPage /> },
        { path: 'screenings', element: <ScreeningsPage /> },
        { path: 'dialer',   element: <DialerPage /> },   // Twilio softphone + AI call notes
        { path: 'home',     element: <HomePage /> },

        // Other
        { path: 'concierge', element: <ConciergePage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);
