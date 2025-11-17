# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/5af5744c-6888-447f-8811-5f10e4549e5e

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/5af5744c-6888-447f-8811-5f10e4549e5e) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Lokale Backend-API für Migration-Schritt 2

Um die FastAPI-Bridge für Credential-Checks lokal zu nutzen, installiere die Python-Abhängigkeiten und starte den Server wie folgt:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Der Vite-Dev-Server leitet Requests an `/api/*` automatisch an `http://127.0.0.1:8000` weiter. Damit kann Schritt 2 der Migration die Zielsystem-API mit den angegebenen Credentials direkt über `/api/probe` aufrufen.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/5af5744c-6888-447f-8811-5f10e4549e5e) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## OpenAI Agent Konfiguration

Um den Celion System Detection Agent über die OpenAI Developer API ausführen zu können, werden folgende Umgebungsvariablen benötigt:

```bash
# OpenAI API Key (Pflicht)
VITE_OPENAI_API_KEY="sk-..."

# Optional: eigenes Projekt oder Workspace
VITE_OPENAI_PROJECT_ID="proj_..."

# Optional: alternatives API- oder Modell-Setup
VITE_OPENAI_API_BASE_URL="https://api.openai.com/v1"
VITE_OPENAI_SYSTEM_DETECTION_MODEL="gpt-4.1-mini"
VITE_OPENAI_AUTH_FLOW_MODEL="gpt-4.1"
```

Trage die Werte in deiner `.env` oder im Deployment-Setup ein. Der Start-Button der Migration erstellt anschließend automatisch einen temporären OpenAI-Agenten, führt ihn aus und zeigt das Ergebnis direkt in der Celion-Oberfläche an.
