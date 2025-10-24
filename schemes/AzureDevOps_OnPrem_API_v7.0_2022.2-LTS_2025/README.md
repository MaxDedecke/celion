# Azure DevOps Server (On-Prem) API FullModel (Celion Edition)

Dieses Paket beschreibt die REST API von **Azure DevOps Server 2022.2 (On-Premise)**,
im selben Datenmodell wie die Cloud-Edition.

- **Produkt:** Azure DevOps Server (On-Prem)
- **Version (Produkt):** 2022.2 (LTS)
- **API-Version (typisch):** `api-version=7.0`
- **Base URL (Beispiel):** `https://{server}/tfs/{collection}/_apis/`
- **Auth:** Personal Access Token (PAT) via Basic Auth (oder Windows/NTLM je nach Konfiguration)
- **Stand:** Oktober 2025

## Enthaltene Module
- Projects & Teams
- Work Items
- Boards & Backlogs
- Repositories
- Pipelines
- Builds
- Releases
- Artifacts
- Users & Groups
- Test Management
- Service Hooks
- Analytics
- Extensions

> Hinweis: Die Endpunkte sind relativ (beginnend mit `/_apis/`) und gelten in beiden Varianten.
> Für On-Prem bitte die **Base URL** und ggf. **api-version=7.0** Query-Parameter berücksichtigen.
