import nextVitals from 'eslint-config-next/core-web-vitals';

// Product release gate. The retained ShipAny admin, payment and AI scaffold
// is outside this local-first product migration and is not rewritten here.
const productFiles = ['src/features/life-ledger/**/*.{ts,tsx}'];
export default [
  { ignores: ['.next/**', '.source/**', 'node_modules/**', '.open-next/**'] },
  ...nextVitals.map((config) => config.ignores ? config : { ...config, files: productFiles }),
];
