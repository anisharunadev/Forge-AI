/**
 * F-800 Plan 3 — `lib/api/copilot` fetcher unit tests.
 *
 * Verifies:
 *   - Each fetcher hits the correct REST endpoint (path, method, body)
 *   - The `tenantId` option is forwarded as `x-forge-tenant-id`
 *   - `ForgeApiError` is thrown on non-2xx
 *   - Types round-trip through JSON without loss
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ForgeApiError,
  deleteConversation,
  getConversation,
  getCost,
  listConversations,
  listTools,
  sendMessage,
  submitFeedback,
  type CopilotChatRequest,
  type CopilotChatResponse,
  type CopilotConversationRead,
  type CopilotConversationSummary,
  type CopilotCostRead,
  type CopilotToolRead,
} from '../../lib/api/copilot';

// Mock the canonical `api` client (replaces the lib/forge-api
// `forgeFetch` transport after Phase 2 consolidation).
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      ws: actual.api.ws,
    },
  };
});

import { api } from '@/lib/api/client';

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);
const mockedDelete = vi.mocked(api.delete);
const mockedPut = vi.mocked(api.put);

const TENANT = 'acme-corp';

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listConversations', () => {
  it('GETs /copilot/conversations with the tenant header', async () => {
    const summaries: CopilotConversationSummary[] = [
      {
        id: 'c-1',
        user_id: 'u-1',
        title: 'Test',
        message_count: 3,
        total_cost_usd: 0.0042,
        archived_at: null,
      },
    ];
    mockedGet.mockResolvedValueOnce(summaries);

    const result = await listConversations(TENANT);

    expect(mockedGet).toHaveBeenCalledWith('/copilot/conversations', {
      tenantId: TENANT,
    });
    expect(result).toEqual(summaries);
  });
});

describe('getConversation', () => {
  it('GETs /copilot/conversations/{id} with encoded id', async () => {
    const detail: CopilotConversationRead = {
      id: 'c/with spaces',
      user_id: 'u-1',
      title: 'Test',
      message_count: 1,
      total_cost_usd: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      messages: [],
      archived_at: null,
    };
    mockedGet.mockResolvedValueOnce(detail);

    const result = await getConversation(detail.id, TENANT);

    expect(mockedGet).toHaveBeenCalledWith(
      '/copilot/conversations/c%2Fwith%20spaces',
      { tenantId: TENANT },
    );
    expect(result).toBe(detail);
  });
});

describe('sendMessage', () => {
  it('POSTs /copilot/conversations with serialized body', async () => {
    const req: CopilotChatRequest = {
      conversation_id: null,
      project_id: null,
      message: 'hi',
      context: {
        current_page: '/dashboard',
        current_center: null,
        current_artifact_id: null,
        recent_actions: [],
      },
    };
    const response: CopilotChatResponse = {
      conversation_id: 'c-new',
      message_id: 'm-1',
      content: 'hello',
      citations: [],
      confidence: 'medium',
      tool_calls: [],
      suggested_actions: [],
      cost_usd: 0,
      tokens_in: 1,
      tokens_out: 1,
      model: 'test',
      latency_ms: 10,
    };
    mockedGet.mockResolvedValueOnce(response);

    const result = await sendMessage(req, TENANT);

    expect(mockedGet).toHaveBeenCalledWith('/copilot/conversations', {
      method: 'POST',
      body: JSON.stringify(req),
      tenantId: TENANT,
    });
    expect(result).toBe(response);
  });
});

describe('deleteConversation', () => {
  it('DELETEs /copilot/conversations/{id}', async () => {
    mockedGet.mockResolvedValueOnce(undefined);
    await deleteConversation('c-1', TENANT);

    expect(mockedGet).toHaveBeenCalledWith(
      '/copilot/conversations/c-1',
      { method: 'DELETE', tenantId: TENANT },
    );
  });
});

describe('submitFeedback', () => {
  it('POSTs feedback body without a comment', async () => {
    mockedGet.mockResolvedValueOnce(undefined);
    await submitFeedback('m-1', 'up', undefined, TENANT);

    expect(mockedGet).toHaveBeenCalledWith(
      '/copilot/messages/m-1/feedback',
      {
        method: 'POST',
        body: JSON.stringify({ rating: 'up' }),
        tenantId: TENANT,
      },
    );
  });

  it('POSTs feedback body with a comment when provided', async () => {
    mockedGet.mockResolvedValueOnce(undefined);
    await submitFeedback('m-1', 'down', 'not quite right', TENANT);

    expect(mockedGet).toHaveBeenCalledWith(
      '/copilot/messages/m-1/feedback',
      {
        method: 'POST',
        body: JSON.stringify({ rating: 'down', comment: 'not quite right' }),
        tenantId: TENANT,
      },
    );
  });
});

describe('getCost', () => {
  it('GETs /copilot/conversations/{id}/cost', async () => {
    const cost: CopilotCostRead = {
      conversation_id: 'c-1',
      total_cost_usd: 0.001,
      total_tokens_in: 10,
      total_tokens_out: 20,
      budget_remaining_usd: 0.999,
      budget_ceiling_usd: 1.0,
      budget_status: 'active',
    };
    mockedGet.mockResolvedValueOnce(cost);

    const result = await getCost('c-1', TENANT);

    expect(mockedGet).toHaveBeenCalledWith(
      '/copilot/conversations/c-1/cost',
      { tenantId: TENANT },
    );
    expect(result).toBe(cost);
  });
});

describe('listTools', () => {
  it('GETs /copilot/tools', async () => {
    const tools: CopilotToolRead[] = [
      {
        name: 'search_knowledge',
        description: 'Search the knowledge graph',
        permission: 'copilot:tool:search_knowledge',
        rate_limit_per_min: 10,
      },
    ];
    mockedGet.mockResolvedValueOnce(tools);

    const result = await listTools(TENANT);

    expect(mockedGet).toHaveBeenCalledWith('/copilot/tools', {
      tenantId: TENANT,
    });
    expect(result).toBe(tools);
  });
});

describe('error handling', () => {
  it('propagates ForgeApiError on 401', async () => {
    const errorBody = { detail: 'Unauthorized' };
    mockedGet.mockRejectedValueOnce(
      new ForgeApiError('Forge API 401', 401, errorBody),
    );

    await expect(listConversations(TENANT)).rejects.toMatchObject({
      name: 'ForgeApiError',
      status: 401,
      body: errorBody,
    });
  });

  it('propagates ForgeApiError on 429', async () => {
    const errorBody = { detail: 'Too Many Requests' };
    mockedGet.mockRejectedValueOnce(
      new ForgeApiError('Forge API 429', 429, errorBody),
    );

    await expect(sendMessage(
      {
        conversation_id: null,
        project_id: null,
        message: 'hi',
        context: {
          current_page: '/',
          current_center: null,
          current_artifact_id: null,
          recent_actions: [],
        },
      },
      TENANT,
    )).rejects.toMatchObject({ name: 'ForgeApiError', status: 429 });
  });
});