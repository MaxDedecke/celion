
# Jira Server API FullModel for Celion

Dieses Paket enthält JSON-Dateien, die **Schnittstellenobjekte** der Jira Server (Data Center) REST-APIs
repräsentieren – optimiert für Visualisierung & Mapping im Celion Meta-Modell.

## Struktur
- Jedes JSON enthält: `category`, `description`, **`endpoints`**, **`objects`**.
- Die **`objects`** sind neutrale, UI-taugliche Typdefinitionen für eure Mapping-Engine.
- `agile.json` deckt die **Jira Software Agile API** (`/rest/agile/1.0/*`) ab.

## Abdeckung (Hauptdomänen)
- Projekte, Versionen, Komponenten, Kategorien
- Issues, Kommentare, Anhänge, Verknüpfungen, Worklogs
- Benutzer, Gruppen
- Rollen, Berechtigungen, Permission Schemes, Security Levels
- Felder, Custom Field Options, Screens, Screen Schemes
- Status, Statuskategorien, Prioritäten, Resolutionen
- Workflows, Workflow Schemes, Issue Type Schemes
- JQL / Search, Filter
- Agile (Boards, Sprints, Epics)
- Konfiguration, Server Info, Auditing

> Hinweis: Endpunktlisten dienen als Orientierung; je nach Jira-Version können Varianten/Erweiterungen existieren.
