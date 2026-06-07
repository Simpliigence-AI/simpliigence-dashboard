/**
 * India-map view of candidates. Pins are clustered by city (Bangalore, Pune,
 * Hyderabad, …) — size of pin = candidate count in that city. Click a pin
 * to open a side panel listing the candidates there.
 *
 * Geography: India states TopoJSON fetched from a public CDN at runtime via
 * react-simple-maps. If the fetch fails (offline, CDN down), the map still
 * renders with just the city pins on a blank canvas — the data is the point.
 *
 * Candidates without a recognizable Indian city in their `location` field
 * are bucketed into an "Unmapped" list shown below the map.
 */
import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { MapPin, X, Linkedin, Mail, Phone } from 'lucide-react';
import { INDIA_CITIES, matchIndianCity } from '../../data/indiaCities';
import { TaIdentity } from '../../components/TaIdentity';
import type { StaffingCandidate } from '../../types/staffing';
// Vendored India states GeoJSON (~93 KB, simplified 1% from datameet/maps).
// Bundled at build time so the basemap works offline + survives CDN churn.
import indiaGeo from '../../data/india-states.json';

interface ClusterInfo {
  city: string;
  /** [lng, lat] */
  coords: [number, number];
  candidates: StaffingCandidate[];
}

export function CandidateMapView({ candidates }: { candidates: StaffingCandidate[] }) {
  const [selected, setSelected] = useState<ClusterInfo | null>(null);

  // Group candidates by matched Indian city
  const { clusters, unmapped } = useMemo(() => {
    const byCity = new Map<string, ClusterInfo>();
    const unmappedList: StaffingCandidate[] = [];
    for (const c of candidates) {
      const matched = matchIndianCity(c.location);
      if (!matched) {
        unmappedList.push(c);
        continue;
      }
      const existing = byCity.get(matched.name);
      if (existing) {
        existing.candidates.push(c);
      } else {
        byCity.set(matched.name, {
          city: matched.name,
          coords: matched.coords,
          candidates: [c],
        });
      }
    }
    const clustersList = Array.from(byCity.values()).sort((a, b) => b.candidates.length - a.candidates.length);
    return { clusters: clustersList, unmapped: unmappedList };
  }, [candidates]);

  const maxCount = clusters.reduce((m, c) => Math.max(m, c.candidates.length), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* Map */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: [82, 22], scale: 800 }}
          width={800}
          height={700}
          style={{ width: '100%', height: 'auto' }}
        >
          <ZoomableGroup minZoom={0.9} maxZoom={4}>
            <Geographies geography={indiaGeo}>
              {({ geographies }: { geographies: Array<{ rsmKey: string }> }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    geography={geo as any}
                    fill="#e2e8f0"
                    stroke="#cbd5e1"
                    strokeWidth={0.4}
                    style={{
                      default: { outline: 'none' },
                      hover:   { fill: '#f1f5f9', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>
            {clusters.map((cluster) => {
              const count = cluster.candidates.length;
              // Radius: 6px floor + scaled component up to ~22px for biggest cluster
              const r = 6 + Math.round((count / maxCount) * 16);
              return (
                <Marker
                  key={cluster.city}
                  coordinates={cluster.coords}
                  onClick={() => setSelected(cluster)}
                  style={{
                    default: { cursor: 'pointer' },
                    hover:   { cursor: 'pointer' },
                    pressed: { cursor: 'pointer' },
                  }}
                >
                  <circle
                    r={r}
                    fill="#3b82f6"
                    fillOpacity={0.55}
                    stroke="#1d4ed8"
                    strokeWidth={1.2}
                  />
                  <text
                    textAnchor="middle"
                    y={3}
                    style={{ fontFamily: 'system-ui, sans-serif', fontSize: '10px', fontWeight: 700, fill: 'white', pointerEvents: 'none' }}
                  >
                    {count}
                  </text>
                  <title>{cluster.city} — {count} candidate{count === 1 ? '' : 's'}</title>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* Side panel */}
      <aside className="bg-white rounded-xl border border-slate-200 p-4 min-h-[300px]">
        {selected ? (
          <SelectedCityPanel cluster={selected} onClose={() => setSelected(null)} />
        ) : (
          <CityList clusters={clusters} maxCount={maxCount} onPick={(c) => setSelected(c)} unmappedCount={unmapped.length} />
        )}
      </aside>

      {/* Unmapped list (full-width row below) */}
      {unmapped.length > 0 && (
        <div className="lg:col-span-2 mt-2">
          <details className="rounded-xl bg-white border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 hover:text-slate-900">
              {unmapped.length} candidate{unmapped.length === 1 ? '' : 's'} not on the map
              <span className="text-[11px] text-slate-400 font-normal ml-2">
                (no recognizable Indian city in their location)
              </span>
            </summary>
            <ul className="mt-3 divide-y divide-slate-100">
              {unmapped.slice(0, 50).map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-900 font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-slate-500 truncate ml-2">{c.location || <em>no location</em>}</div>
                </li>
              ))}
              {unmapped.length > 50 && (
                <li className="py-2 text-[11px] text-slate-400 italic">+ {unmapped.length - 50} more not shown</li>
              )}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/* ── Side panel: candidates for a selected city ── */

function SelectedCityPanel({ cluster, onClose }: { cluster: ClusterInfo; onClose: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">City</div>
          <div className="text-lg font-bold text-slate-900 truncate inline-flex items-center gap-1.5">
            <MapPin size={16} className="text-primary" /> {cluster.city}
          </div>
          <div className="text-[11px] text-slate-500">
            {cluster.candidates.length} candidate{cluster.candidates.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Close panel"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto -mx-1">
        {cluster.candidates.map((c) => (
          <li key={c.id} className="py-2.5 px-1">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">{c.stage}</span>
            </div>
            {c.experience && (
              <div className="text-[11px] text-slate-500 truncate mt-0.5">{c.experience}</div>
            )}
            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 flex-wrap">
              {c.email && (
                <span className="inline-flex items-center gap-1 truncate"><Mail size={10} /> {c.email}</span>
              )}
              {c.phone && (
                <span className="inline-flex items-center gap-1 truncate"><Phone size={10} /> {c.phone}</span>
              )}
              {c.linkedin_url && (
                <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-sky-600 hover:underline">
                  <Linkedin size={10} /> LinkedIn
                </a>
              )}
            </div>
            {c.owning_ta_email && (
              <div className="mt-1.5">
                <TaIdentity email={c.owning_ta_email} avatarSize={20} nameSize="text-[10px]" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Side panel: city list (default before any pin is clicked) ── */

function CityList({ clusters, maxCount, onPick, unmappedCount }: {
  clusters: ClusterInfo[];
  maxCount: number;
  onPick: (c: ClusterInfo) => void;
  unmappedCount: number;
}) {
  return (
    <div>
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Cities on map</div>
        <div className="text-xl font-bold text-slate-900 tabular-nums">
          {clusters.length}
          <span className="text-sm font-normal text-slate-500 ml-2">
            · {clusters.reduce((s, c) => s + c.candidates.length, 0)} candidates
          </span>
        </div>
        {unmappedCount > 0 && (
          <div className="text-[11px] text-amber-700 mt-0.5">
            {unmappedCount} unmapped (no recognizable Indian city)
          </div>
        )}
      </div>
      {clusters.length === 0 ? (
        <div className="text-sm text-slate-400 italic text-center py-8">
          No candidates with a recognizable Indian city yet.
          <br />
          Set <strong>Location</strong> on a candidate (e.g. "Bangalore, India") and the pin appears here.
        </div>
      ) : (
        <ul className="space-y-1 max-h-[540px] overflow-y-auto -mx-1">
          {INDIA_CITIES.map((c) => clusters.find((cl) => cl.city === c.name))
            .filter((cl): cl is ClusterInfo => !!cl)
            .map((cl) => {
              const widthPct = Math.max(8, (cl.candidates.length / maxCount) * 100);
              return (
                <li key={cl.city}>
                  <button
                    type="button"
                    onClick={() => onPick(cl)}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-50 group"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 truncate">{cl.city}</span>
                      <span className="font-bold text-primary tabular-nums">{cl.candidates.length}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-primary/40 group-hover:bg-primary/60 transition-colors" style={{ width: `${widthPct}%` }} />
                    </div>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
