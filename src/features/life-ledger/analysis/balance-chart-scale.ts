/** Presentation only: cents stay unchanged; rounded bounds never clip data. */
export function balanceChartScale(values: number[]) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (low === high) {
    return {
      domain: [-1_000_000, 1_000_000] as [number, number],
      ticks: [-1_000_000, 0, 1_000_000],
    };
  }
  const roughStep = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step =
    ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= roughStep) ?? 10) *
    magnitude;
  const lower = Math.floor(low / step) * step;
  const upper = Math.ceil(high / step) * step;
  const count = Math.round((upper - lower) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => lower + i * step);
  return { domain: [lower, upper] as [number, number], ticks };
}

/** SVG area bounds include the zero baseline, not the optional comparison. */
export function balanceZeroOffset(values: number[]) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  return low === high ? 1 : high / (high - low);
}

/** Keep the endpoints and familiar decade ages, without crowding short plans. */
export function balanceAgeTicks(
  rows: { year: number; ageEnd: number | null }[]
) {
  if (!rows.length) return [];
  const first = rows[0];
  const last = rows.at(-1)!;
  const interval = rows.length > 80 ? 20 : rows.length > 30 ? 10 : 5;
  return [
    ...new Set([
      first.year,
      ...rows
        .filter(
          (r) =>
            (r.ageEnd ?? r.year) % interval === 0 &&
            r.year - first.year >= interval / 2 &&
            last.year - r.year >= interval / 2
        )
        .map((r) => r.year),
      last.year,
    ]),
  ];
}
