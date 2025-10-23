# Trello API Cloud FullModel

Dieses Paket beschreibt die Trello Cloud REST API v1.
Alle Objekte und Endpunkte sind optimiert für das Celion Meta-Modell.

- **Version:** Trello Cloud API v1 (Stand 2025)
- **Base URL:** https://api.trello.com/1/
- **Auth:** API Key + Token oder OAuth 1.0
- **Deployment:** Nur Cloud

## Enthaltene JSON-Dateien
- boards.json
- lists.json
- cards.json
- members.json
- checklists.json
- labels.json
- organizations.json
- custom_fields.json


## Erweiterte Version (Extended Cloud)
Diese Edition ergänzt die Standard-Trello Cloud API um:
- **Webhooks** (/webhooks, /webhooks/{id})
- **Notifications** (/notifications, /notifications/{id})
- **Search API** (/search, /search/members)
- **Enterprise API** (/enterprises/*)
- **Plugins & Board Power-Ups** (/plugins, /boardPlugins)
- **Batch API** (/batch)
- **UI-Ressourcen** (/stickers, /emoji)

Alle Objekte folgen der bestehenden Celion-Meta-Struktur.
