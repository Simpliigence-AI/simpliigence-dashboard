/**
 * Starter plans for a new project (Governance's "apply template"). Same
 * shape as a SOW extraction, so both go through applyPlanProposal: weeks are
 * counted from the project start date. PMs edit freely afterwards.
 */
export interface TemplatePhase { name: string; tasks: { name: string; start_week: number; duration_weeks: number }[] }
export interface PlanTemplate { key: string; label: string; weeks: number; phases: TemplatePhase[]; features: string[] }

const t = (name: string, start_week: number, duration_weeks: number) => ({ name, start_week, duration_weeks });

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'sales_cloud', label: 'Sales Cloud implementation (12 weeks)', weeks: 12,
    phases: [
      { name: 'Discovery', tasks: [t('Kick-off and stakeholder interviews', 0, 1), t('Current-state review and requirements workshops', 0, 2), t('BRD sign-off', 1, 1)] },
      { name: 'Design', tasks: [t('Solution design and data model', 2, 1), t('Security model and roles', 2, 1), t('Integration and migration approach', 2, 1)] },
      { name: 'Build', tasks: [t('Sprint 1 — accounts, contacts, leads', 3, 2), t('Sprint 2 — opportunities, products, quotes', 5, 2), t('Sprint 3 — automation, reports, dashboards', 7, 1), t('Data migration build and trial loads', 5, 3)] },
      { name: 'Testing', tasks: [t('System integration testing', 8, 1), t('UAT support and defect fixes', 9, 1)] },
      { name: 'Training', tasks: [t('Train-the-trainer and admin training', 9, 1)] },
      { name: 'Go-live', tasks: [t('Cutover and final data load', 10, 1), t('Go-live', 10, 1)] },
      { name: 'Hypercare', tasks: [t('Hypercare and handover', 11, 1)] },
    ],
    features: ['Account & contact management', 'Lead management', 'Opportunity pipeline', 'Products & price books', 'Quotes', 'Activities & email sync', 'Reports & dashboards', 'Security & roles', 'Data migration'],
  },
  {
    key: 'service_cloud', label: 'Service Cloud implementation (14 weeks)', weeks: 14,
    phases: [
      { name: 'Discovery', tasks: [t('Kick-off and service process workshops', 0, 2), t('BRD sign-off', 2, 1)] },
      { name: 'Design', tasks: [t('Case model, queues and routing design', 2, 1), t('Channels design (email, web, phone)', 2, 1), t('Entitlements and SLA design', 3, 1)] },
      { name: 'Build', tasks: [t('Sprint 1 — cases, queues, assignment', 4, 2), t('Sprint 2 — email-to-case, web-to-case, macros', 6, 2), t('Sprint 3 — knowledge, entitlements, omni-channel', 8, 2), t('Service reports and dashboards', 9, 1)] },
      { name: 'Testing', tasks: [t('System integration testing', 10, 1), t('UAT support and defect fixes', 11, 1)] },
      { name: 'Training', tasks: [t('Agent and supervisor training', 11, 1)] },
      { name: 'Go-live', tasks: [t('Cutover', 12, 1), t('Go-live', 12, 1)] },
      { name: 'Hypercare', tasks: [t('Hypercare and handover', 13, 1)] },
    ],
    features: ['Case management', 'Queues & routing', 'Email-to-case', 'Web-to-case', 'Knowledge', 'Entitlements & SLAs', 'Omni-channel', 'Service console', 'Service reports & dashboards'],
  },
  {
    key: 'cpq', label: 'CPQ / quote-to-contract (16 weeks)', weeks: 16,
    phases: [
      { name: 'Discovery', tasks: [t('Pricing and quoting workshops', 0, 2), t('Product catalogue analysis', 1, 1), t('BRD sign-off', 2, 1)] },
      { name: 'Design', tasks: [t('Product and bundle design', 3, 1), t('Pricing, discount and approval rules design', 3, 1), t('Quote template and contract design', 3, 1)] },
      { name: 'Build', tasks: [t('Sprint 1 — products, bundles, price books', 4, 2), t('Sprint 2 — pricing and discount rules', 6, 2), t('Sprint 3 — approvals, quote templates', 8, 2), t('Sprint 4 — contracts, amendments, renewals', 10, 2)] },
      { name: 'Testing', tasks: [t('System integration testing', 12, 1), t('UAT support and defect fixes', 13, 1)] },
      { name: 'Training', tasks: [t('Sales and deal-desk training', 13, 1)] },
      { name: 'Go-live', tasks: [t('Cutover and go-live', 14, 1)] },
      { name: 'Hypercare', tasks: [t('Hypercare and handover', 15, 1)] },
    ],
    features: ['Product catalogue & bundles', 'Pricing rules', 'Discount schedules', 'Approvals', 'Quote templates', 'Contracts', 'Amendments', 'Renewals'],
  },
  {
    key: 'ai_agent', label: 'AI agent pilot (8 weeks)', weeks: 8,
    phases: [
      { name: 'Discovery', tasks: [t('Use-case workshop and success metrics', 0, 1), t('Data and system access', 0, 2)] },
      { name: 'Design', tasks: [t('Agent design, guardrails and evaluation plan', 1, 1)] },
      { name: 'Build', tasks: [t('Agent build — iteration 1', 2, 2), t('Integrations and tools', 2, 2), t('Agent build — iteration 2', 4, 1)] },
      { name: 'Testing', tasks: [t('Evaluation against test set', 5, 1), t('User pilot', 6, 1)] },
      { name: 'Go-live', tasks: [t('Pilot readout and go/no-go', 7, 1)] },
    ],
    features: ['Agent conversation flow', 'Knowledge grounding', 'System integrations', 'Guardrails', 'Evaluation dashboard', 'User pilot'],
  },
  {
    key: 'support', label: 'Managed services / support (monthly)', weeks: 4,
    phases: [
      { name: 'Onboarding', tasks: [t('Access, runbook and ticket process', 0, 1), t('Org health check', 0, 2)] },
      { name: 'Run', tasks: [t('Monthly enhancements and fixes', 1, 3), t('Release and change management', 1, 3)] },
      { name: 'Governance', tasks: [t('Monthly service review', 3, 1)] },
    ],
    features: ['Ticket handling', 'Enhancements', 'Release management', 'Health check', 'Monthly service review'],
  },
];

/** Monday-based date arithmetic on 'YYYY-MM-DD' strings. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
