import { discoverMint } from "./mint-discovery";
import type { MintDiscoveryResponse } from "./mint-types";
import {
  fetchOpenSeaDropsFeed,
  type OpenSeaDropCard,
  type OpenSeaDropsFeedError,
  type OpenSeaDropsFeedResult,
} from "./opensea-drops-feed";

type FeedFetcher = typeof fetchOpenSeaDropsFeed;
type Discoverer = (query: string, chain?: string) => Promise<MintDiscoveryResponse>;

export async function fetchVerifiedLiveDrops(input: {
  limit?: number;
  feedFetcher?: FeedFetcher;
  discoverer?: Discoverer;
}): Promise<OpenSeaDropsFeedResult | OpenSeaDropsFeedError> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const feedFetcher = input.feedFetcher ?? fetchOpenSeaDropsFeed;
  const discoverer = input.discoverer ?? discoverMint;
  const [live, past] = await Promise.all([
    feedFetcher({ mode: "live", limit: 60 }),
    feedFetcher({ mode: "past", limit: 60 }),
  ]);

  if (!live.ok && !past.ok) return live;

  const directLive = live.ok ? live.items : [];
  const directKeys = new Set(directLive.map(dropKey));
  const pastCandidates = past.ok ? past.items.filter((item) => !directKeys.has(dropKey(item))) : [];
  const rescued: OpenSeaDropCard[] = [];
  let lookupFailures = 0;

  for (let index = 0; index < pastCandidates.length; index += 4) {
    const batch = pastCandidates.slice(index, index + 4);
    const checked = await Promise.all(
      batch.map(async (card) => {
        try {
          const discovery = await discoverer(card.contractAddress, card.chain);
          const stage = discovery.stages.find(
            (candidate) =>
              candidate.source === "onchain-seadrop" &&
              (candidate.status === "live" || candidate.status === "upcoming") &&
              Boolean(candidate.feeRecipient),
          );
          if (!stage) return null;
          return {
            ...card,
            isMinting: stage.status === "live",
            isMintedOut: false,
            startTime: stage.startTime ?? card.startTime,
            endTime: stage.endTime ?? card.endTime,
          } satisfies OpenSeaDropCard;
        } catch {
          lookupFailures += 1;
          return null;
        }
      }),
    );
    for (const item of checked) {
      if (item) rescued.push(item);
    }
  }

  const base = live.ok ? live : past;
  if (!base.ok) return base;
  const items = [...rescued, ...directLive]
    .filter((item, index, all) => all.findIndex((candidate) => dropKey(candidate) === dropKey(item)) === index)
    .sort((a, b) => liveRank(a) - liveRank(b))
    .slice(0, limit);

  return {
    ...base,
    mode: "live",
    fetchedAt: new Date().toISOString(),
    items,
    warnings: [
      ...base.warnings,
      rescued.length > 0
        ? `${rescued.length} OpenSea Past drop${rescued.length === 1 ? "" : "s"} restored after live SeaDrop verification.`
        : "OpenSea Past candidates were checked against live SeaDrop stages; none required restoration.",
      ...(lookupFailures > 0 ? [`${lookupFailures} Past candidate lookup${lookupFailures === 1 ? "" : "s"} failed and were not promoted.`] : []),
    ],
  };
}

function dropKey(item: OpenSeaDropCard): string {
  return `${item.chain}:${item.contractAddress.toLowerCase()}`;
}

function liveRank(item: OpenSeaDropCard): number {
  if (item.isMinting) return 0;
  const start = item.startTime ? Date.parse(item.startTime) : Number.POSITIVE_INFINITY;
  return Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
}
