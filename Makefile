# Makefile for the Celion project
#
# Usage:
#   make           - Start all services in detached mode.
#   make up        - Alias for 'make'.
#   make down      - Stop all services and remove associated resources.
#   make stop      - Alias for 'make down'.
#   make logs      - View the logs of all running application containers.
#   make ssh service=<service_name> - SSH into a running service container (e.g., webapp, worker, api, db).

SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: all up down stop restart logs ssh

all: up

# Build and start all services in detached mode using Docker Compose.
up:
	@echo "Starting application containers in detached mode..."
	@$(COMPOSE) up --build -d

# Stop and remove all application containers and volumes created by Compose.
down:
	@echo "Stopping application containers..."
	@$(COMPOSE) down -v --remove-orphans

# 'stop' is a more intuitive alias for 'down'.
stop: down

# Restart application containers.
restart: down up

# Follow the logs of the application containers.
logs:
	@$(COMPOSE) logs -f

# SSH into a running service container.
# Example: make ssh service=webapp
ssh:
	@if [ -z "$(service)" ]; then \
		echo "Please specify a service. Usage: make ssh service=<service_name>"; \
		echo "Available services: webapp, worker, api, db"; \
	else \
		$(COMPOSE) exec $(service) /bin/sh; \
	fi
