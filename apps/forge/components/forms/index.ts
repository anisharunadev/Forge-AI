/**
 * Form primitives barrel.
 *
 * Wraps react-hook-form + zod + the shadcn form.tsx primitives behind
 * a single import path so consumers don't reach into ui/form directly.
 *
 *   import { Form, FormField, FormItem, FormLabel,
 *            FormControl, FormDescription, FormMessage,
 *            useZodForm } from '@/components/forms'
 */
export { Form, useZodForm } from './Form'
export { FormField } from './FormField'
export { FormItem } from './FormItem'
export { FormLabel } from './FormLabel'
export { FormControl } from './FormControl'
export { FormDescription } from './FormDescription'
export { FormMessage } from './FormMessage'