import { useState, useMemo, useRef, useEffect } from 'react';
import { usePipelineStore, useFinancialStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import { PresalesSection } from './pipeline/PresalesSection';
import type { ZohoPipelineProject, PipelineResource } from '../types/forecast';
import { db } from '../lib/supabaseSync';
import { useAuthStore } from '../store/useAuthStore';
import { buildSowDocxBlob, type SowSectionInput } from '../lib/sowDocx';
import {
  Plus,
  ArrowRightCircle,
  Trash2,
  Calendar,
  DollarSign,
  Users,
  Layers,
  UserPlus,
  X,
  Check,
  FileText,
  Download,
} from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  BA: 'BAs',
  JuniorDev: 'Jr Devs',
  SeniorDev: 'Sr Devs',
};

/** Canonical Simpliigence concierge SOW template. Extracted verbatim from
 *  the executed "Concierge Support for Knit.docx". When the wizard opens
 *  for a concierge SOW, every field below pre-fills with these values —
 *  the user edits in place rather than starting from a blank page. */
const CONCIERGE_TEMPLATE = {
  intro: 'Simpliigence has partnered with the client here to setup, enhance and support the Salesforce platform to help the client achieve its business goals. As part of this exercise, Simpliigence will be covering the following activities. The activities covered under this SOW will be:',
  activities: [
    'Advisory, consulting and recommendations for usage of platform features',
    'Enhancements of functionality on Salesforce platform (examples include User Interface changes, Scheduled reports, data jobs, workflow changes, code changes)',
    'Business Operations support on Salesforce CRM (examples include User maintenance, Data updates, Template creation)',
    'Other Services (examples include User Training, technical feasibility/evaluation, Onsite meetings, Process reviews)',
  ],
  assumptions: [
    'Weekly status report of hours consumed will be shared with the client which will include the number of hours consumed. If the client has any question or objection of hours consumed by task, they are required to raise the clarification within 3 business days, else it will be presumed that there are no queries.',
    'Client shall provide a single point of contact to coordinate management, communication and other project actions throughout the life-cycle of the engagement.',
    'Knowledge transition of existing Salesforce.com will be completed prior to the start of the contract.',
    'Any technology services outside of Salesforce.com will be considered out of scope. Simpliigence will validate if technical changes (outside Salesforce) can be done and will advise the client accordingly.',
    'Onsite meetings will require at least 1 week notice and will be based on mutual availability and schedule of consultant and the client. Expenses associated to onsite meeting (travel, lodging etc) will be based on actual and prior approved by the client.',
  ],
  pricing: {
    contractType: 'Time & Materials',
    rate: '$95 / hour',
    paymentTerms: '30 days from invoice date',
    invoiceDate: '1st of every month',
    termination: '4 weeks of notice will be required for termination of services',
    minimumHours: 'N/A',
    travel: 'For consultant travel, it will be based on actuals and pre-approved by the client.',
    purchaseOrder: 'The client agrees hereby that NO purchase order is required for monthly invoice.',
  },
};

/** Builds the canonical concierge SOW sections deterministically from the
 *  user's (possibly edited) template inputs. No AI is involved — the
 *  concierge SOW is a standardised template, and AI generation only
 *  introduces drift away from Legal's accepted language. */
function buildConciergeSections(input: {
  clientName: string;
  clientAddress: string;
  effectiveDate: string;
  intro: string;
  activities: string;
  assumptions: string;
  contractType: string;
  rate: string;
  paymentTerms: string;
  invoiceDate: string;
  termination: string;
  minimumHours: string;
  travel: string;
  purchaseOrder: string;
  special: string;
}): SowSectionInput[] {
  const SIMPLIIGENCE = 'Simpliigence Inc, a Delaware incorporated company with offices at 8 The Green, Ste A, Dover, DE-19901 ("Simpliigence")';
  const splitNonEmpty = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  const statementOfWork: SowSectionInput = {
    heading: 'STATEMENT OF WORK',
    body: `This STATEMENT OF WORK ("SOW") is entered into between ${SIMPLIIGENCE} and ${input.clientName} ("Client") with offices at ${input.clientAddress || '<Client Address>'} as of ${input.effectiveDate} (the "SOW Effective Date").`,
  };

  const scopeOfServices: SowSectionInput = {
    heading: 'SCOPE OF SERVICES',
    body: input.intro,
    bullets: splitNonEmpty(input.activities),
  };

  const assumptions: SowSectionInput = {
    heading: 'ASSUMPTIONS',
    body: '',
    bullets: splitNonEmpty(input.assumptions),
  };

  const pricingLines = [
    'Pricing',
    `Contract Type: ${input.contractType}`,
    `Rate: ${input.rate}`,
    `Payment terms: ${input.paymentTerms}.`,
    `Invoice date: ${input.invoiceDate}.`,
    'Contract Termination',
    `${input.termination}.`,
    `Minimum Hours per month: ${input.minimumHours}`,
    'Travel & Expenses',
    input.travel,
    `Purchase Order required: ${input.purchaseOrder}`,
  ];
  const pricing: SowSectionInput = {
    heading: 'PRICING TERMS AND FEE SCHEDULE',
    body: '',
    bullets: pricingLines,
  };

  const sections: SowSectionInput[] = [statementOfWork, scopeOfServices, assumptions, pricing];

  if (input.special && input.special.trim()) {
    sections.push({
      heading: 'SPECIAL CONDITIONS',
      body: input.special.trim(),
    });
  }

  return sections;
}

/** Canonical Simpliigence implementation SOW template. Extracted verbatim
 *  from the executed "Simpliigence Implementation for Qu Data 2026 SOW".
 *  Pre-fills the implementation wizard so the user edits in place rather
 *  than starting from a blank page. */
