# Celion 🚀

[![Stack: TypeScript](https://img.shields.io/badge/Stack-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Framework: React](https://img.shields.io/badge/Framework-React-blue.svg)](https://react.dev/)
[![Backend: FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![Database: Neo4j](https://img.shields.io/badge/Database-Neo4j-008CC1.svg)](https://neo4j.com/)
[![Powered by: OpenAI](https://img.shields.io/badge/Powered%20by-OpenAI-41ADFF.svg)](https://openai.com/)

**Celion** is a high-performance, AI-powered migration platform designed for seamless data transfer between SaaS ecosystems (e.g., ClickUp, Notion, Asana, Jira). By leveraging Graph Databases and Large Language Models (LLMs), Celion goes beyond simple "copy-paste" migrations, enabling intelligent data enrichment, structural transformation, and automated error recovery.

---

## 📖 Table of Contents

- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Migration Workflow](#-migration-workflow)
- [Security & Reliability](#-security--reliability)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Key Features

- **AI-Driven Data Enhancement:** Automatically correct spelling, adjust tone, summarize content, and redact PII during the migration process.
- **Graph-Based Transformation:** Uses **Neo4j** as an intermediate store to model complex relationships (parent-child, linked entities) across different systems.
- **Smart Transfer Recipes:** Dynamically generates API transfer logic via LLMs to meet platform-specific requirements (e.g., Notion's block model).
- **Interactive Migration Agent:** A chat-based workflow guides you through all phases: System Detection, Auth Validation, Mapping, and Transfer.
- **Surgical Updates:** Minimizes API load through targeted transformations and efficient batch processing.
- **Revisions-Safe Logging:** Every action, API request, and data change is documented for full auditability.

---

## 🏗 Architecture

Celion's modular architecture is built for scalability and robustness:

1.  **Frontend (React + Vite):** A modern SPA using **Shadcn UI** for project management, data source configuration, and the interactive workflow.
2.  **Backend (FastAPI / Python):** The central API gateway orchestrating migrations, user management, and PostgreSQL persistence.
3.  **Worker (Node.js + TypeScript):** A high-throughput background worker handling data fetching, AI transformations, and final API transfers.
4.  **Data Layer:**
    *   **PostgreSQL:** Stores metadata, job states, and migration configurations.
    *   **Neo4j:** The graph engine for modeling and refining entities.
    *   **RabbitMQ:** Message broker for reliable task distribution and background processing.

---

## 🛠 Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS, Shadcn UI, Lucide Icons, TanStack Query
- **Backend:** Python 3.9+, FastAPI, SQLAlchemy, Pydantic
- **Worker:** Node.js, TypeScript, Neo4j Driver, OpenAI/Anthropic/Gemini APIs
- **Infra:** Docker & Docker Compose, PostgreSQL 15, Neo4j, RabbitMQ, Keycloak (Auth)

---

## 🚥 Getting Started

### Prerequisites

- [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) (optional, for local development)
- [Python 3.9+](https://www.python.org/) (optional, for local development)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-org/celion.git
    cd celion
    ```

2.  **Configuration:**
    Copy the example environment file and fill in your credentials:
    ```bash
    cp .env.example .env
    ```
    *Note: OpenAI API keys can also be configured directly within the application settings.*

3.  **Launch the application:**
    ```bash
    docker compose up --build
    ```

The application will be available at:
- **Frontend:** `http://localhost:8080`
- **Backend API:** `http://localhost:8000`
- **Keycloak (Auth):** `http://localhost:8888`

### Initial Setup
After the first launch, Celion automatically initializes the PostgreSQL database and imports the Keycloak realm configuration.

---

## 📋 Migration Workflow

Celion guides you through a structured 8-step process:

1.  **Source Discovery:** Automatically identifies the source API, entities, and limits.
2.  **Target Discovery:** Analyzes the destination system to map structures.
3.  **Data Staging:** Prepares the source data for transformation.
4.  **Mapping Verification:** Ensures field-to-field consistency.
5.  **Quality Enhancement:** Applies AI rules (translations, summaries, etc.).
6.  **Data Transfer:** Orchestrates the actual migration into the target system.
7.  **Verification:** Validates that all objects were created correctly.
8.  **Reporting:** Generates a final audit report.

---

## 🛡 Security & Reliability

- **Enterprise Auth:** Powered by Keycloak for secure OIDC/SAML authentication.
- **Retry Mechanism:** Automatic retry with exponential backoff for failed API calls.
- **PII Protection:** Built-in agents for identifying and redacting sensitive information before transfer.
- **Audit Logs:** Full traceability of all data transformations within the graph database.

---

## 🤝 Contributing

We welcome contributions! Please feel free to submit Pull Requests or open Issues for bugs and feature requests.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information (coming soon).

---
© 2026 Celion Migration Tools. Built with ❤️ for the open-source community.
