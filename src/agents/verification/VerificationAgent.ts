import { AgentBase } from '../core/AgentBase';
import { Tool, ChatMessage } from '../core/LlmProvider';
import { httpClient } from '../../tools/httpRequest';
import neo4j from 'neo4j-driver';

export class VerificationAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId } = this.context;
    
    await this.context.writeChatMessage('assistant', 'Starte Stichproben-Verifizierung im Zielsystem...', stepNumber);

    const migrationDetails = await this.context.getMigrationDetails();
    const sourceSystem = migrationDetails?.source_system;
    const targetSystem = migrationDetails?.target_system;

    const outConnector = await this.context.getConnector('out');
    if (!outConnector) {
       return { success: false, error: "Kein Target Connector gefunden." };
    }

    const email = outConnector.username || "";
    const token = outConnector.api_key || "";
    
    // Connect to Neo4j to get sample nodes
    const driver = neo4j.driver(
      process.env.NEO4J_URI || "bolt://neo4j-db:7687",
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
    );

    const session = driver.session();
    let samples: any[] = [];
    try {
        // Find random nodes that have a target_id
        const res = await session.run(
           `MATCH (n:\`${sourceSystem}\` {migration_id: $migrationId})
            WHERE n.target_id IS NOT NULL
            WITH n, rand() AS r
            ORDER BY r
            LIMIT 15
            RETURN n.target_id AS target_id, n.name AS name, n.title AS title, n.entity_type AS entity_type`,
           { migrationId }
        );
        samples = res.records.map(r => ({
            target_id: r.get('target_id'),
            name: r.get('name') || r.get('title') || null,
            entity_type: r.get('entity_type')
        })).filter(s => s.name); // only keep those with a name/title to search for
    } finally {
        await session.close();
        await driver.close();
    }

    if (samples.length === 0) {
        const msg = "Keine passenden migrierten Objekte in Neo4j gefunden, die verifiziert werden können.";
        await this.context.writeChatMessage('assistant', msg, stepNumber);
        return { success: true, verified: 0, total: 0, message: msg };
    }

    await this.context.writeChatMessage('assistant', `Es wurden ${samples.length} Objekte für die Stichprobe ausgewählt. Ich prüfe nun per API, ob sie im Zielsystem korrekt angelegt wurden...`, stepNumber);

    const encodedBasicAuth = Buffer.from(`${email}:${token}`).toString('base64');

    const SYSTEM_PROMPT = `
Du bist der Celion Validation Agent. Du überprüfst, ob Daten, die laut unserer Datenbank erfolgreich migriert wurden, auch tatsächlich im Zielsystem (${targetSystem}) existieren.
Wir haben eine Liste von Objekten (Stichprobe), die jeweils einen 'namen' und eine 'target_id' (die ID im Zielsystem) besitzen.

DEINE AUFGABE:
1. Nutze das Tool 'http_request', um die Zielsystem-API anzufragen.
2. Da die Suche im Zielsystem oft komplex ist, solltest du einfach einen direkten HTTP GET Request auf das Objekt mit der 'target_id' machen.
3. Prüfe die Antwort der API:
   - Wurde das Objekt gefunden (Status 200)?
   - Stimmt der in der API zurückgegebene Name/Titel ungefähr mit unserem Namen überein?
4. Gehe die Liste der Stichproben durch. Prüfe mindestens 3-5 repräsentative Stichproben detailliert.
5. **WICHTIG:** Sobald du fertig bist, MUSST du ein finales Feedback als JSON-Block am Ende deiner Nachricht ausgeben. Ohne dieses JSON kann der Prozess nicht abgeschlossen werden.

ZIEL-SYSTEM AUTHENTIFIZIERUNG:
Du musst die passenden Header in 'http_request' mitgeben:
- Asana: {"Authorization": "Bearer ${token}"}
- ClickUp: {"Authorization": "${token}"}
- Jira: {"Authorization": "Basic ${encodedBasicAuth}"}
- Notion: {"Authorization": "Bearer ${token}", "Notion-Version": "2022-06-28"}
- TargetProcess: {"Authorization": "Basic ${encodedBasicAuth}"} (base64 encoded username:token)

STICHPROBE:
${JSON.stringify(samples, null, 2)}

HINWEIS ZU ENDPUNKTEN (Beispiele):
- Asana Task: GET https://app.asana.com/api/1.0/tasks/{target_id}
- ClickUp Task: GET https://api.clickup.com/api/v2/task/{target_id}
- Jira Issue: GET https://deine-jira-domain.atlassian.net/rest/api/3/issue/{target_id} (ersetze durch die korrekte Domain)
- Notion Page: GET https://api.notion.com/v1/pages/{target_id}

Am Ende der Verifizierung gib folgendes JSON aus (und beschreibe vorher das Ergebnis freundlich):
\`\`\`json
{
  "verified_count": <Anzahl erfolgreich gefundener Objekte>,
  "failed_count": <Anzahl fehlgeschlagener Objekte>,
  "details": [
    {"target_id": "...", "status": "success/failed", "reason": "Gefunden als '...'"}
  ]
}
\`\`\`
    `;

    const tools: Tool[] = [
        {
          type: "function",
          function: {
            name: 'http_request',
            description: 'Führt einen HTTP-Request gegen das Zielsystem aus, z.B. um ein Objekt per ID abzurufen.',
            parameters: {
              type: 'object',
              properties: {
                method: { type: 'string', enum: ['GET', 'POST'] },
                url: { type: 'string' },
                headers: { type: 'object' },
                body: { type: 'string' },
              },
              required: ['method', 'url', 'headers']
            }
          }
        }
    ];

    let messageId: string | null = null;
    const processMessages = async (role: 'user'|'assistant', text: string) => {
        if (this.context.upsertChatMessage) {
            messageId = await this.context.upsertChatMessage(messageId, role, text, stepNumber) || null;
        } else {
            await this.context.writeChatMessage(role, text, stepNumber);
        }
    };

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT }, 
        { role: 'user', content: "Bitte verifiziere die Stichproben und prüfe ob der Name im Zielsystem übereinstimmt. Gib das JSON am Ende aus." }
    ];
    let resultJson: any = null;

    for (let i = 0; i < 15; i++) { // Max iterations
        const response = await this.provider.chat(messages, tools);
        console.log(`[VerificationAgent] Turn ${i} Response Content:`, response.content);
        if (response.toolCalls) {
            console.log(`[VerificationAgent] Turn ${i} Tool Calls:`, response.toolCalls.length);
        }
        
        messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolCalls
        });

        if (response.content && response.content.trim()) {
           await processMessages('assistant', response.content);
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
            for (const toolCall of response.toolCalls) {
               if (toolCall.function.name === 'http_request') {
                   try {
                       const args = JSON.parse(toolCall.function.arguments);
                       console.log(`[VerificationAgent] HTTP Request to:`, args.url);
                       const httpRes = await httpClient(args);
                       console.log(`[VerificationAgent] HTTP Status:`, httpRes.status);
                       messages.push({
                           role: 'tool',
                           tool_call_id: toolCall.id,
                           name: toolCall.function.name,
                           content: JSON.stringify({
                               status: httpRes.status,
                               body: httpRes.body ? (typeof httpRes.body === 'object' ? JSON.stringify(httpRes.body).substring(0, 1000) : String(httpRes.body).substring(0, 1000)) : null,
                               error: httpRes.error
                           })
                       });
                   } catch (err: any) {
                       messages.push({
                           role: 'tool',
                           tool_call_id: toolCall.id,
                           name: toolCall.function.name,
                           content: JSON.stringify({ error: err.message })
                       });
                   }
               }
            }
        } else {
            const content = response.content || "";
            
            // Try to find JSON anywhere in the conversation history if it's not in the last message
            const findJsonInText = (text: string) => {
                const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (match) {
                    try { return JSON.parse(match[1]); } catch(e){}
                }
                const start = text.indexOf('{');
                const end = text.lastIndexOf('}');
                if (start !== -1 && end > start) {
                    try { return JSON.parse(text.substring(start, end+1)); } catch(e){}
                }
                return null;
            };

            resultJson = findJsonInText(content);
            
            // Fallback: look in previous assistant messages if not found in last one
            if (!resultJson) {
                for (let j = messages.length - 1; j >= 0; j--) {
                    if (messages[j].role === 'assistant' && messages[j].content) {
                        resultJson = findJsonInText(messages[j].content!);
                        if (resultJson && resultJson.verified_count !== undefined) break;
                        else resultJson = null;
                    }
                }
            }
            
            break;
        }
    }

    console.log(`[VerificationAgent] Final resultJson found:`, !!resultJson);

    if (!resultJson) {
        return { success: false, error: "Verifizierungs-Agent hat kein valides Ergebnis-JSON zurückgeliefert.", isLogicalFailure: true };
    }

    if (this.context.saveResult) {
        await this.context.saveResult(resultJson);
    }

    await this.context.logActivity('success', `Stichproben-Verifizierung abgeschlossen. ${resultJson.verified_count} validiert.`);
    
    return { 
        success: true, 
        verified: resultJson.verified_count, 
        failed: resultJson.failed_count,
        details: resultJson.details 
    };
  }
}
