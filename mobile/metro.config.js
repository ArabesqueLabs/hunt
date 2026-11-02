// The web UI's data layer (../src/web/src/lib: the API client, dates and
// money, the board, filters) is shared with this app, imported as @web/…
// (tsconfig.json's paths). Metro watches it, and resolves what it imports
// (React) from this app's node_modules, never the web UI's: one React.

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const web = path.resolve(__dirname, "../src/web");

config.watchFolders = [path.join(web, "src/lib")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];
config.resolver.blockList = [new RegExp(`^${path.join(web, "node_modules").replace(/[/\\.]/g, "\\$&")}/.*`)];

module.exports = config;
