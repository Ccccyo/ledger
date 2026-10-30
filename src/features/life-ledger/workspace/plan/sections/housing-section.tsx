'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { cn } from '@/shared/lib/utils';

import { requestPlanNavigation } from '../../navigation';
import { HousingCalculator } from '../housing-calculator';
import { RelocationEditor } from '../relocation-editor';
import { StageEditor } from '../stage-editor';
import type { SectionProps } from '../types';

export function HousingSection(props: SectionProps) {
  const search = useSearchParams();
  const requestedMode = search.get('housing');
  const [mode, setMode] = useState<'flows' | 'purchase' | 'relocation'>(
    requestedMode === 'relocation' ? 'relocation' : 'flows'
  );
  const focusId = search.get('relocation') ?? undefined;
  return (
    <div className="space-y-5">
      <div
        role="tablist"
        className="bg-muted/55 grid grid-cols-3 gap-1 rounded-xl p-1"
        aria-label={props.copy.housing.kind}
      >
        {(['flows', 'purchase', 'relocation'] as const).map(
          (value, index, values) => (
            <button
              type="button"
              key={value}
              role="tab"
              id={`housing-tab-${value}`}
              aria-controls="housing-content"
              aria-selected={mode === value}
              tabIndex={mode === value ? 0 : -1}
              className={cn(
                'focus-visible:ring-primary/30 min-h-10 rounded-lg px-2 text-sm transition-colors focus-visible:ring-4 focus-visible:outline-none motion-reduce:transition-none',
                mode === value
                  ? 'bg-background text-primary font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-background/65 hover:text-foreground'
              )}
              onClick={() => {
                if (requestPlanNavigation()) setMode(value);
              }}
              onKeyDown={(event) => {
                if (
                  !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                    event.key
                  )
                ) {
                  return;
                }
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? values.length - 1
                      : (index +
                          (event.key === 'ArrowRight'
                            ? 1
                            : values.length - 1)) %
                        values.length;
                if (values[next] !== mode && !requestPlanNavigation()) return;
                setMode(values[next]);
                document.getElementById(`housing-tab-${values[next]}`)?.focus();
              }}
            >
              {props.copy.housing[value]}
            </button>
          )
        )}
      </div>
      <div
        id="housing-content"
        role="tabpanel"
        aria-labelledby={`housing-tab-${mode}`}
      >
        {mode === 'flows' ? (
          <StageEditor {...props} stage="housing" />
        ) : mode === 'purchase' ? (
          <HousingCalculator {...props} />
        ) : (
          <RelocationEditor
            key={focusId ?? 'relocation'}
            {...props}
            focusId={focusId}
          />
        )}
      </div>
    </div>
  );
}
