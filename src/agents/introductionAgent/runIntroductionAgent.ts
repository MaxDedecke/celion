import { Message } from '../openai/types';

export async function* runIntroductionAgent(
  userMessage: string,
  context: {
    history: { role: string; content: string }[];
    migrationId: string;
    migrationName?: string;
    dataSources?: any[];
    fetchScopeData?: (system: string, dataSourceId: string, apiToken?: string, url?: string, email?: string) => Promise<{ id: string, name: string }[]>;
    verifySystemAndAuth?: (dataSourceId: string, system?: string, apiToken?: string, url?: string, email?: string) => Promise<{ success: boolean, message: string }>;
    onboardingState?: any;
  }
): AsyncGenerator<Message> {
  const state = context.onboardingState?.step || 'init';
  const data = context.onboardingState?.data || {};

  const yieldText = function* (text: string): Generator<Message> {
    yield { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
  };

  const yieldStateUpdate = function* (newState: string, newData: any): Generator<Message> {
    yield { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `AUSGABE_TOOL_CALL:SET_STATE:${JSON.stringify({ step: newState, data: newData })}` }] };
  };

  // Helper to find data source by ID from context
  const getDataSourceById = (id: string) => {
    return (context.dataSources || []).find(ds => ds.id === id);
  };

  switch (state) {
    case 'init':
      yield* yieldText("Hallo! Ich bin der Celion Onboarding Agent. Lass uns deine Migration einrichten.");
      yield* yieldText(JSON.stringify({
        type: "datasource_dropdown",
        mode: "source",
        label: "Bitte wähle ein Quellsystem aus...",
        options: [
          ...(context.dataSources || []).map(ds => ({ id: ds.id, label: `${ds.name} (${ds.source_type}) - ${ds.api_url}` })),
          { id: "new", label: "+ Neue Datenquelle erstellen" }
        ]
      }));
      yield* yieldStateUpdate('await_source', data);
      break;

    case 'await_source': {
      let dataSourceId = "";
      const idMatch = userMessage.match(/\[ID:([^\]]+)\]/);
      if (idMatch) {
        dataSourceId = idMatch[1];
      } else if (userMessage.includes("neue Datenquelle")) {
        dataSourceId = "new";
      }

      if (!dataSourceId) {
        yield* yieldText("Bitte wähle eine gültige Option aus dem Dropdown, um fortzufahren.");
        return;
      }
      
      if (dataSourceId === "new") {
        yield* yieldText("Alles klar, eine neue Datenquelle. Bitte gib mir das System (z.B. Asana, ClickUp), die API-URL, deinen API-Token und ggf. deine E-Mail-Adresse.");
        // Normally we'd transition to a 'new_datasource' sub-flow, but for now we'll stick to existing ones
        return;
      }

      const ds = getDataSourceById(dataSourceId);
      if (!ds) {
        yield* yieldText("Diese Datenquelle konnte ich leider nicht finden. Bitte wähle erneut.");
        return;
      }

      if (context.verifySystemAndAuth) {
        yield* yieldText(`Prüfe Verbindung zu **${ds.name}**...`);
        const verifyRes = await context.verifySystemAndAuth(ds.id, ds.source_type);
        
        if (verifyRes.success) {
          const newData = { ...data, source: { dataSourceId: ds.id, system: ds.source_type, name: ds.name } };
          yield* yieldText("✅ Verbindung zum System erfolgreich.");
          yield* yieldText("✅ Authentifizierung mit den API Credentials war erfolgreich.");
          yield* yieldText("Möchtest du alles migrieren oder nur bestimmte Bereiche?");
          yield* yieldText(JSON.stringify({
            type: "action",
            actions: [
              { label: "Alles migrieren", action: "send_chat:Alles", variant: "primary" },
              { label: "Bestimmte Bereiche", action: "send_chat:Spezifisch", variant: "outline" }
            ]
          }));
          yield* yieldStateUpdate('await_scope_decision', newData);
        } else {
          yield* yieldText(`Fehler bei der Verbindung: ${verifyRes.message}\nBitte überprüfe die Datenquelle.`);
        }
      }
      break;
    }

    case 'await_scope_decision':
      if (userMessage.toLowerCase().includes("alles")) {
        const newData = { ...data };
        newData.source.scope = "Alles";
        newData.source.scopeIds = [];
        yield* yieldText("Alles klar. Nun zum Zielsystem:");
        yield* yieldText(JSON.stringify({
          type: "datasource_dropdown",
          mode: "target",
          label: "Bitte wähle ein Zielsystem aus...",
          options: [
            ...(context.dataSources || []).filter(ds => ds.id !== data.source?.dataSourceId).map(ds => ({ id: ds.id, label: `${ds.name} (${ds.source_type}) - ${ds.api_url}` })),
            { id: "new", label: "+ Neue Datenquelle erstellen" }
          ]
        }));
        yield* yieldStateUpdate('await_target', newData);
      } else if (userMessage.toLowerCase().includes("spezifisch") || userMessage.toLowerCase().includes("bestimmte bereiche")) {
        yield* yieldText("Ich lade die verfügbaren Bereiche...");
        if (context.fetchScopeData) {
          try {
            const scopes = await context.fetchScopeData(data.source.system, data.source.dataSourceId);
            if (scopes.length === 0) {
              yield* yieldText("Keine Bereiche gefunden, migriere alles.");
              const newData = { ...data };
              newData.source.scope = "Alles";
              newData.source.scopeIds = [];
              yield* yieldText("Nun zum Zielsystem:");
              yield* yieldText(JSON.stringify({
                type: "datasource_dropdown",
                mode: "target",
                label: "Bitte wähle ein Zielsystem...",
                options: [
                  ...(context.dataSources || []).filter(ds => ds.id !== data.source?.dataSourceId).map(ds => ({ id: ds.id, label: `${ds.name} (${ds.source_type}) - ${ds.api_url}` })),
                  { id: "new", label: "+ Neue Datenquelle erstellen" }
                ]
              }));
              yield* yieldStateUpdate('await_target', newData);
            } else {
              yield* yieldText(JSON.stringify({
                type: "scope_dropdown",
                label: "Welchen Bereich möchtest du migrieren?",
                options: scopes.map(s => ({ id: s.id, label: s.name }))
              }));
              yield* yieldStateUpdate('await_scope_selection', data);
            }
          } catch (e: any) {
            yield* yieldText(`Fehler beim Laden: ${e.message}`);
          }
        }
      } else {
        yield* yieldText("Bitte wähle 'Alles' oder 'Bestimmte Bereiche'.");
      }
      break;

    case 'await_scope_selection': {
      const idMatch = userMessage.match(/\[ID:([^\]]+)\]/);
      const labelMatch = userMessage.match(/den Bereich '([^']+)'/);
      
      if (idMatch) {
        const newData = { ...data };
        newData.source.scope = labelMatch ? labelMatch[1] : idMatch[1];
        newData.source.scopeIds = [idMatch[1]];
        yield* yieldText(`Bereich "${newData.source.scope}" ausgewählt. Nun zum Zielsystem:`);
        yield* yieldText(JSON.stringify({
          type: "datasource_dropdown",
          mode: "target",
          label: "Bitte wähle ein Zielsystem aus...",
          options: [
            ...(context.dataSources || []).filter(ds => ds.id !== data.source?.dataSourceId).map(ds => ({ id: ds.id, label: `${ds.name} (${ds.source_type}) - ${ds.api_url}` })),
            { id: "new", label: "+ Neue Datenquelle erstellen" }
          ]
        }));
        yield* yieldStateUpdate('await_target', newData);
      } else {
        yield* yieldText("Bitte wähle einen Bereich.");
      }
      break;
    }

    case 'await_target': {
      let dataSourceId = "";
      const idMatch = userMessage.match(/\[ID:([^\]]+)\]/);
      if (idMatch) {
        dataSourceId = idMatch[1];
      }

      if (!dataSourceId) {
        yield* yieldText("Bitte wähle ein gültiges Zielsystem.");
        return;
      }

      const ds = getDataSourceById(dataSourceId);
      if (!ds) {
        yield* yieldText("Zielsystem nicht gefunden.");
        return;
      }

      if (context.verifySystemAndAuth) {
        yield* yieldText(`Prüfe Verbindung zu **${ds.name}**...`);
        const verifyRes = await context.verifySystemAndAuth(ds.id, ds.source_type);
        
        if (verifyRes.success) {
          const newData = { ...data, target: { dataSourceId: ds.id, system: ds.source_type, name: ds.name } };
          newData.target.scope = "Zielbereich";
          newData.target.containerType = "workspace";
          
          yield* yieldText("✅ Verbindung zum System erfolgreich.");
          yield* yieldText("✅ Authentifizierung mit den API Credentials war erfolgreich.");
          
          yield* yieldText(`Zusammenfassung:
**Quelle:** ${newData.source.name} (${newData.source.scope})
**Ziel:** ${newData.target.name}

Passt das?`);
          yield* yieldText(JSON.stringify({
            type: "action",
            actions: [
              { label: "Ich bestätige", action: "send_chat:Bestätigt", variant: "primary" }
            ]
          }));
          yield* yieldStateUpdate('await_confirmation', newData);
        } else {
          yield* yieldText(`Fehler: ${verifyRes.message}`);
        }
      }
      break;
    }

    case 'await_confirmation':
      if (userMessage.toLowerCase().includes("bestätigt")) {
        yield* yieldText("AUSGABE_TOOL_CALL:FINISH_ONBOARDING:" + JSON.stringify({
          name: context.migrationName || "Neue Migration",
          source: data.source,
          target: data.target
        }));
        yield* yieldStateUpdate('completed', data);
      } else {
        yield* yieldText("Bitte bestätige die Auswahl.");
      }
      break;

    case 'completed':
      yield* yieldText("Onboarding abgeschlossen.");
      break;
  }
}
