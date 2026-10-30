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
  for (const match of source.matchAll(/(?:\/_next\/)?static\/[^"\\\s]+/g)) {
    const asset = match[0];
    assets.add(asset.startsWith('/_next/') ? asset : `/_next/${asset}`);
  }
}
// Fonts and styles can be referenced indirectly by CSS rather than route JS.
for (const folder of ['chunks', 'media']) {
  for (const file of await readdir(`.next/static/${folder}`)) {
    if (/\.(css|woff2?)$/.test(file))
      assets.add(`/_next/static/${folder}/${file}`);
  }
}
const version = (await readFile('.next/BUILD_ID', 'utf8')).trim();
// Lazy client chunks can stay out of a route manifest. Build a chunk-id index
// from React Loadable, then follow only dynamic imports reachable from the two
// public route entry points. This avoids caching unrelated admin/docs chunks.
const loadableManifest = JSON.parse(
  await readFile('.next/react-loadable-manifest.json', 'utf8')
);
const loadableFilesById = new Map();
const loadableFilesByChunkId = new Map();
for (const value of Object.values(loadableManifest)) {
  if (!value || typeof value !== 'object' || value.id == null) continue;
  const files = Array.isArray(value.files)
    ? value.files.filter((file) => typeof file === 'string')
    : [];
  if (!files.length) continue;
  loadableFilesById.set(String(value.id), files);
  for (const file of files) {
    const chunkId = path.basename(file).match(/^(\d+)[.-]/)?.[1];
    if (!chunkId) continue;
    const group = loadableFilesByChunkId.get(chunkId) ?? new Set();
    for (const groupFile of files) group.add(groupFile);
    loadableFilesByChunkId.set(chunkId, group);
  }
}

// Set iteration visits assets added below, so nested lazy imports are followed
// until no new public-route dependency is found.
for (const asset of assets) {
  if (!asset.endsWith('.js')) continue;
  const source = await readFile(
    `.next/${decodeURIComponent(asset.slice('/_next/'.length))}`,
    'utf8'
  );
  for (const match of source.matchAll(/static\/chunks\/[A-Za-z0-9_.-]+\.js/g)) {
    assets.add(`/_next/${match[0]}`);
  }
  for (const match of source.matchAll(/\.e\((\d+)\)/g)) {
    const files = new Set([
      ...(loadableFilesById.get(match[1]) ?? []),
      ...(loadableFilesByChunkId.get(match[1]) ?? []),
    ]);
    for (const file of files) {
      if (file.startsWith('static/')) assets.add(`/_next/${file}`);
    }
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
