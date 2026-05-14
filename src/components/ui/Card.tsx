import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}

export function Card({ children, className = '', title, action }: CardProps) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          {title && <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  subtitle?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, subtitle, trend, trendValue, icon }: StatCardProps) {
  const trendColors = {
    up: 'text-emerald-600',
    down: 'text-red-600',
    flat: 'text-slate-500',
  };
  const trendArrows = { up: '\u2191', down: '\u2193', flat: '\u2192' };

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>}
          {trend && trendValue && (
            <p className={`text-xs font-semibold mt-2 ${trendColors[trend]}`}>
              {trendArrows[trend]} {trendValue}
            </p>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
