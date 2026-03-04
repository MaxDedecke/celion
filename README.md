# Celion

Celion ist eine hochperformante, KI-gestützte Migrations-Plattform für den Datentransfer zwischen verschiedenen SaaS-Ökosystemen (z. B. ClickUp, Notion, Asana, Jira). Durch den Einsatz von Graphen-Datenbanken und Large Language Models (LLMs) ermöglicht Celion nicht nur den reinen Transfer, sondern auch die intelligente Veredelung von Daten während des Prozesses.

## 🚀 Kern-Features

- **KI-Driven Data Enhancement:** Automatische Korrektur von Rechtschreibung, Tonalitäts-Anpassung, Zusammenfassungen und PII-Redaktion während der Migration.
- **Graph-basierte Transformation:** Nutzung von Neo4j als Intermediate Store, um komplexe Relationen (Parent-Child, Verknüpfungen) systemübergreifend abzubilden.
- **Smart Transfer Recipes:** Dynamische Generierung von API-Transfer-Rezepten durch LLMs, um Zielsystem-spezifische Anforderungen (wie das Block-Modell von Notion) präzise zu erfüllen.
- **Interaktiver Migrations-Agent:** Ein Chat-basierter Workflow führt den Nutzer durch alle Phasen: System-Detection, Auth-Validierung, Mapping und Transfer.
- **Surgical Updates:** Minimale API-Last durch punktuelle Transformationen und effiziente Batch-Verarbeitung.

## 🏗 Architektur

Celion besteht aus vier Hauptkomponenten:

1.  **Frontend (React + Vite):** Eine moderne Single-Page-Application mit Shadcn UI für die Verwaltung von Projekten, Datenquellen und den interaktiven Migrations-Workflow.
2.  **Backend (FastAPI / Python):** Das zentrale API-Gateway für die Orchestrierung der Migrationen, Benutzerverwaltung und Anbindung an PostgreSQL.
3.  **Worker (Node.js + tsx):** Ein dedizierter Background-Worker für rechenintensive Aufgaben wie Datenabruf, KI-Transformationen und den finalen API-Transfer.
4.  **Datenhaltung:**
    *   **PostgreSQL:** Persistenz für Metadaten, Jobs und Migrations-Konfigurationen.
    *   **Neo4j:** Graph-Datenbank für die Modellierung und Veredelung der zu migrierenden Entitäten.

## 🛠 Tech Stack

*   **Frontend:** React, TypeScript, Tailwind CSS, Lucide Icons, Shadcn UI
*   **Backend:** Python 3.9+, FastAPI, SQLAlchemy
*   **Worker:** Node.js, TypeScript, Neo4j-Driver, OpenAI API
*   **Infrastructure:** Docker, Docker Compose, PostgreSQL, Neo4j, RabbitMQ

## 🚥 Quick Start

Stelle sicher, dass Docker und Docker Compose auf deinem System installiert sind.

1.  **Repository klonen:**
    ```bash
    git clone https://github.com/your-repo/celion.git
    cd celion
    ```

2.  **Umgebungsvariablen konfigurieren:**
    Erstelle eine `.env` Datei basierend auf der `.env.example` und trage deine Datenbank-Credentials ein. Den `OPENAI_API_KEY` kannst du nun direkt über die Sidebar in der Benutzeroberfläche (LLM-Einstellungen) konfigurieren.

3.  **Anwendung starten:**
    ```bash
    docker compose up --build
    ```

Die Anwendung ist anschließend unter `http://localhost:8080` (Frontend) und `http://localhost:8000` (Backend API) erreichbar.

## 📋 Migrations-Workflow

1.  **System Detection:** Celion erkennt Quell- und Zielsysteme automatisch.
2.  **Authentication:** Validierung der API-Verbindungen.
3.  **Inventory:** Erfassung aller migrierbaren Objekte (Tasks, Spaces, Pages etc.).
4.  **Mapping:** Definition der Feld-Zuordnungen.
5.  **Quality Enhancement:** KI-gestützte Veredelung der Daten in Neo4j.
6.  **Transfer:** Sicherer Export in das Zielsystem mittels dynamischer Rezepte.

## 🛡 Sicherheitsmechanismen

*   **Retry-Limit:** Automatischer Abbruch nach 3 fehlgeschlagenen Transfer-Versuchen pro Objekt, um Infinite Loops zu vermeiden.
*   **Error Tracking:** Detaillierte Fehlerspeicherung direkt am betroffenen Datenknoten in Neo4j.
*   **PII Redaction:** Optionale Anonymisierung sensibler Daten vor dem Export.

---
© 2026 Celion Migration Tools.
