'use client'

/**
 * FormField — re-export of the shadcn form.tsx FormField primitive.
 *
 * Lives at `@/components/forms` so consumers don't reach into
 * `@/components/ui/form`. The shadcn primitive is itself a thin
 * Controller wrapper that injects the field context.
 */
export { FormField } from '@/components/ui/form'
export type {
  ControllerProps as FormFieldProps,
} from 'react-hook-form'