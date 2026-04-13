-- Soft-delete: add active column to profiles (default true, backward compatible)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
