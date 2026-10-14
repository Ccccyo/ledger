import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [prefix];
  return Object.entries(value)
    .flatMap(([key, nested]) => keys(nested, prefix ? `${prefix}.${key}` : key))
    .sort();
}

it('Chinese and English landing/workspace messages have matching keys', () => {
  for (const name of ['plans', 'index']) {
    const read = (locale: string) =>
      JSON.parse(
        readFileSync(
          new URL(
            `../../../config/locale/messages/${locale}/pages/${name}.json`,
            import.meta.url
          ),
          'utf8'
        )
      );
    assert.deepEqual(
      keys(read('zh')),
      keys(read('en')),
      `${name} locale contract`
    );
  }
});

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(ts|tsx)$/.test(file) && !file.endsWith('.test.ts')
        ? [file]
        : [];
  });
}

it('formal product modules do not import AI services or call the legacy calculator', () => {
  const root = path.resolve('src/features/life-ledger');
  for (const folder of ['landing', 'workspace', 'analysis'])
    for (const file of sources(path.join(root, folder))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const visit = (node: ts.Node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          assert.doesNotMatch(
            node.moduleSpecifier.text,
            /(?:^ai$|@ai-sdk\/|extensions\/ai|services\/ai|openai|anthropic)/i,
            file
          );
        }
        if (ts.isIdentifier(node))
          assert.ok(
            !['calculateLifePlan', 'safeCalculateLifePlan'].includes(node.text),
            `${file}: legacy annual engine`
          );
        if (folder === 'analysis' && ts.isIdentifier(node))
          assert.ok(
            ![
              'fetch',
              'XMLHttpRequest',
              'window',
              'document',
              'navigator',
              'localStorage',
            ].includes(node.text),
            `${file}: analysis must remain platform-independent`
          );
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
});

it('formal product copy does not advertise AI recommendations or unfinished chat routes', () => {
  for (const locale of ['zh', 'en'])
    for (const name of ['index', 'plans']) {
      const source = readFileSync(
        `src/config/locale/messages/${locale}/pages/${name}.json`,
        'utf8'
      );
      assert.doesNotMatch(
        source,
        /AI 建议|AI recommendations|\/ai-(?:image|video|music)|"\/chat"/i
      );
    }
});
