# Jira Data Center API FullModel

Dieses Paket erweitert das Jira Server API FullModel um Data Center-spezifische Schnittstellen.
Es enthält alle REST-Endpunkte und Objekttypen, die in Jira Data Center (v9.x+) verfügbar sind.

## Neu gegenüber Server Edition
- **Cluster & License** APIs (`/rest/license/1/license`, `/rest/cluster/1/*`)
- **Monitoring** APIs (`/rest/monitoring/1.0/*`)
- **Personal Access Tokens (PAT)** & OAuth2 Support
- **Zero Downtime Upgrade (ZDU)** Status API
- **Erweiterte Workflow Transition Properties**

## Kompatibilität
Alle bisherigen `/rest/api/2/*` Endpunkte sind weiterhin gültig.
Dieses Modell ist kompatibel mit Celion Meta-Modell-Visualisierung und kann für On-Prem- oder Hybrid-Migrationen verwendet werden.
