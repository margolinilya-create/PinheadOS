import { toast } from '../store/useToastStore';

interface SupabaseResult<T = unknown> {
  data: T | null;
  error: { message?: string } | null;
}

/**
 * Execute a Supabase query and throw on error.
 */
export async function supaQuery<T = unknown>(queryFn: () => Promise<SupabaseResult<T>>): Promise<T> {
  const { data, error } = await queryFn();
  if (error) {
    const msg = error.message || 'Ошибка запроса к базе данных';
    toast.error(msg);
    throw new Error(msg);
  }
  return data as T;
}
