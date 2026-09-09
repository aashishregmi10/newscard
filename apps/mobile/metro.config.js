// Metro configuration.  https://docs.expo.dev/guides/customizing-metro/
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// This app lives inside a monorepo but is deliberately NOT an npm workspace: it
// has its own node_modules and its own lockfile. React Native tooling is much
// happier that way, because Metro resolves modules by walking UP the directory
// tree, and a hoisted install hands it two copies of React to choose between.
// Two copies of React does not fail cleanly — it fails as a bundling error that
// names some unrelated module, or as a runtime crash about hooks.
//
// The default config still walks up, so `D:\newscard\node_modules` remains
// reachable. That directory is not empty: the API, the CMS and the build
// tooling live there, and anything accidentally installed at the root (an
// `expo` pulled in by running a command from the wrong folder, say) lands there
// too. So resolution is confined to this project's own node_modules. If
// something genuinely needed is missing, the bundle now fails with "Unable to
// resolve <name>" — a sentence that says what to install — instead of resolving
// to a second, subtly different copy.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Watch only this app. The server packages are not imported by the client, so
// watching the repository root would cost file-watcher churn for no benefit.
config.watchFolders = [projectRoot];

// Resolve only from this app's node_modules, and do not walk up past it.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
