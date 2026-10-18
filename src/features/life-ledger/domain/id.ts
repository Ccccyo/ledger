type RandomUuidSource = {
  randomUUID?: () => string;
};

let fallbackSequence = 0;

/**
 * Creates a local-only identifier without requiring Web Crypto.
 *
 * Some embedded browsers do not expose `window.crypto`, even for localhost.
 * These identifiers are used for local records, not for authentication or
 * other security-sensitive purposes, so a timestamp/random fallback is safe.
 */
export function createLocalId(
  prefix = 'local',
  source: RandomUuidSource | null | undefined = globalThis.crypto
) {
  if (typeof source?.randomUUID === 'function') {
    return source.randomUUID();
  }

  fallbackSequence += 1;
  const timestamp = Date.now().toString(36);
  const sequence = fallbackSequence.toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${sequence}-${random}`;
}
