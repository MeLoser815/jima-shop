/**
 * USDT 多链注册表：主网合约、精度、官方查询端点与地址规则。
 * 不接受用户自定义 RPC，避免 SSRF。
 */

export const USDT_NETWORK_IDS = [
  'trc20',
  'bep20',
  'erc20',
  'polygon',
  'arbitrum',
  'optimism',
  'avax',
  'xlayer',
] as const;

export type UsdtNetworkId = (typeof USDT_NETWORK_IDS)[number];

export type UsdtPaymentChannel =
  | 'usdt_trc20'
  | 'usdt_bep20'
  | 'usdt_erc20'
  | 'usdt_polygon'
  | 'usdt_arbitrum'
  | 'usdt_optimism'
  | 'usdt_avax'
  | 'usdt_xlayer';

export type OfficialRpcEndpoint = {
  url: string;
  host: string;
};

export type UsdtNetworkDef = {
  id: UsdtNetworkId;
  channel: UsdtPaymentChannel;
  /** 后台与链上技术名 */
  name: string;
  /** 买家可见默认名 */
  defaultLabel: string;
  /** 结账页展示的网络名（避免转错链） */
  displayNetwork: string;
  standard: string;
  family: 'tron' | 'evm';
  chainId?: number;
  /** 官方主合约 */
  contract: string;
  /** 同链仍需识别的旧合约（例如 X Layer 旧版 wrapped USDT） */
  extraContracts?: readonly string[];
  decimals: number;
  rpc: readonly OfficialRpcEndpoint[];
  /** 估算区块窗口 */
  blockTimeMs: number;
  confirmations: number;
  logChunkBlocks: number;
  addressKind: 'tron' | 'evm';
};

function rpc(url: string): OfficialRpcEndpoint {
  const u = new URL(url);
  return { url, host: u.hostname };
}

/**
 * 欧易链：当前发卡/提币场景里的「欧易链」是 OKX X Layer 主网（Chain ID 196），
 * 不是已较少使用的 OKT Chain / OKC（Chain ID 66）。
 * 官方正在把 X Layer 收款切到 USDT0；交易所提到 X Layer 的 USDT 走新合约。
 * 同时仍识别旧版 wrapped USDT，避免存量钱包漏单。
 */
export const XLAYER_USDT0_CONTRACT = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
export const XLAYER_LEGACY_USDT_CONTRACT = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';

/**
 * Optimism 较新的 USDT0。官方文档（Chain ID 10）与 usdt0.to 均列出此地址：
 * https://docs.usdt0.to/technical-documentation/deployments
 * 经典 Tether（0x94b0…）仍作为本链主合约，USDT0 作为 extraContracts 一并识别。
 */
export const OPTIMISM_USDT0_CONTRACT = '0x01bFF41798a0BcF287b996046Ca68b395DbC1071';

