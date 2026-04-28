import { fromBinary } from "@bufbuild/protobuf";
import { DailyAsnArchiveSchema, OrgArchiveSchema, GlobalMetadataIndexSchema, DaySummarySchema } from "./gen/historical/v1/historical_pb";
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

export function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export function formatHumanNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return num.toString();
}

export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 5) return 'just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  return date.toLocaleDateString();
}

export function getClassificationName(c: Classification): string {
  switch (c) {
    case Classification.HIJACK: return 'Hijack';
    case Classification.ROUTE_LEAK: return 'Route Leak';
    case Classification.MINOR_ROUTE_LEAK: return 'Minor Route Leak';
    case Classification.OUTAGE: return 'Outage';
    case Classification.DDOS_MITIGATION: return 'DDoS Mitigation';
    case Classification.FLAP: return 'Flap';
    case Classification.PATH_HUNTING: return 'Path Hunting';
    case Classification.DISCOVERY: return 'Discovery';
    default: return 'Unknown';
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
