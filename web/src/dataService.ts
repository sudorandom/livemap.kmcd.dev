import { fromBinary } from "@bufbuild/protobuf";
import { DailyAsnArchiveSchema, OrgArchiveSchema, GlobalMetadataIndexSchema, DaySummarySchema, DailyAsnArchive, OrgArchive } from "./gen/historical/v1/historical_pb";
import { Classification } from "./gen/livemap/v1/livemap_pb";

async function fetchBinary(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }

  // Prevent parsing HTML fallback pages as Protobuf
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("text/html")) {
    console.warn(`Expected binary data from ${url} but received HTML. This usually means the file is missing and the server fell back to index.html.`);
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export async function fetchMetadataIndex() {
  const bytes = await fetchBinary('/data/metadata.pb');
  if (!bytes) return null;
  try {
    return fromBinary(GlobalMetadataIndexSchema, bytes);
  } catch (err) {
    console.error("Protobuf decoding error for Metadata Index:", err);
    return null;
  }
}

export async function fetchDaySummary(date: string) {
  const bytes = await fetchBinary(`/data/${date}/summary.pb`);
  if (!bytes) return null;
  try {
    return fromBinary(DaySummarySchema, bytes);
  } catch (err) {
    console.error(`Protobuf decoding error for Day Summary (${date}):`, err);
    return null;
  }
}

export async function fetchAsnHistory(date: string, asn: number) {
  const shard = (asn % 100).toString().padStart(2, '0');
  const url = `/data/${date}/asns/${shard}/${asn}.pb`;
  
  const bytes = await fetchBinary(url);
  if (!bytes) return null;

  try {
    return fromBinary(DailyAsnArchiveSchema, bytes);
  } catch (err) {
    console.error("Protobuf decoding error for ASN:", err);
    throw new Error("Received invalid data format from server.", { cause: err });
  }
}

export async function fetchOrgHistory(date: string, orgSlug: string) {
  const url = `/data/${date}/orgs/${orgSlug}.pb`;
  
  const bytes = await fetchBinary(url);
  if (!bytes) return null;

  try {
    return fromBinary(OrgArchiveSchema, bytes);
  } catch (err) {
    console.error("Protobuf decoding error for Org:", err);
    throw new Error("Received invalid data format from server.", { cause: err });
  }
}

export async function fetchAsnHistoryAggregated(dates: string[], asn: number): Promise<DailyAsnArchive | null> {
  const fetches = dates.slice(0, 7).map(d => fetchAsnHistory(d, asn).catch(() => null));
  const results = await Promise.all(fetches);

  let merged: DailyAsnArchive | null = null;

  for (const res of results) {
    if (!res) continue;
    if (!merged) {
      merged = res;
      continue;
    }

    // Merge prefixes
    for (const p of res.prefixes) {
      const existing = merged.prefixes.find(x => x.prefix === p.prefix);
      if (existing) {
        existing.events.push(...p.events);
      } else {
        merged.prefixes.push(p);
      }
    }
  }

  // Sort events by timestamp if needed (already sorted usually, but good practice when merging)
  if (merged) {
    for (const p of merged.prefixes) {
      p.events.sort((a, b) => Number(b.ts) - Number(a.ts));
    }
  }

  return merged;
}

export async function fetchOrgHistoryAggregated(dates: string[], orgSlug: string): Promise<OrgArchive | null> {
  const fetches = dates.slice(0, 7).map(d => fetchOrgHistory(d, orgSlug).catch(() => null));
  const results = await Promise.all(fetches);

  let merged: OrgArchive | null = null;

  for (const res of results) {
    if (!res) continue;
    if (!merged) {
      merged = res;
      continue;
    }

    merged.eventCount += res.eventCount;
    for (const a of res.asns) {
      if (!merged.asns.includes(a)) {
        merged.asns.push(a);
      }
    }
  }

  if (merged) {
    merged.asns.sort((a, b) => a - b);
  }

  return merged;
}

export function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export function getClassificationName(c: Classification): string {
  // Convert explicitly to number first in case TS loses track
  switch (Number(c)) {
    case Classification.BOGON: return 'Bogon';
    case Classification.HIJACK: return 'Hijack';
    case Classification.ROUTE_LEAK: return 'Route Leak';
    case Classification.MINOR_ROUTE_LEAK: return 'Minor Route Leak';
    case Classification.OUTAGE: return 'Outage';
    case Classification.DDOS_MITIGATION: return 'DDoS Mitigation';
    case Classification.FLAP: return 'Flap';
    case Classification.PATH_HUNTING: return 'Path Hunting';
    case Classification.DISCOVERY: return 'Discovery';
    case Classification.UNSPECIFIED: return 'Unspecified';
    default: return `Unknown (${c})`;
  }
}

export function getClassificationColor(c: Classification): string {
  switch (c) {
    case Classification.HIJACK:
    case Classification.ROUTE_LEAK:
    case Classification.OUTAGE:
      return 'var(--accent-pink)';
    case Classification.FLAP:
      return '#ff8c00'; // Orange
    case Classification.DDOS_MITIGATION:
    case Classification.PATH_HUNTING:
      return 'var(--accent-blue)';
    default:
      return '#888';
  }
}

import { GlobalPrefixShardSchema, DailyPrefixArchiveSchema } from "./gen/historical/v1/historical_pb";

export async function fetchPrefixShardMetadata(octet: string) {
  const bytes = await fetchBinary(`/data/prefixes/${octet}/metadata.pb`);
  if (!bytes) return null;
  try {
    return fromBinary(GlobalPrefixShardSchema, bytes);
  } catch (err) {
    console.error("Protobuf decoding error for Prefix Shard:", err);
    return null;
  }
}

export async function fetchPrefixHistory(date: string, prefix: string) {
  const pfxSlug = slugify(prefix);
  const octet = prefix.split('.')[0] || "0";
  const url = `/data/${date}/prefixes/${octet}/${pfxSlug}.pb`;

  const bytes = await fetchBinary(url);
  if (!bytes) return null;

  try {
    return fromBinary(DailyPrefixArchiveSchema, bytes);
  } catch (err) {
    console.error("Protobuf decoding error for Prefix:", err);
    throw new Error("Received invalid data format from server.", { cause: err });
  }
}

export function parseIP(ipStr: string): number[] | null {
  if (ipStr.includes('.')) {
    const parts = ipStr.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
      return parts;
    }
  } else if (ipStr.includes(':')) {
    // simplified parsing
  }
  return null;
}
