// Import a dependency-free TypeScript content file (src/content/*.ts) from a plain Node script, on every supported Node version.
//
// Why this exists: `await import('../src/content/journal.ts')` only works where Node strips types by itself. That is Node 22.18 and later
// (22.6 to 22.17 need --experimental-strip-types, Node 20 cannot do it). On Node 22.16.0 it throws ERR_UNKNOWN_FILE_EXTENSION, which made
// `npm run seo:schema` and `npm run ai:site` fail. This loader uses the `typescript` package the project already depends on, so the result
// does not depend on the Node minor version.
//
// Limits (checked, not assumed): the file must not import anything. A relative or bare import throws here with a clear message instead of
// failing later with an unreadable data: URL error.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export async function importTs(path) {
  const source = readFileSync(path, 'utf8');
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)];
  if (imports.length > 0) throw new Error(`importTs: ${path} imports ${imports.map((m) => m[1] ?? m[2]).join(', ')}. Only import-free content files can be loaded this way.`);
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  });
  const syntax = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (syntax.length > 0) throw new Error(`importTs: ${path}: ${syntax.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  return import(`data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`);
}
