import { LlmProvider } from './LlmProvider';

export interface AgentContext {
  migrationId: string;
  stepNumber: number;
  writeChatMessage: (role: string, content: string, stepNumber?: number) => Promise<string | undefined>;
  upsertChatMessage?: (id: string | null, role: string, content: string, stepNumber?: number) => Promise<string | undefined>;
  logActivity: (type: 'success' | 'error' | 'info' | 'warning', title: string) => Promise<void>;
  getConnector: (type: 'in' | 'out') => Promise<any>;
  getMigrationDetails: () => Promise<any>;
  updateMigrationScopeConfig?: (config: Record<string, any>) => Promise<void>;
  saveResult?: (result: any) => Promise<void>;
  dbPool?: any; // The pg Pool instance, just in case
}

export abstract class AgentBase {
  protected provider: LlmProvider;
  protected context: AgentContext;

  constructor(provider: LlmProvider, context: AgentContext) {
    this.provider = provider;
    this.context = context;
  }

  abstract execute(params: any): Promise<any>;
}
