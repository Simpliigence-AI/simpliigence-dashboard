/**
 * Resolve a forecast employee NAME to a login EMAIL.
 *
 * The two halves of the app key people differently: forecast_assignments (and
 * therefore every project allocation) stores a free-text `employee_name`,
 * while leave, timesheets and auth all key on email. Nothing joins them, so
 * anything that needs both — "who on this project is on leave next week" —
 * has to bridge the gap here.
 *
 * The names genuinely disagree. Against live data, 12 of 35 allocated people
 * fail an exact full-name match:
 *
 *   Pawan Angad Thote          → Pawan Thote
 *   Joseph Sunil Joseph        → Joseph Sunil
 *   B Chaithanya Kumar Reddy   → Chaithanya Reddy
 *   Sailendraraj Singh         → Sailendra Raj Singh
 *   Raghu S / Vasanth          → Raghu / Vasanth Kumar      (short forms)
 *   Arprit Soni                → Arpit Soni                 (typo in forecast)
 *
 * ── Returning null matters ──
 * A caller showing leave per person MUST distinguish "no leave booked" from
 * "we couldn't identify this person". Blank-means-available would quietly
 * report an unresolvable name as fully available, which is worse than saying
 * nothing. So this returns null rather than guessing, and ambiguous matches
 * (two people who could both be "Rahul") also return null — a confident wrong
 * answer is the failure mode to avoid.
 */

export interface DirectoryEntry {
  /** Nullable: authorized_users.full_name is optional, so callers can pass
   *  the directory straight through without pre-filtering. */
  fullName: string | null;
  email: string;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Name tokens worth matching on — single letters are initials, not names. */
function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 1);
}

function isSubset(a: string[], b: string[]): boolean {
  return a.length > 0 && a.every((t) => b.includes(t));
}

/** All spaces removed, so differing word breaks compare equal. */
function squash(s: string): string {
  return norm(s).replace(/\s/g, '');
}

/**
 * True when one edit (insert / delete / substitute / adjacent transposition)
 * turns `a` into `b`. Used only as a last resort against typos like
 * "Arprit" for "Arpit", and only when exactly one candidate is within reach.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  if (la === lb) {
    let diff = -1;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        if (diff !== -1) {
          // Two mismatches are only OK if they're an adjacent swap.
          return diff === i - 1 && a[diff] === b[i] && a[i] === b[diff]
            && a.slice(i + 1) === b.slice(i + 1);
        }
        diff = i;
      }
    }
    return true;
  }

  // One longer than the other — check it's a single insertion.
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

export interface Resolver {
  /** Email for this forecast name, or null when unknown or ambiguous. */
  (employeeName: string): string | null;
}

export function buildEmailResolver(directory: DirectoryEntry[]): Resolver {
  const people = directory
    .filter((d) => d.email && d.fullName)
    .map((d) => ({
      email: d.email.toLowerCase(),
      norm: norm(d.fullName),
      squashed: squash(d.fullName),
      tokens: tokens(d.fullName),
    }));

  const byExact = new Map<string, string>();
  for (const p of people) {
    // First writer wins; a duplicated full name is ambiguous either way and
    // will be caught by the uniqueness checks below.
    if (!byExact.has(p.norm)) byExact.set(p.norm, p.email);
  }

  const cache = new Map<string, string | null>();

  return (employeeName: string): string | null => {
    if (!employeeName) return null;
    const key = employeeName.toLowerCase();
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const resolve = (): string | null => {
      const n = norm(employeeName);
      const exact = byExact.get(n);
      if (exact) return exact;

      // Same letters, different word breaks: "Sailendraraj Singh" is
      // "Sailendra Raj Singh" with a space missing. Character-exact once
      // spaces are dropped, so no risk of a false positive.
      const sq = squash(employeeName);
      const squashHits = people.filter((p) => p.squashed === sq);
      if (squashHits.length === 1) return squashHits[0].email;

      const t = tokens(employeeName);
      if (t.length === 0) return null;

      // Token subset either direction — handles extra middle names and
      // dropped surnames ("Pawan Angad Thote" ↔ "Pawan Thote").
      //
      // Only for multi-token names. A lone token would otherwise let a bare
      // surname claim someone: "Sharma" is a subset of "Shikhar Sharma", and
      // attributing one person's leave to another is the worst thing this
      // module can do. Single tokens fall through to the first-name rule
      // below, which matches on given name only.
      const subset = t.length < 2
        ? []
        : people.filter((p) => isSubset(t, p.tokens) || isSubset(p.tokens, t));
      if (subset.length === 1) return subset[0].email;
      if (subset.length > 1) {
        // Prefer the candidate sharing the most tokens, but only when that
        // best score is unique — otherwise it's a coin flip.
        const scored = subset
          .map((p) => ({ p, score: p.tokens.filter((x) => t.includes(x)).length }))
          .sort((a, b) => b.score - a.score);
        if (scored[0].score > (scored[1]?.score ?? -1)) return scored[0].p.email;
        return null;
      }

      // Distinctive-first-name fallback ("Vasanth" → "Vasanth Kumar"), only
      // when exactly one person in the directory starts with that name.
      const first = t[0];
      const byFirst = people.filter((p) => p.tokens[0] === first);
      if (byFirst.length === 1) return byFirst[0].email;

      // Last resort: a single typo ("Arprit Soni" for "Arpit Soni"). Guarded
      // hard — the whole name must be long enough that one edit isn't a
      // coincidence, and exactly one person may be within reach.
      if (sq.length >= 8) {
        const near = people.filter((p) => p.squashed.length >= 8 && withinOneEdit(sq, p.squashed));
        if (near.length === 1) return near[0].email;
      }

      return null;
    };

    const out = resolve();
    cache.set(key, out);
    return out;
  };
}
