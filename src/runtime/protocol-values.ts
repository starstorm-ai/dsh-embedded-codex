export type JsonObject = Record<string, unknown>

export function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value as JsonObject
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value
}

export function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value
}

export function json(value: unknown): string {
  const encoded = JSON.stringify(value)
  return typeof encoded === 'string' ? encoded : 'null'
}

export function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  for (const item of value as unknown[]) {
    if (typeof item === 'string') output.push(item)
  }
  return output
}

