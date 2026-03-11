import { AgentBase, AgentContext } from './AgentBase';
import { LlmProvider } from './LlmProvider';
import { OpenAiProvider } from './OpenAiProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleGeminiProvider } from './GoogleGeminiProvider';
import { Pool } from 'pg';
import { CapabilityDiscoveryAgent } from '../discovery/CapabilityDiscoveryAgent';
import { SystemDetectionAgent } from '../systemDetection/SystemDetectionAgent';
import { AuthFlowAgent } from '../authFlow/AuthFlowAgent';
import { TargetDiscoveryAgent } from '../targetDiscovery/TargetDiscoveryAgent';
import { DataStagingAgent } from '../dataStaging/DataStagingAgent';
import { MappingVerificationAgent } from '../mapping/MappingVerificationAgent';
import { QualityEnhancementAgent } from '../enhancement/QualityEnhancementAgent';
import { MappingRulesAgent } from '../mapping/MappingRulesAgent';
import { EnhancementRulesAgent } from '../enhancement/EnhancementRulesAgent';
import { DataTransferAgent } from '../dataTransfer/DataTransferAgent';
import { VerificationAgent } from '../verification/VerificationAgent';
import { FailureAnalysisAgent } from '../failureAnalysis/FailureAnalysisAgent';

export class StepFactory {
  private static provider: LlmProvider | null = null;

  static async getProvider(dbPool?: Pool): Promise<LlmProvider> {
    if (this.provider) return this.provider;

    // Default to OpenAI
    let selectedProvider: LlmProvider = new OpenAiProvider();

    if (dbPool) {
      try {
        const { rows } = await dbPool.query("SELECT provider FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1");
        if (rows.length > 0) {
          const settings = rows[0];
          if (settings.provider === 'openai' || settings.provider === 'ollama' || settings.provider === 'custom') {
            selectedProvider = new OpenAiProvider();
          } else if (settings.provider === 'anthropic') {
            selectedProvider = new AnthropicProvider();
          } else if (settings.provider === 'google' || settings.provider === 'gemini') {
            selectedProvider = new GoogleGeminiProvider();
          }
        }
      } catch (e) {
        console.error("Failed to load LLM settings from DB:", e);
      }
    }

    this.provider = selectedProvider;
    return this.provider;
  }

  static async createAgent(agentName: string, context: AgentContext): Promise<AgentBase | null> {
    const provider = await this.getProvider(context.dbPool);

    switch (agentName) {
      case 'runCapabilityDiscovery':
        return new CapabilityDiscoveryAgent(provider, context);
      case 'runSystemDetection':
        return new SystemDetectionAgent(provider, context);
      case 'runAuthFlow':
        return new AuthFlowAgent(provider, context);
      case 'runTargetSchema':
        return new TargetDiscoveryAgent(provider, context);
      case 'runDataStaging':
        return new DataStagingAgent(provider, context);
      case 'runMappingVerification':
        return new MappingVerificationAgent(provider, context);
      case 'runQualityEnhancement':
        return new QualityEnhancementAgent(provider, context);
      case 'runMappingRules':
        return new MappingRulesAgent(provider, context);
      case 'runEnhancementRules':
        return new EnhancementRulesAgent(provider, context);
      case 'runDataTransfer':
        return new DataTransferAgent(provider, context);
      case 'runVerification':
        return new VerificationAgent(provider, context);
      case 'runFailureAnalysis':
        return new FailureAnalysisAgent(provider, context);
      default:
        return null;
    }
  }

  static setProvider(provider: LlmProvider) {
    this.provider = provider;
  }
}

