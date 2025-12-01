# Makefile for the Celion project
#
# Usage:
#   make           - Start all services (database and application) in detached mode.
#   make up        - Alias for 'make'.
#   make down      - Stop all services (database and application).
#   make stop      - Alias for 'make down'.
#   make logs      - View the logs of all running application containers.
#   make ssh service=<service_name> - SSH into a running service container (e.g., webapp, worker, api).
# Use bash for better scripting capabilities
SHELL := /bin/bash

# Use .PHONY to ensure these targets run even if files with the same name exist.
.PHONY: all up down stop supabase-start db-reset logs ssh
# Define the path to local node binaries. This ensures we use the project's dependencies.
NODE_BIN := ./node_modules/.bin

# Default target when you just run 'make'
# Check if the Supabase CLI is available at the expected path.
# The `if` condition checks for the existence of the file.
# The `$(if ...)` is a Make function. The shell command `[ -f ... ]` returns exit code 0 if true.
# `$(shell ...)` executes the shell command. We check if the output of `echo $$?` is 0.
SUPABASE_CLI := $(NODE_BIN)/supabase
SUPABASE_CLI_EXISTS := $(shell [ -f $(SUPABASE_CLI) ] && echo 1)

.PHONY: all up down start stop restart status logs

all: up

# Build and start all services in detached mode.
# This target first ensures the database is running and migrations are applied.
up: supabase-start db-reset
	@echo "Starting application containers in detached mode..."
	docker-compose up --build -d
# Target to start all services.
up: supabase-start

# Stop and remove all application containers.
# It also stops the Supabase services.
down:
	@echo "Stopping application containers..."
	@docker-compose down -v --remove-orphans
	@echo "Stopping Supabase services..."
	@npx supabase stop
# Target to stop all services.
down: supabase-stop

# 'stop' is a more intuitive alias for 'down'.
stop: down
# Target to start Supabase services.
start: supabase-start

# Target to start the local Supabase stack (Postgres, GoTrue, etc.).
# Target to stop Supabase services.
stop: supabase-stop

# Target to restart Supabase services.
restart: supabase-stop supabase-start

# Target to get the status of Supabase services.
status:
	@$(MAKE) supabase-status

# Internal target to start Supabase. It checks for the CLI first.
.PHONY: supabase-start
supabase-start:
	@echo "Starting Supabase services (this may take a moment)..."
	@npx supabase start
	@if [ "$(SUPABASE_CLI_EXISTS)" != "1" ]; then \
		echo "Error: Supabase CLI not found at $(SUPABASE_CLI)."; \
		echo "Please run 'npm install'."; \
		exit 1; \
	fi
	@$(SUPABASE_CLI) start

# Target to reset the local database and apply all migrations from scratch.
# This is useful for ensuring a clean state in development.
db-reset:
	@echo "Resetting local database and applying all migrations..."
	@npx supabase db reset
# Internal target to stop Supabase.
.PHONY: supabase-stop
supabase-stop:
	@echo "Stopping Supabase services..."
	@$(SUPABASE_CLI) stop

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
# Internal target to get Supabase status.
.PHONY: supabase-status
supabase-status:
	@$(SUPABASE_CLI) status
