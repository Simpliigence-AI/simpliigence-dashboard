/**
 * Skill pools and suggested profiles.
 *
 * A skill pool is a standing view of the candidate database by skill family
 * ("Salesforce pool", "QA pool"). It does the job of an evergreen requisition
 * without putting a dummy requisition into the demand numbers: a profile that
 * arrives with no job ID is still findable under its pool the moment it is parsed.
 *
 * Pools are derived in the browser from the skills parse-resume already stores,
 * so they cost nothing, need no backfill, and cover every profile in the database.
 *
 * `suggestProfiles` ranks database profiles against one requisition, so the
 * matching people come to the role instead of someone having to search for them.
 */
import type { StaffingCandidate, StaffingRequisition } from '../types/staffing';

export interface SkillPool {
  id: string;
  label: string;
  /** Tested against each individual skill (lower-cased, trimmed). */
  skill: RegExp;
  /** Tested against the job title on the profile, and against requisition text. */
  title: RegExp;
  /** How many of the profile's skills must match before it joins the pool on skills alone. */
  min: number;
}

export const SKILL_POOLS: SkillPool[] = [
  { id: 'salesforce', label: 'Salesforce', min: 2,
    skill: /salesforce|\bapex\b|\bsoql\b|\bsosl\b|visualforce|lightning web|\blwc\b|aura comp|\bcpq\b|agentforce|copado|field service|omnistudio|vlocity|servicemax|sales cloud|service cloud|experience cloud|marketing cloud|revenue cloud/,
    title: /salesforce|\bsfdc\b|\bsf\b|\bapex\b|\blwc\b|\bcpq\b|omnistudio|vlocity|servicemax|agentforce|field service/ },
  { id: 'qa', label: 'QA & Testing', min: 2,
    skill: /selenium|testing|test automation|test cases?|test plan|\bqa\b|quality assurance|cypress|playwright|testng|jmeter|appium|cucumber|\bsdet\b|defect/,
    title: /\bqa\b|quality assurance|\btest(er|ing)?\b|\bsdet\b|automation engineer/ },
  { id: 'data', label: 'Data & BI', min: 2,
    skill: /power bi|tableau|snowflake|data analysis|data analytics|\betl\b|informatica|databricks|data engineering|data warehous|pyspark|\bspark\b|\bssis\b|\bdbt\b|bigquery|redshift|data model|looker|crm analytics|tableau crm/,
    title: /data (engineer|analyst|architect)|\bbi\b|business intelligence|tableau|power bi|snowflake|\betl\b|analytics/ },
  { id: 'ai', label: 'AI & ML', min: 2,
    skill: /machine learning|langchain|generative ai|\bgen ?ai\b|tensorflow|pytorch|\bnlp\b|\bllms?\b|deep learning|\brag\b|computer vision|scikit|hugging ?face|prompt engineering|openai|agentic/,
    title: /machine learning|\bml\b|\bai\b|data scien|\bnlp\b|gen ?ai|\bllm\b/ },
  { id: 'rpa', label: 'RPA & Automation', min: 2,
    skill: /uipath|automation anywhere|blue prism|\brpa\b|robotic process|power automate/,
    title: /\brpa\b|uipath|automation anywhere|blue prism/ },
  { id: 'devops', label: 'Cloud & DevOps', min: 3,
    skill: /\baws\b|\bazure\b|\bgcp\b|docker|kubernetes|jenkins|ci\/cd|terraform|ansible|devops|\blinux\b|helm|cloudformation/,
    title: /devops|devsecops|cloud (engineer|architect)|\baws\b|\bazure\b|\bgcp\b|\bsre\b|site reliability|platform engineer/ },
  { id: 'web', label: 'Web & Full Stack', min: 2,
    skill: /\breact|angular|node\.?js|typescript|express\.?js|\bvue|next\.?js|redux|javascript|tailwind/,
    title: /full ?stack|front ?end|\breact|angular|node|\bmern\b|\bmean\b|web developer|ui developer/ },
  { id: 'backend', label: 'Java & .NET', min: 2,
    skill: /^java$|\bjava (8|11|17|ee|se)\b|core java|spring|microservices|hibernate|^c#$|\.net|asp\.net|\bj2ee\b/,
    title: /\bjava\b(?!script)|\.net|dot ?net|spring boot|backend/ },
  { id: 'servicenow', label: 'ServiceNow', min: 1, skill: /servicenow|\bitsm\b|\bitom\b/, title: /servicenow/ },
  { id: 'sap', label: 'SAP', min: 1, skill: /^sap$|\bsap\b|\babap\b|s\/4 ?hana|successfactors/, title: /\bsap\b|\babap\b/ },
  { id: 'integration', label: 'Integration', min: 1, skill: /mulesoft|\bboomi\b|\btibco\b|anypoint/, title: /mulesoft|\bboomi\b|integration (developer|architect|engineer)/ },
  { id: 'design', label: 'UX & Design', min: 2,
    skill: /figma|adobe xd|wirefram|prototyp|user research|\bux\b|\bui\/ux\b|usability|design system|photoshop|illustrator/,
    title: /\bux\b|\bui\/ux\b|product designer|ui designer|graphic designer/ },
  { id: 'ba_pm', label: 'BA & Project Mgmt', min: 2,
    skill: /business analysis|requirements? gathering|user stories|project management|stakeholder management|scrum master|product management|\bpmp\b|\bbrd\b|process mapping|product owner/,
    title: /business analyst|\bbsa\b|\bba\b|project[ -]manager|program manager|scrum master|product (owner|manager)|delivery manager/ },
  { id: 'hr', label: 'HR & TA', min: 2,
    skill: /recruit|talent acquisition|employee relations|payroll|onboarding|performance management|employee engagement|talent management|\bhris\b|sourcing/,
    title: /\bhr\b|human resource|recruiter|talent acquisition|people (experience|operations)/ },
  { id: 'sales', label: 'Sales & Marketing', min: 2,
    skill: /digital marketing|\bseo\b|lead generation|business development|social media|email marketing|account management|market research|google analytics|hubspot|content marketing|inside sales/,
    title: /\bsales\b|marketing|marketer|business development|account (manager|executive|management)|\bbdr\b|\bsdr\b/ },
  { id: 'finance', label: 'Finance & Accounts', min: 2,
    skill: /accounts payable|accounts receivable|\bgst\b|tally|reconciliation|financial reporting|bookkeeping|\btds\b|invoic|taxation|audit/,
    title: /accountant|finance|accounts (executive|manager)|\bca\b/ },
];

