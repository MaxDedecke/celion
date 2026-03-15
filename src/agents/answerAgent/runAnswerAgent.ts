import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';
import { Pool } from 'pg';

const SYSTEM_PROMPT = `
Du bist der Celion Migration Consultant. Deine Aufgabe ist es, den User während des Migrationsprozesses zu beraten.

### DEINE RESSOURCEN:
1.  **Migrations-Kontext:** Dir werden (falls vorhanden) die Ergebnisse der bisherigen Schritte zur Verfügung gestellt.
2.  **Ausführungsplan (Execution Plan):** Dir wird der aktuelle Ausführungsplan übergeben, falls einer existiert. Du kannst mit dem User über diesen Plan diskutieren und ihn anpassen.
3.  **Live-Daten (Neo4j):** Du kannst live auf die importierten Daten zugreifen.
4.  **Vektorsuche:** Du kannst eine semantische Suche durchführen.

### DATEN-STRUKTUR IN NEO4J:
- **Labels:** Das Label entspricht meist dem Systemnamen (z.B. ':ClickUp', ':JiraCloud').
- **Properties:** Alle Nodes haben 'migration_id' und 'entity_type'.
- **WICHTIG:** Die 'entity_type' Namen sind oft PLURAL (z.B. 'tasks', 'spaces', 'folders', 'lists').
- **SCHEMA-CHECK:** Falls du unsicher bist, welche entity_types existieren, nutze:
  "MATCH (n {migration_id: $migrationId}) RETURN DISTINCT n.entity_type"

### DEINE TOOLS:
- **query_neo4j:** Führe Cypher-Queries aus. 
  - Nutze IMMER '{migration_id: $migrationId}' in deiner Abfrage.
- **vector_search_neo4j:** Suche semantisch nach Inhalten.
- **vectorize_data:** Bereite Daten für die Vektorsuche vor.
- **update_execution_plan:** Aktualisiere den Ausführungsplan (Execution Plan) nach Absprache mit dem User. Nutze dieses Tool, wenn der User Aufgaben entfernen, hinzufügen oder ändern möchte (z.B. "Migriere keine Status", "Ändere das Ziel von Tasks auf Issues").

### DEINE REGELN:
- Antworte IMMER auf Deutsch.
- Sei professionell, präzise und fasse dich kurz.
- Vermeide unnötige Einleitungen und Füllsätze. Antworte direkt auf die Frage.
- Nutze Cypher, um konkrete Fragen zu den Daten zu beantworten.
- Wenn der User den Ausführungsplan ändern will, aktualisiere ihn zwingend über das \`update_execution_plan\` Tool. Bestätige danach kurz die Änderung.

### FORMATIERUNG:
- Nutze Markdown-Tabellen für Daten-Ergebnisse.
- Halte Erklärungen knapp.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_neo4j",
      description: "Führt eine Cypher-Abfrage aus. Nutze $migrationId für die Filterung.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Die Cypher-Query unter Verwendung von $migrationId." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "vector_search_neo4j",
      description: "Sucht semantisch nach ähnlichen Inhalten in den importierten Daten.",
      parameters: {
        type: "object",
        properties: {
          query_text: { type: "string", description: "Der Suchtext." },
          limit: { type: "number", description: "Anzahl der Ergebnisse (default 5)." }
        },
        required: ["query_text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "vectorize_data",
      description: "Erstellt Vektor-Embeddings für alle importierten Elemente, falls noch nicht geschehen.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_execution_plan",
      description: "Aktualisiert den Ausführungsplan (Execution Plan) in der Datenbank. Sende IMMER den GESAMTEN neuen Plan (alle Tasks), auch wenn du nur einen entfernst oder änderst.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Die vollständige Liste der Aufgaben in der korrekten Ausführungsreihenfolge.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Eindeutige ID des Tasks" },
                description: { type: "string", description: "Beschreibung des Tasks" },
                sourceEntityType: { type: "string", description: "Quell-Entität" },
                targetEntityType: { type: "string", description: "Ziel-Entität" },
                dependsOn: { type: "array", items: { type: "string" }, description: "Abhängigkeiten (IDs)" },
                status: { type: "string", description: "Immer 'pending'" },
                retries: { type: "number", description: "Immer 0" }
              },
              required: ["id", "description", "sourceEntityType", "targetEntityType", "dependsOn"]
            }
          }
        },
        required: ["tasks"]
      }
    }
  }
];

export async function* runAnswerAgent(
  userMessage: string,
  context: {
    stepResults: any;
    history: { role: string; content: string }[];
    migrationId: string;
    sourceSystem: string;
    executionPlan?: any;
    dbPool?: Pool;
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = await resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const backendUrl = process.env.INTERNAL_BACKEND_URL || "http://backend:8000";

  const historyPrompt = context.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  
  const userContext = `
### MIGRATIONS-ID:
${context.migrationId}

### QUELLSYSTEM:
${context.sourceSystem}

### AKTUELLE ERGEBNISSE DER SCHRITTE:
${JSON.stringify(context.stepResults, null, 2)}

### AKTUELLER AUSFÜHRUNGSPLAN (Execution Plan):
${context.executionPlan ? JSON.stringify(context.executionPlan, null, 2) : "Noch kein Plan vorhanden."}

### BISHERIGER VERLAUF:
${historyPrompt}

### NEUE BENUTZERANFRAGE:
${userMessage}
  `;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContext }
  ];

  while (true) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        tools: TOOLS
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    messages.push(message);

    if (message.content) {
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

        console.log(`[AnswerAgent] Tool Call: ${functionName}`, args);

        try {
          if (functionName === 'query_neo4j') {
            const queryResponse = await fetch(`${backendUrl}/api/neo4j/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: args.query,
                    params: { migrationId: context.migrationId }
                })
            });
            result = await queryResponse.json();
          } else if (functionName === 'vector_search_neo4j') {
            const queryResponse = await fetch(`${backendUrl}/api/neo4j/vector-search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    migration_id: context.migrationId,
                    query_text: args.query_text,
                    limit: args.limit || 5,
                    source_system: context.sourceSystem
                })
            });
            result = await queryResponse.json();
          } else if (functionName === 'vectorize_data') {
            const queryResponse = await fetch(`${backendUrl}/api/neo4j/vectorize?migration_id=${context.migrationId}&source_system=${context.sourceSystem}`, {
                method: 'POST'
            });
            result = await queryResponse.json();
          } else if (functionName === 'update_execution_plan') {
            if (context.dbPool) {
                const { rows } = await context.dbPool.query('SELECT scope_config FROM migrations WHERE id = $1', [context.migrationId]);
                const existingConfig = rows[0]?.scope_config || {};
                
                // Ensure default values for new tasks
                const updatedTasks = args.tasks.map((t: any) => ({
                    ...t,
                    status: t.status || 'pending',
                    retries: t.retries || 0
                }));
                
                const updatedPlan = { tasks: updatedTasks };
                existingConfig.execution_plan = updatedPlan;
                
                await context.dbPool.query('UPDATE migrations SET scope_config = $1 WHERE id = $2', [JSON.stringify(existingConfig), context.migrationId]);
                result = { success: true, message: "Execution Plan wurde erfolgreich in der Datenbank aktualisiert." };
            } else {
                result = { error: "Database pool not available in Answer Agent context." };
            }
          } else {
            result = { error: `Unknown tool: ${functionName}` };
          }
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
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
