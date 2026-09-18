import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4 nav:flex-row nav:items-start nav:justify-between">
      <div>
        <h1 className="text-20 font-semibold text-balance text-text">{title}</h1>
        <p className="mt-1 text-13 text-muted">{description}</p>
      </div>
      {action}
    </div>
  )
}
