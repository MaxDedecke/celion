// src/agents/authFlow/prompt.ts

import { RunAuthFlowParams } from "./runAuthFlow";
import type { AuthHeaders } from "./types";

export type BuildAuthFlowPromptParams = { 
  system: string;
  baseUrl: string;
  apiVersion?: string | null;

  // Der Agent soll authType kennen – kannst du später dynamisch machen
  authType?: "api_token" | "basic" | "oauth2" | "bearer_token" | string;

  // 🔥 Jetzt flache Felder für MigrationDetails:
  apiToken?: string;
  email?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;

  // 🔥 UND weiterhin das verschachtelte Objekt (wird später automatisch befüllt)
  credentials?: {
    apiToken?: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
  };
};


export const buildAuthFlowPrompt = (params: BuildAuthFlowPromptParams) => {
  const { system, baseUrl, apiVersion, authType } = params;
  
  const credentials = params.credentials ?? {
  apiToken: params.apiToken,
  username: params.email,
  password: params.password,
  clientId: params.clientId,
  clientSecret: params.clientSecret,
};

  // WICHTIG: Wir zwingen den Agenten zu einer festen JSON-Struktur
  // und sagen explizit, dass ER alle benötigten Header bestimmen muss.
  return `
Du bist der Celion Auth Flow Agent.

Kontext:
- Zielsystem: "${system}"
- API Base-URL: "${baseUrl}"
- Erkannte API-Version (falls bekannt): "${apiVersion ?? "unbekannt"}"
- Authentifizierungstyp: "${authType}"

Der Benutzer stellt dir gültige Credentials bereit (du darfst sie NICHT verändern, nur beschreiben):
${JSON.stringify(credentials, null, 2)}

Aufgabe:
1. Bestimme die korrekte Art, diese Credentials für die API zu verwenden.
2. Leite alle erforderlichen HTTP-Header ab und KODIERE die Credentials korrekt:
   - Beispiel Jira Cloud: "Authorization: Basic <base64(email:apiToken)>", "Accept: application/json"
     WICHTIG: Für Jira MUSST du email und apiToken mit base64 kodieren!
   - Beispiel Monday GraphQL: "Authorization: <apiToken>", "Content-Type: application/json"
   - Beispiel Notion: "Authorization: Bearer <apiToken>", "Notion-Version: 2022-06-28", "Content-Type: application/json"
3. Baue eine empfohlene Probe-Request-Konfiguration mit den KODIERTEN Headers:
   - Wähle einen Endpunkt wie "/rest/api/3/myself" (Jira) oder "/v2" (Monday) oder "/v1/users/me" (Notion)
   - Gib HTTP-Methode, URL, und die VOLLSTÄNDIG KODIERTEN Header an
   - Bei GraphQL: gib query und variables an
4. Führe SOFORT einen echten Request mit dem httpClient-Tool aus:
   - Rufe httpClient mit ALLEN drei Parametern auf: url, method, UND headers
   - Die headers MÜSSEN die vollständig kodierten Authorization-Header enthalten
   - Beispiel Tool-Call für Jira: httpClient(url="https://...", method="GET", headers={"Authorization": "Basic <base64-string>", "Accept": "application/json"})
   - Das Tool gibt dir Status, Body und Fehler zurück
   - Setze "authenticated" auf true, wenn Status 200-299 ist, sonst false

WICHTIG:
- Du musst mindestens EINEN echten Request mit dem Tool "httpClient" ausführen.
  Verwende dabei genau die Konfiguration, die du unter "recommended_probe" definierst.
- Das Tool "httpClient" führt den Request über einen Backend-Proxy wirklich gegen die API des Zielsystems aus
  und liefert dir ein standardisiertes Ergebnis zurück (Status, Headers, Body, Fehler, Evidenz).
- Verwende NUR dieses Tool für externe HTTP-Requests, das Frontend selbst macht keine API-Calls.
- Du kennst die offiziellen API-Spezifikationen dieser gängigen Systeme
  (Jira Cloud, Monday.com, Notion, Asana, Azure DevOps, Trello, ClickUp etc.)
  und verwendest die jeweils aktuelle, empfohlene Authentifizierung.
- KRITISCH FÜR JIRA CLOUD: 
  * Du MUSST die Credentials als "email:apiToken" base64-kodieren
  * Der Authorization-Header MUSS "Basic <base64-kodierter-string>" sein
  * Beispiel: Wenn email="user@example.com" und apiToken="abc123", dann:
    Authorization: Basic dXNlckBleGFtcGxlLmNvbTphYmMxMjM=
  * Vergiss NICHT das Wort "Basic" vor dem base64-String!
- Wenn ein Header wie "Notion-Version" oder spezielle "Content-Type"-Werte zwingend erforderlich ist,
  MUSST du ihn in den auth_headers und im recommended_probe.headers mit angeben.
- Wenn der Authentifizierungstyp "bearer" oder "api_token" ist, gehört das Token in der Regel in den Authorization-Header.

Antwortformat:
Gib AUSSCHLIESSLICH ein JSON-Objekt mit folgendem Schema zurück:

{
  "system": string | null,
  "base_url": string | null,
  "authenticated": boolean,
  "auth_method": string | null,
  "auth_headers": {
    "<Header-Name>": "<Header-Wert>",
    "Authorization": "...",
    "Notion-Version": "... (falls Notion)",
    "Content-Type": "... (falls nötig)",
    "Accept": "... (falls sinnvoll)"
  },
  "recommended_probe": {
    "method": "GET" | "POST" | "HEAD" | ...,
    "url": "https://....",
    "headers": {
      "<Header-Name>": "<Header-Wert>"
    },
    "request_format": "rest_json" | "graphql" | "form" | "xml" | null,
    "graphql": {
      "query": string,
      "operation_name": string | null,
      "variables": {}
    } | null
  },
  "explanation": string,
  "raw_output": any
}

Hinweise:
- "authenticated" basiert auf deiner Auswertung der WIRKLICHEN Response des httpClient-Calls (Status, Body, Fehler).
- Nutze das Ergebnis des Tools, um eine klare Erklärung und ein Debug-fähiges raw_output zu liefern.
- Die Config unter recommended_probe muss so beschaffen sein, dass sie direkt wiederverwendbar ist (z. B. für spätere Probes).
`.trim();
};
