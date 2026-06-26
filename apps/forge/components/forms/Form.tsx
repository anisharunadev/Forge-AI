'use client'

import * as React from 'react'
import { useForm, type UseFormProps, type UseFormReturn, type FieldValues } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'

import { Form } from '@/components/ui/form'

/**
 * useZodForm — typed wrapper around react-hook-form's `useForm`
 * that wires a zod resolver automatically.
 *
 * Usage:
 *   const schema = z.object({ name: z.string().min(2) })
 *   const form = useZodForm(schema, { defaultValues: { name: '' } })
 *
 * The schema's inferred type is the form's value type, so callers
 * never have to write `z.infer<typeof schema>` manually.
 *
 * Zod 4 / react-hook-form v7 / @hookform/resolvers v5 compatibility:
 *   Zod 4's `ZodType<Output, Input>` defaults to `<unknown, unknown>`,
 *   which doesn't satisfy `react-hook-form`'s `FieldValues` constraint
 *   at the type level. We accept the schema as a Zod 4 `ZodTypeAny`
 *   and bind `T = z.infer<S>` (the Output type) so enums and literals
 *   stay narrow all the way through `form.handleSubmit`'s
 *   SubmitHandler. The previous `ZodType<T, any>` constraint widened
 *   those to `string` because the Input slot defaulted to `unknown`.
 */
export function useZodForm<S extends z.ZodTypeAny, T extends FieldValues>(
  schema: S,
  options?: Omit<UseFormProps<T>, 'resolver'>,
): UseFormReturn<T> {
  return useForm<T>({
    ...(options ?? {}),
    // The v5 zodResolver signature is a discriminated union over
    // Zod 3 and Zod 4 internal types; the cast bridges the v4
    // `ZodType<S>` shape to the union. The runtime schema is
    // identical between Zod 3 and Zod 4, so this is type-only.
    resolver: zodResolver(
      schema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as UseFormProps<T>['resolver'],
  })
}

export { Form }
