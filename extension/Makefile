all: clean build

.PHONY: all clean build firefox chrome safari validate version same-version

# What goes in each browser's build, beside its manifest.
PARTS = background.js popup options lib icons vendor

# One version for every browser: each manifest carries it, and the Safari
# app takes it from them. Set it in both at once with make version V=0.3.0
# (at most three numbers, as the Mac app's version can only have three);
# a build stops if the two disagree.
MANIFESTS = src/manifest-chrome.json src/manifest-firefox.json

version:
	@python3 -c 'import re, sys; v = sys.argv[1]; re.fullmatch(r"\d+(\.\d+){0,2}", v) or sys.exit("Give the version as up to three numbers: make version V=0.3.0")' "$(V)"
	@for m in $(MANIFESTS); do \
		python3 -c 'import re, sys; m, v = sys.argv[1:]; s = open(m).read(); s, n = re.subn(r"(\"version\":\s*)\"[^\"]*\"", lambda x: x.group(1) + "\"" + v + "\"", s, count=1); n or sys.exit(m + " has no version"); open(m, "w").write(s)' $$m "$(V)" || exit 1; \
	done
	@echo "✓ Version $(V) in $(MANIFESTS)"

same-version:
	@python3 -c 'import json, sys; v = {m: json.load(open(m))["version"] for m in sys.argv[1:]}; len(set(v.values())) == 1 or sys.exit("The manifests disagree on the version (" + ", ".join(m + ": " + x for m, x in v.items()) + "): set it in both with make version V=…")' $(MANIFESTS)

# clean
clean:
	rm -rf dist/chrome dist/firefox dist/safari dist/safari-src

# build both, unpacked in dist/<browser>/ and zipped for its store
build: chrome firefox

chrome: same-version
	rm -rf dist/chrome && mkdir -p dist/chrome
	cp src/manifest-chrome.json dist/chrome/manifest.json
	cd src && cp -R $(PARTS) ../dist/chrome/
	(cd dist/chrome && rm -f hunt.zip && zip -qr hunt.zip . -x hunt.zip)

firefox: same-version
	rm -rf dist/firefox && mkdir -p dist/firefox
	cp src/manifest-firefox.json dist/firefox/manifest.json
	cd src && cp -R $(PARTS) ../dist/firefox/
	(cd dist/firefox && rm -f hunt.zip && zip -qr hunt.zip . -x hunt.zip)

# Safari: an Xcode project wrapping the Chrome build, in dist/safari/ (needs
# a Mac with Xcode; signing it to share needs an Apple developer account).
# The converter is Xcode's, not the Command Line Tools': when those are the
# developer directory (xcode-select -p), Xcode's is used for this alone.
XCODE ?= /Applications/Xcode.app/Contents/Developer
SAFARI_DEV = $(shell xcode-select -p 2>/dev/null | grep -q CommandLineTools && test -d $(XCODE) && echo "DEVELOPER_DIR=$(XCODE)")

# The oldest macOS the app installs on (Safari there needs to be 16.4 or
# newer, which macOS 12 gets as an update), and its build number: each upload
# to App Store Connect needs a higher one (make safari SAFARI_BUILD=2).
SAFARI_MACOS ?= 12.0
SAFARI_BUILD ?= 1
# The Apple developer team that signs it (Xcode → Settings → Accounts), and
# so that App Store Connect takes it from.
SAFARI_TEAM ?= 449L9365N4
# The Mac app's bundle ID (the extension's is it, .Extension): its own, not
# the mobile app's (app.careerhunt.hunt), so it's an app of its own in App
# Store Connect, not the mobile app's macOS version.
SAFARI_ID ?= app.careerhunt.safari

# It's converted from a copy of the Chrome build, without the Chrome store's
# zip and with the background script joined into one plain script (Safari's
# can't be a module); then the project gets hunt's icon, SAFARI_MACOS, the
# manifest's version, SAFARI_BUILD, SAFARI_TEAM, SAFARI_ID and its App Store
# category (safari/adapt.py).
safari: chrome
	rm -rf dist/safari-src && cp -R dist/chrome dist/safari-src && rm dist/safari-src/hunt.zip
	python3 safari/adapt.py extension dist/safari-src
	$(SAFARI_DEV) xcrun safari-web-extension-converter dist/safari-src --project-location dist/safari \
		--app-name "hunt" --bundle-identifier $(SAFARI_ID) \
		--macos-only --copy-resources --no-open --no-prompt --force
	python3 safari/adapt.py project dist/safari/hunt $(SAFARI_MACOS) $(SAFARI_BUILD) $(SAFARI_TEAM) $(SAFARI_ID)
	@echo "Open it in Xcode: open dist/safari/hunt/hunt.xcodeproj"

# validate the manifests (and, with Mozilla's web-ext installed, the
# Firefox build: npx web-ext lint)
validate: same-version
	@python3 -m json.tool src/manifest-firefox.json > /dev/null && echo "✓ Firefox manifest is valid JSON"
	@python3 -m json.tool src/manifest-chrome.json > /dev/null && echo "✓ Chrome manifest is valid JSON"
	@echo "✓ Both manifests are version $$(python3 -c 'import json; print(json.load(open("src/manifest-chrome.json"))["version"])')"
	@for f in src/background.js src/lib/*.js src/popup/*.js src/options/*.js; do node --check $$f || exit 1; done && echo "✓ Scripts parse"
