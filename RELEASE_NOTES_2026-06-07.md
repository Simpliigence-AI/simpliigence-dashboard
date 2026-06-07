# Simpliigence Dashboard — Release Notes, 7 June 2026

A big shipping day across recruiting, account ops, and candidate workflow. 22 PRs landed. Highlights below — try them out and tell us what's missing.

## New modules

### 🆕 Vendors
A full vendor relationship hub, found in the sidebar under **India T&M**.

- **Vendors page** — inline-edit table of all vendors. Capture company name, SPOC name, SPOC email, and the skills they specialise in. Multi-select from a curated skill list or add your own.
- **Send-to-Vendor from any requisition** — every India Demand requisition now has a paper-plane icon. Click it to open a dialog that:
  - Lists active vendors with the matching skills pre-selected at the top
  - Auto-fills a subject line and body using the requisition's title, account, department, and (if generated) the full JD
  - Sends per-vendor emails so vendors never see each other in CC/BCC
- **Phase 2: real email delivery** — emails now go out from `hr@simpliigence.com` via Resend with delivery status logged per-vendor (✓/✗). No more `mailto:` workaround.
- **Outreach log** — every send is stored on the vendor record so you can see who you've contacted, when, and about which req.

### 🆕 Account Management
Found in the sidebar under **Account Management**.

- **Accounts page** — central registry of every client account with sales + delivery owners, "Stale" red flag when 30+ days pass with no connect.
- Five tabs per account: **Overview**, **Sales connects**, **Delivery connects**, **Client contacts**, **Actions**, **Team**.
- **Client Contacts tab** — track named individuals at each client: name, email, phone, last touch date, gift sent, gift date, notes.
- **Team tab** — auto-populated from India Roster + US Roster based on the `project` field.
- **Action items** — log a task, assign a due date, get an "overdue" tag in red when the due date passes.

### 🆕 Profile Format
Found in the sidebar under **India T&M**.

- Upload any candidate resume (PDF / DOCX / TXT) and Claude reformats it into our Simpliigence house style — Arial Black headings, brand-green accents, italic blockquote summary.
- Optional: upload a target-format reference doc and Claude will match its layout instead.
- One-click PDF export via the browser's print engine.

## Candidates page

- **Referral capture** — new "Add referral" CTA. Capture referrer email + name + referral date alongside availability (Full-time / Contracting) and expected salary.
- **Bulk resume import** — drop many resumes at once. Each one is auto-parsed for identity + skills + summary.
- **India map view** — toggle to Map view to see candidates clustered by Indian city. Pin size = candidate count. Click a pin to see the candidates in that city in the side panel.
- **Cards view: pixel-perfect alignment** — cards in the same row now share top + bottom edges and the contact/action footer pins to the bottom.
- **Stronger map outlines** — state boundaries now clearly visible against a clean white canvas.

## India Demand

- **Generate JD** — every requisition row has a "Generate JD" button. Opens a drawer where Claude drafts a full markdown JD from the role + account context. Editable, persists to the requisition, and feeds the Send-to-Vendor flow.
- **Aligned row cells** — every row now lays its cells out on a single 28px baseline; no more cells drifting up or down depending on content height.
- **Add candidate from existing pool** — the "Add candidate" action on a requisition now opens a picker against the Candidates DB instead of an inline create form. Cuts duplicate records.

## TA Daily Log

- **Non-requisition activities** — log Vendor Coordination, Training, Interviews, Admin etc. without picking a requisition. Each entry takes a Customer/Topic + Description.
- **30-minute time-spent stepper** — every entry now records time spent in 30-minute increments.
- **Display names + avatars everywhere** — Chaitra, Amulya, Kavitha (and everyone else) now appear with their real names and profile pictures across TA Daily Log, TA Metrics, the Candidates panel, and any other place we used to display a raw email.

## Quality of life

- **Collapsible sidebar sections** — every section (Home, India T&M, US T&M, Account Management) now collapses with a chevron toggle. The active route's section auto-expands. State persists per user.
- **No more dashboard wipeouts** — every page loads its real data on every navigation; the "loading..." state no longer briefly flashes empty UI.

## How to ship this update to your team

You can paste this entire file into Slack or email. If you'd rather a tighter Slack-ready version, ping me and I'll cut one for you.

— Built by the Simpliigence dev team with [Claude Code](https://claude.com/claude-code)
