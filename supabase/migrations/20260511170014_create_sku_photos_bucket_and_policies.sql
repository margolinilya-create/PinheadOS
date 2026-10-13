-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260511170014 `create_sku_photos_bucket_and_policies`.
-- Создаёт публичный Storage-бакет `sku-photos` (фото моделей SKU)
-- и политики: публичное чтение + запись для authenticated.

INSERT INTO storage.buckets (id, name, public) VALUES ('sku-photos', 'sku-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sku_photos_public_read'
  ) THEN
    EXECUTE 'CREATE POLICY "sku_photos_public_read" ON storage.objects
      FOR SELECT TO public USING (bucket_id = ''sku-photos'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sku_photos_authenticated_write'
  ) THEN
    EXECUTE 'CREATE POLICY "sku_photos_authenticated_write" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = ''sku-photos'')';
  END IF;
END$$;
