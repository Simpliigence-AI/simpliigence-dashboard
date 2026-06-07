/** Vendor types — companies who supply candidates, plus outreach log. */

export interface Vendor {
  id: string;
  companyName: string;
  spocName: string | null;
  spocEmail: string | null;
  altEmails: string[];
  skills: string[];
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VendorOutreachStatus = 'composed' | 'sent' | 'bounced' | 'replied';

export interface VendorOutreach {
  id: string;
  vendorId: string;
  requisitionId: string;
  sentAt: string;
  sentBy: string | null;
  subject: string;
  bodyPreview: string;
  sendStatus: VendorOutreachStatus;
  sendError: string | null;
}

/** Canonical skill set offered as default multi-select options. */
export const VENDOR_SKILL_PRESETS: string[] = [
  'Salesforce',
  'Salesforce Service Cloud',
  'Salesforce Marketing Cloud',
  'Salesforce CPQ',
  'ServiceMax',
  'ServiceNow',
  'Python',
  'Java',
  'Spring Boot',
  '.NET',
  'C#',
  'Node.js',
  'JavaScript',
  'TypeScript',
  'React',
  'Angular',
  'Vue',
  'iOS',
  'Android',
  'AWS',
  'Azure',
  'GCP',
  'DevOps',
  'SRE',
  'Kubernetes',
  'Terraform',
  'Data Engineering',
  'Snowflake',
  'Databricks',
  'Apache Spark',
  'Data Science / ML',
  'AI / LLM',
  'SAP',
  'Oracle',
  'PostgreSQL',
  'MongoDB',
  'Power Platform',
  'Mulesoft',
  'Mainframe / COBOL',
  'QA / Automation',
  'Cybersecurity',
];