const IMPLEMENTATION_TEMPLATE = {
  scopeIntro: 'Simpliigence will configure and deploy the Salesforce platform to support the following core commercial and operational capabilities:',
  scopeCapabilities: [
    'Account and Contact Management',
    'Opportunity Management and Pipeline Governance',
    'Standardized Quoting and Approval Controls',
    'Product Catalog and Pricing Governance',
    'Contract Object Configuration for Term, Rate, and Renewal Management',
    'Order Handoff and Downstream System Integration Readiness',
    'Reporting, Forecasting, and Executive Dashboarding',
    'User Experience Design and Permission Model',
    'Document Generation (e-Signature, Quote Outputs, Supporting Attachments)',
    'Activity Management, Notifications, and Workflow Automation',
    'Data Migration (Agreed Historical Commercial Records and Active Accounts)',
    'Environment Strategy, Testing, and Deployment Governance',
  ],
  discoveryIntro: 'Simpliigence will lead a structured Discovery & Design program intended to formalize requirements, validate data architecture, and produce a build-ready blueprint aligned to the Client\'s current operating model and future growth objectives.',
  discoveryExit: 'Exit Criteria: Approved Working BRD, documented solution design, integration mapping, data migration scope definition, and written sign-off.',
  discoveryAreas: [
    'Account & Customer Data Architecture — Confirmation of account structure, segmentation, hierarchy, ownership, and data governance standards.',
    'Opportunity Lifecycle & Pipeline Governance — Formalization of opportunity stages, progression criteria, forecasting alignment, and approval thresholds.',
    'Product Catalogue & Pricing Governance — Validation of product structure, Pricebook strategy, discount governance, and administrative controls.',
    'Quote Creation & Commercial Workflow — Definition of quote lifecycle, calculation handling, approval routing, amendment management, and quote-to-order transition.',
    'Contract Structure & Renewal Governance — Establishment of contract object design, term management, amendment handling, and renewal visibility.',
    'Order Handoff & Integration Readiness — Definition of order structure, object relationships, metadata requirements, and downstream system readiness.',
    'Reporting & Executive Visibility — Cataloging of required dashboards, operational reports, KPI definitions, and data source governance.',
    'Security Model & Role-Based Access — Confirmation of user roles, field-level access, approval authority structure, and governance controls.',
    'Data Migration & Archival Strategy — Definition of historical data scope, archival access model, extraction responsibilities, transformation rules, and reconciliation standards.',
  ],
  buildIntro: 'Following completion of the Discovery and Design phase, Salesforce will be configured in accordance with the signed design. Build Completion is defined as all in-scope configuration completed in a sandbox environment, internal QA passed, and readiness confirmed for formal User Acceptance Testing. The activities covered within configuration and build will include:',
  buildCategories: [
    { heading: 'Account & Contact Model', bullets: [
      'Configuration of Account and Contact data structures to support the Client\'s commercial model.',
      'Standardization of record types and lifecycle stages.',
      'Field configuration for commercial tracking, segmentation, and ownership.',
      'Relationship management between Accounts, Contacts, Opportunities, and Contracts.',
      'Data governance controls including validation rules and required field enforcement.',
    ] },
    { heading: 'Opportunity Management & Pipeline Governance', bullets: [
      'Configuration of opportunity processes aligned to the Client\'s sales motion.',
      'Standardized stage model with defined entry and exit criteria.',
      'Forecast category alignment and reporting consistency.',
      'Approval workflows where required by policy.',
      'Activity tracking and pipeline visibility controls.',
    ] },
    { heading: 'Quoting', bullets: [
      'Configuration of standard Salesforce Quotes related to Opportunities.',
      'Opportunity Product selection using standard Price Books.',
      'Governed price override controls and approval workflows where required.',
      'Quote-to-Opportunity synchronization settings.',
      'Document generation for quote output using Salesforce-native templates.',
      'E-signature readiness, with vendor selection confirmed separately if required.',
    ] },
    { heading: 'Product Catalog & Pricing Governance', bullets: [
      'Configuration of Products and Price Books aligned to defined pricing tiers.',
      'Field-based pricing attributes to support reporting and governance.',
      'Approval-based pricing control mechanisms.',
      'Reporting alignment between product usage and revenue tracking.',
      'Configuration-first pricing architecture without engine-based rule orchestration.',
    ] },
    { heading: 'Contract Management', bullets: [
      'Configuration of the standard Salesforce Contract object.',
      'Contract term tracking and start/end date management.',
      'Structured linkage between Quotes, Opportunities, and Contracts.',
      'Amendment tracking using defined fields and governance controls.',
      'Renewal tracking and contract status reporting.',
    ] },
    { heading: 'Reporting & Dashboards', bullets: [
      'Configuration of core Sales and Executive dashboards.',
      'Standard pipeline, forecast, and revenue reporting.',
      'Product and pricing analytics reporting.',
      'Contract status and lifecycle visibility reporting.',
      'Delivery of an agreed baseline set of custom reports and dashboards to be finalized during Design.',
    ] },
    { heading: 'Data Migration', bullets: [
      'Migration of active Accounts and Contacts.',
      'Migration of active and month-to-month Contracts.',
      'Migration of active Opportunities.',
      'Historical data to be archived outside Salesforce per agreed strategy.',
    ] },
    { heading: 'Automation Framework', bullets: [
      'Implementation of record-triggered flows for lifecycle transitions.',
      'Approval processes aligned to defined governance policies.',
      'Task and notification automation.',
      'Performance-optimized automation architecture.',
      'Limited Apex development for structural services or metadata-driven mappings where configuration alone is insufficient.',
    ] },
  ],
  deliverablesTable: {
    headers: ['Phase', 'Project Deliverables'],
    rows: [
      ['Discovery & Design', 'Process Flows\nUser stories by role, business process mapping\nArchitecture diagram and data model\nBusiness Requirements Document (BRD)'],
      ['Configuration & Build', 'Weekly demos of features and functionality\nConfiguration documentation'],
      ['UAT', 'UAT Test Plan and Test Cases\n7 Step UAT process execution'],
      ['Data Migration', 'Full-Service Migration of Data\nData extraction, transformation, and loading\nSandbox testing before Production'],
      ['Integration', 'Integration configuration and testing\nMicrosoft Office 365\nDownstream systems per agreed plan'],
      ['Training', 'Guided digital walkthroughs with recordings\nSalesforce In-App Guidance\nUser and admin guides'],
      ['Project Management', 'Project plan\nIssue tracker / Risk register\nWeekly status report\nMonthly Exec review (Steering Group)'],
    ],
  },
  testingTable: {
    headers: ['Test Type', 'Role', 'Activity'],
    rows: [
      ['Unit Testing', 'Configurators, Developers (Simpliigence)', 'Unit testing of all configurations and code — done by developers'],
      ['Functional Testing', 'Functional Lead (Simpliigence)', 'Testing of each unit-tested feature and user story'],
      ['System Integration Testing', 'QA, Functional Lead, PM', 'End-to-end testing of features along with testing of interfaces'],
      ['Mobile Testing', 'QA, Functional Lead', 'Testing of mobile UI including loading and rendering; feature testing'],
      ['User Acceptance Testing', 'Simpliigence + Client UAT team', 'Testing of features end-to-end including data'],
      ['Sanity Testing', 'Simpliigence + Client UAT team', 'Post-deployment testing of all developed features'],
      ['Regression Testing', 'QA, Functional Lead', 'Retest of fixed issues and regression test existing features'],
    ],
  },
  trainingTable: {
    headers: ['Training Type', 'Activity', 'Deliverables'],
    rows: [
      ['Demo and Beta Training', 'After weekly demos, nominated beta users (SMEs) can be trained to test beta features on the Salesforce sandbox', 'Recordings\nBeta training scenarios\nTest data'],
      ['Business User Training', 'Remote Train-the-Trainer model for end users\nCore platform functionality and workflows', 'Digital walkthroughs with recordings\nUser guides'],
      ['Advanced and Admin Training', 'Training for designated administrators and super-users\nSetup tasks, users and roles maintenance, admin reporting', 'Digital walkthroughs with recordings\nAdmin documentation'],
    ],
  },
  assumptions: [
    'Configuration limits described in the scope above are based on the agreed Business Requirements Document.',
    'Additional requirements not documented in the approved BRD will be evaluated and may be addressed through a formal scope deferment or change request process.',
    'Client is responsible for providing administrative access to all systems in scope for development and integration.',
    'Timeline assumptions are contingent upon timely extraction access and data quality for data migration activities.',
    'Client shall provide a single point of contact to coordinate management, communication, and project actions throughout the life cycle of the engagement.',
    'Unless otherwise stated, any technology services outside of Salesforce.com will be considered out of scope. Simpliigence will validate if technical changes (outside Salesforce) can be done and will advise the Client accordingly.',
    'Onsite meetings will require at least 1 week notice and will be based on mutual availability and schedule of Simpliigence and the Client. Expenses associated with onsite meetings will not be invoiced without prior approvals and/or change orders agreed upon in advance.',
  ],
  goLiveDef: 'Go-Live is defined as successful deployment to Production, completion of agreed sanity validation, and written confirmation from Client that core in-scope deliverables are operational.',
  hypercareDef: 'Hypercare is a structured, time-bound post-deployment support phase designed to stabilize the solution, address early-stage issues, and ensure Client\'s team is fully supported during transition to steady-state operations.',
  timelineBullets: [
    'Kickoff: 3-5 business days from SOW Signing',
    'Discovery & Design',
    'Configuration & Build (Sprints, Build, Unit Test)',
    'Testing and Training',
    'Go-Live',
    'Hypercare (post go-live support): 4 weeks',
  ],
  pricing: {
    contractType: 'Fixed Price, milestone-based',
    paymentTerms: '15 days from invoice date',
    termination: '4 weeks of notice will be required for termination of services.',
    minimumHours: 'N/A',
    travel: 'For Simpliigence travel, travel and expenses will be based on actuals and pre-approved by the Client.',
    purchaseOrder: 'The Client agrees hereby that NO purchase order is required for monthly invoice.',
    defaultMilestones: [
      { milestone: 'SOW Signing', percentage: '25%', amount: '' },
      { milestone: 'Build Completion', percentage: '25%', amount: '' },
      { milestone: 'UAT Completion', percentage: '25%', amount: '' },
      { milestone: 'Go-Live', percentage: '25%', amount: '' },
    ],
  },
};

/** Builds the canonical implementation SOW sections deterministically from
 *  the user's (possibly edited) template inputs. No AI involvement —
 *  mirrors the executed Qu Data Centres SOW format 1:1. */
