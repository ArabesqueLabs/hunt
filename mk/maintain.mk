# The maintainer's: releasing hunt, publishing its docs (careerhunt.app),
# its pictures, and keeping its dependencies up to date. Included by the
# Makefile; docs/maintaining.md says how they fit together.
#
# Nothing here commits, or pushes a branch: that's yours, with jj. `publish`
# pushes a release's tag, once its commit is on main.

# careerhunt.app, beside hunt: where its docs are built from hunt's.
SITE    ?= ../careerhunt.app
# The version being released: `make release VERSION=0.17.0`.
VERSION ?=
# DRY_RUN=1: say what publish would do, and do none of it.
RUN = $(if $(DRY_RUN),@echo "would run:",)

# This hunt's version, and the notes for it that release drafts.
CURRENT = $(shell grep -m1 '^version' Cargo.toml | cut -d '"' -f2)
NOTES   = target/release-notes-v$(1).md

.PHONY: release publish site-sync docs-preview site-deploy screenshots cli-docs logo audit deps dev-hosted

##@ Maintain hunt

# Ready a release, in the working copy, and commit nothing: the version (in
# Cargo.toml and Cargo.lock), the CLI's pages, CI's checks, and notes drafted
# from the log since the last release.
release: ## Ready a release in the working copy: VERSION=x.y.z (then commit, push main, and make publish)
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "say which version: make release VERSION=x.y.z (now $(CURRENT))"; exit 1; }
	@[ "$$(printf '%s\n%s\n' "$(CURRENT)" "$(VERSION)" | sort -V | tail -1)" = "$(VERSION)" ] && [ "$(CURRENT)" != "$(VERSION)" ] \
	  || { echo "$(VERSION) isn't after $(CURRENT)"; exit 1; }
	@[ -z "$$(jj diff -r @ --summary)" ] || { echo "start from an empty change (jj new): the release is its own"; exit 1; }
	perl -0pi -e 's/^version = "[^"]*"/version = "$(VERSION)"/m' Cargo.toml
	$(CARGO) update -p hunt --offline 2>/dev/null || $(CARGO) update -p hunt
	$(MAKE) --no-print-directory cli-docs ci
	@mkdir -p target
	@{ echo "# hunt $(VERSION)"; echo; echo "## What's new"; echo; \
	  jj log --no-graph -r '(tags()..@-) ~ root()' -T 'if(description, "- " ++ description.first_line() ++ "\n")'; \
	  echo; echo "## Running it"; echo; \
	  echo "\`ghcr.io/arabesquelabs/hunt:v$(VERSION)\` (or \`:release\`, the newest release). Back up before updating: a backup imports only into the hunt that made it, or a newer one."; \
	} > $(call NOTES,$(VERSION))
	@echo; echo "hunt $(VERSION), ready in the working copy. Next:"; \
	echo "  1. edit $(call NOTES,$(VERSION)): what people will notice, first"; \
	echo "  2. jj commit -m 'hunt $(VERSION)', and push main"; \
	echo "  3. make publish   (once CI's green on main)"

# The release on main, published: its tag (which builds :vX.Y.Z and
# :release), its GitHub release (the sidebar's "hunt X.Y.Z" links there),
# and careerhunt.app's docs, rebuilt.
publish: ## Tag main's release, push the tag, make its GitHub release, and rebuild the docs (DRY_RUN=1 to see)
	@v=$$(jj file show -r main@origin Cargo.toml | grep -m1 '^version' | cut -d '"' -f2); \
	[ "$$v" = "$(CURRENT)" ] || { echo "main (on GitHub) is at $$v, here $(CURRENT): push the release first"; exit 1; }; \
	[ -f $(call NOTES,$(CURRENT)) ] || { echo "no $(call NOTES,$(CURRENT)): make release VERSION=$(CURRENT) drafts it"; exit 1; }; \
	! git ls-remote --exit-code --tags origin "v$$v" >/dev/null || { echo "v$$v is already published"; exit 1; }
	$(RUN) jj tag set v$(CURRENT) -r main@origin
	$(RUN) git push origin refs/tags/v$(CURRENT)
	$(RUN) gh release create v$(CURRENT) --verify-tag --title "hunt $(CURRENT)" --notes-file $(call NOTES,$(CURRENT))
	$(RUN) $(MAKE) --no-print-directory site-deploy
	@echo "$(if $(DRY_RUN),would publish,published) hunt $(CURRENT): the image workflow builds :v$(CURRENT) and :release"

site-sync: ## Write this hunt's docs into careerhunt.app (SITE), as its deploy does
	HUNT_DIR=$(CURDIR) $(SITE)/scripts/sync.py

docs-preview: site-sync ## The docs on http://localhost:3000/docs/, as careerhunt.app will show them
	cd $(SITE)/docusaurus && { [ -d node_modules ] || $(NPM) ci; } && $(NPM) start

site-deploy: ## Rebuild careerhunt.app from hunt's main (its deploy workflow, through GitHub)
	gh api repos/ArabesqueLabs/careerhunt.app/dispatches -f event_type=hunt-updated
	@echo "careerhunt.app is rebuilding: gh run list -R ArabesqueLabs/careerhunt.app"

screenshots: build ## Photograph the demo's pages into docs/screenshots, for docs/screenshots.md and careerhunt.app (needs Chrome and Node)
	node scripts/screenshots.mjs

cli-docs: build ## Write each CLI command's help into its page, docs/cli/<command>.md
	scripts/cli-docs.sh

logo: ## The logo as PNGs, in the app's colours, into docs/logo (needs Chrome and Node)
	node scripts/logo.mjs

audit: ## Known vulnerabilities in the dependencies (cargo-audit, if installed; npm)
	@if command -v cargo-audit >/dev/null; then $(CARGO) audit; else echo "skipping Rust's: cargo install cargo-audit"; fi
	cd src/web && $(NPM) audit --omit=dev

deps: ## Update the dependencies (within their versions), then run CI's checks
	$(CARGO) update
	cd src/web && $(NPM) update
	$(MAKE) --no-print-directory ci

# Arabesque Labs' own: their hosted hunt, with careerhunt.app's terms.
HOSTED_ENV = HUNT_SITE_URL=https://careerhunt.app HUNT_OPERATOR="Arabesque Labs Ltd"

dev-hosted: web ## Like dev-tenants, as the hosted hunt: terms to agree to, and careerhunt.app's legal pages linked
	$(BE_SOMEONE)
	$(HOSTED_ENV) $(CARGO) run -- serve --addr $(ADDR) --db $(DEV_DB) $(TENANTS_FLAGS)
