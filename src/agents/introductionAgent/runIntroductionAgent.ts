import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Onboarding Agent – dein Ziel ist es, den User bei der Einrichtung seiner Migration zu begleiten. 
Du bist professionell, aber hast einen trockenen, IT-typischen Humor (denk an eine Mischung aus einem hilfsbereiten Butler und einem leicht sarkastischen Systemadministrator).

### DEINE AUFGABE:
Du musst alle Informationen sammeln, die für eine Migration notwendig sind. 
**HINWEIS:** Der Name der Migration wurde bereits festgelegt (siehe Kontext). Frage NICHT nach dem Namen.

Die zu sammelnden Informationen sind:
1.  **Quellsystem & Zielsystem:**
    - Du erhältst im Kontext eine Liste ALLER bereits gespeicherten Datenquellen.
    - Präsentiere dem Nutzer ZUERST für das Quellsystem und DANACH für das Zielsystem ein Dropdown-Menü, aus dem er eine bestehende Datenquelle wählen oder eine neue anlegen kann.
    - WICHTIG: Filtere die Optionen für das Quellsystem NIEMALS vorab! Zeige IMMER ALLE Datenquellen aus dem Kontext in den 'options' an.
    - SEHR WICHTIG: Wenn du das Dropdown für das ZIELSYSTEM generierst, DARFST DU DIE DATENQUELLE, DIE FÜR DAS QUELLSYSTEM GEWÄHLT WURDE, NICHT in die 'options' aufnehmen. Ein System kann nicht in sich selbst migriert werden.
    - Nutze dafür EXAKT folgendes JSON-Format am ENDE deiner Nachricht:
      \`\`\`json
      {
        "type": "datasource_dropdown",
        "mode": "source", // oder "target"
        "label": "Bitte wähle eine Quell-Datenquelle...",
        "options": [
          {"id": "id-aus-kontext", "label": "Name (System) - URL"},
          {"id": "new", "label": "+ Neue Datenquelle erstellen"}
        ]
      }
      \`\`\`
    - Wenn der Nutzer "new" auswählt, erfrage die Details manuell: System, URL, API-Token, E-Mail. (Diese wird dann automatisch gespeichert).
    - Wenn der Nutzer eine bestehende wählt, bestätige die Auswahl und nutze ihre ID für das finale Tool.
2.  **Bereich (Scope) & Spezifische Auswahl:**
    - Sobald das System (Quelle) feststeht, frage den Nutzer: "Möchtest du alles migrieren oder nur bestimmte Bereiche (z. B. Workspaces, Spaces, Projekte - je nach System)?"
    - Um dem Nutzer die Antwort zu erleichtern, hänge EXAKT folgendes JSON am Ende der Nachricht an:
      \`\`\`json
      {
        "type": "action",
        "actions": [
          { "label": "Alles migrieren", "action": "send_chat:Ich möchte alles migrieren.", "variant": "primary" },
          { "label": "Bestimmte Bereiche", "action": "send_chat:Ich möchte nur bestimmte Bereiche migrieren.", "variant": "outline" }
        ]
      }
      \`\`\`
    - Wenn der Nutzer bestimmte Bereiche migrieren möchte, rufe das Tool 'fetch_available_scopes' auf, um die im System verfügbaren Bereiche abzufragen. Präsentiere diese dann dem Nutzer zur Auswahl.
    - **Sollte das Tool fehlschlagen, keine Ergebnisse liefern oder der Nutzer den Bereich manuell benennen wollen, frage ihn direkt nach dem Namen oder der ID des Bereichs.**
    - Speichere die ausgewählten IDs.
    - Frage für das Zielsystem auch, ob ein neuer Hauptbereich oder ein Unterbereich genutzt werden soll, und ob der Quell-Name übernommen werden soll.

### ABLAUF:
- Begrüße den User und präsentiere direkt das JSON-Dropdown für das Quellsystem.
- Wenn das Quellsystem steht, frage nach dem Scope (Alles vs. spezifisch) und zeige die zwei Action-Buttons.
- Nutze 'fetch_available_scopes' bei spezifischem Wunsch. Falls das fehlschlägt, frage nach dem Namen des Bereichs.
- Präsentiere anschließend ZWINGEND wieder ein JSON-Dropdown für das Zielsystem (mit \`"mode": "target"\`), damit der Nutzer auch dieses System per Dropdown wählen kann.
- **WICHTIG:** Wenn du alle Informationen hast, fasse sie zusammen und frage nach der Bestätigung.
- Wenn du nach der finalen Bestätigung fragst, hänge ZWINGEND EXAKT folgendes JSON am Ende der Nachricht an:
  \`\`\`json
  {
    "type": "action",
    "actions": [
      { "label": "Ich bestätige", "action": "send_chat:Ich bestätige", "variant": "primary" }
    ]
  }
  \`\`\`
- Sobald der User bestätigt, rufe das Tool 'finish_onboarding' auf.

### DEINE TOOLS:
- **fetch_available_scopes:** Rufe dieses Tool auf, wenn der User spezifische Bereiche auswählen möchte, um die verfügbaren Optionen aus dem System zu laden.
- **finish_onboarding:** Rufe dieses Tool auf, wenn der User die Konfiguration bestätigt hat. Übergebe alle gesammelten Daten, insbesondere die IDs der spezifischen Bereiche.

### REGELN:
- Antworte IMMER auf Deutsch.
- Sei charmant-sarkastisch, aber effizient.
- Du darfst erst einen kurzen Text schreiben und dann das JSON-Objekt (gerne in einem \`\`\`json Block) anhängen.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "fetch_available_scopes",
      description: "Fragt das Quellsystem nach den verfügbaren Bereichen (Workspaces, Spaces, Projekte etc.) ab, um sie dem Nutzer zur Auswahl zu präsentieren.",
      parameters: {
        type: "object",
        properties: {
          dataSourceId: { type: "string", description: "ID der gewählten Datenquelle. Oder 'new' falls neu angelegt." },
          system: { type: "string", description: "Name des Systems (z.B. ClickUp, Asana, JiraCloud)" },
          url: { type: "string", description: "Wird nur benötigt, wenn dataSourceId 'new' ist." },
          apiToken: { type: "string", description: "Wird nur benötigt, wenn dataSourceId 'new' ist." },
          email: { type: "string", description: "Wird nur benötigt, wenn dataSourceId 'new' ist." }
        },
        required: ["dataSourceId", "system"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish_onboarding",
      description: "Speichert die finale Konfiguration und schließt das Onboarding ab.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: {
            type: "object",
            properties: {
              dataSourceId: { type: "string", description: "ID der gewählten Datenquelle. Oder 'new' falls neu angelegt." },
              system: { type: "string" },
              url: { type: "string" },
              apiToken: { type: "string" },
              email: { type: "string" },
              scope: { type: "string", description: "Allgemeiner Name des Bereichs (Projekt, Workspace etc.)" },
              scopeIds: { 
                type: "array", 
                items: { type: "string" },
                description: "Array von IDs der ausgewählten spezifischen Bereiche. Wenn 'Alles' migriert werden soll, kann dies leer sein oder weggelassen werden."
              }
            }
          },
          target: {
            type: "object",
            properties: {
              dataSourceId: { type: "string", description: "ID der gewählten Datenquelle. Oder 'new' falls neu angelegt." },
              system: { type: "string" },
              url: { type: "string" },
              apiToken: { type: "string" },
              email: { type: "string" },
              scope: { type: "string", description: "Gewählter Bereich (Projekt, Workspace etc.)" },
              containerType: { type: "string", description: "Der gewünschte Typ des Ziel-Containers (z.B. workspace, project, space)." },
              containerId: { type: "string", description: "Die ID des Ziel-Containers, falls in einen existierenden migriert wird." }
            }
          }
        },
        required: ["name", "source", "target"]
      }
    }
  }
];

export async function* runIntroductionAgent(
  userMessage: string,
  context: {
    history: { role: string; content: string }[];
    migrationId: string;
    migrationName?: string;
    dataSources?: any[];
    fetchScopeData?: (system: string, dataSourceId: string, apiToken?: string, url?: string, email?: string) => Promise<{ id: string, name: string }[]>;
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = await resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const historyPrompt = context.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  const dataSourcesPrompt = context.dataSources && context.dataSources.length > 0
    ? context.dataSources.map(ds => `- ID: ${ds.id}, Name: ${ds.name}, System: ${ds.source_type}, URL: ${ds.api_url}`).join('\n')
    : 'Keine gespeicherten Datenquellen vorhanden.';
  
  const userContext = `
### MIGRATION:
ID: ${context.migrationId}
Name: ${context.migrationName || 'Unbekannt'}

### VERFÜGBARE DATENQUELLEN:
${dataSourcesPrompt}

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

        console.log(`[IntroductionAgent] Tool Call: ${functionName}`, args);

        if (functionName === 'finish_onboarding') {
          // This will be handled by the worker to update the DB
          result = { status: "success", message: "Onboarding abgeschlossen. Die Migration wird konfiguriert." };
          
          // We yield the tool result so the agent can finish the conversation
          yield {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: "AUSGABE_TOOL_CALL:FINISH_ONBOARDING:" + JSON.stringify(args) }]
          };
        } else if (functionName === 'fetch_available_scopes') {
          if (context.fetchScopeData) {
            try {
              const scopes = await context.fetchScopeData(args.system, args.dataSourceId, args.apiToken, args.url, args.email);
              result = { status: "success", scopes };
            } catch (err: any) {
              result = { error: "Fehler beim Abrufen der Bereiche: " + err.message };
            }
          } else {
            result = { error: "fetchScopeData-Funktion ist nicht im Kontext verfügbar." };
          }
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
