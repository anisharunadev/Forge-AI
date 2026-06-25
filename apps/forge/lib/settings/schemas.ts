/**
 * Settings — zod schemas for the Settings page forms.
 *
 * Single source of truth for client-side validation. Each schema's
 * inferred type is exported alongside it so form code can use
 * `useZodForm(schema, { defaultValues })` without `z.infer<typeof …>`
 * noise.
 *
 * Server-side validation is the Pydantic schema's job (lib/types.ts
 * is the TS projection of those). These zod schemas mirror the
 * Pydantic constraints where they overlap; the server is always
 * authoritative.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Project (General tab)
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export const projectUpdateSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must be 255 characters or fewer'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(64, 'Slug must be 64 characters or fewer')
    .regex(SLUG_RE, 'Slug must be lowercase letters, digits, and hyphens'),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer')
    .optional()
    .or(z.literal('')),
  defaultBranch: z
    .string()
    .min(1, 'Default branch is required')
    .max(128, 'Branch name must be 128 characters or fewer')
    .regex(
      /^[A-Za-z0-9._/-]+$/,
      'Branch name may only contain letters, digits, dots, hyphens, underscores, and slashes',
    ),
  visibility: z.enum(['private', 'internal', 'public']),
});

export type ProjectUpdateForm = z.infer<typeof projectUpdateSchema>;

// ---------------------------------------------------------------------------
// Members (Members tab)
// ---------------------------------------------------------------------------

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Must be a valid email address')
    .max(320, 'Email is too long'),
  roleId: z
    .string()
    .min(1, 'Role is required'),
});

export type InviteMemberForm = z.infer<typeof inviteMemberSchema>;

// ---------------------------------------------------------------------------
// Environment variables (Env Vars tab)
// ---------------------------------------------------------------------------

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,126}[A-Z0-9]$/;

export const envVarCreateSchema = z.object({
  key: z
    .string()
    .min(2, 'Key must be at least 2 characters')
    .max(128, 'Key must be 128 characters or fewer')
    .regex(
      ENV_KEY_RE,
      'Key must be uppercase letters, digits, and underscores (start with a letter)',
    ),
  value: z
    .string()
    .min(1, 'Value is required')
    .max(8192, 'Value must be 8 KB or smaller'),
  scope: z.enum(['workflow', 'agent', 'all']),
});

export type EnvVarCreateForm = z.infer<typeof envVarCreateSchema>;

export const envVarUpdateSchema = z.object({
  value: z
    .string()
    .min(1, 'Value is required')
    .max(8192, 'Value must be 8 KB or smaller'),
});

export type EnvVarUpdateForm = z.infer<typeof envVarUpdateSchema>;

// ---------------------------------------------------------------------------
// Model providers (Providers tab)
// ---------------------------------------------------------------------------

export const providerCreateSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(128, 'Name must be 128 characters or fewer'),
  type: z.enum(['anthropic', 'openai', 'google', 'bedrock', 'azure_openai', 'custom']),
  config: z
    .string()
    .min(2, 'Config is required')
    .refine(
      (raw) => {
        try {
          JSON.parse(raw);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Config must be valid JSON' },
    ),
  litellmModelAlias: z
    .string()
    .max(128, 'Alias must be 128 characters or fewer')
    .optional()
    .or(z.literal('')),
  rateLimitRpm: z
    .number()
    .int('RPM must be a whole number')
    .positive('RPM must be positive')
    .optional()
    .or(z.literal(0)),
  rateLimitTpm: z
    .number()
    .int('TPM must be a whole number')
    .positive('TPM must be positive')
    .optional()
    .or(z.literal(0)),
});

export type ProviderCreateForm = z.infer<typeof providerCreateSchema>;

// ---------------------------------------------------------------------------
// Agent configuration (Agents tab)
// ---------------------------------------------------------------------------

export const agentConfigSchema = z.object({
  systemPrompt: z
    .string()
    .max(32_000, 'System prompt must be 32 KB or smaller')
    .optional()
    .or(z.literal('')),
  temperature: z
    .number()
    .min(0, 'Temperature cannot be negative')
    .max(2, 'Temperature cannot exceed 2')
    .optional()
    .or(z.literal(0)),
  maxTokens: z
    .number()
    .int('Max tokens must be a whole number')
    .positive('Max tokens must be positive')
    .optional()
    .or(z.literal(0)),
  modelProviderId: z
    .string()
    .optional()
    .or(z.literal('')),
  modelAlias: z
    .string()
    .max(128, 'Alias must be 128 characters or fewer')
    .optional()
    .or(z.literal('')),
});

export type AgentConfigForm = z.infer<typeof agentConfigSchema>;
