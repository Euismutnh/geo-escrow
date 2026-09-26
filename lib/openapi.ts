import { LIMITS } from './validate-input';
import { MARKET_FILTERS } from './status';

/**
 * Spesifikasi OpenAPI — ditulis tangan, bukan digenerate dari anotasi.
 *
 * Alasannya praktis: generator seperti `next-swagger-doc` menuntut blok
 * JSDoc di tiap route yang harus diperbarui manual setiap bentuk respons
 * berubah. Yang basi diam-diam lebih buruk daripada yang tidak ada,
 * karena orang tetap memercayainya.
 *
 * Beberapa angka di bawah diambil dari sumber yang sama dengan validator
 * sungguhan (`LIMITS`, `MARKET_FILTERS`), jadi kalau batasnya diubah,
 * dokumentasinya ikut berubah — tidak bisa meleset diam-diam.
 */

const ERROR_CODES = [
  'VALIDATION',
  'HASH_MISMATCH',
  'NOT_FOUND',
  'WRONG_STATUS',
  'BUSY',
  'STRUCTURAL_FAILED',
  'RATE_LIMITED',
  'ORACLE_FAILED',
  'CHAIN_FAILED',
  'INTERNAL',
];

const JOB_STATUS = [
  'Open',
  'Accepted',
  'Submitted',
  'Verifying',
  'Disputed',
  'ReleasedFull',
  'Refunded',
];

/** Respons gagal seragam dari `fail()` di lib/http.ts. */
const errorResponse = {
  description: 'Gagal',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', enum: [false] },
          code: { type: 'string', enum: ERROR_CODES },
          error: { type: 'string' },
        },
      },
    },
  },
};

/** Bungkus skema sukses dengan amplop `{ ok: true, ... }`. */
function sukses(deskripsi: string, properti: Record<string, unknown>) {
  return {
    description: deskripsi,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', enum: [true] }, ...properti },
        },
      },
    },
  };
}

// Aturan jobId string tinggal di lib/route-params.ts (dipakai BE & FE).
// OpenAPI 3.0 tidak mengizinkan `pattern` untuk integer, jadi batasnya
// ditulis lewat `maximum` + deskripsi.
const schemaJobId = { type: 'integer', minimum: 0, maximum: 9007199254740991 };
const aturanJobId =
  'Desimal kanonik tanpa nol di depan, maksimal 2^53 − 1. ' +
  '`0x10`, `1e1`, `007`, `1.0`, `+1`, dan angka yang lebih besar ditolak **400 VALIDATION** ' +
  '(sejak 2026-09-24; sebelumnya `0x10` diam-diam dibaca sebagai job 16).';

const paramJobId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: schemaJobId,
  description: 'jobId on-chain. Dimulai dari **0**, bukan 1. ' + aturanJobId,
};

