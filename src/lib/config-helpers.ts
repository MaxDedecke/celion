export type PaginationStrategy = 'none' | 'offset' | 'page' | 'cursor';
export type DeltaStrategy = 'timestamp' | 'incremental' | 'cursor';

export interface HeaderField {
  id: string;
  key: string;
  value: string;
}

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
};

export const createHeaderField = (key = '', value = ''): HeaderField => ({
  id: createId(),
  key,
  value,
});

export const mapHeadersToFields = (headers: unknown): HeaderField[] => {
  if (!Array.isArray(headers) || headers.length === 0) {
    return [createHeaderField()];
  }

  const mapped = headers
    .map((header) => {
      if (!header || typeof header !== 'object') return null;

      const key = typeof (header as Record<string, unknown>).key === 'string'
        ? (header as Record<string, string>).key
        : '';
      const value = typeof (header as Record<string, unknown>).value === 'string'
        ? (header as Record<string, string>).value
        : '';

      return createHeaderField(key, value);
    })
    .filter((entry): entry is HeaderField => entry !== null);

  return mapped.length > 0 ? mapped : [createHeaderField()];
};

export const headersToConfigEntries = (fields: HeaderField[]): Array<{ key: string; value: string }> =>
  fields
    .map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
    .filter(({ key, value }) => key !== '' || value !== '');

export const parseInteger = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const parseCommaSeparatedIntegers = (value: string): number[] | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const values = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((num) => !Number.isNaN(num));

  return values.length > 0 ? values : undefined;
};

export const successCodesToString = (codes: unknown): string => {
  if (!Array.isArray(codes)) return '';

  const filtered = codes.filter((code): code is number => typeof code === 'number' && Number.isFinite(code));
  return filtered.length > 0 ? filtered.join(', ') : '';
};

type PrunedValue = unknown;

type NonUndefined<T> = T extends undefined ? never : T;

export const pruneConfig = (value: unknown): PrunedValue => {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const prunedArray = value
      .map((item) => pruneConfig(item))
      .filter((item): item is NonUndefined<typeof item> => item !== undefined);

    return prunedArray.length > 0 ? prunedArray : undefined;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const pruned = pruneConfig(val);
        return pruned !== undefined ? [key, pruned] : null;
      })
      .filter((entry): entry is [string, PrunedValue] => entry !== null);

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return undefined;
};
