/**
 * Smart Query panel scoped to India Staffing data.
 * Ask natural-language questions like "which reqs are stuck in Client Round"
 * or "show me reqs with no update in 10+ days".
 */
import { useCallback, useRef, useState } from 'react';
import { Search, Sparkles, Loader2, X } from 'lucide-react';
import {
  runStaffingQuery,
  STAFFING_SUGGESTED_QUERIES,
  getClaudeApiKey,
  type StaffingQueryInput,
} from '../../lib/claudeQuery';
import type { QueryResult } from '../../lib/queryEngine';

interface Props {
  input: StaffingQueryInput;
}

export function StaffingSmartQuery({ input }: Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasKey = !!getClaudeApiKey();

  const submit = useCallback(async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text) return;
    setQuery(text);
    setLoading(true);
    setExpanded(true);
    setResult(null);
    try {
      const res = await runStaffingQuery(text, input);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }, [query, input]);

  const clear = () => {
    setQuery('');
    setResult(null);
    setExpanded(false);
    inputRef.current?.focus();
  };

  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 shadow-sm overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} className="text-blue-600" />
          <span className="text-sm font-bold text-ink">Smart Query</span>
          <span className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">AI</span>
          <span className="text-[10px] text-muted/70 ml-1">
            {hasKey ? 'Ask anything about your pipeline' : 'Add Claude API key in Settings to enable'}
          </span>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. Which reqs are stuck in Client Round? What moved this week?"
            disabled={!hasKey || loading}
            className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-surface-2 disabled:text-muted/70"
          />
          {query && !loading && (
            <button onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted/70 hover:text-muted" title="Clear">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Suggested queries */}
        {!result && !loading && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {STAFFING_SUGGESTED_QUERIES.slice(0, 5).map((sq) => (
              <button
                key={sq}
                onClick={() => submit(sq)}
                disabled={!hasKey}
                className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-line text-muted hover:bg-surface-2/70 hover:border-blue-300 transition-colors disabled:opacity-50"
              >
                {sq}
              </button>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin text-blue-500" /> Claude is analyzing your pipeline...
          </div>
        )}

        {/* Result */}
        {result && !loading && expanded && (
          <div className="mt-3 bg-white rounded-lg border border-line p-3">
            <div className="text-[12px] leading-relaxed text-ink/80 [&_strong]:text-ink">
              {result.answer.split('\n').map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return null;
                const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
                const content = isBullet ? trimmed.slice(2) : trimmed;
                const parts = content.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
                return (
                  <p key={i} className={`${isBullet ? 'ml-4 before:content-["•"] before:mr-2 before:text-blue-400' : ''} my-1`}>
                    {parts.map((part, j) =>
                      part.startsWith('**') && part.endsWith('**')
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : <span key={j}>{part}</span>,
                    )}
                  </p>
                );
              })}
            </div>

            {result.data && result.columns && result.data.length > 0 && (
              <div className="mt-3 overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-2/70">
                    <tr className="border-b border-line">
                      {result.columns.map((col) => (
                        <th key={col} className="py-1.5 px-2.5 text-left font-semibold text-muted text-[10px] uppercase tracking-wide">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row, i) => (
                      <tr key={i} className="border-b border-line/40 hover:bg-surface-2/50">
                        {result.columns!.map((col) => (
                          <td key={col} className="py-1 px-2.5 text-ink/80 tabular-nums text-[11px]">
                            {row[col] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-line/60">
              <span className="text-[10px] text-muted/70 mr-1">Try also:</span>
              {STAFFING_SUGGESTED_QUERIES.filter((s) => s !== query).slice(0, 4).map((sq) => (
                <button
                  key={sq}
                  onClick={() => submit(sq)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-surface-2/70 border border-line text-muted hover:bg-surface-2"
                >
                  {sq}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
