/* ── Centralized storage utilities ── */

// ── localStorage ──

export function storageGet(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}

// ── sessionStorage ──

export function sessionGet(key, defaultValue = null) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return defaultValue;
    const parsed = JSON.parse(raw);
    // Check TTL envelope
    if (parsed && typeof parsed === 'object' && 'value' in parsed && 'expires' in parsed) {
      if (parsed.expires !== null && Date.now() > parsed.expires) {
        sessionStorage.removeItem(key);
        return defaultValue;
      }
      return parsed.value;
    }
    return parsed;
  } catch {
    return defaultValue;
  }
}

export function sessionSet(key, value, ttlMs = null) {
  try {
    const envelope = {
      value,
      expires: ttlMs !== null ? Date.now() + ttlMs : null,
    };
    sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

export function sessionRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // unavailable — silently ignore
  }
}
