export interface MetricItem {
  label: string
  value: string
}

/** One thin strip of label/value pairs, separated by a vertical divider. Not card tiles. */
export function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="flex flex-col divide-y divide-line rounded border border-line bg-surface sm:flex-row sm:flex-wrap sm:divide-x sm:divide-y-0">
      {items.map((item) => (
        // min-width leaves room for the longest translated label/value pair
        // (e.g. "6 ngày 4 giờ") without the value wrapping under its label.
        <div key={item.label} className="flex min-w-[10.5rem] flex-1 flex-col gap-1 px-4 py-3">
          <span className="text-12 text-muted">{item.label}</span>
          <span className="text-20 font-medium tabular-nums text-text">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
