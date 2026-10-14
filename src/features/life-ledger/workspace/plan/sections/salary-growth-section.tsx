'use client';

import { useState } from 'react';

import { markPlanDraftChanged } from '../../navigation';
import { salaryGrowthBps, updateSalaryGrowth } from '../career-mutations';
import type { SectionProps } from '../types';

export function SalaryGrowthSection({ plan, copy, onChange }: SectionProps) {
  const [value, setValue] = useState(String(salaryGrowthBps(plan) / 100));
  const [error, setError] = useState(false);
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !value.trim() ||
          !Number.isFinite(Number(value)) ||
          Number(value) < -99 ||
          Number(value) > 100
        ) {
          setError(true);
          return;
        }
        onChange((p) => updateSalaryGrowth(p, Number(value)));
        setError(false);
      }}
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        {copy.career.growth_hint}
      </p>
      <label className="block max-w-sm text-sm">
        <span className="mb-2 block">{copy.career.growth_label}</span>
        <span className="border-input bg-background focus-within:ring-primary/20 flex h-11 items-center rounded-lg border px-3 focus-within:ring-3">
          <input
            name="growth"
            type="number"
            step="0.1"
            min="-99"
            max="100"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
          />
          <span className="text-muted-foreground">%</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 3].map((v) => (
          <button
            type="button"
            key={v}
            aria-pressed={Number(value) === v}
            onClick={() => {
              if (String(v) !== value) markPlanDraftChanged();
              setValue(String(v));
            }}
            className="border-border hover:bg-muted focus-visible:ring-primary/30 aria-pressed:border-primary aria-pressed:text-primary min-h-10 rounded-md border px-3 text-sm focus-visible:ring-4 focus-visible:outline-none"
          >
            {v}%{v === 0 ? ` · ${copy.career.flat}` : ''}
          </button>
        ))}
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          {copy.career.growth_basis}
        </summary>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          {copy.career.growth_detail}
        </p>
      </details>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {copy.career.growth_error}
        </p>
      )}
      <button
        type="submit"
        className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/30 min-h-11 rounded-lg px-5 text-sm font-medium focus-visible:ring-4 focus-visible:outline-none"
      >
        {copy.editor.save}
      </button>
    </form>
  );
}
