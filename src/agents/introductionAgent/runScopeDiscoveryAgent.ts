import { Message } from '../openai/types';
import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';

export async function* runScopeDiscoveryAgent(
  userMessage: string,
  context: {
    history: { role: string; content: string }[];
    migrationId: string;
    sourceSystem: string;
    dataSourceId: string;
    querySourceScopes: (params: { search_term?: string, entity_type?: string }) => Promise<any[]>;
    onboardingState: any;
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, model } = await resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey);

  const systemPrompt = `Du bist der Celion Scope Discovery Agent. Deine Aufgabe ist es, dem Benutzer dabei zu helfen, den richtigen Bereich (Scope) für die Migration aus dem Quellsystem "${context.sourceSystem}" auszuwählen.

VERHALTENSREGELN:
1. Sei hilfsbereit und beratend.
2. Nutze das Tool "query_source_scopes", um verfügbare Bereiche (wie Projekte, Datenbanken, Spaces) abzufragen.
3. Wenn der Benutzer nach etwas Bestimmtem sucht, nutze den "search_term" Parameter.
4. Bei Notion kannst du zwischen "pages" und "databases" unterscheiden.
5. Wenn du mehrere Optionen (Scopes) gefunden hast, präsentiere sie dem Benutzer als JSON-Dropdown, damit er sie direkt auswählen kann.

FORMAT FÜR DROPDOWN:
Gib einen JSON-String aus, der so aussieht (KEIN Markdown-Code-Block, nur der pure String):
{"type": "scope_dropdown", "label": "Welchen Bereich möchtest du migrieren?", "options": [{"id": "ID1", "label": "Name 1"}, {"id": "ID2", "label": "Name 2"}]}

WICHTIG:
- Wenn der Benutzer eine Auswahl getroffen hat (oft erkennbar an einer ID wie [ID:xxx]), bestätige dies und rufe das Tool "SET_SCOPE_AND_CONTINUE" auf.
- Falls die Nachricht "INIT_SEARCH" lautet, beginne sofort mit einer allgemeinen Suche (ohne Suchbegriff), um dem Benutzer erste Optionen zu zeigen.
- Wenn der Benutzer sich entschieden hat, MUSST du "AUSGABE_TOOL_CALL:SET_SCOPE_AND_CONTINUE:{"scope": "NAME", "scopeIds": ["ID"]}" ausgeben.
`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...context.history.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  const tools = [
    {
      type: 'function',
      function: {
        name: 'query_source_scopes',
        description: 'Fragt verfügbare Bereiche (Projekte, Datenbanken, etc.) vom Quellsystem ab.',
        parameters: {
          type: 'object',
          properties: {
            search_term: { type: 'string', description: 'Optionaler Suchbegriff' },
            entity_type: { type: 'string', description: 'Optionaler Typ der Entität (z.B. "page" oder "database" bei Notion)' }
          }
        }
      }
    },
    {
        type: 'function',
        function: {
          name: 'SET_SCOPE_AND_CONTINUE',
          description: 'Setzt den gewählten Bereich und fährt mit dem nächsten Onboarding-Schritt fort.',
          parameters: {
            type: 'object',
            properties: {
              scope: { type: 'string', description: 'Name des gewählten Bereichs' },
              scopeIds: { type: 'array', items: { type: 'string' }, description: 'Liste der IDs der gewählten Bereiche' }
            },
            required: ['scope', 'scopeIds']
          }
        }
      }
  ];

  while (true) {
    console.log(`[ScopeDiscoveryAgent] Calling OpenAI with model ${model}...`);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        tools
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ScopeDiscoveryAgent] OpenAI Error: ${response.status}`, errorText);
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    messages.push(message);

    if (message.content) {
      console.log(`[ScopeDiscoveryAgent] Assistant response: ${message.content.substring(0, 50)}...`);
      yield {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message.content }]
      };
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let result: any;

        console.log(`[ScopeDiscoveryAgent] Tool call: ${functionName}`, args);

        if (functionName === 'query_source_scopes') {
            yield { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Suche nach Bereichen in ${context.sourceSystem}...` }] };
            try {
                result = await context.querySourceScopes(args);
                console.log(`[ScopeDiscoveryAgent] Found ${result.length} scopes.`);
            } catch (e: any) {
                console.error(`[ScopeDiscoveryAgent] query_source_scopes failed:`, e);
                result = { error: e.message };
            }
        } else if (functionName === 'SET_SCOPE_AND_CONTINUE') {
            const output = `AUSGABE_TOOL_CALL:SET_SCOPE_AND_CONTINUE:${JSON.stringify(args)}`;
            yield { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: output }] };
            return; // Exit the loop and agent
        } else {
            result = { error: `Unknown tool: ${functionName}` };
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: JSON.stringify(result)
        });
      }
    } else {
      break;
    }
  }
}
