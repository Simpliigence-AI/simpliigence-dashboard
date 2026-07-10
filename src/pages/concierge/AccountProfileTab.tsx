/**
 * AccountProfileTab
 *
 * Renders the AI-synthesized profile inside AccountDrawer. If no profile
 * exists yet, prompts the user to build one from uploaded docs + features.
 * Regenerate re-invokes rebuild-account-profile.
 */
import { useEffect } from 'react';
import { Sparkles, RefreshCw, Loader2, Users, Cpu, Target, AlertTriangle, TrendingUp, ArrowUpRight } from 'lucide-react';
import { Button } from '../../components/ui';
import { useAccountDocsStore } from '../../store/useAccountDocsStore';

interface Props { accountId: string }

function fmtUSD(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000) return `~$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k/yr`;
  return `~$${n}/yr`;
}

export function AccountProfileTab({ accountId }: Props) {
  const profile = useAccountDocsStore((s) => s.profileByAccount[accountId]);
  const docs = useAccountDocsStore((s) => s.docsByAccount[accountId] ?? []);
  const rebuild = useAccountDocsStore((s) => s.rebuildProfile);
  const building = useAccountDocsStore((s) => s.profileBuilding.has(accountId));
  const loadForAccount = useAccountDocsStore((s) => s.loadForAccount);

  useEffect(() => { void loadForAccount(accountId); }, [accountId, loadForAccount]);

  const doneCount = docs.filter((d) => d.aiStatus === 'done').length;
  const hasProfile = !!profile && (profile.whatWeDo || profile.keyStakeholders.length > 0 || profile.upsellOpportunities.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-600" /> AI Account Profile
          </h3>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Synthesized from {doneCount} document{doneCount !== 1 ? 's' : ''} + tracked features + Salesforce opps
            {profile?.generatedAt && ` · last rebuilt ${new Date(profile.generatedAt).toLocaleString()}`}
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => rebuild(accountId)} disabled={building}>
          {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          <span className="ml-1">{hasProfile ? 'Rebuild' : 'Build profile'}</span>
        </Button>
      </div>

      {!hasProfile && !building && (
        <div className="text-center text-slate-500 text-sm py-8 border border-dashed border-slate-200 rounded-lg">
          <Sparkles size={18} className="mx-auto text-slate-300 mb-2" />
          {doneCount === 0
            ? 'Upload documents or meeting transcripts on the Documents / Meetings tabs, then click Build profile.'
            : 'Click Build profile to synthesize a summary from your uploads.'}
        </div>
      )}

      {profile?.whatWeDo && (
        <section className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">What we're delivering</h4>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">{profile.whatWeDo}</p>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ProfileList
          icon={<Users size={13} />}
          title="Key stakeholders"
          items={profile?.keyStakeholders ?? []}
          renderItem={(s) => (
            <>
              <div className="font-semibold">{s.name}{s.role ? <span className="font-normal text-slate-500"> · {s.role}</span> : null}</div>
              {s.notes && <div className="text-slate-600 mt-0.5">{s.notes}</div>}
            </>
          )}
        />
        <ProfileList
          icon={<Cpu size={13} />}
          title="Technologies in use"
          items={profile?.technologies ?? []}
          renderItem={(t) => <span>{t}</span>}
          chips
        />
        <ProfileList
          icon={<Target size={13} />}
          title="Current initiatives"
          items={profile?.currentInitiatives ?? []}
          renderItem={(i) => (
            <>
              <div className="font-semibold">{i.title}</div>
              {i.description && <div className="text-slate-600 mt-0.5">{i.description}</div>}
            </>
          )}
        />
        <ProfileList
          icon={<AlertTriangle size={13} />}
          title="Risks"
          items={profile?.risks ?? []}
          renderItem={(r) => (
            <>
              <div className="font-semibold flex items-center gap-1.5">
                {r.title}
                {r.severity && <span className={`text-[9px] px-1 py-0.5 rounded ${
                  r.severity === 'high' ? 'bg-rose-100 text-rose-700' :
                  r.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-600'
                }`}>{r.severity}</span>}
              </div>
              {r.notes && <div className="text-slate-600 mt-0.5">{r.notes}</div>}
            </>
          )}
        />
      </div>

      <OppSection
        title="Upsell opportunities"
        subtitle="Deeper adoption of clouds this account already uses"
        items={profile?.upsellOpportunities ?? []}
        icon={<TrendingUp size={13} className="text-emerald-600" />}
        badgeCls="bg-emerald-50 text-emerald-700 border-emerald-200"
      />
      <OppSection
        title="Cross-sell opportunities"
        subtitle="New clouds / products not yet in their stack"
        items={profile?.crossSellOpportunities ?? []}
        icon={<ArrowUpRight size={13} className="text-sky-600" />}
        badgeCls="bg-sky-50 text-sky-700 border-sky-200"
      />
    </div>
  );
}

function ProfileList<T>({
  icon, title, items, renderItem, chips = false,
}: {
  icon: React.ReactNode;
  title: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  chips?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">{icon} {title}</h4>
      {items.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">None extracted yet.</div>
      ) : chips ? (
        <div className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <span key={i} className="text-[11px] bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full">{renderItem(it)}</span>
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => <li key={i} className="text-xs text-slate-800">{renderItem(it)}</li>)}
        </ul>
      )}
    </section>
  );
}

interface Opp { title: string; cloud?: string; rationale?: string; upsell_estimate_usd?: number }
function OppSection({ title, subtitle, items, icon, badgeCls }: {
  title: string; subtitle: string; items: Opp[]; icon: React.ReactNode; badgeCls: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">{icon} {title}</h4>
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      </div>
      <div className="space-y-2">
        {items.map((o, i) => (
          <div key={i} className={`rounded border ${badgeCls} px-3 py-2`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">{o.title}</div>
                {o.cloud && <div className="text-[10px] text-slate-500 uppercase tracking-wider">{o.cloud}</div>}
              </div>
              {o.upsell_estimate_usd ? (
                <span className="flex-shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  {fmtUSD(o.upsell_estimate_usd)}
                </span>
              ) : null}
            </div>
            {o.rationale && <div className="text-xs text-slate-700 mt-1 leading-relaxed">{o.rationale}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
