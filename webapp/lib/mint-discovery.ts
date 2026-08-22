import { Contract, Interface, JsonRpcProvider, formatEther, getAddress } from "ethers";
import { normalizeChainKey, resolveChain } from "./chains";
import type { ChainOption, CollectionCard, MintDiscoveryResponse, MintStage, StageStatus } from "./mint-types";

const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1F0DF003000390027140000fAa719";
export const SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";

const PUBLIC_ABI = [
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
  "function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getAllowedFeeRecipients(address nftContract) view returns (address[])",
];

const ERC721_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const IFACE = new Interface(PUBLIC_ABI);

interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

interface ParsedTarget {
  kind: "address" | "slug";
  value: string;
  chainHint?: string;
}

interface OpenSeaCollectionPayload {
  name?: string;
  collection?: string;
  slug?: string;
  image_url?: string;
  imageUrl?: string;
  banner_image_url?: string;
  description?: string;
  contracts?: { address?: string; chain?: string }[];
}

interface RpcResult<T> {
  value: T | null;
  warning?: string;
}

const PUBLIC_RPCS: Record<string, string[]> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.merkle.io", "https://cloudflare-eth.com"],
  base: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  robinhood: ["https://rpc.mainnet.chain.robinhood.com", "https://sequencer.mainnet.chain.robinhood.com"],
};

export async function discoverMint(input: string, chainKey?: string): Promise<MintDiscoveryResponse> {
  const query = input.trim();
  if (!query) throw new Error("Enter an OpenSea slug, collection URL, item URL, or contract address.");

  const parsed = parseNftTarget(query);
  const preferredChain = resolveChain(parsed.chainHint ?? chainKey);
  const warnings: string[] = [];

  let collection: CollectionCard;
  if (parsed.kind === "slug") {
    const resolved = await resolveOpenSeaSlug(parsed.value, preferredChain.key);
    collection = resolved.collection;
    if (resolved.warning) warnings.push(resolved.warning);
  } else {
    const address = getAddress(parsed.value);
    const metadata = await readErc721Metadata(address, preferredChain.key);
    if (metadata.warning) warnings.push(metadata.warning);
    const title = metadata.value?.name || `Contract ${shortAddress(address)}`;
    collection = {
      name: title,
      address,
      chain: preferredChain,
      openseaUrl: `https://opensea.io/assets/${preferredChain.key}/${address}`,
      explorerUrl: `${preferredChain.explorer}/address/${address}`,
      source: metadata.value?.name ? "address" : "fallback",
      description: metadata.value?.symbol ? `Symbol: ${metadata.value.symbol}` : undefined,
    };
  }

  const publicDrop = await fetchPublicDrop(collection.address, collection.chain.key);
  if (publicDrop.warning) warnings.push(publicDrop.warning);

  const stages = buildStages(collection.address, collection.chain, publicDrop.value, warnings);

  return {
    ok: true,
    query,
    resolvedAt: new Date().toISOString(),
    collection,
    stages,
    warnings,
  };
}

function parseNftTarget(rawInput: string): ParsedTarget {
  const raw = rawInput.trim().replace(/\/+$/, "");
  if (isHexAddress(raw)) return { kind: "address", value: raw };

  if (/^https?:\/\//i.test(raw) || raw.toLowerCase().includes("opensea.io")) {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withProtocol);
    } catch {
      throw new Error(`Could not parse "${rawInput}" as a URL.`);
    }
    const segments = url.pathname.split("/").map((segment) => segment.trim()).filter(Boolean);
    const itemIdx = segments.findIndex((segment) => segment === "assets" || segment === "item");
    if (itemIdx >= 0) {
      const rest = segments.slice(itemIdx + 1);
      const addressIdx = rest.findIndex((segment) => isHexAddress(segment));
      if (addressIdx >= 0) {
        return {
          kind: "address",
          value: rest[addressIdx],
          chainHint: addressIdx > 0 ? normalizeChain(rest[addressIdx - 1]) : undefined,
        };
      }
    }

    const collectionIdx = segments.indexOf("collection");
    if (collectionIdx >= 0 && segments[collectionIdx + 1]) {
      return {
        kind: "slug",
        value: segments[collectionIdx + 1].toLowerCase(),
        chainHint: collectionIdx > 0 ? normalizeChain(segments[collectionIdx - 1]) : undefined,
      };
    }

    const looseAddress = segments.find((segment) => isHexAddress(segment));
    if (looseAddress) return { kind: "address", value: looseAddress };
    throw new Error("No collection slug or contract address found in the OpenSea link.");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
    throw new Error("Enter a bare slug, OpenSea link, or 0x contract address.");
  }
  return { kind: "slug", value: raw.toLowerCase() };
}

