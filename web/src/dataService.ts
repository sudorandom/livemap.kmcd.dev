import { fromBinary } from "@bufbuild/protobuf";
import { DaySummarySchema } from "./gen/summary/v1/summary_pb";
import { Classification } from "./gen/livemap/v1/livemap_pb";

async function fetchBinary(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchDaySummary() {
  const data = await fetchBinary(`/data/summary.pb`);
  if (!data) return null;
  try {
    return fromBinary(DaySummarySchema, data);
  } catch (err) {
    console.error(`Protobuf decoding error for Day Summary:`, err);
    return null;
  }
}

export function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export function formatHumanNumber(num: number): string {
  if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'b';
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
