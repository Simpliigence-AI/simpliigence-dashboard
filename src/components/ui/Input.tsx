import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-semibold text-muted uppercase tracking-wider">{label}</label>}
      <input
        className={`w-full px-3 py-2 rounded-lg border text-sm text-ink placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary transition-colors ${error ? 'border-red-400 focus-visible:ring-red-400/50' : 'border-line'} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { label: string; value: string }[];
  placeholder?: string;
}

export function Select({ label, options, placeholder, className = '', ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-semibold text-muted uppercase tracking-wider">{label}</label>}
      <select
        className={`w-full px-3 py-2 rounded-lg border border-line text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary bg-surface transition-colors ${className}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

interface MultiSelectProps {
  label?: string;
  options: { label: string; value: string }[];
  value: string[];
  onChange: (values: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: MultiSelectProps) {
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-semibold text-muted uppercase tracking-wider">{label}</label>}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-150 ${
              value.includes(opt.value)
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-surface text-muted border-line hover:border-primary hover:text-primary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-semibold text-muted uppercase tracking-wider">{label}</label>}
      <textarea
        className={`w-full px-3 py-2 rounded-lg border border-line text-sm text-ink placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary resize-none transition-colors ${className}`}
        rows={3}
        {...props}
      />
    </div>
  );
}