function normalizeChain(segment: string): string {
  return normalizeChainKey(segment);
}

function isHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

async function resolveOpenSeaSlug(slug: string, preferredChainKey: string): Promise<{ collection: CollectionCard; warning?: string }> {
  const headers: HeadersInit = { accept: "application/json" };
  if (process.env.OPENSEA_API_KEY) headers["x-api-key"] = process.env.OPENSEA_API_KEY;

  const response = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`, {
    headers,
    next: { revalidate: 60 },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      process.env.OPENSEA_API_KEY
        ? `OpenSea rejected the API key (${response.status}).`
        : `OpenSea refused the collection lookup (${response.status}); paste the contract address or set OPENSEA_API_KEY.`
    );
  }
  if (response.status === 404) throw new Error(`No OpenSea collection called "${slug}".`);
  if (response.status === 429) throw new Error("OpenSea rate-limited collection lookup. Retry shortly.");
  if (!response.ok) throw new Error(`OpenSea lookup failed: ${response.status} ${response.statusText}`);

  const json = (await response.json()) as OpenSeaCollectionPayload;
  const contracts = Array.isArray(json.contracts) ? json.contracts : [];
  if (contracts.length === 0) throw new Error(`OpenSea did not list any contracts for "${slug}".`);

  const preferredContract =
    contracts.find((contract) => normalizeChain(contract.chain ?? "") === preferredChainKey) ?? contracts[0];
  if (!preferredContract.address || !isHexAddress(preferredContract.address)) {
    throw new Error(`OpenSea returned an invalid contract address for "${slug}".`);
  }

  const chain = resolveChain(preferredContract.chain ?? preferredChainKey);
  const address = getAddress(preferredContract.address);

  return {
    collection: {
      name: json.name || slug,
      slug: json.collection || json.slug || slug,
      imageUrl: json.image_url || json.imageUrl || json.banner_image_url,
      description: json.description,
      address,
      chain,
      openseaUrl: `https://opensea.io/collection/${json.collection || json.slug || slug}`,
      explorerUrl: `${chain.explorer}/address/${address}`,
      source: "opensea",
    },
    warning: chain.key !== preferredChainKey ? `Using OpenSea's ${chain.name} contract because ${preferredChainKey} was not listed.` : undefined,
  };
}

async function readErc721Metadata(address: string, chainKey: string): Promise<RpcResult<{ name?: string; symbol?: string }>> {
  const rpc = firstRpc(chainKey);
  if (!rpc) return { value: null, warning: `No public RPC configured for ${chainKey}.` };
  const contract = new Contract(address, ERC721_ABI, new JsonRpcProvider(rpc));
  try {
    const [name, symbol] = await Promise.all([
      contract.name().catch(() => undefined),
      contract.symbol().catch(() => undefined),
    ]);
    return { value: { name, symbol } };
  } catch (error) {
    return { value: null, warning: `Could not read ERC721 metadata: ${messageOf(error)}` };
  }
}

async function fetchPublicDrop(address: string, chainKey: string): Promise<RpcResult<{ drop: PublicDrop; feeRecipient: string; calldata: string }>> {
  const rpc = firstRpc(chainKey);
  if (!rpc) return { value: null, warning: `No public RPC configured for ${chainKey}; public stage is preview-only.` };

  const seadrop = new Contract(SEADROP_ADDRESS, PUBLIC_ABI, new JsonRpcProvider(rpc));
  try {
    const raw = await seadrop.getPublicDrop(address);
    const drop: PublicDrop = {
      mintPrice: BigInt(raw.mintPrice),
      startTime: Number(raw.startTime),
      endTime: Number(raw.endTime),
      maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
      feeBps: Number(raw.feeBps),
      restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
    };

    if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) {
      return { value: null, warning: "No SeaDrop public stage was readable on the singleton; signed stages remain preview-only." };
    }

    const feeRecipient = await resolveFeeRecipient(seadrop, address, drop.restrictFeeRecipients);
    if (!feeRecipient) {
      return { value: null, warning: "Public stage exists, but no allowed fee recipient was readable; calldata was not built." };
    }

    return {
      value: {
        drop,
        feeRecipient,
        calldata: IFACE.encodeFunctionData("mintPublic", [
          address,
          feeRecipient,
          "0x0000000000000000000000000000000000000000",
          BigInt(1),
        ]),
      },
    };
  } catch (error) {
    return { value: null, warning: `SeaDrop public read failed: ${messageOf(error)}` };
  }
}

