import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderConfigError } from './configError';

const SUPA_URL: string = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  // Проверка на уровне модуля — до React, поэтому ни ErrorBoundary, ни тост
  // не сработают, и без этой строки человек увидит белый экран. Подробно —
  // в комментарии `lib/configError.ts`.
  const missing = [
    !SUPA_URL && 'VITE_SUPABASE_URL',
    !SUPA_KEY && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(' и ');
  renderConfigError(
    'Приложение не настроено',
    `Не заданы переменные окружения: ${missing}. Без них нет доступа к базе данных, поэтому интерфейс не запускается.`,
    'Локально — создайте файл .env по образцу .env.example. На сервере — добавьте переменные в настройках деплоя и пересоберите проект.',
  );
  throw new Error(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

export const supabase: SupabaseClient = createClient(SUPA_URL, SUPA_KEY);
