import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Search } from 'lucide-react'

import { EmptyState } from '@/components/data/EmptyState'
import { Button } from '@/components/ui/button'

describe('<EmptyState>', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="No results"
        description="Try a different query"
      />,
    )
    expect(screen.getByText('No results')).toBeTruthy()
    expect(screen.getByText('Try a different query')).toBeTruthy()
    expect(screen.getByTestId('empty-state')).toBeTruthy()
  })

  it('renders the icon when provided', () => {
    const { container } = render(
      <EmptyState
        icon={Search}
        title="Search empty"
        description="No matches"
      />,
    )
    // lucide-react renders an inline SVG
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders the action slot when provided', () => {
    render(
      <EmptyState
        title="Failed"
        description="Try again"
        action={<Button>Retry</Button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})