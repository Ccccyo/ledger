import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Only the two public product routes; do not preload retained admin/AI routes.
const routes = [
  '.next/server/app/[locale]/(landing)/page_client-reference-manifest.js',
  '.next/server/app/[locale]/(app)/plan/page_client-reference-manifest.js',
];
const assets = new Set();
for (const file of routes) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\/_next\/static\/[^"\\\s]+/g))
    assets.add(match[0]);
}
// Fonts and styles can be referenced indirectly by CSS rather than route JS.
for (const folder of ['chunks', 'media']) {
  for (const file of await readdir(`.next/static/${folder}`)) {
    if (/\.(css|woff2?)$/.test(file))
      assets.add(`/_next/static/${folder}/${file}`);
  }
}
const version = (await readFile('.next/BUILD_ID', 'utf8')).trim();
// Turbopack can keep lazy client chunks out of the route manifest. Follow only
// static chunk references reachable from these public route entry points.
for (const asset of assets) {
  if (!asset.endsWith('.js')) continue;
  const source = await readFile(
    `.next/${asset.slice('/_next/'.length)}`,
    'utf8'
  );
  for (const match of source.matchAll(/static\/chunks\/[A-Za-z0-9_.-]+\.js/g)) {
    assets.add(`/_next/${match[0]}`);
  }
}
const manifest = { version, assets: [...assets].sort() };
const template = await readFile('scripts/offline/worker.js', 'utf8');
await writeFile(
  path.resolve('public/life-ledger-sw.js'),
  template.replace('__LIFE_LEDGER_MANIFEST__', JSON.stringify(manifest))
);
console.log(
  `Offline shell ${version}: ${assets.size} static resources prepared`
);
