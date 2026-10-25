# hunt: common tasks. `make` alone runs `make dev`: hunt as you're changing
# it, on an empty database. `make help` lists the rest, by who they're for:
# trying hunt, running it, working on it, testing it, and (mk/maintain.mk)
# releasing it.
#
# Settings, overridable as `make serve ADDR=0.0.0.0:8080 DB=./dev.db`:
#   ADDR          where hunt listens, or is reached (backup, restore, try)
#   DB            serve's database: a SQLite file, or a postgres://… or mysql://… address
#   BACKUPS       where backup saves to
#   HUNT_VERSION  which image try runs: release, a version (v0.17.0), or latest
ADDR         ?= 127.0.0.1:4848
DB           ?= $(HOME)/.hunt/hunt.db
BACKUPS      ?= backups
HUNT_VERSION ?= release
IMAGE        ?= ghcr.io/arabesquelabs/hunt

# Throwaway servers for testing on PostgreSQL and MySQL (Docker).
PG_URL    ?= postgres://postgres:hunt@127.0.0.1:55432/postgres
MYSQL_URL ?= mysql://root:hunt@127.0.0.1:53306/

CARGO ?= cargo
NPM   ?= npm

# Running hunt from deploy/: its compose file (with its .env beside it), and
# its Kustomize folder (with its .env and .secrets).
COMPOSE = docker compose -f deploy/docker/compose.yaml
K8S     = deploy/kubernetes

