# hunt: common tasks. `make help` lists them.
#
# Settings, overridable as `make serve ADDR=0.0.0.0:8080 DB=./dev.db`. DB is
# a SQLite file, or a postgres://… or mysql://… address.
ADDR ?= 127.0.0.1:4848
DB   ?= $(HOME)/.hunt/hunt.db

# Throwaway servers for testing on PostgreSQL and MySQL (Docker).
PG_URL    ?= postgres://postgres:hunt@127.0.0.1:55432/postgres
MYSQL_URL ?= mysql://root:hunt@127.0.0.1:53306/

CARGO ?= cargo

.DEFAULT_GOAL := help
.PHONY: help build release serve serve-release dev dev-tenants dev-hosted watch demo screenshots cli-docs logo test test-postgres test-mysql test-all db-up db-down check lint fmt fmt-check ci doc install uninstall clean

help: ## List the targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

build: ## Build (debug)
	$(CARGO) build

release: ## Build optimised, into target/release/hunt
	$(CARGO) build --release

serve: ## Run the service and web UI (ADDR, DB) for several people, as dev-tenants does: never where others can reach it
	@echo "be the admin:  http://$(ADDR)/dev/as?email=$(firstword $(subst $(comma), ,$(ADMINS)))"
	@echo "be someone new: http://$(ADDR)/dev/as?email=someone@example.test"
	$(CARGO) run -- serve --addr $(ADDR) --db "$(DB)" $(TENANTS_FLAGS)

serve-release: release ## Run the optimised build (ADDR, DB)
	./target/release/hunt serve --addr $(ADDR) --db "$(DB)"

dev: ## Serve a throwaway database in target/, for trying things out
	$(CARGO) run -- serve --addr $(ADDR) --db target/dev.db

# Several people, locally: no Cloudflare Access, so who's asking is taken on
# trust, from a header or the cookie /dev/as sets. ADMINS: the admins.
ADMINS ?= admin@example.test
comma := ,
TENANTS_FLAGS = --tenants --admins $(ADMINS) --identity-header X-Hunt-User

dev-tenants: ## Like dev, for several people (ADMINS); be someone at /dev/as?email=…
	@echo "be the admin:  http://$(ADDR)/dev/as?email=$(firstword $(subst $(comma), ,$(ADMINS)))"
	@echo "be someone new: http://$(ADDR)/dev/as?email=someone@example.test"
	$(CARGO) run -- serve --addr $(ADDR) --db target/dev.db $(TENANTS_FLAGS)

# Arabesque Labs' own: their hosted hunt, with careerhunt.app's terms.
HOSTED_ENV = HUNT_SITE_URL=https://careerhunt.app HUNT_OPERATOR="Arabesque Labs Ltd"

dev-hosted: ## Like dev-tenants, as the hosted hunt: terms to agree to, and careerhunt.app's legal pages linked
	@echo "be the admin:   http://$(ADDR)/dev/as?email=$(firstword $(subst $(comma), ,$(ADMINS)))"
	@echo "be someone new: http://$(ADDR)/dev/as?email=someone@example.test"
	$(HOSTED_ENV) $(CARGO) run -- serve --addr $(ADDR) --db target/dev.db $(TENANTS_FLAGS)

watch: ## Like dev-tenants, rebuilt and restarted on every change (needs cargo-watch)
	@command -v cargo-watch >/dev/null || { echo "install it with: cargo install cargo-watch"; exit 1; }
	@echo "be the admin:  http://$(ADDR)/dev/as?email=$(firstword $(subst $(comma), ,$(ADMINS)))"
	@echo "be someone new: http://$(ADDR)/dev/as?email=someone@example.test"
	$(CARGO) watch -w src -x 'run -- serve --addr $(ADDR) --db target/dev.db $(TENANTS_FLAGS)'

demo: build ## Fill target/dev.db (what dev and watch serve) with demo data, replacing it
	scripts/demo.sh target/dev.db
	@! curl -fs -o /dev/null http://$(ADDR)/api/meta || echo "a hunt is running on $(ADDR): restart it to see the demo data"

screenshots: build ## Photograph the demo's pages into docs/screenshots, for docs/screenshots.md and careerhunt.app (needs Chrome and Node)
	node scripts/screenshots.mjs

cli-docs: build ## Write each CLI command's help into its page, docs/cli/<command>.md
	scripts/cli-docs.sh

logo: ## The logo as PNGs, in the app's colours, into docs/logo (needs Chrome and Node)
	node scripts/logo.mjs

test: ## Run all tests (on SQLite)
	$(CARGO) test

db-up: ## Start PostgreSQL and MySQL in Docker, for test-postgres and test-mysql
	@docker start hunt-pg >/dev/null 2>&1 || docker run -d --name hunt-pg -e POSTGRES_PASSWORD=hunt -p 127.0.0.1:55432:5432 postgres:17 >/dev/null
	@docker start hunt-mysql >/dev/null 2>&1 || docker run -d --name hunt-mysql -e MYSQL_ROOT_PASSWORD=hunt -p 127.0.0.1:53306:3306 mysql:8.4 >/dev/null
	@echo "waiting for the databases…"; for i in $$(seq 60); do \
	  docker exec hunt-pg pg_isready -q -U postgres 2>/dev/null && docker exec hunt-mysql mysqladmin ping -uroot -phunt --silent 2>/dev/null && break; sleep 1; done

db-down: ## Remove the test databases' containers
	-docker rm -f hunt-pg hunt-mysql

test-postgres: ## Run the API tests on PostgreSQL (PG_URL; see db-up)
	HUNT_TEST_DB=$(PG_URL) $(CARGO) test --test api

test-mysql: ## Run the API tests on MySQL (MYSQL_URL; see db-up)
	HUNT_TEST_DB=$(MYSQL_URL) $(CARGO) test --test api

test-all: test test-postgres test-mysql ## Tests on SQLite, PostgreSQL and MySQL

check: ## Type-check without building
	$(CARGO) check --all-targets

lint: ## Clippy, with warnings as errors
	$(CARGO) clippy --all-targets -- -D warnings

fmt: ## Format the code
	$(CARGO) fmt

fmt-check: ## Fail if the code isn't formatted
	$(CARGO) fmt --check

ci: fmt-check lint test ## What CI should run: format check, lint, tests

doc: ## Build and open the API docs
	$(CARGO) doc --no-deps --open

install: ## Install `hunt` into ~/.cargo/bin
	$(CARGO) install --path . --locked

uninstall: ## Remove the installed `hunt`
	$(CARGO) uninstall hunt

clean: ## Remove build output
	$(CARGO) clean