export const USDT_NETWORKS: Record<UsdtNetworkId, UsdtNetworkDef> = {
  trc20: {
    id: 'trc20',
    channel: 'usdt_trc20',
    name: 'Tron',
    defaultLabel: 'USDT (TRC20)',
    displayNetwork: 'TRC20',
    standard: 'TRC20',
    family: 'tron',
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
    rpc: [rpc('https://api.trongrid.io')],
    blockTimeMs: 3_000,
    confirmations: 1,
    logChunkBlocks: 0,
    addressKind: 'tron',
  },
  bep20: {
    id: 'bep20',
    channel: 'usdt_bep20',
    name: 'BNB Smart Chain',
    defaultLabel: 'USDT (BEP20)',
    displayNetwork: 'BEP20',
    standard: 'BEP20',
    family: 'evm',
    chainId: 56,
    // BSC 上的 USDT 是 18 位小数，与绝大多数链的 6 位不同。
    contract: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    rpc: [
      rpc('https://bsc-dataseed.binance.org'),
      rpc('https://bsc-dataseed1.binance.org'),
      rpc('https://bsc-dataseed2.binance.org'),
      rpc('https://bsc-dataseed3.binance.org'),
      rpc('https://bsc-dataseed4.binance.org'),
    ],
    blockTimeMs: 750,
    confirmations: 15,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
  erc20: {
    id: 'erc20',
    channel: 'usdt_erc20',
    name: 'Ethereum',
    defaultLabel: 'USDT (ERC20)',
    displayNetwork: 'ERC20',
    standard: 'ERC20',
    family: 'evm',
    chainId: 1,
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    rpc: [
      rpc('https://cloudflare-eth.com'),
      rpc('https://ethereum-rpc.publicnode.com'),
    ],
    blockTimeMs: 12_000,
    confirmations: 12,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
  polygon: {
    id: 'polygon',
    channel: 'usdt_polygon',
    name: 'Polygon',
    defaultLabel: 'USDT (Polygon)',
    displayNetwork: 'Polygon',
    standard: 'Polygon',
    family: 'evm',
    chainId: 137,
    contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    decimals: 6,
    rpc: [rpc('https://polygon-rpc.com')],
    blockTimeMs: 2_000,
    confirmations: 30,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
  arbitrum: {
    id: 'arbitrum',
    channel: 'usdt_arbitrum',
    name: 'Arbitrum One',
    defaultLabel: 'USDT (Arbitrum)',
    displayNetwork: 'Arbitrum One',
    standard: 'Arbitrum',
    family: 'evm',
    chainId: 42_161,
    contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
    rpc: [rpc('https://arb1.arbitrum.io/rpc')],
    blockTimeMs: 250,
    confirmations: 20,
    logChunkBlocks: 8_000,
    addressKind: 'evm',
  },
  optimism: {
    id: 'optimism',
    channel: 'usdt_optimism',
    name: 'Optimism',
    defaultLabel: 'USDT (Optimism)',
    displayNetwork: 'Optimism',
    standard: 'Optimism',
    family: 'evm',
    chainId: 10,
    contract: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    extraContracts: [OPTIMISM_USDT0_CONTRACT],
    decimals: 6,
    rpc: [rpc('https://mainnet.optimism.io')],
    blockTimeMs: 2_000,
    confirmations: 12,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
  avax: {
    id: 'avax',
    channel: 'usdt_avax',
    name: 'Avalanche C-Chain',
    defaultLabel: 'USDT (Avalanche)',
    displayNetwork: 'Avalanche C-Chain',
    standard: 'Avalanche',
    family: 'evm',
    chainId: 43_114,
    contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    decimals: 6,
    rpc: [rpc('https://api.avax.network/ext/bc/C/rpc')],
    blockTimeMs: 2_000,
    confirmations: 12,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
  xlayer: {
    id: 'xlayer',
    channel: 'usdt_xlayer',
    name: 'X Layer',
    defaultLabel: 'USDT (X Layer)',
    displayNetwork: 'X Layer',
    standard: 'X Layer',
    family: 'evm',
    chainId: 196,
    contract: XLAYER_USDT0_CONTRACT,
    extraContracts: [XLAYER_LEGACY_USDT_CONTRACT],
    decimals: 6,
    rpc: [rpc('https://rpc.xlayer.tech'), rpc('https://xlayerrpc.okx.com')],
    blockTimeMs: 2_000,
    confirmations: 12,
    logChunkBlocks: 2_000,
    addressKind: 'evm',
  },
};

export const USDT_NETWORK_LIST: UsdtNetworkDef[] = USDT_NETWORK_IDS.map(
  (id) => USDT_NETWORKS[id],
);

const CHANNEL_TO_NETWORK = Object.fromEntries(
  USDT_NETWORK_LIST.map((n) => [n.channel, n.id]),
) as Record<UsdtPaymentChannel, UsdtNetworkId>;

export function isUsdtNetworkId(value: string | null | undefined): value is UsdtNetworkId {
  return Boolean(value && (USDT_NETWORK_IDS as readonly string[]).includes(value));
}

export function isUsdtPaymentChannel(
  channel: string | null | undefined,
): channel is UsdtPaymentChannel {
  if (!channel) return false;
  return channel in CHANNEL_TO_NETWORK || channel.startsWith('usdt_');
}

export function usdtNetworkFromChannel(
  channel: string | null | undefined,
): UsdtNetworkId | null {
  if (!channel) return null;
  if (channel in CHANNEL_TO_NETWORK) {
    return CHANNEL_TO_NETWORK[channel as UsdtPaymentChannel];
  }
  if (channel === 'usdt_trc20' || channel === 'usdt') return 'trc20';
  return null;
}

export function usdtChannelFromNetwork(id: UsdtNetworkId): UsdtPaymentChannel {
  return USDT_NETWORKS[id].channel;
}

export function getUsdtNetwork(id: UsdtNetworkId): UsdtNetworkDef {
  return USDT_NETWORKS[id];
}

export function usdtContracts(def: UsdtNetworkDef): string[] {
  return [def.contract, ...(def.extraContracts ?? [])];
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(raw: string): boolean {
  return EVM_ADDRESS_RE.test(raw.trim());
}

export function normalizeEvmAddress(raw: string): string | null {
  const s = raw.trim();
  if (!isEvmAddress(s)) return null;
  return s.toLowerCase();
}

export function evmAddressesEqual(a: string, b: string): boolean {
  const na = normalizeEvmAddress(a);
  const nb = normalizeEvmAddress(b);
  return Boolean(na && nb && na === nb);
}

export function officialRpcHosts(def: UsdtNetworkDef): string[] {
  return [...new Set(def.rpc.map((r) => r.host))];
}

/** 4 位小数应付额 → 该链合约精度的整数。BSC 为 18 位，多数链为 6 位。 */
export function usdtPointsToOnChain(points4: number, decimals: number): bigint {
  if (!Number.isInteger(points4) || points4 < 0) {
    throw new Error('USDT 精度必须为整数');
  }
  if (!Number.isInteger(decimals) || decimals < 4 || decimals > 36) {
    throw new Error('不支持的代币精度');
  }
  const pad = BigInt(decimals - 4);
  return BigInt(points4) * 10n ** pad;
}

export function onChainToUsdtPoints(value: bigint, decimals: number): number | null {
  if (!Number.isInteger(decimals) || decimals < 4 || decimals > 36) return null;
  const step = 10n ** BigInt(decimals - 4);
  if (value < 0n || value % step !== 0n) return null;
  const points = value / step;
  if (points > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(points);
}

export function evmQrContent(input: {
  chainId: number;
  contract: string;
  address: string;
  amountOnChain: bigint;
}): string {
  const contract = input.contract.toLowerCase();
  const to = input.address.toLowerCase();
  return `ethereum:${contract}@${input.chainId}/transfer?address=${to}&uint256=${input.amountOnChain.toString()}`;
}

function usdtAmountToPoints(raw: string): number | null {
  const s = raw.trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(4, '0');
  return sign * (whole * 10_000 + Number(frac));
}

export function buildUsdtQrContent(
  networkId: UsdtNetworkId,
  address: string,
  amount?: string,
): string {
  const def = USDT_NETWORKS[networkId];
  const addr = address.trim();
  if (!addr) return '';
  const amt = (amount || '').trim();
  if (def.family === 'tron') {
    return amt ? `tron:${addr}?amount=${amt}&token=USDT` : `tron:${addr}`;
  }
  if (!def.chainId) return addr;
  if (!amt) return evmQrContent({ chainId: def.chainId, contract: def.contract, address: addr, amountOnChain: 0n }).replace(/&uint256=0$/, '');
  const points = usdtAmountToPoints(amt);
  if (points == null || points < 0) return evmQrContent({ chainId: def.chainId, contract: def.contract, address: addr, amountOnChain: 0n }).replace(/&uint256=0$/, '');
  return evmQrContent({
    chainId: def.chainId,
    contract: def.contract,
    address: addr,
    amountOnChain: usdtPointsToOnChain(points, def.decimals),
  });
}