async function resolveFeeRecipient(seadrop: Contract, address: string, restricted: boolean): Promise<string | null> {
  let allowed: string[] = [];
  try {
    allowed = (await seadrop.getAllowedFeeRecipients(address)) as string[];
  } catch {
    allowed = [];
  }
  if (allowed.length > 0) return allowed[0];
  if (restricted) return null;
  return OPENSEA_FEE_RECIPIENT;
}

function buildStages(
  address: string,
  chain: ChainOption,
  publicRead: { drop: PublicDrop; feeRecipient: string; calldata: string } | null,
  warnings: string[]
): MintStage[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const publicStart = publicRead?.drop.startTime || nowSeconds + 45 * 60;
  const publicEnd = publicRead?.drop.endTime || publicStart + 24 * 60 * 60;
  const publicPrice = publicRead ? formatEth(publicRead.drop.mintPrice) : "0.0000";
  const publicMax = publicRead?.drop.maxTotalMintableByWallet || null;

  const signedStartTimes = {
    team: publicStart - 45 * 60,
    gtd: publicStart - 30 * 60,
    fcfs: publicStart - 15 * 60,
  };

  const stages: MintStage[] = [
    signedStage("team", "TEAM", signedStartTimes.team, signedStartTimes.gtd, publicPrice, publicMax, "Team wallets require OpenSea signed calldata or an onchain allowlist proof before firing."),
    signedStage("gtd", "GTD", signedStartTimes.gtd, signedStartTimes.fcfs, publicPrice, publicMax, "Guaranteed wallets are shown for planning; eligibility must be supplied by OpenSea/signature data."),
    signedStage("fcfs", "FCFS", signedStartTimes.fcfs, publicStart, publicPrice, publicMax, "FCFS is latency-sensitive and signed; this console schedules the window but never broadcasts."),
  ];

  if (publicRead) {
    stages.push({
      id: "public",
      label: "PUBLIC STAGE",
      source: "onchain-seadrop",
      status: statusOf(publicRead.drop.startTime, publicRead.drop.endTime),
      startTime: isoOrNull(publicRead.drop.startTime),
      endTime: isoOrNull(publicRead.drop.endTime),
      priceEth: publicPrice,
      maxPerWallet: publicMax,
      eligible: statusOf(publicRead.drop.startTime, publicRead.drop.endTime) === "ended" ? "ended" : "eligible",
      summary: `On-chain SeaDrop public config read from ${chain.name}. Calldata preview uses quantity 1 and minterIfNotPayer=0x0.`,
      feeRecipient: publicRead.feeRecipient,
      calldataPreview: publicRead.calldata.slice(0, 34),
      warnings: publicRead.drop.restrictFeeRecipients ? ["Fee recipient is restricted; using the first allowed address read on-chain."] : [],
    });
  } else {
    stages.push({
      id: "public",
      label: "PUBLIC STAGE",
      source: "mock-preview",
      status: statusOf(publicStart, publicEnd),
      startTime: isoOrNull(publicStart),
      endTime: isoOrNull(publicEnd),
      priceEth: publicPrice,
      maxPerWallet: publicMax,
      eligible: "watch-only",
      summary: `No local SeaDrop public calldata could be built for ${shortAddress(address)}; this is a schedule preview only.`,
      warnings: warnings.length > 0 ? [warnings[warnings.length - 1]] : ["Public stage is not executable from this preview."],
    });
  }

  return stages;
}

function signedStage(
  id: "team" | "gtd" | "fcfs",
  label: string,
  start: number,
  end: number,
  priceEth: string,
  maxPerWallet: number | null,
  summary: string
): MintStage {
  return {
    id,
    label,
    source: "opensea-signed-preview",
    status: statusOf(start, end),
    startTime: isoOrNull(start),
    endTime: isoOrNull(end),
    priceEth,
    maxPerWallet,
    eligible: statusOf(start, end) === "ended" ? "ended" : "needs-signature",
    summary,
    warnings: ["Preview only: signed/allowlist stages need wallet-specific calldata and are not broadcast by the webapp."],
  };
}

function firstRpc(chainKey: string): string | null {
  const explicit = process.env[`RPC_URL_${chainKey.toUpperCase()}`] || (process.env.CHAIN === chainKey ? process.env.RPC_URL : undefined);
  if (explicit) return explicit.split(",")[0]?.trim() || null;
  return PUBLIC_RPCS[chainKey]?.[0] ?? null;
}

function statusOf(start: number, end: number): StageStatus {
  const now = Math.floor(Date.now() / 1000);
  if (!start && !end) return "unknown";
  if (end && now >= end) return "ended";
  if (start && now >= start) return "live";
  return "upcoming";
}

function isoOrNull(epochSeconds: number): string | null {
  return epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null;
}

function formatEth(value: bigint): string {
  const raw = formatEther(value);
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(4, "0").slice(0, 4)}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
