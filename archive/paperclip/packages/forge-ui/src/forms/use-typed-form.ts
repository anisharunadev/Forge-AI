import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

/**
 * useTypedForm<T> — Plan 4 §4 typed wrapper around RHF that wires the Zod
 * resolver. The single place validation lives in Forge UI; ad-hoc `if (valid)`
 * checks in component code are forbidden.
 *
 * Usage:
 *   const form = useTypedForm(mySchema, { title: "" });
 *   form.register("title");
 *   form.handleSubmit((values) => mutate(values));
 */
export function useTypedForm<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  defaultValues: z.input<TSchema>,
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as never,
    mode: "onTouched",
  });
}
