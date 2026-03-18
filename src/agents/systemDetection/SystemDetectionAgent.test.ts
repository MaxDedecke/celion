import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemDetectionAgent } from './SystemDetectionAgent';
import { LlmProvider, ChatResponse } from '../core/LlmProvider';

describe('SystemDetectionAgent', () => {
  let mockProvider: LlmProvider;
  let mockContext: any;
  let agent: SystemDetectionAgent;

  beforeEach(() => {
    mockProvider = {
      chat: vi.fn(),
    } as any;

    mockContext = {
      writeChatMessage: vi.fn().mockResolvedValue(undefined),
      stepNumber: 1,
    };

    agent = new SystemDetectionAgent(mockProvider, mockContext);
  });

  it('should successfully detect a system', async () => {
    const mockLlmResponse: ChatResponse = {
      content: JSON.stringify({
        systemMatchesUrl: true,
        summary: 'System successfully detected as Notion',
        apiTypeDetected: 'REST',
        apiSubtype: null,
        recommendedBaseUrl: 'https://api.notion.com/v1',
        confidenceScore: 0.95,
        detectionEvidence: { headers: [], status_codes: [], redirects: [], notes: 'Detected via mock' },
        rawOutput: 'Raw mock output'
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    };

    vi.mocked(mockProvider.chat).mockResolvedValueOnce(mockLlmResponse);

    const result = await agent.execute({
      url: 'https://notion.so',
      expectedSystem: 'Notion',
      mode: 'source'
    });

    expect(result.success).toBe(true);
    expect(result.result.systemMatchesUrl).toBe(true);
    expect(result.result.summary).toContain('Notion');
    expect(mockProvider.chat).toHaveBeenCalled();
    expect(mockContext.writeChatMessage).toHaveBeenCalled();
  });

  it('should handle system mismatch', async () => {
    const mockLlmResponse: ChatResponse = {
      content: JSON.stringify({
        systemMatchesUrl: false,
        summary: 'System is NOT Notion',
        confidenceScore: 0.9
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    };

    vi.mocked(mockProvider.chat).mockResolvedValueOnce(mockLlmResponse);

    const result = await agent.execute({
      url: 'https://google.com',
      expectedSystem: 'Notion'
    });

    expect(result.success).toBe(false);
    expect(result.isLogicalFailure).toBe(true);
    expect(result.error).toContain('system detection failed');
  });
});
