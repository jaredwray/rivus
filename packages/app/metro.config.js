// Metro configuration tuned for the Rivus pnpm monorepo.
// See: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so Metro picks up changes in linked packages
//    (e.g. @rivus/core, which is consumed as TypeScript source).
config.watchFolders = [workspaceRoot];

// 2. Let Metro resolve modules from both the package and the repo root.
config.resolver.nodeModulesPaths = [
	path.resolve(projectRoot, 'node_modules'),
	path.resolve(workspaceRoot, 'node_modules'),
];

// 3. pnpm uses symlinked, non-hoisted dependencies; do not force-hoist.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