const POOL_BY_ID = new Map(SKILL_POOLS.map((p) => [p.id, p]));
export const poolLabel = (id: string) => POOL_BY_ID.get(id)?.label ?? id;

const norm = (s: string | null | undefined) => (s || '').toLowerCase().trim();

/** Pools a profile belongs to: on its job title, or on enough of its parsed skills. */
export function poolsForCandidate(c: Pick<StaffingCandidate, 'skills' | 'experience'>): string[] {
  const skills = (c.skills || []).map(norm).filter(Boolean);
  const title = norm(c.experience);
  if (!skills.length && !title) return [];
  const out: string[] = [];
  for (const p of SKILL_POOLS) {
    if (title && p.title.test(title)) { out.push(p.id); continue; }
    let hits = 0;
    for (const s of skills) {
      if (p.skill.test(s) && ++hits >= p.min) break;
    }
    if (hits >= p.min) out.push(p.id);
  }
  return out;
}

/** Pools a requisition is asking for. The title decides; the JD is only consulted when the title is silent. */
export function poolsForRequisition(r: Pick<StaffingRequisition, 'title' | 'job_description'>): string[] {
  const title = norm(r.title);
  const fromTitle = SKILL_POOLS.filter((p) => p.title.test(title)).map((p) => p.id);
  if (fromTitle.length) return fromTitle;
  const jd = norm(r.job_description).slice(0, 6000);
  if (!jd) return [];
  return SKILL_POOLS.filter((p) => p.title.test(jd)).map((p) => p.id);
}

