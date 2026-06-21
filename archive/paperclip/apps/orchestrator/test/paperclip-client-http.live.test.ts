/**
 * Live integration test for the Paperclip HTTP adapter (FORA-177).
 *
 * Runs only when `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY` are set.
 * Exercises the adapter against a real Paperclip API instance.
 */

import { describe, it, expect } from 'vitest';
import { PaperclipHttpClient } from '../src/paperclip-client-http.js';
import type { PaperclipInteraction } from '../src/router-types.js';

const API_URL = process.env['PAPERCLIP_API_URL'];
const API_KEY = process.env['PAPERCLIP_API_KEY'];
const RUN_ID = process.env['PAPERCLIP_RUN_ID'] ?? 'run-live-test';
const ISSUE_ID = process.env['PAPERCLIP_TASK_ID']; // Current issue

const skip = !API_URL || !API_KEY || !ISSUE_ID;

describe.skipIf(skip)('PaperclipHttpClient — live API', () => {
  const client = new PaperclipHttpClient({
    apiUrl: API_URL!,
    apiKey: API_KEY!,
    runId: RUN_ID,
  });

  it('successfully creates an interaction on the current issue', async () => {
    // We need a real revisionId if we use type: issue_document.
    // In a real run, the router fetches the latest plan first.
    // Here we use a dummy one if we can't find it, but we just created one.
    const revisionId = 'ddd18d85-a6a0-4056-8762-d423773fabb5';

    const idempotencyKey = `live-test:${RUN_ID}:${Date.now()}`;
    const interaction: PaperclipInteraction = {
      kind: 'request_confirmation',
      idempotencyKey,
      targetIssueId: ISSUE_ID!,
      target: {
        type: 'issue_document',
        issueId: ISSUE_ID!,
        key: 'plan',
        revisionId,
      },
      continuationPolicy: 'wake_assignee',
      payload: {
        title: 'Live Integration Test (FORA-177)',
        prompt: 'This is a test interaction created by the Orchestrator adapter live test.',
        role: 'cto',
        artefactRefs: [],
        ttlSeconds: 60,
      },
    };

    const out = await client.issue({
      issueId: ISSUE_ID!,
      interaction,
    });

    expect(out.interactionId).toBeDefined();
    expect(typeof out.interactionId).toBe('string');
    // eslint-disable-next-line no-console
    console.log(`Created live interaction: ${out.interactionId}`);
  }, 15_000);
});
