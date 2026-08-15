import chalk from "chalk";

interface CollectionInfo {
  name: string;
  contractAddress: string;
  chain: string;
}

export async function resolveSlug(
  slug: string,
  apiKey: string,
  preferredChain?: string
): Promise<CollectionInfo> {
  const url = `https://api.opensea.io/api/v2/collections/${slug}`;

  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve slug "${slug}": ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as any;

  // Extract primary contract from the collection
  const contracts = json.contracts;
  if (!contracts || contracts.length === 0) {
    throw new Error(`No contracts found for slug "${slug}"`);
  }

  // Prefer the contract on the chain we're actually sniping on (--chain / CHAIN),
  // otherwise take the first one OpenSea lists.
  const wanted = preferredChain?.trim().toLowerCase();
  const picked =
    (wanted && contracts.find((c: any) => c.chain?.toLowerCase() === wanted)) ||
    contracts[0];

  return {
    name: json.name || slug,
    contractAddress: picked.address,
    chain: picked.chain,
  };
}

// Detect if input is a slug (no 0x prefix) or contract address
export function isSlug(input: string): boolean {
  return !input.startsWith("0x");
}
