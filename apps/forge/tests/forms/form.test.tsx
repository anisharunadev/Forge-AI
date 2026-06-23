import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@/components/forms'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const schema = z.object({
  name: z.string().min(2, 'Too short'),
})

type Schema = z.infer<typeof schema>

function DemoForm({ onSubmit }: { onSubmit?: (v: Schema) => void }) {
  const form = useZodForm(schema, {
    defaultValues: { name: '' },
  })
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => onSubmit?.(v))}
        data-testid="demo-form"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="Your name"
                  data-testid="name-input"
                  {...field}
                />
              </FormControl>
              <FormMessage data-testid="name-message" />
            </FormItem>
          )}
        />
        <Button type="submit" data-testid="submit-button">
          Submit
        </Button>
      </form>
    </Form>
  )
}

describe('useZodForm + Form primitives', () => {
  it('shows the schema error message when value is too short', async () => {
    render(<DemoForm />)
    fireEvent.click(screen.getByTestId('submit-button'))
    // Allow RHF to run validation and re-render
    const message = await screen.findByText('Too short')
    expect(message).toBeTruthy()
  })

  it('does not show an error when a valid value is submitted', () => {
    render(<DemoForm />)
    const input = screen.getByTestId('name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Alice' } })
    fireEvent.click(screen.getByTestId('submit-button'))
    expect(screen.queryByText('Too short')).toBeNull()
  })

  it('calls the submit handler with parsed values when valid', async () => {
    let captured: Schema | null = null
    render(<DemoForm onSubmit={(v) => (captured = v)} />)
    const input = screen.getByTestId('name-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-button'))
    })
    expect(captured).toEqual({ name: 'Alice' })
  })
})