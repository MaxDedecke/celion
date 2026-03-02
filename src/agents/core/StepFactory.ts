import { AgentBase, AgentContext } from './AgentBase';
import { LlmProvider } from './LlmProvider';
import { OpenAiProvider } from './OpenAiProvider';
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

export class StepFactory {
  private static provider: LlmProvider = new OpenAiProvider(); // Default provider

  static createAgent(agentName: string, context: AgentContext): AgentBase | null {
    switch (agentName) {
      case 'runCapabilityDiscovery':
        return new CapabilityDiscoveryAgent(this.provider, context);
      case 'runSystemDetection':
        return new SystemDetectionAgent(this.provider, context);
      case 'runAuthFlow':
        return new AuthFlowAgent(this.provider, context);
      case 'runTargetSchema':
        return new TargetDiscoveryAgent(this.provider, context);
      case 'runDataStaging':
        return new DataStagingAgent(this.provider, context);
      case 'runMappingVerification':
        return new MappingVerificationAgent(this.provider, context);
      case 'runQualityEnhancement':
        return new QualityEnhancementAgent(this.provider, context);
      case 'runMappingRules':
        return new MappingRulesAgent(this.provider, context);
      case 'runEnhancementRules':
        return new EnhancementRulesAgent(this.provider, context);
      case 'runDataTransfer':
        return new DataTransferAgent(this.provider, context);
      // Other agents can be added here
      default:
        return null;
    }
  }

  // Method to change the provider if needed (e.g. to Ollama)
  static setProvider(provider: LlmProvider) {
    this.provider = provider;
  }
}
