import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _db: SupabaseClient | null = null;

/**
 * Klien Supabase untuk sisi server.
 *
 * Memakai service_role key -> MELEWATI RLS sepenuhnya. Karena itu modul
 * ini tidak boleh pernah diimpor dari komponen client ('use client').
 *
 * Lazy singleton, bukan konstanta modul: env baru disentuh saat fungsi ini
 * dipanggil pertama kali, sehingga `next build` tidak gagal di lingkungan
 * yang belum punya kredensial.
 *
 * persistSession: false karena ini server — tidak ada sesi login user
 * yang perlu disimpan di mana pun.
 */
export function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}
