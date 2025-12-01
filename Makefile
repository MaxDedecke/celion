# Makefile for the Celion project
#
# Usage:
#   make           - Start all services (database and application) in detached mode.
#   make up        - Alias for 'make'.
#   make down      - Stop all services (database and application).
#   make stop      - Alias for 'make down'.
#   make logs      - View the logs of all running application containers.
#   make ssh service=<service_name> - SSH into a running service container (e.g., webapp, worker, api).

# Use .PHONY to ensure these targets run even if files with the same name exist.
.PHONY: all up down stop supabase-start db-reset logs ssh

# Default target when you just run 'make'
all: up

# Build and start all services in detached mode.
# This target first ensures the database is running and migrations are applied.
up: supabase-start db-reset
	@echo "Starting application containers in detached mode..."
	docker-compose up --build -d

# Stop and remove all application containers.
# It also stops the Supabase services.
down:
	@echo "Stopping application containers..."
	@docker-compose down -v --remove-orphans
	@echo "Stopping Supabase services..."
	@npx supabase stop

# 'stop' is a more intuitive alias for 'down'.
stop: down

# Target to start the local Supabase stack (Postgres, GoTrue, etc.).
supabase-start:
	@echo "Starting Supabase services (this may take a moment)..."
	@npx supabase start

# Target to reset the local database and apply all migrations from scratch.
# This is useful for ensuring a clean state in development.
db-reset:
	@echo "Resetting local database and applying all migrations..."
	@npx supabase db reset

# Follow the logs of the application containers.
logs:
	@docker-compose logs -f

# SSH into a running service container.
# Example: make ssh service=webapp
ssh:
	@if [ -z "$(service)" ]; then \
		echo "Please specify a service. Usage: make ssh service=<service_name>"; \
		echo "Available services: webapp, worker, api"; \
	else \
		docker-compose exec $(service) /bin/sh; \
	fi