function buildImplementationSections(input: {
  clientName: string;
  clientAddress: string;
  effectiveDate: string;
  introNarrative: string;
  scopeIntro: string;
  scopeCapabilities: string;
  governingArtifacts: string;
  discoveryIntro: string;
  discoveryExit: string;
  discoveryAreas: string;
  buildIntro: string;
  buildCategories: Array<{ heading: string; bullets: string }>;
  assumptions: string;
  totalDuration: string;
  timelineBullets: string;
  contractType: string;
  totalFee: string;
  pricingMilestones: Array<{ milestone: string; percentage: string; amount: string }>;
  paymentTerms: string;
  termination: string;
  minimumHours: string;
  travel: string;
  purchaseOrder: string;
}): SowSectionInput[] {
  const SIMPLIIGENCE = 'Simpliigence Inc, a Delaware incorporated company with offices at 8 The Green, Ste A, Dover, DE-19901 ("Simpliigence")';
  const splitNonEmpty = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  const opening = `This STATEMENT OF WORK ("SOW") is entered into between ${SIMPLIIGENCE} and ${input.clientName} ("Client") with offices at ${input.clientAddress || '<Client Address>'} as of ${input.effectiveDate} (the "SOW Effective Date").`;
  const narrative = input.introNarrative.trim();
  const statementOfWork: SowSectionInput = {
    heading: 'STATEMENT OF WORK',
    body: narrative ? `${opening}\n\n${narrative}` : opening,
  };

  const scope: SowSectionInput = {
    heading: 'SCOPE OF SERVICES (IMPLEMENTATION)',
    body: input.scopeIntro,
    bullets: splitNonEmpty(input.scopeCapabilities),
  };
  const artifacts = splitNonEmpty(input.governingArtifacts);
  if (artifacts.length > 0) {
    scope.subSections = [{
      heading: 'Governing Artifacts',
      body: 'This Scope of Services is informed by and aligned to the following artifacts provided by Client leadership and project stakeholders:',
      bullets: artifacts,
    }];
  }

  const discovery: SowSectionInput = {
    heading: 'DISCOVERY AND DESIGN',
    body: `${input.discoveryIntro}\n\n${input.discoveryExit}\n\nThe Discovery & Design phase will focus on the following capability areas:`,
    bullets: [
      ...splitNonEmpty(input.discoveryAreas),
      'Deliverable: comprehensive Business Requirements Document (BRD) governing all subsequent build activities.',
    ],
  };

  const build: SowSectionInput = {
    heading: 'CONFIGURATION AND BUILD',
    body: input.buildIntro,
    subSections: input.buildCategories
      .filter((c) => c.heading && c.heading.trim())
      .map((c) => ({ heading: c.heading.trim(), bullets: splitNonEmpty(c.bullets) })),
  };

  const deliverables: SowSectionInput = { heading: 'SUMMARY OF DELIVERABLES', body: '', table: IMPLEMENTATION_TEMPLATE.deliverablesTable };
  const testing: SowSectionInput = { heading: 'TESTING DELIVERABLES', body: '', table: IMPLEMENTATION_TEMPLATE.testingTable };
  const training: SowSectionInput = { heading: 'TRAINING DELIVERABLES', body: '', table: IMPLEMENTATION_TEMPLATE.trainingTable };

  const assumptions: SowSectionInput = {
    heading: 'ASSUMPTIONS (IMPLEMENTATION)',
    body: '',
    bullets: splitNonEmpty(input.assumptions),
  };

  const timeline: SowSectionInput = {
    heading: 'TIMELINES AND PRICING',
    body: `Overall Duration: ${input.totalDuration}\n\n${IMPLEMENTATION_TEMPLATE.goLiveDef}\n\n${IMPLEMENTATION_TEMPLATE.hypercareDef}\n\nActual project plan will be discussed and formalized post-kickoff meeting, and mutually agreed upon with the Client.`,
    subSections: [{ heading: 'Project Timeline', bullets: splitNonEmpty(input.timelineBullets) }],
  };

  const validMilestones = input.pricingMilestones.filter((m) => m.milestone && m.milestone.trim());
  const pricing: SowSectionInput = {
    heading: 'PRICING TERMS AND FEE SCHEDULE',
    body: '',
    bullets: [
      'Pricing (Implementation)',
      `Contract Type: ${input.contractType}`,
      `Total Fee: ${input.totalFee}`,
      `Payment terms: ${input.paymentTerms}.`,
      `Contract Termination: ${input.termination}`,
      `Minimum Hours per month: ${input.minimumHours}`,
      `Travel & Expenses: ${input.travel}`,
      `Purchase Order: ${input.purchaseOrder}`,
    ],
  };
  if (validMilestones.length > 0) {
    pricing.table = {
      headers: ['Milestone', 'Percentage', 'Amount'],
      rows: validMilestones.map((m) => [m.milestone.trim(), m.percentage.trim(), m.amount.trim()]),
    };
  }

  return [statementOfWork, scope, discovery, build, deliverables, testing, training, assumptions, timeline, pricing];
}

/** Same content as the .docx — renders as a clean HTML preview the user can
 *  print to PDF if they prefer. */
