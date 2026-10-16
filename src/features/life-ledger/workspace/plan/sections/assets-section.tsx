import { basisPoints, yuan } from '../../../domain';
import { moneyFormatter, NumberField } from '../fields';
import type { SectionProps } from '../types';

export function AssetsSection({ plan, locale, copy, onChange }: SectionProps) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{copy.editor.assets_hint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {plan.assets
          .filter((asset) => !asset.purchase)
          .map((asset) => (
            <NumberField
              key={asset.id}
              label={`${asset.name} · ${asset.liquid ? copy.editor.liquid : copy.editor.non_liquid}`}
              value={asset.openingBalanceCents / 1_000_000}
              unit={copy.editor.wan}
              step="0.01"
              onCommit={(value: number) =>
                onChange((current) => ({
                  ...current,
                  assets: current.assets.map((a) =>
                    a.id === asset.id
                      ? { ...a, openingBalanceCents: yuan(value * 10_000) }
                      : a
                  ),
                }))
              }
            />
          ))}
      </div>
      {plan.assets.length === 0 && (
        <button
          type="button"
          className="border-border hover:bg-muted min-h-11 rounded-lg border px-4 text-sm"
          onClick={() =>
            onChange((current) => ({
              ...current,
              assets: [
                ...current.assets,
                {
                  id: `${current.id}:opening-cash`,
                  name: copy.plan.available_cash,
                  ownerId: current.primaryMemberId,
                  kind: 'cash',
                  liquid: true,
                  openingBalanceCents: yuan(0),
                  annualReturnBps: basisPoints(0),
                  source: { kind: 'user', label: copy.editor.user },
                  confirmation: 'confirmed',
                },
              ],
            }))
          }
        >
          {copy.editor.add_cash}
        </button>
      )}
      {plan.liabilities.some((item) => !item.originatesAtStart) && (
        <div className="border-border border-t pt-4">
          <p className="mb-2 text-sm font-medium">{copy.editor.debts}</p>
          {plan.liabilities
            .filter((item) => !item.originatesAtStart)
            .map((item) => (
              <p key={item.id} className="text-muted-foreground text-sm">
                {item.name} ·{' '}
                {moneyFormatter(locale)(item.openingPrincipalCents)}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
