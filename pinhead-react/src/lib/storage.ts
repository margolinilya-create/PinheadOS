/* ── Centralized storage utilities ── */

// ── localStorage ──

export function storageGet<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}

// ── sessionStorage ──

interface SessionEnvelope<T = unknown> {
  value: T;
  expires: number | null;
}

export function sessionGet<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return defaultValue;
    const parsed = JSON.parse(raw);
    // Check TTL envelope
    if (parsed && typeof parsed === 'object' && 'value' in parsed && 'expires' in parsed) {
      const envelope = parsed as SessionEnvelope<T>;
      if (envelope.expires !== null && Date.now() > envelope.expires) {
        sessionStorage.removeItem(key);
        return defaultValue;
      }
      return envelope.value;
    }
    return parsed as T;
  } catch {
    return defaultValue;
  }
}

export function sessionSet(key: string, value: unknown, ttlMs: number | null = null): void {
  try {
    const envelope: SessionEnvelope = {
      value,
      expires: ttlMs !== null ? Date.now() + ttlMs : null,
    };
    sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}
