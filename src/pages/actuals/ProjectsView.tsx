/**
 * Read-only "Projects" view for /actual-hours. Mirrors the Project Team's
 * ProjectsView (card per project with assigned people and their monthly
 * strips) but shows what each person actually logged from Zoho People.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useActualHoursStore } from '../../store';
import { MONTHS } from '../../types/forecast';
import { colorHash, getInitials } from '../team/shared';
import { AllocationStrip } from '../team/AllocationStrip';
import { aggregateActuals } from './shared';

interface ProjectCard {
  name: string;
  people: Array<{
    name: string;
    email: string | null;
    monthlyTotals: Record<string, number>;
    weeklyHours: Record<string, number>;
    total: number;
  }>;
  totalHours: number;
}

export default function ActualProjectsView() {
  const entries = useActualHoursStore((s) => s.entries);
  const groups = useMemo(() => aggregateActuals(entries), [entries]);
  const year = new Date().getFullYear();

  // Pivot: groups (by employee) → cards (by project).
  const cards: ProjectCard[] = useMemo(() => {
    const byProject = new Map<string, ProjectCard>();
    for (const g of groups) {
      for (const a of g.assignments) {
        let card = byProject.get(a.project);
        if (!card) {
          card = { name: a.project, people: [], totalHours: 0 };
          byProject.set(a.project, card);
        }
        const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
        card.totalHours += total;
        card.people.push({
          name: g.name,
          email: g.email,
          monthlyTotals: a.monthlyTotals,
          weeklyHours: a.weeklyHours,
          total,
        });
      }
    }
    for (const c of byProject.values()) c.people.sort((a, b) => b.total - a.total);
    return [...byProject.values()].sort((a, b) => b.totalHours - a.totalHours);
  }, [groups]);

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return cards;
    const q = search.toLowerCase();
    return cards.filter((c) => c.name.toLowerCase().includes(q));
  }, [cards, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          {cards.length === 0 ? 'No actuals synced yet.' : 'No projects match the filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((card) => {
            const hue = colorHash(card.name);
            return (
              <div key={card.name} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div
                  className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100"
                  style={{ backgroundColor: `hsl(${hue} 70% 97%)` }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-2 h-10 rounded-full"
                      style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
                    />
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-800 truncate">{card.name}</h3>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {card.people.length} {card.people.length === 1 ? 'person' : 'people'} ·{' '}
                        <span className="font-semibold text-slate-700 tabular-nums">{card.totalHours.toFixed(0)} hrs logged</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-50">
                  {card.people.map((p) => {
                    const personHue = colorHash(p.name);
                    return (
                      <div key={`${card.name}-${p.name}`} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                            style={{
                              backgroundColor: `hsl(${personHue} 70% 90%)`,
                              color: `hsl(${personHue} 60% 30%)`,
                            }}
                          >
                            {getInitials(p.name)}
                          </div>
                          <div className="w-40 shrink-0 min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                            {p.email && <div className="text-[11px] text-slate-500 truncate">{p.email}</div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <AllocationStrip
                              employeeName={p.name}
                              project={card.name}
                              monthlyTotals={p.monthlyTotals}
                              weeklyHours={p.weeklyHours}
                              year={year}
                              compact
                              readOnly
                            />
                          </div>
                          <div className="w-14 shrink-0 text-right tabular-nums">
                            <div className="text-sm font-bold text-slate-700">{p.total.toFixed(0)}</div>
                            <div className="text-[9px] text-slate-400 uppercase">hrs/yr</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
        Read-only view of logged hours per project from Zoho People. To assign forecast hours, use the Project Team page.
      </p>
    </div>
  );
}