# The web UI (React, in src/web) is built into src/web/dist, which the
# binary compiles in: anything that builds hunt builds it first. Needs Node
# (20.19 or 22.12 and later).
WEB_SRC := $(shell find src/web/src -type f) $(wildcard src/web/*.css src/web/vendor/arabesque/*.css src/web/vendor/arabesque/js/*.js) \
  src/web/img/logo.svg src/web/package.json src/web/vite.config.ts src/web/vite.editor.config.ts src/web/tsconfig.json

.DEFAULT_GOAL := dev
.PHONY: help try try-demo doctor docker-up docker-down docker-logs docker-update k8s-up k8s-update k8s-down \
  install serve update backup backup-first restore \
  web build release-build dev dev-demo dev-password dev-tenants dev-serve watch demo image image-try check doc uninstall clean \
  test test-postgres test-mysql test-all db-up db-down lint fmt fmt-check ci

help: # List the targets
	@printf '\nNew to hunt? \033[1mmake try-demo\033[0m to look around (Docker), or \033[1mmake doctor\033[0m to see how it can run here.\n'
	@printf 'Working on it? \033[1mmake\033[0m (or \033[1mmake dev\033[0m) runs it, on an empty database each start.\n'
	@awk 'BEGIN { FS = ":.*## " } /^##@ / { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } /^[a-z-]+:.*## / { printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

##@ Try hunt: with Docker, keeping nothing

try: ## A new, empty hunt on ADDR (127.0.0.1:4848), on its launcher (HUNT_VERSION); ctrl-c ends it
	docker run --rm -it -p $(ADDR):4848 $(IMAGE):$(HUNT_VERSION)

try-demo: ## The same, with made-up data on every page
	docker run --rm -it --pull always -p $(ADDR):4848 $(IMAGE):demo

##@ Run hunt: on your own machine or server

# What each way of running hunt needs: Docker with Compose, or Rust and Node
# to build it. Fine if either is there.
doctor: ## Check what running hunt needs, with Docker or from source
	@docker_ok=0; source_ok=1; \
	if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then \
	  echo "missing  Docker with Compose v2, to run hunt's image: https://docs.docker.com/get-docker/"; \
	elif ! docker info >/dev/null 2>&1; then echo "stopped  Docker is installed, but not running: start it for make docker-up"; \
	else echo "ok       Docker, with Compose: make docker-up"; docker_ok=1; fi; \
	if command -v kubectl >/dev/null; then echo "ok       kubectl: make k8s-up"; fi; \
	if command -v cargo >/dev/null && rustc --version | awk '{ split($$2, v, "."); exit !(v[1] > 1 || v[2] >= 85) }'; then \
	  echo "ok       Rust $$(rustc --version | awk '{ print $$2 }')"; \
	else echo "missing  Rust 1.85 or later, to build hunt: https://rustup.rs"; source_ok=0; fi; \
	if command -v node >/dev/null && command -v npm >/dev/null && node --version | awk -F'[v.]' '{ exit !($$2 > 22 || ($$2 == 22 && $$3 >= 12) || ($$2 == 20 && $$3 >= 19)) }'; then \
	  echo "ok       Node $$(node --version), for the web UI"; \
	else echo "missing  Node 20.19, or 22.12 and later, to build the web UI: https://nodejs.org"; source_ok=0; fi; \
	[ $$source_ok = 1 ] && echo "ok       from source: make install && make serve"; \
	[ $$docker_ok = 1 ] || [ $$source_ok = 1 ] || { echo "hunt needs one of these to run"; exit 1; }

deploy/docker/.env:
	cp deploy/docker/.env.example $@
	@echo "made $@: hunt's settings (its version, its owner, where it listens)"

docker-up: deploy/docker/.env ## Run hunt in Docker (deploy/docker, its settings in .env there)
	$(COMPOSE) up -d
	@echo "hunt is on http://$(ADDR): a new hunt opens on its launcher, to set it up"

docker-down: ## Stop it (its data stays, in the hunt-data volume)
	$(COMPOSE) down

docker-logs: ## Follow its log
	$(COMPOSE) logs -f hunt

docker-update: deploy/docker/.env ## Back it up (into BACKUPS), then run the newest image of its HUNT_VERSION
	@$(MAKE) --no-print-directory backup-first
	$(COMPOSE) pull
	$(COMPOSE) up -d

$(K8S)/.env $(K8S)/.secrets:
	cp $@.example $@
	@echo "made $@: fill it in as it says, then make k8s-up again if needed"

k8s-up: $(K8S)/.env $(K8S)/.secrets ## Run hunt on Kubernetes (deploy/kubernetes, in the namespace hunt)
	kubectl apply -k $(K8S)
	kubectl -n hunt rollout status deployment/hunt
	@echo "reach it with: kubectl -n hunt port-forward svc/hunt 4848 (or see $(K8S)/ingress.example.yaml)"

k8s-update: ## Restart it on the newest image of its tag (back it up first: make backup, through a port-forward)
	kubectl -n hunt rollout restart deployment/hunt
	kubectl -n hunt rollout status deployment/hunt

k8s-down: ## Take it down, keeping its volume (and data): kubectl -n hunt delete pvc hunt-data deletes that
	kubectl -n hunt delete deployment/hunt service/hunt --ignore-not-found

install: web ## Build hunt from source and install it into ~/.cargo/bin (needs Rust and Node: see doctor)
	$(CARGO) install --path . --locked

serve: release-build ## Run one person's hunt from source (ADDR, DB): make its owner (the launcher) before ADDR=0.0.0.0:…
	./target/release/hunt serve --addr $(ADDR) --db "$(DB)"

update: ## Back it up (if it's running), git pull, and install again
	@$(MAKE) --no-print-directory backup-first
	git pull --ff-only
	$(MAKE) install
	@echo "updated: restart hunt to use it"

# Through the API, so it's the same for Docker, Kubernetes (through a
# port-forward) and a build of hunt; as its owner (HUNT_EMAIL and
# HUNT_PASSWORD, as the CLI signs in), once it has one.
backup: ## Save everything in the running hunt (ADDR) to BACKUPS/hunt-backup-<date>.json
	@mkdir -p "$(BACKUPS)"
	@out="$(BACKUPS)/hunt-backup-$$(date +%Y-%m-%d-%H%M%S).json"; \
	curl -fsS $${HUNT_EMAIL:+-u "$$HUNT_EMAIL:$$HUNT_PASSWORD"} -o "$$out" http://$(ADDR)/api/backup \
	  && echo "saved $$out" || { rm -f "$$out"; echo "no backup: is hunt running on $(ADDR)? As its owner, set HUNT_EMAIL and HUNT_PASSWORD"; exit 1; }

# Before an update: a backup, the way back (a backup imports only into the
# hunt that made it, or a newer one), if hunt's answering. SKIP_BACKUP=1 skips.
backup-first:
	@if [ -n "$(SKIP_BACKUP)" ]; then echo "not backing up first (SKIP_BACKUP)"; \
	elif curl -fs -o /dev/null http://$(ADDR)/healthz; then $(MAKE) --no-print-directory backup || \
	  { echo "update stopped: set HUNT_EMAIL and HUNT_PASSWORD to back up first, or SKIP_BACKUP=1"; exit 1; }; \
	else echo "hunt isn't answering on $(ADDR): nothing to back up first"; fi

restore: ## Replace everything in the running hunt (ADDR) with a backup: FILE=backups/hunt-backup-….json
	@[ -f "$(FILE)" ] || { echo "say which backup: make restore FILE=backups/hunt-backup-….json"; exit 1; }
	@printf 'Replace everything in the hunt on %s with %s? It cannot be undone. [y/N] ' "$(ADDR)" "$(FILE)"; \
	read answer; [ "$$answer" = y ] || [ "$$answer" = Y ] || { echo "left as it was"; exit 1; }
	@curl -fsS $${HUNT_EMAIL:+-u "$$HUNT_EMAIL:$$HUNT_PASSWORD"} -H "Content-Type: application/json" \
	  --data-binary @"$(FILE)" "http://$(ADDR)/api/backup?confirm=replace" >/dev/null \
	  && echo "restored $(FILE)" || { echo "not restored: is hunt running on $(ADDR)? As its owner, set HUNT_EMAIL and HUNT_PASSWORD"; exit 1; }

##@ Work on hunt

web: src/web/dist/app.js ## Build the web UI into src/web/dist (needs Node)

src/web/node_modules/.package-lock.json: src/web/package-lock.json
	cd src/web && $(NPM) ci

src/web/dist/app.js: src/web/node_modules/.package-lock.json $(WEB_SRC)
	cd src/web && $(NPM) run build

build: web ## Build (debug)
	$(CARGO) build

release-build: web ## Build optimised, into target/release/hunt
	$(CARGO) build --release

# target/dev.db: dev's throwaway database, emptied each time dev starts,
# filled by demo; dev-tenants, dev-password and watch serve it as it is.
DEV_DB = target/dev.db

dev: web ## Run hunt as it is here, on an empty database each start: the launcher, every time (the default)
	rm -f $(DEV_DB) $(DEV_DB)-wal $(DEV_DB)-shm
	$(CARGO) run -- serve --addr $(ADDR) --db $(DEV_DB)

dev-demo: demo ## Like dev, with demo's made-up data each start, set up already
	$(CARGO) run -- serve --addr $(ADDR) --db $(DEV_DB)

dev-password: web ## Serve dev's database, its owner dev@example.test (password dev-password) made from HUNT_ADMIN_EMAIL and _PASSWORD
	HUNT_ADMIN_EMAIL=dev@example.test HUNT_ADMIN_PASSWORD=dev-password $(CARGO) run -- serve --addr $(ADDR) --db $(DEV_DB)

demo: build ## Fill dev's database (target/dev.db, which watch serves) with made-up data, replacing it
	scripts/demo.sh $(DEV_DB)
	@! curl -fs -o /dev/null http://$(ADDR)/api/meta || echo "a hunt is running on $(ADDR): restart it to see the demo data"

# Several people, locally: no Cloudflare Access, so who's asking is taken on
# trust, from a header or the cookie /dev/as sets. ADMINS: the admins.
ADMINS ?= admin@example.test
comma := ,
TENANTS_FLAGS = --admins $(ADMINS) --identity-header X-Hunt-User
BE_SOMEONE = @echo "be the admin:   http://$(ADDR)/dev/as?email=$(firstword $(subst $(comma), ,$(ADMINS)))"; \
  echo "be someone new: http://$(ADDR)/dev/as?email=someone@example.test"

dev-tenants: web ## Serve dev's database for several people (ADMINS), as it is; be someone at /dev/as?email=…
	$(BE_SOMEONE)
	$(CARGO) run -- serve --addr $(ADDR) --db $(DEV_DB) $(TENANTS_FLAGS)

dev-serve: web ## Like dev-tenants, on your own database (DB): never where others can reach it
	$(BE_SOMEONE)
	$(CARGO) run -- serve --addr $(ADDR) --db "$(DB)" $(TENANTS_FLAGS)

# The web UI is rebuilt as it changes (vite build --watch), and hunt with it.
watch: web ## Like dev-tenants, rebuilt and restarted on every change (needs cargo-watch)
	@command -v cargo-watch >/dev/null || { echo "install it with: cargo install cargo-watch"; exit 1; }
	$(BE_SOMEONE)
	(cd src/web && $(NPM) run watch) & \
	$(CARGO) watch -w src -i 'src/web/src/**' -i 'src/web/node_modules/**' -x 'run -- serve --addr $(ADDR) --db $(DEV_DB) $(TENANTS_FLAGS)'

# The image as CI builds it, for this machine: TARGET=demo for the demo's.
TARGET ?= hunt
image: ## Build the container image here, as hunt:dev (TARGET=demo: the demo's, as hunt:dev-demo)
	docker build --target $(TARGET) -t hunt:dev$(if $(filter demo,$(TARGET)),-demo) .

image-try: ## Run that image, keeping nothing: Docker and the launcher, as a newcomer sees them
	docker run --rm -it -p $(ADDR):4848 hunt:dev$(if $(filter demo,$(TARGET)),-demo)

check: web ## Type-check without building
	$(CARGO) check --all-targets

doc: ## Build and open the API docs
	$(CARGO) doc --no-deps --open

uninstall: ## Remove the installed `hunt`
	$(CARGO) uninstall hunt

clean: ## Remove build output
	$(CARGO) clean
	rm -rf src/web/dist

##@ Test

test: web ## Run all tests (on SQLite)
	$(CARGO) test

db-up: ## Start PostgreSQL and MySQL in Docker, for test-postgres and test-mysql
	@docker start hunt-pg >/dev/null 2>&1 || docker run -d --name hunt-pg -e POSTGRES_PASSWORD=hunt -p 127.0.0.1:55432:5432 postgres:17 >/dev/null
	@docker start hunt-mysql >/dev/null 2>&1 || docker run -d --name hunt-mysql -e MYSQL_ROOT_PASSWORD=hunt -p 127.0.0.1:53306:3306 mysql:8.4 >/dev/null
	@echo "waiting for the databases…"; for i in $$(seq 60); do \
	  docker exec hunt-pg pg_isready -q -U postgres 2>/dev/null && docker exec hunt-mysql mysqladmin ping -uroot -phunt --silent 2>/dev/null && break; sleep 1; done

db-down: ## Remove the test databases' containers
	-docker rm -f hunt-pg hunt-mysql

test-postgres: web ## Run the API tests on PostgreSQL (PG_URL; see db-up)
	HUNT_TEST_DB=$(PG_URL) $(CARGO) test --test api

test-mysql: web ## Run the API tests on MySQL (MYSQL_URL; see db-up)
	HUNT_TEST_DB=$(MYSQL_URL) $(CARGO) test --test api

test-all: test test-postgres test-mysql ## Tests on SQLite, PostgreSQL and MySQL

lint: web ## Clippy, with warnings as errors
	$(CARGO) clippy --all-targets -- -D warnings

fmt: ## Format the code
	$(CARGO) fmt

fmt-check: ## Fail if the code isn't formatted
	$(CARGO) fmt --check

ci: web fmt-check lint test ## What CI runs: the web UI built (and type-checked), format check, lint, tests

# Releasing hunt, its docs and its assets: the maintainer's.
include mk/maintain.mk