function buildSowHtml(clientName: string, effectiveDate: string, sections: SowSectionInput[]): string {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderTable = (t: { headers: string[]; rows: string[][] }) => {
    const thead = `<thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${t.rows.map((r) => `<tr>${r.map((c) => {
      const lines = (c || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
      return `<td>${lines.length > 1 ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : esc(lines[0] || '')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
    return `<table class="sow-table">${thead}${tbody}</table>`;
  };
  const sectionBlocks = sections.map((s) => {
    const body = s.body ? `<p>${esc(s.body).replace(/\n\n/g, '</p><p>')}</p>` : '';
    const bullets = s.bullets && s.bullets.length > 0 ? `<ol>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ol>` : '';
    const subs = (s.subSections || []).map((sub) => `<div class="sub"><h3>${esc(sub.heading)}</h3>${sub.body ? `<p>${esc(sub.body)}</p>` : ''}${sub.bullets && sub.bullets.length > 0 ? `<ul>${sub.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join('');
    const table = s.table ? renderTable(s.table) : '';
    return `<section><h2>${esc(s.heading)}</h2>${body}${bullets}${subs}${table}</section>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>SOW — ${esc(clientName)}</title>
<style>
  body{font:13px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;max-width:840px;margin:24px auto;padding:0 32px}
  .cover{text-align:center;padding:80px 0 40px}
  .cover h1{font-size:32px;margin:0 0 16px 0;border-bottom:3px solid #f97316;padding-bottom:8px;display:inline-block}
  .cover .preparedFor{color:#64748b;margin-top:24px}
  .cover .client{font-size:24px;font-weight:bold;margin-top:8px}
  .toc{margin:24px 0}
  .toc h2{font-size:15px;color:#f97316;text-transform:uppercase;letter-spacing:.05em}
  .toc ol{padding-left:24px}
  h2{font-size:15px;color:#f97316;text-transform:uppercase;letter-spacing:.05em;margin-top:28px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  p{margin:6px 0}
  ol{padding-left:22px;margin:8px 0}
  ol li{margin-bottom:6px}
  ul{padding-left:18px;margin:4px 0}
  h3{font-size:13px;color:#1e293b;margin:14px 0 6px 0}
  .sub{margin:10px 0 10px 8px}
  table.sow-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
  table.sow-table th{background:#f1f5f9;text-align:left;padding:8px 10px;border:1px solid #e2e8f0;font-weight:600}
  table.sow-table td{padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top}
  .footer{margin-top:32px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:8px}
  @media print { body{margin:8mm} h2{break-after:avoid} section{break-inside:avoid} .cover{page-break-after:always} .toc{page-break-after:always} }
</style></head><body>
<div class="cover">
  <h1>STATEMENT OF WORK</h1>
  <div class="preparedFor">Prepared for:</div>
  <div class="client">${esc(clientName)}</div>
  <div style="margin-top:24px;color:#64748b">Prepared by: Simpliigence Inc.</div>
  <div style="color:#64748b">Effective Date: ${esc(effectiveDate)} · Confidential</div>
</div>
<div class="toc">
  <h2>Table of Contents</h2>
  <ol>${sections.map((s) => `<li>${esc(s.heading)}</li>`).join('')}<li>ACCEPTED BY</li></ol>
</div>
${sectionBlocks}
<section><h2>ACCEPTED BY:</h2>
  <table style="width:100%;border-collapse:collapse;margin:10px 0">
    <tr><th style="background:#f1f5f9;padding:8px;border:1px solid #e2e8f0;text-align:left">Client</th><th style="background:#f1f5f9;padding:8px;border:1px solid #e2e8f0;text-align:left">Simpliigence Inc.</th></tr>
    <tr><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Signature</td><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Signature</td></tr>
    <tr><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Printed Name</td><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Printed Name</td></tr>
    <tr><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Title</td><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Title</td></tr>
    <tr><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Date Signed</td><td style="padding:18px 8px 8px;border:1px solid #e2e8f0;height:46px">Date Signed</td></tr>
  </table>
  <p style="margin-top:18px;font-size:12px"><b>Please return ALL PAGES of this Statement of Work via one of the following:</b><br/>
  By e-mail to: raghu.seetharam@simpliigence.com<br/>
  By mail to: Simpliigence Inc., 8 The Green, Ste A, Dover, DE-19901</p>
</section>
<div class="footer">Simpliigence Inc. · 8 The Green, Ste A, Dover, DE-19901</div>
</body></html>`;
}

/** Helper to get headcount from resources array */
function getHeadcount(resources: PipelineResource[], role: string): number {
  return resources.find((r) => r.roleCategory === role)?.count ?? 0;
}

/** Build resources array from headcount values */
function buildResources(ba: number, jd: number, sd: number, hrsPerMonth = 160): PipelineResource[] {
  const res: PipelineResource[] = [];
  if (ba > 0) res.push({ roleCategory: 'BA', count: ba, hoursPerMonth: hrsPerMonth });
  if (jd > 0) res.push({ roleCategory: 'JuniorDev', count: jd, hoursPerMonth: hrsPerMonth });
  if (sd > 0) res.push({ roleCategory: 'SeniorDev', count: sd, hoursPerMonth: hrsPerMonth });
  return res;
}

/** Total people from resources */
function totalPeople(resources: PipelineResource[]): number {
  return resources.reduce((sum, r) => sum + r.count, 0);
}

/* ── Status badge helper ─────────────────────── */
function statusVariant(status: string) {
  const s = status.toLowerCase();
  if (s === 'proposed') return 'default' as const;
  if (s === 'negotiation') return 'warning' as const;
  if (s === 'confirmed') return 'success' as const;
  if (s === 'on hold') return 'neutral' as const;
  return 'info' as const;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

const PIPELINE_STATUSES = ['Proposed', 'Negotiation', 'Confirmed', 'On Hold'];

/* ── Inline editable field ────────────────────── */
function InlineEdit({ value, onSave, type = 'text', prefix = '', placeholder = 'Click to set', className = '' }: {
  value: string | number | null | undefined;
  onSave: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  prefix?: string;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  const commit = () => { onSave(draft.trim()); setEditing(false); };
  if (editing) {
    return (
      <input
        ref={ref}
        type={type}
        className={`rounded border border-primary/40 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }
  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(String(value ?? '')); }} className="cursor-pointer hover:text-primary">
      {value ? `${prefix}${value}` : <span className="text-slate-400 italic">{placeholder}</span>}
    </span>
  );
}

/* ── New Pipeline Project Form ──────────────── */
function NewProjectForm({ onAdd, onCancel }: { onAdd: (p: ZohoPipelineProject) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('Proposed');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [revenue, setRevenue] = useState('');
  const [revCurrency, setRevCurrency] = useState<'USD' | 'CAD'>('USD');
  const [baCount, setBaCount] = useState(0);
  const [jdCount, setJdCount] = useState(0);
  const [sdCount, setSdCount] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const project: ZohoPipelineProject = {
      id: `manual-${Date.now()}`,
      name: name.trim(),
      status,
      owner: owner.trim() || 'Unassigned',
      startDate: startDate || null,
      endDate: endDate || null,
      source: 'manual',
      revenue: parseFloat(revenue) > 0 ? parseFloat(revenue) : null,
      revenueCurrency: revCurrency,
      resources: buildResources(baCount, jdCount, sdCount),
    };
    onAdd(project);
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-800 text-base">New Pipeline Project</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className="text-xs text-slate-500 block mb-1">Project Name *</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Acme Corp Phase 2"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Owner</label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Project owner"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Expected Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Expected End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Est. Revenue</label>
            <div className="flex gap-1">
              <select
                value={revCurrency}
                onChange={(e) => setRevCurrency(e.target.value as 'USD' | 'CAD')}
                className="rounded border border-slate-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
              </select>
              <input
                type="number"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="0"
                min="0"
              />
            </div>
          </div>
        </div>

        {/* Resource needs */}
        <div>
          <label className="text-xs text-slate-500 block mb-2 flex items-center gap-1">
            <UserPlus size={12} /> Resource Needs (headcount) — feeds into Hiring Forecast
          </label>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Business Analysts</label>
              <input type="number" min={0} value={baCount} onChange={(e) => setBaCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Junior Developers</label>
              <input type="number" min={0} value={jdCount} onChange={(e) => setJdCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Senior Developers</label>
              <input type="number" min={0} value={sdCount} onChange={(e) => setSdCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Check size={16} />
            Add to Pipeline
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

/* ── Pipeline project card ─────────────────── */
function PipelineProjectCard({
  project,
  onUpdate,
  onRemove,
  onMoveToCurrent,
}: {
  project: ZohoPipelineProject;
  onUpdate: (id: string, updates: Partial<ZohoPipelineProject>) => void;
  onRemove: (id: string) => void;
  onMoveToCurrent: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [sowOpen, setSowOpen] = useState(false);
  const [editSowId, setEditSowId] = useState<string | null>(null);
  const [sowReloadKey, setSowReloadKey] = useState(0);
  const revenue = project.revenue ?? 0;
  const curr = project.revenueCurrency ?? 'USD';
  const currSymbol = curr === 'CAD' ? 'CA$' : '$';

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-800 text-base">{project.name}</h3>
            <Badge variant={statusVariant(project.status)}>{project.status}</Badge>
            <Badge variant="default">Pipeline</Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-slate-500 flex-wrap">
            <span className="flex items-center gap-1"><Users size={12} /> {project.owner}</span>
            {(project.startDate || project.endDate) && (
              <span className="flex items-center gap-1">
                <Calendar size={12} /> {formatDate(project.startDate)} – {formatDate(project.endDate)}
              </span>
            )}
            {revenue > 0 && (
              <span className="flex items-center gap-1 text-emerald-700">
                <DollarSign size={12} /> Est. Revenue: <Sensitive>{`${currSymbol}${revenue.toLocaleString()} ${curr}`}</Sensitive>
              </span>
            )}
            {totalPeople(project.resources) > 0 && (
              <span className="flex items-center gap-1 text-violet-700">
                <UserPlus size={12} />
                {project.resources.map((r) => `${r.count} ${ROLE_LABELS[r.roleCategory] ?? r.roleCategory}`).join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setSowOpen(true); }}
            title="Generate Statement of Work"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <FileText size={14} />
            Generate SOW
          </button>
          {!confirmMove ? (
            <button
              onClick={() => setConfirmMove(true)}
              title="Move to Current Projects"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <ArrowRightCircle size={14} />
              Move to Current
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">Sure?</span>
              <button
                onClick={() => { onMoveToCurrent(project.id); setConfirmMove(false); }}
                className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmMove(false)}
                className="px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
              >
                No
              </button>
            </div>
          )}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete project"
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded hover:bg-red-50"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600">Delete?</span>
              <button
                onClick={() => { onRemove(project.id); setConfirmDelete(false); }}
                className="px-2 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Project Name</label>
              <InlineEdit
                value={project.name}
                onSave={(v) => v && onUpdate(project.id, { name: v })}
                placeholder="Project name"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Owner</label>
              <InlineEdit
                value={project.owner}
                onSave={(v) => onUpdate(project.id, { owner: v || 'Unassigned' })}
                placeholder="Owner"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Status</label>
              <select
                value={project.status}
                onChange={(e) => onUpdate(project.id, { status: e.target.value })}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Est. Revenue</label>
              <div className="flex items-center gap-1">
                <select
                  value={curr}
                  onChange={(e) => onUpdate(project.id, { revenueCurrency: e.target.value as 'USD' | 'CAD' })}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
                <Sensitive placeholder={<span className="text-sm text-slate-400 italic">•••</span>}>
                  <InlineEdit
                    value={project.revenue ?? ''}
                    type="number"
                    prefix={currSymbol}
                    placeholder="Set revenue"
                    onSave={(v) => onUpdate(project.id, { revenue: parseFloat(v) > 0 ? parseFloat(v) : null })}
                    className="w-32"
                  />
                </Sensitive>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected Start</label>
              <InlineEdit
                value={project.startDate ?? ''}
                type="date"
                placeholder="Set date"
                onSave={(v) => onUpdate(project.id, { startDate: v || null })}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected End</label>
              <InlineEdit
                value={project.endDate ?? ''}
                type="date"
                placeholder="Set date"
                onSave={(v) => onUpdate(project.id, { endDate: v || null })}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Go-Live Date</label>
              <InlineEdit
                value={project.goLiveDate ?? ''}
                type="date"
                placeholder="Set go-live"
                onSave={(v) => onUpdate(project.id, { goLiveDate: v || null })}
                className="w-36"
              />
            </div>
          </div>

          {/* Resource needs */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="text-xs text-slate-500 block mb-2 flex items-center gap-1">
              <UserPlus size={12} /> Resource Needs (feeds into Hiring Forecast)
            </label>
            <div className="flex gap-4 items-end">
              {(['BA', 'JuniorDev', 'SeniorDev'] as const).map((role) => (
                <div key={role}>
                  <label className="text-[10px] text-slate-400 block mb-1">{ROLE_LABELS[role]}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={getHeadcount(project.resources, role)}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value) || 0);
                      const updated = buildResources(
                        role === 'BA' ? val : getHeadcount(project.resources, 'BA'),
                        role === 'JuniorDev' ? val : getHeadcount(project.resources, 'JuniorDev'),
                        role === 'SeniorDev' ? val : getHeadcount(project.resources, 'SeniorDev'),
                      );
                      onUpdate(project.id, { resources: updated });
                    }}
                  />
                </div>
              ))}
              {totalPeople(project.resources) > 0 && (
                <span className="text-[10px] text-slate-400 pb-1">
                  = {totalPeople(project.resources)} people × 160 hrs/mo
                </span>
              )}
            </div>
          </div>

          <SowHistory
            projectId={project.id}
            refreshKey={`${sowOpen ? 'open' : 'closed'}-${sowReloadKey}`}
            onEdit={(id) => { setEditSowId(id); setSowOpen(true); }}
          />
        </div>
      )}
      {sowOpen && (
        <SowWizard
          project={project}
          initialSowId={editSowId ?? undefined}
          onClose={() => {
            setSowOpen(false);
            setEditSowId(null);
            // Bump the reload key so SowHistory re-fetches and reflects any
            // saves that happened inside the wizard.
            setSowReloadKey((k) => k + 1);
          }}
        />
      )}
    </Card>
  );
}

// ── SOW Wizard ──────────────────────────────────────────
const SOW_STATUSES = ['draft', 'sent', 'signed', 'archived'] as const;
const SOW_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-300',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  signed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Lists every saved SOW for a project, newest first. Each row exposes
 *  download, status (click to flip), edit-as-new-version, and delete.
 *  refreshKey forces a re-fetch when a save likely happened. */
function SowHistory({ projectId, refreshKey, onEdit }: {
  projectId: string;
  refreshKey: string;
  onEdit: (sowId: string) => void;
}) {
  type Row = {
    id: string; version: number; sowType: string; clientName: string;
    effectiveDate: string | null; createdAt: string; createdBy: string | null;
    docxPath: string | null; status: string;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    db.listSowsForProject(projectId).then((r) => { setRows(r); setLoading(false); });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.listSowsForProject(projectId).then((r) => {
      if (cancelled) return;
      setRows(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, refreshKey]);

  const downloadSaved = async (path: string | null) => {
    if (!path) return;
    const url = await db.signedSowDocxUrl(path);
    if (!url) return;
    window.open(url, '_blank');
  };

  const cycleStatus = async (row: Row) => {
    const idx = SOW_STATUSES.indexOf(row.status as (typeof SOW_STATUSES)[number]);
    const next = SOW_STATUSES[(idx + 1) % SOW_STATUSES.length];
    setBusyId(row.id);
    const res = await db.setSowStatus(row.id, next);
    setBusyId(null);
    if (res.ok) setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
  };

  const remove = async (row: Row) => {
    setBusyId(row.id);
    const res = await db.deleteSow(row.id, row.docxPath);
    setBusyId(null);
    if (res.ok) {
      setConfirmDelete(null);
      reload();
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-400">Loading SOW history…</div>
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
        <FileText size={12} /> SOW versions ({rows.length})
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const isConfirming = confirmDelete === r.id;
          const isBusy = busyId === r.id;
          const statusClass = SOW_STATUS_STYLES[r.status] ?? SOW_STATUS_STYLES.draft;
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 px-2 hover:bg-slate-50 rounded text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-semibold text-slate-700 shrink-0">v{r.version}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 shrink-0">{r.sowType}</span>
                <button
                  type="button"
                  onClick={() => cycleStatus(r)}
                  disabled={isBusy}
                  title="Click to advance status (draft → sent → signed → archived)"
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 uppercase tracking-wide hover:opacity-80 disabled:opacity-50 ${statusClass}`}
                >
                  {r.status}
                </button>
                <span className="text-slate-600 truncate">{r.clientName}</span>
                <span className="text-slate-400 shrink-0">· {new Date(r.createdAt).toLocaleDateString()}</span>
                {r.createdBy && <span className="text-slate-400 truncate hidden md:inline">by {r.createdBy}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadSaved(r.docxPath)}
                  disabled={!r.docxPath || isBusy}
                  className="px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                  title={r.docxPath ? 'Download .docx' : 'No .docx attached (legacy save)'}
                >
                  <Download size={11} /> .docx
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(r.id)}
                  disabled={isBusy}
                  className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
                  title="Open in wizard to tweak and save as next version"
                >
                  Edit
                </button>
                {!isConfirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r.id)}
                    disabled={isBusy}
                    title="Delete this SOW version"
                    className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-40 rounded hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-red-600">Delete?</span>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={isBusy}
                      className="px-1.5 py-0.5 text-[10px] text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="px-1.5 py-0.5 text-[10px] text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Multi-step modal for generating a Statement of Work for a pipeline
 *  project. Two flavours:
 *    1. Concierge — Time & Materials support engagement.
 *    2. Implementation — fixed-fee build/delivery with payment milestones.
 *  User fills rough inputs; gpt-4.1-nano (via the generate-sow edge fn)
 *  polishes them into Simpliigence-style legal language and returns a
 *  ready-to-print HTML doc + structured sections. */
function SowWizard({ project, onClose, initialSowId }: { project: ZohoPipelineProject; onClose: () => void; initialSowId?: string }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [sowType, setSowType] = useState<'concierge' | 'implementation' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Client info (step 2)
  const [clientName, setClientName] = useState(project.name || '');
  const [clientAddress, setClientAddress] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);

  // Concierge inputs (step 3) — prefilled from the canonical Simpliigence
  // concierge template ("Concierge Support for Knit.docx"). User edits in
  // place; Generate builds the SOW deterministically from these values, no
  // AI involved. The template is so standardized that AI generation just
  // introduces drift — see the Knit / Marnoa / Doodyman SOWs for the
  // verbatim language.
  const [conIntro, setConIntro] = useState(CONCIERGE_TEMPLATE.intro);
  const [conActivities, setConActivities] = useState(CONCIERGE_TEMPLATE.activities.join('\n'));
  const [conAssumptions, setConAssumptions] = useState(CONCIERGE_TEMPLATE.assumptions.join('\n'));
  const [conContractType, setConContractType] = useState(CONCIERGE_TEMPLATE.pricing.contractType);
  const [conHourlyRate, setConHourlyRate] = useState(CONCIERGE_TEMPLATE.pricing.rate);
  const [conPaymentTerms, setConPaymentTerms] = useState(CONCIERGE_TEMPLATE.pricing.paymentTerms);
  const [conInvoiceDate, setConInvoiceDate] = useState(CONCIERGE_TEMPLATE.pricing.invoiceDate);
  const [conTerminationNotice, setConTerminationNotice] = useState(CONCIERGE_TEMPLATE.pricing.termination);
  const [conMinHours, setConMinHours] = useState(CONCIERGE_TEMPLATE.pricing.minimumHours);
  const [conTravelPolicy, setConTravelPolicy] = useState(CONCIERGE_TEMPLATE.pricing.travel);
  const [conPurchaseOrder, setConPurchaseOrder] = useState(CONCIERGE_TEMPLATE.pricing.purchaseOrder);
  const [conSpecial, setConSpecial] = useState('');

  // Implementation inputs (step 3)
  // Implementation inputs (step 3) — prefilled from the canonical
  // Simpliigence implementation template (Qu Data Centres 2026). User
  // edits in place. Generate is deterministic — no AI.
  const [impIntroNarrative, setImpIntroNarrative] = useState('');
  const [impScopeIntro, setImpScopeIntro] = useState(IMPLEMENTATION_TEMPLATE.scopeIntro);
  const [impScopeCapabilities, setImpScopeCapabilities] = useState(IMPLEMENTATION_TEMPLATE.scopeCapabilities.join('\n'));
  const [impGoverningArtifacts, setImpGoverningArtifacts] = useState('');
  const [impDiscoveryIntro, setImpDiscoveryIntro] = useState(IMPLEMENTATION_TEMPLATE.discoveryIntro);
  const [impDiscoveryExit, setImpDiscoveryExit] = useState(IMPLEMENTATION_TEMPLATE.discoveryExit);
  const [impDiscoveryAreas, setImpDiscoveryAreas] = useState(IMPLEMENTATION_TEMPLATE.discoveryAreas.join('\n'));
  const [impBuildIntro, setImpBuildIntro] = useState(IMPLEMENTATION_TEMPLATE.buildIntro);
  const [impBuildCategories, setImpBuildCategories] = useState<Array<{ heading: string; bullets: string }>>(
    IMPLEMENTATION_TEMPLATE.buildCategories.map((c) => ({ heading: c.heading, bullets: c.bullets.join('\n') })),
  );
  const [impAssumptions, setImpAssumptions] = useState(IMPLEMENTATION_TEMPLATE.assumptions.join('\n'));
  const [impTotalDuration, setImpTotalDuration] = useState('17 weeks');
  const [impTimelineBullets, setImpTimelineBullets] = useState(IMPLEMENTATION_TEMPLATE.timelineBullets.join('\n'));
  const [impContractType, setImpContractType] = useState(IMPLEMENTATION_TEMPLATE.pricing.contractType);
  const [impTotalFees, setImpTotalFees] = useState('');
  const [impMilestones, setImpMilestones] = useState<Array<{ milestone: string; percentage: string; amount: string }>>(
    IMPLEMENTATION_TEMPLATE.pricing.defaultMilestones.map((m) => ({ ...m })),
  );
  const [impPaymentTerms, setImpPaymentTerms] = useState(IMPLEMENTATION_TEMPLATE.pricing.paymentTerms);
  const [impTermination, setImpTermination] = useState(IMPLEMENTATION_TEMPLATE.pricing.termination);
  const [impMinHours, setImpMinHours] = useState(IMPLEMENTATION_TEMPLATE.pricing.minimumHours);
  const [impTravel, setImpTravel] = useState(IMPLEMENTATION_TEMPLATE.pricing.travel);
  const [impPurchaseOrder, setImpPurchaseOrder] = useState(IMPLEMENTATION_TEMPLATE.pricing.purchaseOrder);

  // Result (step 4)
  const [html, setHtml] = useState<string>('');
  const [sections, setSections] = useState<SowSectionInput[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // When the wizard is opened with an initialSowId (clone-and-edit from
  // SowHistory), load that row and prefill every field so the user can
  // tweak and re-generate as the next version.
  useEffect(() => {
    if (!initialSowId) return;
    let cancelled = false;
    (async () => {
      const sow = await db.loadSow(initialSowId);
      if (cancelled || !sow) return;
      setSowType(sow.sowType);
      setClientName(sow.clientName);
      setClientAddress(sow.clientAddress);
      setSignerName(sow.signerName);
      setSignerTitle(sow.signerTitle);
      setSignerEmail(sow.signerEmail);
      setEffectiveDate(sow.effectiveDate || today);
      const i = sow.inputs as Record<string, string | undefined>;
      if (sow.sowType === 'concierge') {
        setConIntro(i.intro ?? conIntro);
        setConActivities(i.activities ?? conActivities);
        setConAssumptions(i.assumptions ?? conAssumptions);
        setConContractType(i.contractType ?? conContractType);
        setConHourlyRate(i.hourlyRate ?? conHourlyRate);
        setConPaymentTerms(i.paymentTerms ?? conPaymentTerms);
        setConInvoiceDate(i.invoiceDate ?? conInvoiceDate);
        setConTerminationNotice(i.terminationNotice ?? conTerminationNotice);
        setConMinHours(i.minimumHours ?? conMinHours);
        setConTravelPolicy(i.travelPolicy ?? conTravelPolicy);
        setConPurchaseOrder(i.purchaseOrder ?? conPurchaseOrder);
        setConSpecial(i.specialConditions ?? '');
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ii = sow.inputs as any;
        setImpIntroNarrative(ii.introNarrative ?? '');
        setImpScopeIntro(ii.scopeIntro ?? impScopeIntro);
        setImpScopeCapabilities(ii.scopeCapabilities ?? impScopeCapabilities);
        setImpGoverningArtifacts(ii.governingArtifacts ?? '');
        setImpDiscoveryIntro(ii.discoveryIntro ?? impDiscoveryIntro);
        setImpDiscoveryExit(ii.discoveryExit ?? impDiscoveryExit);
        setImpDiscoveryAreas(ii.discoveryAreas ?? impDiscoveryAreas);
        setImpBuildIntro(ii.buildIntro ?? impBuildIntro);
        if (Array.isArray(ii.buildCategories)) setImpBuildCategories(ii.buildCategories);
        setImpAssumptions(ii.assumptions ?? impAssumptions);
        setImpTotalDuration(ii.totalDuration ?? impTotalDuration);
        setImpTimelineBullets(ii.timelineBullets ?? impTimelineBullets);
        setImpContractType(ii.contractType ?? impContractType);
        setImpTotalFees(ii.totalFees ?? '');
        if (Array.isArray(ii.pricingMilestones)) setImpMilestones(ii.pricingMilestones);
        setImpPaymentTerms(ii.paymentTerms ?? impPaymentTerms);
        setImpTermination(ii.termination ?? impTermination);
        setImpMinHours(ii.minimumHours ?? impMinHours);
        setImpTravel(ii.travel ?? impTravel);
        setImpPurchaseOrder(ii.purchaseOrder ?? impPurchaseOrder);
      }
      // Jump the user straight to the scope step — they're editing a known
      // template, not starting from scratch.
      setStep(3);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSowId]);

  const inputsForGenerate = sowType === 'concierge' ? {
    intro: conIntro, activities: conActivities, assumptions: conAssumptions,
    contractType: conContractType, hourlyRate: conHourlyRate,
    paymentTerms: conPaymentTerms, invoiceDate: conInvoiceDate,
    terminationNotice: conTerminationNotice, minimumHours: conMinHours,
    travelPolicy: conTravelPolicy, purchaseOrder: conPurchaseOrder,
    specialConditions: conSpecial,
  } : {
    introNarrative: impIntroNarrative,
    scopeIntro: impScopeIntro,
    scopeCapabilities: impScopeCapabilities,
    governingArtifacts: impGoverningArtifacts,
    discoveryIntro: impDiscoveryIntro,
    discoveryExit: impDiscoveryExit,
    discoveryAreas: impDiscoveryAreas,
    buildIntro: impBuildIntro,
    buildCategories: impBuildCategories,
    assumptions: impAssumptions,
    totalDuration: impTotalDuration,
    timelineBullets: impTimelineBullets,
    contractType: impContractType,
    totalFees: impTotalFees,
    pricingMilestones: impMilestones,
    paymentTerms: impPaymentTerms,
    termination: impTermination,
    minimumHours: impMinHours,
    travel: impTravel,
    purchaseOrder: impPurchaseOrder,
  };

  const generate = async () => {
    if (!sowType) return;
    setBusy(true); setError(null); setWarnings([]);

    // CONCIERGE: standardised template, no AI involvement. Build the
    // sections deterministically from the (possibly user-edited) template
    // values. The AI was inventing its own format and drifting from
    // Legal's accepted language; with a standardised template the only
    // value AI adds is noise.
    if (sowType === 'concierge') {
      const builtSections = buildConciergeSections({
        clientName, clientAddress, effectiveDate,
        intro: conIntro,
        activities: conActivities,
        assumptions: conAssumptions,
        contractType: conContractType,
        rate: conHourlyRate,
        paymentTerms: conPaymentTerms,
        invoiceDate: conInvoiceDate,
        termination: conTerminationNotice,
        minimumHours: conMinHours,
        travel: conTravelPolicy,
        purchaseOrder: conPurchaseOrder,
        special: conSpecial,
      });
      setSections(builtSections);
      setHtml(buildSowHtml(clientName, effectiveDate, builtSections));
      setWarnings([]);
      setBusy(false);
      setStep(4);
      return;
    }

    // IMPLEMENTATION: also deterministic. The Qu Data template is so
    // structured (10 sections, fixed tables, verbatim assumptions/Go-Live
    // definitions, milestone-based pricing) that AI just introduces drift.
    // User edits the inputs in place; we render the doc 1:1 against the
    // executed template.
    try {
      const builtSections = buildImplementationSections({
        clientName, clientAddress, effectiveDate,
        introNarrative: impIntroNarrative,
        scopeIntro: impScopeIntro,
        scopeCapabilities: impScopeCapabilities,
        governingArtifacts: impGoverningArtifacts,
        discoveryIntro: impDiscoveryIntro,
        discoveryExit: impDiscoveryExit,
        discoveryAreas: impDiscoveryAreas,
        buildIntro: impBuildIntro,
        buildCategories: impBuildCategories,
        assumptions: impAssumptions,
        totalDuration: impTotalDuration,
        timelineBullets: impTimelineBullets,
        contractType: impContractType,
        totalFee: impTotalFees,
        pricingMilestones: impMilestones,
        paymentTerms: impPaymentTerms,
        termination: impTermination,
        minimumHours: impMinHours,
        travel: impTravel,
        purchaseOrder: impPurchaseOrder,
      });
      setSections(builtSections);
      setHtml(buildSowHtml(clientName, effectiveDate, builtSections));
      setWarnings([]);
      setBusy(false);
      setStep(4);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message || 'Build failed');
    }
  };

  const buildDocxBlob = async () => {
    return buildSowDocxBlob(
      { clientName, effectiveDate, signerName, signerTitle },
      sections,
    );
  };

  /** Save the SOW: upload the generated .docx to sow-documents, then write
   *  the row into pipeline_sows. Each save is a NEW version (version history). */
  const save = async () => {
    if (!sowType) return;
    setBusy(true); setError(null);
    try {
      const version = await db.nextSowVersion(project.id);
      const blob = await buildDocxBlob();
      const docxPath = await db.uploadSowDocx(project.id, clientName, blob);
      const id = `sow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await db.saveSow({
        id,
        pipelineProjectId: project.id, projectName: project.name,
        sowType, clientName, clientAddress, signerName, signerTitle, signerEmail, effectiveDate,
        inputs: inputsForGenerate as unknown as Record<string, unknown>,
        sections, html, docxPath, version,
        createdBy: (currentUser?.email || '').toLowerCase(),
      });
      if (!res.ok) { setError(res.error || 'Save failed'); return; }
      setSavedId(id);
    } catch (e) {
      setError((e as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadHtml = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOW-${clientName.replace(/[^a-zA-Z0-9]+/g, '_')}-${effectiveDate}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadDocx = async () => {
    setBusy(true);
    try {
      const blob = await buildDocxBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SOW-${clientName.replace(/[^a-zA-Z0-9]+/g, '_')}-${effectiveDate}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message || 'DOCX build failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4 md:p-8"
         onClick={(e) => {
           // Only close on a *true* backdrop click — not on every event that
           // bubbles up. This prevents the modal from closing when an inner
           // textarea/input dispatches an outside click, and prevents
           // accidental dismissal after a generation error (the user used
           // to lose all their inputs that way).
           if (e.target === e.currentTarget) onClose();
         }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-xl">
          <div>
            <div className="text-sm font-bold text-slate-900">Generate Statement of Work</div>
            <div className="text-[11px] text-slate-500">{project.name} · Step {step} of 4</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xs font-semibold">✕ Close</button>
        </div>

        <div className="p-5 space-y-4">

          {step === 1 && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">What kind of project is this?</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button type="button" onClick={() => { setSowType('concierge'); setStep(2); }}
                        className="text-left p-4 border-2 border-slate-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  <div className="font-bold text-sm text-slate-900 mb-1">🛠 Concierge / Support</div>
                  <div className="text-xs text-slate-600">Time & Materials engagement for ongoing enhancements, business-ops support, ad-hoc work. Billed hourly.</div>
                </button>
                <button type="button" onClick={() => { setSowType('implementation'); setStep(2); }}
                        className="text-left p-4 border-2 border-slate-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  <div className="font-bold text-sm text-slate-900 mb-1">🚀 Implementation</div>
                  <div className="text-xs text-slate-600">Fixed-scope build / delivery with business goals, in/out-of-scope, assumptions, payment milestones.</div>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Client details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Client legal name *">
                  <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={fInput} />
                </Field>
                <Field label="Effective date *">
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={fInput} />
                </Field>
              </div>
              <Field label="Client address">
                <input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="20 Erb St. West Suite 1001 Waterloo, ON N2L 1T2" className={fInput} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Signer name">
                  <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className={fInput} />
                </Field>
                <Field label="Signer title">
                  <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} className={fInput} />
                </Field>
                <Field label="Signer email">
                  <input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} className={fInput} />
                </Field>
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={() => setStep(3)} disabled={!clientName || !effectiveDate} className="px-4 py-1.5 bg-primary text-white rounded-md text-xs font-semibold disabled:opacity-50">Next →</button>
              </div>
            </div>
          )}

          {step === 3 && sowType === 'concierge' && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Concierge SOW — standard template</div>
              <div className="text-[11px] text-slate-500 -mt-1">
                Every section below is pre-filled from Simpliigence's standard concierge SOW (the Knit / Marnoa template). Edit any field that differs for this engagement; everything else stays verbatim. The generated document is a 1:1 mirror of the source template — no AI rewriting.
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Scope of Services</div>
              <Field label="Scope intro paragraph">
                <textarea value={conIntro} onChange={(e) => setConIntro(e.target.value)} rows={3} className={fInput} />
              </Field>
              <Field label="Activities (one per line — become numbered bullets)">
                <textarea value={conActivities} onChange={(e) => setConActivities(e.target.value)} rows={5} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Assumptions</div>
              <Field label="Assumptions (one per line — become numbered bullets; pre-filled with Legal's standard 5 clauses)">
                <textarea value={conAssumptions} onChange={(e) => setConAssumptions(e.target.value)} rows={8} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Pricing Terms & Fee Schedule</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Contract type"><input value={conContractType} onChange={(e) => setConContractType(e.target.value)} className={fInput} /></Field>
                <Field label="Rate"><input value={conHourlyRate} onChange={(e) => setConHourlyRate(e.target.value)} className={fInput} /></Field>
                <Field label="Payment terms"><input value={conPaymentTerms} onChange={(e) => setConPaymentTerms(e.target.value)} className={fInput} /></Field>
                <Field label="Invoice date"><input value={conInvoiceDate} onChange={(e) => setConInvoiceDate(e.target.value)} className={fInput} /></Field>
                <Field label="Contract termination"><input value={conTerminationNotice} onChange={(e) => setConTerminationNotice(e.target.value)} className={fInput} /></Field>
                <Field label="Minimum hours / month"><input value={conMinHours} onChange={(e) => setConMinHours(e.target.value)} className={fInput} /></Field>
              </div>
              <Field label="Travel & Expenses">
                <textarea value={conTravelPolicy} onChange={(e) => setConTravelPolicy(e.target.value)} rows={2} className={fInput} />
              </Field>
              <Field label="Purchase Order">
                <textarea value={conPurchaseOrder} onChange={(e) => setConPurchaseOrder(e.target.value)} rows={2} className={fInput} />
              </Field>
              <Field label="Special conditions (optional — adds an extra section if non-empty)">
                <textarea value={conSpecial} onChange={(e) => setConSpecial(e.target.value)} rows={2} className={fInput} />
              </Field>
              {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={generate} disabled={!conActivities || busy} className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  <FileText size={12} />
                  {busy ? 'Building…' : 'Build SOW'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && sowType === 'implementation' && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Implementation SOW — standard template</div>
              <div className="text-[11px] text-slate-500 -mt-1">
                Every section below is pre-filled from Simpliigence's standard implementation SOW (the Qu Data Centres template). Edit any field that differs for this engagement; everything else stays verbatim. The generated document mirrors the source template 1:1 — no AI rewriting.
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Statement of Work — narrative</div>
              <Field label="Project context narrative (3-5 paragraphs, separated by blank lines — appears after the opening clause)">
                <textarea value={impIntroNarrative} onChange={(e) => setImpIntroNarrative(e.target.value)} rows={8}
                          placeholder={'Client has engaged Simpliigence to…\n\nThe solution will deliver…\n\nThis implementation emphasizes…'}
                          className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Scope of Services (Implementation)</div>
              <Field label="Scope intro paragraph">
                <textarea value={impScopeIntro} onChange={(e) => setImpScopeIntro(e.target.value)} rows={2} className={fInput} />
              </Field>
              <Field label="Core capabilities (one per line)">
                <textarea value={impScopeCapabilities} onChange={(e) => setImpScopeCapabilities(e.target.value)} rows={8} className={`${fInput} font-mono text-[11px]`} />
              </Field>
              <Field label="Governing artifacts (optional — one per line, e.g. RFI Response — 9 Jan 2026)">
                <textarea value={impGoverningArtifacts} onChange={(e) => setImpGoverningArtifacts(e.target.value)} rows={3} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Discovery and Design</div>
              <Field label="Discovery intro">
                <textarea value={impDiscoveryIntro} onChange={(e) => setImpDiscoveryIntro(e.target.value)} rows={3} className={fInput} />
              </Field>
              <Field label="Exit criteria">
                <textarea value={impDiscoveryExit} onChange={(e) => setImpDiscoveryExit(e.target.value)} rows={2} className={fInput} />
              </Field>
              <Field label="Discovery capability areas (one per line)">
                <textarea value={impDiscoveryAreas} onChange={(e) => setImpDiscoveryAreas(e.target.value)} rows={9} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Configuration and Build</div>
              <Field label="Build intro">
                <textarea value={impBuildIntro} onChange={(e) => setImpBuildIntro(e.target.value)} rows={3} className={fInput} />
              </Field>
              <div className="space-y-2">
                {impBuildCategories.map((cat, idx) => (
                  <div key={idx} className="border border-slate-200 rounded p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={cat.heading}
                        onChange={(e) => {
                          const next = [...impBuildCategories];
                          next[idx] = { ...next[idx], heading: e.target.value };
                          setImpBuildCategories(next);
                        }}
                        placeholder="Category heading (e.g. Account & Contact Model)"
                        className={`${fInput} font-semibold`}
                      />
                      <button
                        type="button"
                        onClick={() => setImpBuildCategories(impBuildCategories.filter((_, i) => i !== idx))}
                        className="p-1 text-slate-400 hover:text-red-500 rounded"
                        title="Remove this category"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <textarea
                      value={cat.bullets}
                      onChange={(e) => {
                        const next = [...impBuildCategories];
                        next[idx] = { ...next[idx], bullets: e.target.value };
                        setImpBuildCategories(next);
                      }}
                      rows={4}
                      placeholder="One bullet per line"
                      className={`${fInput} font-mono text-[11px]`}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setImpBuildCategories([...impBuildCategories, { heading: '', bullets: '' }])}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                >
                  <Plus size={12} /> Add build category
                </button>
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">
                Summary of Deliverables / Testing / Training tables
              </div>
              <div className="text-[11px] text-slate-500">
                These three tables (Deliverables by phase, Testing types, Training tiers) are emitted verbatim from the standard template. Edit them by opening the generated .docx if needed for a specific engagement.
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Assumptions (Implementation)</div>
              <Field label="Assumptions (one per line — pre-filled with Legal's standard 7 clauses)">
                <textarea value={impAssumptions} onChange={(e) => setImpAssumptions(e.target.value)} rows={9} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Timeline</div>
              <Field label="Overall duration (e.g. 17 weeks)">
                <input value={impTotalDuration} onChange={(e) => setImpTotalDuration(e.target.value)} className={fInput} />
              </Field>
              <Field label="Project timeline bullets (one per line)">
                <textarea value={impTimelineBullets} onChange={(e) => setImpTimelineBullets(e.target.value)} rows={6} className={`${fInput} font-mono text-[11px]`} />
              </Field>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Pricing Terms & Fee Schedule</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Contract type"><input value={impContractType} onChange={(e) => setImpContractType(e.target.value)} className={fInput} /></Field>
                <Field label="Total fee (e.g. CAD $44,000.00)"><input value={impTotalFees} onChange={(e) => setImpTotalFees(e.target.value)} placeholder="CAD $44,000.00" className={fInput} /></Field>
                <Field label="Payment terms"><input value={impPaymentTerms} onChange={(e) => setImpPaymentTerms(e.target.value)} className={fInput} /></Field>
                <Field label="Termination"><input value={impTermination} onChange={(e) => setImpTermination(e.target.value)} className={fInput} /></Field>
                <Field label="Minimum hours / month"><input value={impMinHours} onChange={(e) => setImpMinHours(e.target.value)} className={fInput} /></Field>
              </div>
              <Field label="Travel & Expenses"><textarea value={impTravel} onChange={(e) => setImpTravel(e.target.value)} rows={2} className={fInput} /></Field>
              <Field label="Purchase Order"><textarea value={impPurchaseOrder} onChange={(e) => setImpPurchaseOrder(e.target.value)} rows={2} className={fInput} /></Field>

              <div className="text-[11px] font-semibold text-slate-600 pt-2">Payment milestones</div>
              <div className="space-y-2">
                {impMilestones.map((m, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input value={m.milestone}
                           onChange={(e) => { const next = [...impMilestones]; next[idx] = { ...next[idx], milestone: e.target.value }; setImpMilestones(next); }}
                           placeholder="Milestone (e.g. SOW Signing)"
                           className={`${fInput} col-span-6`} />
                    <input value={m.percentage}
                           onChange={(e) => { const next = [...impMilestones]; next[idx] = { ...next[idx], percentage: e.target.value }; setImpMilestones(next); }}
                           placeholder="25%"
                           className={`${fInput} col-span-2`} />
                    <input value={m.amount}
                           onChange={(e) => { const next = [...impMilestones]; next[idx] = { ...next[idx], amount: e.target.value }; setImpMilestones(next); }}
                           placeholder="CAD $11,000.00"
                           className={`${fInput} col-span-3`} />
                    <button type="button" onClick={() => setImpMilestones(impMilestones.filter((_, i) => i !== idx))}
                            className="col-span-1 p-1 text-slate-400 hover:text-red-500 rounded" title="Remove milestone">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button type="button"
                        onClick={() => setImpMilestones([...impMilestones, { milestone: '', percentage: '', amount: '' }])}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1">
                  <Plus size={12} /> Add milestone
                </button>
              </div>

              {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={generate} disabled={busy}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  <FileText size={12} />
                  {busy ? 'Building…' : 'Build SOW'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">Preview</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={downloadDocx} disabled={busy} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
                    <Download size={12} /> Download .docx
                  </button>
                  <button onClick={downloadHtml} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded inline-flex items-center gap-1 hover:bg-slate-50">
                    <Download size={12} /> .html
                  </button>
                  <button onClick={save} disabled={busy || !!savedId} className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
                    {savedId ? '✓ Saved' : (busy ? 'Saving…' : 'Save to project')}
                  </button>
                </div>
              </div>
              {warnings.length > 0 && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  <b>AI suggested review:</b>
                  <ul className="list-disc pl-4 mt-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              <div className="border border-slate-300 rounded-md max-h-[60vh] overflow-y-auto">
                <iframe srcDoc={html} className="w-full h-[60vh] border-0" title="SOW preview" />
              </div>
              <div className="text-[11px] text-slate-500">
                Tip: open the downloaded HTML in Chrome → Cmd-P → "Save as PDF" for a print-ready document.
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(3)} className="text-xs text-slate-500 hover:text-slate-800">← Back to edit</button>
                <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded">Close</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const fInput = 'w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Main Pipeline page ──────────────────────── */
export default function PipelinePage() {
  const allProjects = usePipelineStore((s) => s.projects);
  const addProject = usePipelineStore((s) => s.addProject);
  const updateProject = usePipelineStore((s) => s.updateProject);
  const removeProject = usePipelineStore((s) => s.removeProject);
  const [showForm, setShowForm] = useState(false);
  const cadToUsdRate = useFinancialStore((s) => s.settings.cadToUsdRate);

  /** Convert a project's revenue to USD */
  const toUsd = (p: ZohoPipelineProject) => {
    if (!p.revenue) return 0;
    return p.revenueCurrency === 'CAD' ? p.revenue * cadToUsdRate : p.revenue;
  };

  // Pipeline = manually created projects only
  const pipelineProjects = useMemo(() => allProjects.filter((p) => p.source === 'manual'), [allProjects]);

  // Stats
  const proposed = pipelineProjects.filter((p) => p.status === 'Proposed').length;
  const negotiation = pipelineProjects.filter((p) => p.status === 'Negotiation').length;
  const totalRevenueUsd = pipelineProjects.reduce((sum, p) => sum + toUsd(p), 0);

  const handleAdd = (project: ZohoPipelineProject) => {
    addProject(project);
    setShowForm(false);
  };

  const handleMoveToCurrent = (id: string) => {
    // Change source from 'manual' to 'zoho' to move to current projects
    updateProject(id, { source: 'zoho', status: 'In Progress' });
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${pipelineProjects.length} pipeline projects`}
        action={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            Add Pipeline Project
          </button>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-800">{pipelineProjects.length}</div>
          <div className="text-xs text-slate-500">Total Pipeline</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-amber-600">{proposed}</div>
          <div className="text-xs text-slate-500">Proposed</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{negotiation}</div>
          <div className="text-xs text-slate-500">In Negotiation</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-emerald-600">
            {totalRevenueUsd > 0 ? `$${(totalRevenueUsd / 1000).toFixed(0)}k` : '—'}
          </div>
          <div className="text-xs text-slate-500">Pipeline Revenue (USD)</div>
        </div>
      </div>

      {/* New project form */}
      {showForm && (
        <div className="mb-6">
          <NewProjectForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Pipeline projects list */}
      {pipelineProjects.length === 0 && !showForm ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-slate-400 mb-3">
              <Layers size={48} className="mx-auto opacity-50" />
            </div>
            <h3 className="text-lg font-semibold text-slate-600 mb-1">No pipeline projects yet</h3>
            <p className="text-sm text-slate-400 mb-4">
              Add upcoming projects to track your pipeline and forecast future resource needs.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              Add Your First Pipeline Project
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {pipelineProjects.map((project) => (
            <PipelineProjectCard
              key={project.id}
              project={project}
              onUpdate={updateProject}
              onRemove={removeProject}
              onMoveToCurrent={handleMoveToCurrent}
            />
          ))}
        </div>
      )}

      {/* Presales activity tracker — captures POCs/Demos/POVs/Capability work the
          Solution Engineering team is committed to. Tied back to pipeline projects. */}
      <PresalesSection />

      {/* Pipeline funnel summary */}
      {pipelineProjects.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Pipeline Funnel</h2>
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-end gap-6">
              {PIPELINE_STATUSES.map((status) => {
                const count = pipelineProjects.filter((p) => p.status === status).length;
                const rev = pipelineProjects
                  .filter((p) => p.status === status)
                  .reduce((sum, p) => sum + toUsd(p), 0);
                const maxCount = Math.max(pipelineProjects.length, 1);
                const height = Math.max((count / maxCount) * 120, 8);
                return (
                  <div key={status} className="flex-1 text-center">
                    <div className="flex flex-col items-center justify-end" style={{ height: 140 }}>
                      <div className="text-sm font-bold text-slate-700 mb-1">{count}</div>
                      <div
                        className={`w-full rounded-t-lg ${
                          status === 'Proposed' ? 'bg-slate-300' :
                          status === 'Negotiation' ? 'bg-amber-400' :
                          status === 'Confirmed' ? 'bg-emerald-500' :
                          'bg-slate-200'
                        }`}
                        style={{ height }}
                      />
                    </div>
                    <div className="text-xs font-medium text-slate-600 mt-2">{status}</div>
                    {rev > 0 && (
                      <div className="text-[10px] text-slate-400">${(rev / 1000).toFixed(0)}k</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

