export interface OracleEngine {
  id: string;
  name: string;
  /** Deskripsi gaya jawab -- masuk ke system prompt sebagai persona. */
  note: string;
}

export interface OracleRequest {
  query: string;
  engine: OracleEngine;

  /**
   * Nama brand yang sedang diukur.
   *
   * PENTING: nilai ini TIDAK BOLEH masuk ke prompt yang dikirim ke AI
   * sungguhan. Kalau AI diberi tahu brand-nya, ia akan cenderung
   * menyebutnya -- dan seluruh pengukuran jadi tidak ada artinya.
   *
   * Hanya provider `mock` yang membacanya, untuk menyusun jawaban
   * simulasi. Lihat uji "systemPrompt tidak pernah membocorkan brand"
   * di scripts/check-pure.ts.
   */
  brand: string;

  /** Isi deliverable -- hanya diisi pada fase verifikasi (T1). */
  contextContent?: string;
}

export interface OracleResult {
  answer: string;
  model: string;
  latencyMs: number;
}

export interface OracleProvider {
  id: string;
  engines: OracleEngine[];
  ask(req: OracleRequest): Promise<OracleResult>;
}

/** Error dari provider AI. Dibedakan supaya runner bisa memutuskan retry. */
export class OracleError extends Error {
  constructor(
    message: string,
    /** true = masuk akal untuk dicoba lagi (rate limit, 5xx, timeout). */
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'OracleError';
  }
}
