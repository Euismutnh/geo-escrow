/**
 * ABI GeoEscrow — disalin dari `out/GeoEscrow.sol/GeoEscrow.json` (field "abi").
 *
 * JANGAN diketik ulang manual dan jangan diedit sebagian. Kalau kontrak
 * di-deploy ulang, ganti SELURUH isi array ini dengan hasil build terbaru.
 * Nama argumen event di sini dipetakan satu per satu oleh indexer
 * (`log.args.<nama>`); satu huruf meleset membuat indexer gagal DIAM-DIAM —
 * tidak ada error, datanya cuma tidak pernah masuk.
 *
 * `as const` wajib: viem memakainya untuk menurunkan tipe argumen dan
 * hasil tiap fungsi. Tanpa itu semuanya jatuh ke `any`.
 *
 * Deploy: BSC Testnet (97), blok 130.726.113, 13 September 2026.
 */
export const geoEscrowAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_oracle', type: 'address', internalType: 'address' },
      { name: '_arbiter', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'BOND_BPS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'STRUCTURAL_BPS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'acceptJob',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'arbiter',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'arbiterDecide',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'toFreelancer', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'confirmStructural',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createJob',
    inputs: [
      { name: 'queryPoolHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'acceptDeadline', type: 'uint64', internalType: 'uint64' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'escalateStuckJob',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getJob',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct GeoEscrow.JobView',
        components: [
          { name: 'client', type: 'address', internalType: 'address' },
          { name: 'freelancer', type: 'address', internalType: 'address' },
          { name: 'queryPoolHash', type: 'bytes32', internalType: 'bytes32' },
          { name: 'deliverableHash', type: 'bytes32', internalType: 'bytes32' },
          { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
          { name: 'verificationSeed', type: 'bytes32', internalType: 'bytes32' },
          { name: 'budget', type: 'uint256', internalType: 'uint256' },
          { name: 'bond', type: 'uint256', internalType: 'uint256' },
          { name: 'structuralReleased', type: 'uint256', internalType: 'uint256' },
          { name: 'status', type: 'uint8', internalType: 'uint8' },
          { name: 'acceptDeadline', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'jobCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'jobs',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'client', type: 'address', internalType: 'address' },
      { name: 'freelancer', type: 'address', internalType: 'address' },
      { name: 'queryPoolHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'deliverableHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'verificationSeed', type: 'bytes32', internalType: 'bytes32' },
      { name: 'budget', type: 'uint256', internalType: 'uint256' },
      { name: 'bondAmount', type: 'uint256', internalType: 'uint256' },
      { name: 'structuralReleased', type: 'uint256', internalType: 'uint256' },
      { name: 'acceptDeadline', type: 'uint64', internalType: 'uint64' },
      { name: 'submittedAt', type: 'uint64', internalType: 'uint64' },
      { name: 'status', type: 'uint8', internalType: 'enum GeoEscrow.Status' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'oracle',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'raiseDispute',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reclaimExpired',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rejectStructural',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'reason', type: 'string', internalType: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renounceOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requiredBond',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setArbiter',
    inputs: [{ name: 'a', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setOracle',
    inputs: [{ name: 'a', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setVerifyTimeout',
    inputs: [{ name: 'newTimeout', type: 'uint64', internalType: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settleRefund',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settleRelease',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'submitDeliverable',
    inputs: [
      { name: 'jobId', type: 'uint256', internalType: 'uint256' },
      { name: 'deliverableHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verificationSeed',
    inputs: [{ name: 'jobId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifyTimeout',
    inputs: [],
    outputs: [{ name: '', type: 'uint64', internalType: 'uint64' }],
    stateMutability: 'view',
  },

  // ---------- EVENT ----------
  // Nama argumen di bawah ini adalah kontrak antara indexer dan kontrak.
  {
    type: 'event',
    name: 'ArbiterChanged',
    inputs: [
      { name: 'oldArbiter', type: 'address', indexed: false, internalType: 'address' },
      { name: 'newArbiter', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ArbiterDecided',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'toFreelancer', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BondSettled',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'recipient', type: 'address', indexed: false, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'slashed', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DeliverableSubmitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'deliverableHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DisputeRaised',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'verdictHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'JobAccepted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'freelancer', type: 'address', indexed: true, internalType: 'address' },
      { name: 'bond', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'client', type: 'address', indexed: true, internalType: 'address' },
      { name: 'budget', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'queryPoolHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      { name: 'acceptDeadline', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OracleChanged',
    inputs: [
      { name: 'oldOracle', type: 'address', indexed: false, internalType: 'address' },
      { name: 'newOracle', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      { name: 'previousOwner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'newOwner', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Reclaimed',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'client', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'toFreelancer', type: 'bool', indexed: false, internalType: 'bool' },
      { name: 'byArbiter', type: 'bool', indexed: false, internalType: 'bool' },
      { name: 'recipient', type: 'address', indexed: false, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'verdictHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StructuralConfirmed',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'seed', type: 'bytes32', indexed: false, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StructuralRejected',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'reason', type: 'string', indexed: false, internalType: 'string' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'VerifyTimeoutChanged',
    inputs: [
      { name: 'oldTimeout', type: 'uint64', indexed: false, internalType: 'uint64' },
      { name: 'newTimeout', type: 'uint64', indexed: false, internalType: 'uint64' },
    ],
    anonymous: false,
  },

  // ---------- ERROR ----------
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
] as const;

/**
 * Urutan enum Status di kontrak. Angkanya WAJIB cocok — `getJob().status`
 * mengembalikan uint8, dan indexer menerjemahkannya lewat indeks array ini.
 */
export const STATUS_BY_INDEX = [
  'Open',
  'Accepted',
  'Submitted',
  'Verifying',
  'Disputed',
  'ReleasedFull',
  'Refunded',
] as const;