const STOP = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'with', 'in', 'to', 'at', 'on', 'or', 'sr', 'jr', 'senior', 'junior', 'lead',
  'developer', 'engineer', 'consultant', 'specialist', 'associate', 'role', 'position', 'years', 'yrs', 'exp',
  'experience', 'india', 'remote', 'hybrid', 'wfo', 'contract', 'fte', 'new', 'req', 'requirement', 'technical',
  'cloud', 'offshore', 'onsite', 'web', 'services', 'solution', 'solutions', 'solutioning', 'systems', 'application',
  'architect', 'arch', 'manager', 'project', 'director', 'sf',
]);
const tokens = (s: string) => norm(s).split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1 && !STOP.has(t));

export interface ProfileSuggestion {
  candidate: StaffingCandidate;
  score: number;
  /** Up to six of the profile's skills that the role asks for, in the profile's own wording. */
  matchedSkills: string[];
  /** True when the profile is in the unassigned pool and can be added to the role in one click. */
  inPool: boolean;
}

const OUT_OF_RUNNING = new Set(['Joined', 'Offer Accepted']);

/**
 * Rank database profiles for one requisition.
 *
 * Score = 4 per shared skill pool + 3 per role-title word found in the profile
 *       + 1 per profile skill the JD or title mentions (capped at 10).
 * When the role maps to a skill pool, a profile must share that pool to appear; a
 * role outside every pool (PeopleSoft, PHP) falls back to a title-word match. Either
 * way a lone generic skill ("Jira", "SQL") never surfaces someone. Unassigned profiles win
 * ties, then the most recently updated. One row per person (by email, else phone).
 */
export function suggestProfiles(
  req: Pick<StaffingRequisition, 'id' | 'title' | 'job_description'>,
  candidates: StaffingCandidate[],
  limit = 12,
): ProfileSuggestion[] {
  const reqPools = new Set(poolsForRequisition(req));
  const titleTokens = Array.from(new Set(tokens(req.title)));
  const reqText = ` ${norm(req.title)} ${norm(req.job_description).slice(0, 12000)} `;
  if (!reqPools.size && !titleTokens.length) return [];

  // People already on this role, so a second row for the same person isn't suggested back.
  const personKey = (c: StaffingCandidate) => norm(c.email) || norm(c.phone).replace(/\D/g, '').slice(-10) || `id:${c.id}`;
  const onRole = new Set(candidates.filter((c) => c.requisition_id === req.id).map(personKey));

  const best = new Map<string, ProfileSuggestion>();
  for (const c of candidates) {
    if (c.requisition_id === req.id) continue;
    if (OUT_OF_RUNNING.has(c.stage)) continue;
    const key = personKey(c);
    if (onRole.has(key)) continue;

    const skills = (c.skills || []).map(norm).filter(Boolean);
    const title = norm(c.experience);
    if (!skills.length && !title) continue;

    let score = 0;
    let anchored = false;
    if (reqPools.size) {
      for (const p of poolsForCandidate(c)) if (reqPools.has(p)) { score += 4; anchored = true; }
    }
    const profileText = ` ${title} ${skills.join(' ')} `;
    for (const t of titleTokens) {
      if (profileText.includes(` ${t}`)) { score += 3; if (!reqPools.size) anchored = true; }
    }
    if (!anchored) continue;

    const matched: string[] = [];
    for (let i = 0; i < skills.length && matched.length < 10; i++) {
      const s = skills[i];
      if (s.length >= 3 && reqText.includes(s)) matched.push((c.skills || [])[i]);
    }
    score += matched.length;

    const inPool = !c.requisition_id;
    const cur = best.get(key);
    const better = !cur || score > cur.score || (score === cur.score && inPool && !cur.inPool);
    if (better) best.set(key, { candidate: c, score, matchedSkills: matched.slice(0, 6), inPool });
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score || Number(b.inPool) - Number(a.inPool)
      || (b.candidate.updated_at || '').localeCompare(a.candidate.updated_at || ''))
    .slice(0, limit);
}
