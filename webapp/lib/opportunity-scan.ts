import { discoverMint } from "./mint-discovery";
import type { MintDiscoveryResponse } from "./mint-types";

export type OpportunitySignal = "ready" | "watch" | "blocked";

export interface OpportunityWatchItem {
  query: string;
  chain?: string;
}

export interface OpportunityCandidate {
  query: string;
  name: string;
  chain: string;
  address: string;
  signal: OpportunitySignal;
  score: number;
  nextAction: "Prepare canary" | "Watch window" | "Fix input";
  reason: string;
  warnings: string[];
  openStageCount: number;
  executableStageCount: number;
}

export interface OpportunityScanResult {
  schemaVersion: "opportunity-scan.v1";
  generatedAt: string;
  mode: "preview-only";
  safety: {
    previewOnly: true;
    execution: "none";
    broadcast: false;
    custody: false;
  };
  checked: number;
  candidates: OpportunityCandidate[];
  errors: { query: string; error: string }[];
}

export async function runOpportunityScan(input: { items: OpportunityWatchItem[]; now?: Date; discoverer?: (query: string, chain?: string) => Promise<MintDiscoveryResponse> }): Promise<OpportunityScanResult> {
  const discoverer = input.discoverer ?? discoverMint;
  const items = sanitizeItems(input.items).slice(0, 8);
  const candidates: OpportunityCandidate[] = [];
  const errors: { query: string; error: string }[] = [];

  for (const item of items) {
    try {
      const discovery = await discoverer(item.query, item.chain);
      candidates.push(scoreDiscovery(discovery));
    } catch (error) {
      errors.push({ query: item.query, error: safeMessageOf(error) });
    }
  }

  return {
    schemaVersion: "opportunity-scan.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: "preview-only",
    safety: { previewOnly: true, execution: "none", broadcast: false, custody: false },
    checked: items.length,
    candidates: candidates.sort((a, b) => b.score - a.score),
    errors,
  };
}

export function scoreDiscovery(discovery: MintDiscoveryResponse): OpportunityCandidate {
  const openStages = discovery.stages.filter((stage) => stage.status === "live" || stage.status === "upcoming");
  const executableStages = discovery.stages.filter((stage) => stage.source === "onchain-seadrop" && (stage.status === "live" || stage.status === "upcoming") && stage.feeRecipient);
  const warningPenalty = Math.min(30, discovery.warnings.length * 10);
  const score = Math.max(0, Math.min(100, executableStages.length * 45 + openStages.length * 10 - warningPenalty));
  const signal: OpportunitySignal = executableStages.length > 0 ? "ready" : openStages.length > 0 ? "watch" : "blocked";

  return {
    query: discovery.query,
    name: discovery.collection.name,
    chain: discovery.collection.chain.name,
    address: discovery.collection.address,
    signal,
    score,
    nextAction: signal === "ready" ? "Prepare canary" : signal === "watch" ? "Watch window" : "Fix input",
    reason: signal === "ready"
      ? "Public SeaDrop stage is readable and can be simulated before any broadcast."
      : signal === "watch"
        ? "A mint window is visible, but executable public calldata is not ready."
        : "No executable or upcoming mint window was verified.",
    warnings: discovery.warnings,
    openStageCount: openStages.length,
    executableStageCount: executableStages.length,
  };
}

function sanitizeItems(items: OpportunityWatchItem[]): OpportunityWatchItem[] {
  const seen = new Set<string>();
  const out: OpportunityWatchItem[] = [];
  for (const item of items) {
    const query = item.query.trim();
    if (!query || /(?:^|[\s,/?#=&._-])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,/?#=&._-])/.test(query)) continue;
    const key = `${query.toLowerCase()}::${(item.chain ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query, chain: item.chain });
  }
  return out;
}

function safeMessageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s"'`)]+/g, "[redacted-url]")
    .replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, "[redacted-hex]");
}
