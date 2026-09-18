import type { ReactNode } from 'react'

/** Scroll container + consistent table chrome. Each table gets its own overflow-x. */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="data-table w-full min-w-[640px] border-collapse text-left text-13">{children}</table>
    </div>
  )
}
