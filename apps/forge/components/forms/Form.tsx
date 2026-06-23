'use client'

import * as React from 'react'
import { useForm, type UseFormProps, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import type { ZodTypeAny } from 'zod'

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
 */
export function useZodForm<T extends ZodTypeAny>(
  schema: T,
  options?: Omit<UseFormProps<z.infer<T>>, 'resolver'>,
): UseFormReturn<z.infer<T>> {
  return useForm<z.infer<T>>({
    ...(options ?? {}),
    resolver: zodResolver(schema),
  })
}

export { Form }