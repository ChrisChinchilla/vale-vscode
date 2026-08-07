// Webpack entry point / VS Code extension host entry. Kept as a thin
// re-export so package.json's "main" and webpack.config.js's "entry" don't
// need to change; the actual activate/deactivate logic lives in
// lifecycle.ts, which wires together the other modules (config, cli,
// vocabulary, languageServer, commands, ui, workspaceFolders).
export { activate, deactivate } from "./lifecycle";
