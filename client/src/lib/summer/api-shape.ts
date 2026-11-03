type Json = unknown;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function unwrapApiPayload(json: Json): Json {
  return isObject(json) && json.data !== undefined ? json.data : json;
}

export function extractApiItems(json: Json): unknown[] {
  const payload = unwrapApiPayload(json);
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  for (const field of ['items', 'employees', 'data', 'rows'] as const) {
    const v = payload[field];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export interface ApiMeta {
  lastUpdated: unknown;
  source: unknown;
  debug: unknown;
  filters: unknown;
}

export function extractApiMeta(json: Json): ApiMeta {
  const payload = unwrapApiPayload(json);
  const sources = [payload, json, isObject(json) ? json.data : undefined];
  const pick = (field: keyof ApiMeta, fallback: unknown) => {
    for (const s of sources) if (isObject(s) && s[field]) return s[field];
    return fallback;
  };
  return { lastUpdated: pick('lastUpdated', null), source: pick('source', 'api'), debug: pick('debug', null), filters: pick('filters', null) };
}
