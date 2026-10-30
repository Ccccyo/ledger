'use client';

import { useState } from 'react';

import { addMonths, formatMonth, monthIndex } from '../../../domain';
import { markPlanDraftChanged } from '../../navigation';
import {
  salaryGrowthBps,
  salaryGrowthPeriod,
  updateSalaryGrowth,
} from '../career-mutations';
import type { SectionProps } from '../types';

export function SalaryGrowthSection({ plan, copy, onChange }: SectionProps) {
  const period = salaryGrowthPeriod(plan);
  const [value, setValue] = useState(String(salaryGrowthBps(plan) / 100));
  const [start, setStart] = useState(formatMonth(period.start));
  const [end, setEnd] = useState(formatMonth(addMonths(period.end, -1)));
  const [error, setError] = useState(false);
  const parseMonth = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    return monthIndex(year, month);
  };
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
        try {
          onChange((p) =>
            updateSalaryGrowth(
              p,
              Number(value),
              parseMonth(start),
              addMonths(parseMonth(end), 1)
            )
          );
          setError(false);
        } catch {
          setError(true);
        }
      }}
    >
      <p className="text-muted-foreground text-sm leading-relaxed">
        {copy.career.growth_hint}
      </p>
      <div className="grid max-w-sm gap-2">
        <label className="block text-sm">
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
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={copy.career.growth_label}
        >
          {[0, 1, 3].map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={Number(value) === v}
              onClick={() => {
                if (String(v) !== value) markPlanDraftChanged();
                setValue(String(v));
              }}
              className="border-border hover:bg-muted focus-visible:ring-primary/30 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:text-primary inline-flex min-h-11 min-w-16 flex-col items-center justify-center rounded-lg border px-3 py-1 text-sm leading-tight focus-visible:ring-4 focus-visible:outline-none"
            >
              <span className="font-medium tabular-nums">{v}%</span>
              {v === 0 && (
                <span className="text-muted-foreground mt-0.5 text-[11px] font-normal">
                  {copy.career.flat}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="grid max-w-xl min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] [&>label]:min-w-0">
        <label className="min-w-0 text-sm">
          <span className="mb-2 block">{copy.career.growth_start}</span>
          <input
            type="month"
            value={start}
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(addMonths(plan.retirementMonth, -1))}
            onChange={(event) => setStart(event.target.value)}
            className="border-input bg-background focus-visible:ring-primary/20 h-11 w-full rounded-lg border px-3 focus-visible:ring-3 focus-visible:outline-none"
          />
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-2 block">{copy.career.growth_end}</span>
          <input
            type="month"
            value={end}
            min={formatMonth(plan.baseMonth)}
            max={formatMonth(addMonths(plan.retirementMonth, -1))}
            onChange={(event) => setEnd(event.target.value)}
            className="border-input bg-background focus-visible:ring-primary/20 h-11 w-full rounded-lg border px-3 focus-visible:ring-3 focus-visible:outline-none"
          />
        </label>
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
          {copy.career.growth_range_error}
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