const queryJobId = {
  name: 'jobId',
  in: 'query',
  schema: schemaJobId,
  description: 'Saring ke satu job. ' + aturanJobId,
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'GEO Escrow — API Backend',
    version: '1.0.0',
    description: [
      'Escrow freelance di BNB Chain testnet yang mencairkan dana saat mesin',
      'jawaban AI benar-benar mulai menyebut brand klien.',
      '',
      '### Amplop respons',
      'Semua endpoint membalas `{ ok: true, ... }` atau `{ ok: false, code, error }`.',
      '',
      '### Nilai wei selalu STRING',
      'Jangan pernah `Number()` nilai wei — di atas 2^53 presisinya hilang',
      '(sekitar 0,009 tBNB). Pakai `BigInt()`.',
      '',
      '### Mode CHAIN_ENABLED=false',
      'Saat blockchain dimatikan, gerbang hash di `POST /api/jobs` ikut mati dan',
      'endpoint menerima job apa pun. Itu disengaja untuk pengembangan, dan',
      'ditahan dua lapis: penolakan mutlak di produksi + rate limit.',
    ].join('\n'),
  },
  servers: [
    { url: '/api', description: 'Server yang sedang membuka halaman ini' },
  ],
  tags: [
    { name: 'Job', description: 'Membuat & membaca kontrak kerja' },
    { name: 'Oracle', description: 'Baseline, deliverable, verifikasi, verdict' },
    { name: 'Chain', description: 'Sinkronisasi dengan blockchain' },
    { name: 'Umum', description: 'Statistik, aktivitas, kesehatan' },
  ],
  paths: {
    // ─────────────────────────── Job ───────────────────────────
    '/jobs': {
      get: {
        tags: ['Job'],
        summary: 'Daftar job',
        parameters: [
          {
            name: 'filter',
            in: 'query',
            schema: { type: 'string', enum: Object.keys(MARKET_FILTERS) },
            description:
              '`progress` adalah gabungan 3 status (Accepted, Submitted, Verifying) — tidak bisa diwakili satu nilai status.',
          },
          {
            name: 'wallet',
            in: 'query',
            schema: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
            description: 'Cocokkan sebagai client ATAU freelancer.',
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1, minimum: 1, maximum: 10000 },
            description:
              'Halaman di luar jangkauan membalas **200** dengan `jobs: []` dan `total` yang benar ' +
              '(sejak 2026-09-24; sebelumnya **500** "Requested range not satisfiable").',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 },
          },
        ],
        responses: {
          200: sukses('Daftar job', {
            jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } },
            total: { type: 'integer' },
            page: { type: 'integer' },
          }),
          400: errorResponse,
        },
      },
      post: {
        tags: ['Job'],
        summary: 'Daftarkan job yang sudah dibuat on-chain',
        description: [
          'Dipanggil FE **setelah** transaksi `createJob()` sukses.',
          '',
          'Backend menghitung ulang `queryPoolHash` dari body lalu membandingkannya',
          'dengan yang terkunci di blockchain. Data palsu ditolak oleh matematika,',
          'bukan oleh daftar izin.',
          '',
          'Memicu baseline di latar belakang lewat `after()` — jadi memanggilnya',
          'berarti mengeluarkan biaya AI.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'jobId',
                  'clientAddr',
                  'brand',
                  'queries',
                  'targetCount',
                  'budgetWei',
                  'acceptDeadline',
                ],
                properties: {
                  jobId: { type: 'integer', minimum: 0 },
                  clientAddr: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
                  brand: { type: 'string', maxLength: LIMITS.brand },
                  brief: { type: 'string', maxLength: LIMITS.brief, nullable: true },
                  queries: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 6,
                    items: { type: 'string', maxLength: LIMITS.query },
                    description: 'Tidak boleh ada yang kembar (beda kapital tetap dianggap kembar).',
                  },
                  targetCount: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Harus antara 1 dan jumlah `queries`.',
                  },
                  budgetWei: {
                    type: 'string',
                    description: 'STRING, bukan number. Contoh: "20000000000000000" (0,02 tBNB).',
                  },
                  acceptDeadline: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Harus di masa depan.',
                  },
                  multiEngine: { type: 'boolean', default: false },
                },
              },
              example: {
                jobId: 901,
                clientAddr: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
                brand: 'Root & Bloom',
                brief: 'Artikel perbandingan skincare organik.',
                queries: [
                  'Apa rekomendasi skincare organik lokal?',
                  'Brand skincare organik Indonesia yang bagus?',
                  'Skincare organik bersertifikat halal?',
                ],
                targetCount: 2,
                budgetWei: '20000000000000000',
                acceptDeadline: '2027-01-01T00:00:00.000Z',
                multiEngine: false,
              },
            },
          },
        },
        responses: {
          200: sukses('Job tersimpan; baseline berjalan di latar belakang', {
            jobId: { type: 'integer' },
            queryPoolHash: { type: 'string' },
            chainVerified: {
              type: 'boolean',
              description: 'false = gerbang hash dilewati karena CHAIN_ENABLED=false.',
            },
          }),
          400: errorResponse,
          409: errorResponse,
          429: errorResponse,
        },
      },
    },

    '/jobs/{id}': {
      get: {
        tags: ['Job'],
        summary: 'Detail satu job',
        parameters: [
          paramJobId,
          {
            name: 'include',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Dipisah koma: `runs`, `activity`. Menghemat request untuk halaman detail.',
            example: 'runs,activity',
          },
        ],
        responses: {
          200: sukses('Detail job', {
            job: { $ref: '#/components/schemas/Job' },
            runs: { type: 'array', items: { $ref: '#/components/schemas/OracleRun' } },
            activity: { type: 'array', items: { type: 'object' } },
          }),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },

    // ────────────────────────── Oracle ──────────────────────────
    '/jobs/{id}/baseline': {
      post: {
        tags: ['Oracle'],
        summary: 'Ukur ulang baseline (T0)',
        description: [
          'Baseline berjalan **otomatis** saat job dibuat. Endpoint ini hanya untuk',
          'mencoba lagi setelah gagal.',
          '',
          'Tanpa header `Authorization`, hanya boleh kalau `status = "Open"`,',
          '`baseline_score = null`, dan `job_state = "error"` (atau pengukuran macet',
          '> 3 menit di `queued_baseline`/`running_baseline`) — tanpa pembatas itu,',
          'siapa pun bisa menyuruh server menghabiskan kredit AI, atau menghapus',
          'penanda "settlement gagal" milik job yang sedang diverifikasi.',
          '',
          'Dengan header pun, baseline hanya diukur saat `status = "Open"`.',
        ].join('\n'),
        parameters: [paramJobId],
        security: [{}, { cronSecret: [] }],
        responses: {
          200: sukses('Baseline selesai', {
            score: { type: 'integer' },
            of: { type: 'integer' },
          }),
          409: errorResponse,
          429: errorResponse,
        },
      },
    },

    '/jobs/{id}/deliverable': {
      post: {
        tags: ['Oracle'],
        summary: 'Kirim isi deliverable (SEBELUM tanda tangan tx)',
        description: [
          'Urutannya sengaja dibalik dari rancangan awal: **simpan konten dulu,',
          'baru tanda tangan `submitDeliverable()`**.',
          '',
          'Kalau tab ditutup di antara keduanya pada urutan lama, job nyangkut',
          'permanen di status `Submitted` tanpa konten di database — Oracle tidak',
          'punya apa pun untuk diverifikasi.',
          '',
          'Structural check dijalankan di sini, jadi freelancer tahu kontennya lolos',
          '**sebelum** membayar gas.',
          '',
          '**Kapan konten terkunci:** begitu hash-nya ditandatangani di kontrak',
          '(`submitDeliverable`). Sebelum itu draf boleh direvisi berkali-kali.',
          'Sesudahnya hanya konten dengan hash **on-chain** itu yang diterima —',
          'selain itu `HASH_MISMATCH`. Kolom `deliverable_hash` job adalah cermin',
          'nilai on-chain (null sebelum tanda tangan). Saat `CHAIN_ENABLED=false`,',
          'kiriman pertama yang mengunci (mode pengembangan).',
        ].join('\n'),
        parameters: [paramJobId],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', maxLength: LIMITS.deliverable },
                },
              },
              example: {
                content:
                  'Root & Bloom adalah brand skincare organik lokal yang memakai bahan dari petani Indonesia dan sudah bersertifikat halal.',
              },
            },
          },
        },
        responses: {
          200: sukses('Konten tersimpan; pakai hash ini untuk submitDeliverable()', {
            deliverableHash: { type: 'string' },
            structuralPass: { type: 'boolean' },
            length: { type: 'integer' },
          }),
          400: errorResponse,
          409: errorResponse,
          422: errorResponse,
        },
      },
    },

    '/jobs/{id}/verify': {
      post: {
        tags: ['Oracle'],
        summary: 'Jalankan verifikasi (T1) dan settlement',
        description: [
          'Memanggil AI untuk subset pertanyaan yang diundi seed VRF on-chain,',
          'menyimpan verdict, **lalu** mengirim settlement.',
          '',
          'Urutan simpan-dulu-baru-kirim itu yang mencegah pembayaran ganda: kalau',
          'settlement gagal, percobaan berikutnya memakai verdict yang sama tanpa',
          'satu pun panggilan AI baru.',
          '',
          'Rate limit 30 detik per job.',
        ].join('\n'),
        parameters: [paramJobId],
        responses: {
          200: sukses('Verifikasi selesai', {
            score: { type: 'integer' },
            of: { type: 'integer' },
            decision: { type: 'string', enum: ['release', 'refund', 'dispute'] },
            verdictHash: { type: 'string' },
            subset: { type: 'array', items: { type: 'integer' } },
            txHash: {
              type: 'string',
              description:
                "`0xdev` = CHAIN_ENABLED=false. `0xsudah` = kontrak sudah di status akhir, tidak ada tx baru.",
            },
            settledOnChain: { type: 'boolean' },
            alreadySettled: { type: 'boolean' },
            resumedSettlement: { type: 'boolean' },
          }),
          409: errorResponse,
          429: errorResponse,
        },
      },
    },

    '/jobs/{id}/verdict': {
      get: {
        tags: ['Oracle'],
        summary: 'Verdict + audit yang bisa diverifikasi ulang',
        description: [
          'Mengembalikan string kanonik supaya pihak luar bisa menghitung keccak256-nya sendiri dan mencocokkannya dengan yang tercatat on-chain.',
          '',
          'Dua versi verdict (bentuk respons endpoint tidak berubah):',
          '- `GEOv1` — subset = undian dari `seed` on-chain. Verdict sebelum 27-09-2026 & mode pengembangan.',
          '- `GEOv2` — tambahan `confirmTx`, `confirmBlockHash`, `deliverableHash`. Subset = undian dari',
          '  keccak256(seed ‖ confirmBlockHash ‖ uint256(jobId) ‖ deliverableHash). Seed on-chain di BSC praktis',
          '  konstan, jadi v1 bisa ditebak sebelum verifikasi. Periksa sendiri: `confirmTx` harus',
          '  `confirmStructural(jobId)` ke kontrak ini, sukses, di blok `confirmBlockHash`.',
          'String kanonik v2 = 12 baris v1 + tiga baris itu (heksa huruf kecil).',
        ].join('\n'),
        parameters: [paramJobId],
        responses: {
          200: sukses('Verdict', {
            verdict: {
              type: 'object',
              description: 'GEOv1 atau GEOv2 — lihat deskripsi endpoint.',
              properties: {
                v: { type: 'string', enum: ['GEOv1', 'GEOv2'] },
                confirmTx: { type: 'string', description: 'Hanya GEOv2' },
                confirmBlockHash: { type: 'string', description: 'Hanya GEOv2' },
                deliverableHash: { type: 'string', description: 'Hanya GEOv2' },
              },
            },
            canonical: { type: 'string' },
            audit: {
              type: 'object',
              properties: {
                subsetMatches: { type: 'boolean' },
                decisionMatches: { type: 'boolean' },
                hashMatchesStored: { type: 'boolean' },
                hashMatchesChain: { type: 'boolean' },
                allChecksPassed: { type: 'boolean' },
              },
            },
          }),
          404: errorResponse,
        },
      },
    },

    '/jobs/{id}/oracle-log': {
      get: {
        tags: ['Oracle'],
        summary: 'Log panggilan AI untuk satu job',
        parameters: [
          paramJobId,
          {
            name: 'phase',
            in: 'query',
            schema: { type: 'string', enum: ['baseline', 'verification'] },
          },
        ],
        responses: {
          200: sukses('Log', {
            runs: { type: 'array', items: { $ref: '#/components/schemas/OracleRun' } },
          }),
          400: errorResponse,
        },
      },
    },

    '/oracle-log': {
      get: {
        tags: ['Oracle'],
        summary: 'Log panggilan AI — semua job',
        parameters: [
          queryJobId,
          {
            name: 'phase',
            in: 'query',
            schema: { type: 'string', enum: ['baseline', 'verification'] },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 150, minimum: 1, maximum: 300 },
          },
        ],
        responses: {
          200: sukses('Log global', {
            runs: { type: 'array', items: { $ref: '#/components/schemas/OracleRun' } },
          }),
          400: errorResponse,
        },
      },
    },

    // ─────────────────────────── Chain ───────────────────────────
    '/chain-info': {
      get: {
        tags: ['Chain'],
        summary: 'Konfigurasi tingkat-kontrak',
        description: [
          'Sumber kebenaran untuk alamat arbiter — FE memakainya untuk memutuskan',
          'apakah panel juri ditampilkan.',
          '',
          'Menggantikan kolom `jobs.arbiter_addr` yang dihapus: arbiter itu satu',
          'nilai untuk seluruh kontrak, bukan properti per-job.',
          '',
          'Hasilnya di-cache 60 detik di server.',
        ].join('\n'),
        responses: {
          200: sukses('Info kontrak (semua null kalau belum dikonfigurasi)', {
            chainEnabled: { type: 'boolean' },
            contractAddress: { type: 'string', nullable: true },
            oracle: { type: 'string', nullable: true },
            arbiter: { type: 'string', nullable: true },
            owner: { type: 'string', nullable: true },
            bondBps: { type: 'string', nullable: true },
            structuralBps: { type: 'string', nullable: true },
            verifyTimeoutSeconds: { type: 'string', nullable: true },
          }),
        },
      },
    },

    '/sync/{id}': {
      post: {
        tags: ['Chain'],
        summary: 'Tarik ulang satu job dari blockchain',
        description: [
          'Dipanggil FE tepat setelah sebuah transaksi dapat receipt — inilah yang',
          'membuat UI terasa hidup tanpa menunggu cron.',
          '',
          'Terbuka tanpa auth: endpoint ini tidak menerima data, hanya menyuruh',
          'backend membaca ulang dari kontrak. Ditahan rate limit dua lapis.',
        ].join('\n'),
        parameters: [paramJobId],
        responses: {
          200: sukses('Tersinkron', {
            jobId: { type: 'integer' },
            adaDiChain: { type: 'boolean' },
            logs: { type: 'integer' },
            activityBaru: { type: 'integer' },
            jobTersentuh: { type: 'array', items: { type: 'integer' } },
          }),
          404: errorResponse,
          409: errorResponse,
          429: errorResponse,
        },
      },
    },

    '/indexer/poll': {
      get: {
        tags: ['Chain'],
        summary: 'Susuri blok baru (cron)',
        description: [
          'Jaring pengaman untuk event yang tidak lewat `/sync/:id` — user menutup',
          'tab, transaksi dari Etherscan, atau event yang bukan kita yang memicunya.',
          '',
          '**Tertutup di balik `CRON_SECRET`.** Kalau variabelnya kosong, endpoint',
          'ini tertutup rapat, bukan terbuka.',
        ].join('\n'),
        security: [{ cronSecret: [] }],
        responses: {
          200: sukses('Hasil penyusuran', {
            dariBlok: { type: 'string' },
            sampaiBlok: { type: 'string' },
            tipRantai: { type: 'string' },
            blokDilompati: {
              type: 'string',
              description:
                '> 0 berarti log rentang itu sudah dipangkas RPC dan TIDAK akan pernah masuk ledger. Normal sekali di putaran pertama; harus 0 setelahnya.',
            },
            rentangDiproses: { type: 'integer' },
            masihAdaSisa: { type: 'boolean' },
            logs: { type: 'integer' },
            activityBaru: { type: 'integer' },
            lockDibebaskan: { type: 'integer' },
          }),
          400: errorResponse,
          409: errorResponse,
        },
      },
    },

    // ─────────────────────────── Umum ───────────────────────────
    '/stats': {
      get: {
        tags: ['Umum'],
        summary: 'Ringkasan untuk halaman utama',
        parameters: [
          {
            name: 'wallet',
            in: 'query',
            schema: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          },
        ],
        responses: {
          200: sukses('Statistik', {
            asClient: { type: 'integer' },
            asFreelancer: { type: 'integer' },
            needJury: { type: 'integer' },
            done: { type: 'integer' },
          }),
          400: errorResponse,
        },
      },
    },

    '/activity': {
      get: {
        tags: ['Umum'],
        summary: 'Ledger — cerminan event on-chain',
        parameters: [
          queryJobId,
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 150, minimum: 1, maximum: 300 },
          },
        ],
        responses: {
          200: sukses('Aktivitas', { activity: { type: 'array', items: { type: 'object' } } }),
          400: errorResponse,
        },
      },
    },

    '/hello': {
      get: {
        tags: ['Umum'],
        summary: 'Cek kesehatan',
        responses: { 200: sukses('Hidup', { message: { type: 'string' } }) },
      },
    },

    '/dev/seed': {
      post: {
        tags: ['Umum'],
        summary: 'Isi ulang data contoh (DITOLAK di produksi)',
        description:
          'Menulis 6 job contoh dengan `job_id` 1–6. **Hapus sebelum `CHAIN_ENABLED=true`** — job on-chain mulai dari 0, jadi keduanya akan bertabrakan.',
        responses: {
          200: sukses('Data contoh dipulihkan', { seeded: { type: 'integer' } }),
          409: errorResponse,
        },
      },
    },
  },

  components: {
    securitySchemes: {
      cronSecret: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Isi dengan nilai `CRON_SECRET` dari `.env.local`. Tulis token-nya saja, tanpa kata "Bearer".',
      },
    },
    schemas: {
      Job: {
        type: 'object',
        properties: {
          job_id: { type: 'integer' },
          client_addr: { type: 'string' },
          freelancer_addr: { type: 'string', nullable: true },
          brand: { type: 'string' },
          brief: { type: 'string', nullable: true },
          queries: { type: 'array', items: { type: 'string' } },
          target_count: { type: 'integer' },
          multi_engine: { type: 'boolean' },
          query_pool_hash: { type: 'string' },
          budget_wei: { type: 'string', description: 'STRING — jangan di-Number().' },
          bond_wei: { type: 'string', nullable: true },
          structural_released_wei: { type: 'string' },
          deliverable_content: { type: 'string', nullable: true },
          deliverable_hash: { type: 'string', nullable: true },
          baseline_score: { type: 'integer', nullable: true },
          baseline_of: { type: 'integer', nullable: true },
          verification_seed: { type: 'string', nullable: true },
          verification_subset: { type: 'array', items: { type: 'integer' }, nullable: true },
          verification_score: { type: 'integer', nullable: true },
          verification_decision: {
            type: 'string',
            enum: ['release', 'refund', 'dispute'],
            nullable: true,
          },
          verdict_hash: { type: 'string', nullable: true },
          status: {
            type: 'string',
            enum: JOB_STATUS,
            description: 'Cerminan status on-chain. Ditulis HANYA oleh indexer.',
          },
          job_state: {
            type: 'string',
            enum: [
              'idle',
              'queued_baseline',
              'running_baseline',
              'running_structural',
              'queued_verify',
              'running_verify',
              'error',
            ],
            description: 'Status kerja backend. Ditulis HANYA oleh worker Oracle.',
          },
          last_error: { type: 'string', nullable: true },
          accept_deadline: { type: 'string', format: 'date-time' },
        },
      },
      OracleRun: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          job_id: { type: 'integer' },
          phase: { type: 'string', enum: ['baseline', 'verification'] },
          query_index: { type: 'integer' },
          query: { type: 'string' },
          engine: {
            type: 'string',
            description:
              'Keputusan tim: hanya satu provider (Claude), jadi multi_engine berarti dua PERSONA dari model yang sama — `Claude (ringkas)` / `Claude (naratif)`.',
          },
          model: { type: 'string', nullable: true },
          hit: { type: 'boolean' },
          answer: { type: 'string' },
          latency_ms: { type: 'integer', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;
