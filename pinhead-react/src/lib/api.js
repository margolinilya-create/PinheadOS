import { toast } from '../store/useToastStore';

/**
 * Execute a Supabase query and throw on error.
 * @param {() => Promise<{data: any, error: any}>} queryFn
 * @returns {Promise<any>} data
 */
export async function supaQuery(queryFn) {
  const { data, error } = await queryFn();
  if (error) {
    const msg = error.message || 'Ошибка запроса к базе данных';
    toast.error(msg);
    throw new Error(msg);
  }
  return data;
}
