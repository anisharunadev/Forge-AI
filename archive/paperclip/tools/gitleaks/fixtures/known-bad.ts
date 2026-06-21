// tools/gitleaks/fixtures/known-bad.ts
// KNOWN-BAD fixture. This file is INTENTIONALLY populated with
// high-entropy strings that look like real secrets. The gitleaks
// rule set in `.gitleaks.toml` is allowlisted to include this
// file's path (`tools/gitleaks/fixtures/.*`) ONLY for the
// regression test — gitleaks ignores it in production scans but
// the regression test (`tools/gitleaks/gitleaks-fixture.test.mjs`)
// runs gitleaks against this file directly and asserts the
// violations are caught.
//
// DO NOT add REAL secrets here. Use only the well-known
// placeholder tokens from the gitleaks test corpus.
//
// The strings below are the published test fixtures from
// https://github.com/gitleaks/gitleaks/tree/master/testdata — they
// are NOT real credentials.

export const KNOWN_BAD_FIXTURE = {
  // GitHub PAT (fora's github-pat rule)
  github_pat: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",

  // AWS access key (fora's aws-access-key rule)
  aws_access_key: "AKIAIOSFODNN7EXAMPLE",

  // AWS session token
  aws_session_token: "ASIAIOSFODNN7EXAMPLE",

  // Anthropic API key (fora's anthropic-api-key rule)
  anthropic_key: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ",

  // OpenAI API key (fora's openai-api-key rule)
  openai_key: "sk-1234567890abcdefghijklmnopqrstuvwxyzT3BlbkFJABCDEFGHIJKLMNOPQRSTUVWXYZ",

  // Slack bot token
  slack_token: "xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx",

  // Stripe live key
  stripe_live: "sk_live_4eC39HqLyjWDarjtT1zdp7dc",

  // Vault service token
  vault_token: "hvs.CAESIAGHided_actual_value_with_60_chars_or_more_padding_here",

  // PEM private key header
  private_key: "-----BEGIN RSA PRIVATE KEY-----",
};
