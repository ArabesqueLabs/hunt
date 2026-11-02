all: clean build

.PHONY: all clean build firefox chrome safari validate

# What goes in each browser's build, beside its manifest.
PARTS = background.js popup options lib icons vendor

# clean
clean:
	rm -rf dist/chrome dist/firefox dist/safari dist/safari-src

# build both, unpacked in dist/<browser>/ and zipped for its store
build: chrome firefox

chrome:
	rm -rf dist/chrome && mkdir -p dist/chrome
	cp src/manifest-chrome.json dist/chrome/manifest.json
	cd src && cp -R $(PARTS) ../dist/chrome/
	(cd dist/chrome && rm -f hunt.zip && zip -qr hunt.zip . -x hunt.zip)

firefox:
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

# It's converted from a copy of the Chrome build, without the Chrome store's
# zip and with the background script joined into one plain script (Safari's
# can't be a module); then the project gets hunt's icon, SAFARI_MACOS, the
# manifest's version and SAFARI_BUILD (safari/adapt.py).
safari: chrome
	rm -rf dist/safari-src && cp -R dist/chrome dist/safari-src && rm dist/safari-src/hunt.zip
	python3 safari/adapt.py extension dist/safari-src
	$(SAFARI_DEV) xcrun safari-web-extension-converter dist/safari-src --project-location dist/safari \
		--app-name "hunt" --bundle-identifier app.careerhunt.hunt \
		--macos-only --copy-resources --no-open --no-prompt --force
	python3 safari/adapt.py project dist/safari/hunt $(SAFARI_MACOS) $(SAFARI_BUILD)
	@echo "Open it in Xcode: open dist/safari/hunt/hunt.xcodeproj"

# validate the manifests (and, with Mozilla's web-ext installed, the
# Firefox build: npx web-ext lint)
validate:
	@python3 -m json.tool src/manifest-firefox.json > /dev/null && echo "✓ Firefox manifest is valid JSON"
	@python3 -m json.tool src/manifest-chrome.json > /dev/null && echo "✓ Chrome manifest is valid JSON"
	@for f in src/background.js src/lib/*.js src/popup/*.js src/options/*.js; do node --check $$f || exit 1; done && echo "✓ Scripts parse"
