/* ── Centralized storage utilities ── */

import { supabase } from './supabase';

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

// ── Clear all app data (on logout) ──

const APP_KEYS = [
  'pinhead_draft',
  'ph_prices',
  'ph_cb_rate',
  'ph_extras',
  'ph_hardware',
  'ph_sku',
  'ph_fabrics',
  'ph_trims',
  'ph_usd_rate',
];

export function storageClearAll(): void {
  for (const key of APP_KEYS) {
    storageRemove(key);
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

// ── Supabase Storage: SKU photos ──

const SKU_BUCKET = 'sku-photos';

export async function uploadSkuPhoto(code: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${code}.${ext}`;

  // Remove old photo if exists
  await supabase.storage.from(SKU_BUCKET).remove([path]);

  const { error } = await supabase.storage.from(SKU_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });

  if (error) return null;

  const { data } = supabase.storage.from(SKU_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function getSkuPhotoUrl(path: string): string {
  const { data } = supabase.storage.from(SKU_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteSkuPhoto(code: string): Promise<void> {
  // Try common extensions
  const exts = ['jpg', 'jpeg', 'png', 'webp'];
  const paths = exts.map(ext => `${code}.${ext}`);
  await supabase.storage.from(SKU_BUCKET).remove(paths);
}
