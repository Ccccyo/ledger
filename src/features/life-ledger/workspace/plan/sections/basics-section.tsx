'use client';

import { useState } from 'react';

import { updateAges } from '../plan-mutations';
import type { SectionProps } from '../types';

export function BasicsSection({ plan, copy, onChange }: SectionProps) {
  const birth = plan.members.find(
    (m) => m.id === plan.primaryMemberId
  )?.birthMonth;
  const age =
    birth === undefined ? 30 : Math.floor((plan.baseMonth - birth) / 12);
  const values = [
    age,
    age + Math.floor((plan.retirementMonth - plan.baseMonth) / 12),
    age + Math.floor((plan.endMonthExclusive - plan.baseMonth) / 12),
  ];
  const [error, setError] = useState(false);
  return (
    <form
      key={values.join('-')}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const ages = ['age', 'retire', 'end'].map((key) =>
          Number(data.get(key))
        );
        if (
          ages.some((n) => !Number.isInteger(n)) ||
          ages[0] < 18 ||
          ages[0] > 75 ||
          ages[1] <= ages[0] ||
          ages[1] > 80 ||
          ages[2] <= ages[1] ||
          ages[2] > 120
        ) {
          setError(true);
          return;
        }
        setError(false);
        onChange((current) => updateAges(current, ages[0], ages[1], ages[2]));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {['age', 'retire', 'end'].map((name, index) => (
          <label key={name} className="grid gap-2 text-sm">
            {
              [
                copy.plan.current_age,
                copy.plan.retirement_age,
                copy.plan.end_age,
              ][index]
            }
            <input
              name={name}
              type="number"
              required
              min={18}
              max={120}
              step={1}
              defaultValue={values[index]}
              className="border-input bg-background focus-visible:ring-primary/30 h-11 w-full rounded-lg border px-3 tabular-nums focus-visible:ring-4 focus-visible:outline-none"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {copy.editor.age_error}
        </p>
      )}
      <button className="bg-primary text-primary-foreground mt-4 min-h-11 rounded-lg px-4 text-sm font-medium">
        {copy.editor.save_time}
      </button>
    </form>
  );
}
