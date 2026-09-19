/**
 * Akses terpusat ke environment variable.
 *
 * Sengaja memakai GETTER, bukan konstanta yang dicek saat import:
 * kalau dicek saat import, `next build` akan gagal di mesin yang belum
 * punya semua variabel (misal CI, atau anggota tim yang baru clone).
 * Dengan getter, error baru muncul saat variabelnya benar-benar dipakai —
 * dan pesannya menyebut nama variabel yang mana.
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Environment variable ${name} belum diisi di .env.local`
    );
  }
  return v;
}

// Hanya Claude -- keputusan tim (2026-09-13): tidak jadi memakai dua
// provider AI. multi_engine karena itu SELALU berarti dua persona dari
// model yang sama, tidak pernah dua penyedia berbeda. Lihat catatan
// kejujuran di lib/oracle/index.ts.
export type OracleProviderId = 'mock' | 'claude';

export const env = {
  // ---- Supabase (Fase 1) ----
  get supabaseUrl() {
    return req('SUPABASE_URL');
  },
  get supabaseServiceKey() {
    return req('SUPABASE_SERVICE_ROLE_KEY');
  },

  // ---- Oracle (Fase 4) ----
  get oracleProvider(): OracleProviderId {
    const v = process.env.ORACLE_PROVIDER ?? 'mock';
    return v === 'claude' ? v : 'mock';
  },
  get anthropicKey() {
    return req('ANTHROPIC_API_KEY');
  },

  // ---- Blockchain (Fase 9) ----
  get chainEnabled() {
    return process.env.CHAIN_ENABLED === 'true';
  },
  get rpcUrl() {
    return req('RPC_URL');
  },
  get escrowAddress() {
    return req('GEO_ESCROW_ADDRESS');
  },
  get oraclePrivateKey() {
    return req('ORACLE_PRIVATE_KEY');
  },

  // ---- Operasional ----
  get cronSecret() {
    return process.env.CRON_SECRET ?? '';
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
};
