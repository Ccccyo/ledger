'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

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
        className="border-border flex gap-4 border-b"
        aria-label={props.copy.housing.kind}
      >
        {(['flows', 'purchase', 'relocation'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            className={`min-h-11 border-b-2 px-1 text-sm ${mode === value ? 'border-primary font-semibold' : 'text-muted-foreground border-transparent'}`}
            onClick={() => {
              if (requestPlanNavigation()) setMode(value);
            }}
          >
            {props.copy.housing[value]}
          </button>
        ))}
      </div>
      {mode === 'flows' ? (
        <StageEditor {...props} stage="housing" />
      ) : mode === 'purchase' ? (
        <HousingCalculator {...props} />
      ) : (
        <RelocationEditor key={focusId ?? 'relocation'} {...props} focusId={focusId} />
      )}
    </div>
  );
}
