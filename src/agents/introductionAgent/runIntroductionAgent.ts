import { Message } from '../openai/types';

export async function* runIntroductionAgent(
  userMessage: string,
  context: {
    history: { role: string; content: string }[];
    migrationId: string;
    migrationName?: string;
    dataSources?: any[];
    fetchScopeData?: (system: string, dataSourceId: string, apiToken?: string, url?: string, email?: string) => Promise<{ id: string, name: string }[]>;
    verifySystemAndAuth?: (mode: 'source' | 'target', dataSourceId: string, system?: string, apiToken?: string, url?: string, email?: string) => Promise<{ success: boolean, message: string }>;
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
        const verifyRes = await context.verifySystemAndAuth('source', ds.id, ds.source_type);

        if (verifyRes.success) {
          const newData = { ...data, source: { dataSourceId: ds.id, system: ds.source_type, name: ds.name } };
          yield* yieldText("✅ Verbindung zum System erfolgreich.");
          yield* yieldText("✅ Authentifizierung mit den API Credentials war erfolgreich.");
          yield* yieldText("Ich lade nun den Scope Discovery Agent, der dir hilft, die richtigen Bereiche für die Migration auszuwählen...");
          yield* yieldStateUpdate('llm_scope_discovery', newData);
        } else {
          yield* yieldText(`Fehler bei der Verbindung: ${verifyRes.message}\nBitte überprüfe die Datenquelle.`);
        }
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
        const verifyRes = await context.verifySystemAndAuth('target', ds.id, ds.source_type);

        if (verifyRes.success) {
          const newData = { ...data, target: { dataSourceId: ds.id, system: ds.source_type, name: ds.name } };          newData.target.scope = "Zielbereich";
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
