export function parseCidr(cidr: string): { ip: number; mask: number; isV4: boolean } | null {
  const [ipStr, maskStr] = cidr.split('/');

  if (ipStr.includes('.')) { // IPv4
    const parts = ipStr.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
      const ip = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
      const mask = maskStr ? parseInt(maskStr, 10) : 32;
      if (mask >= 0 && mask <= 32) {
        return { ip: ip >>> 0, mask, isV4: true }; // Ensure unsigned
      }
    }
  } else if (ipStr.includes(':')) { // IPv6
    // Simplified parsing. We just return a flag for now.
    // True subnet checking for IPv6 is complex in JS without BigInt.
    // For this prototype we will just use exact string matches or partial string matches for IPv6.
    return { ip: 0, mask: 0, isV4: false };
  }

  return null;
}

export function isSubnetOf(parentCidr: string, childCidr: string): boolean {
  const parent = parseCidr(parentCidr);
  const child = parseCidr(childCidr);
  if (!parent || !child || parent.isV4 !== child.isV4) return false;
  if (!parent.isV4) {
    return parentCidr === childCidr || childCidr.startsWith(parentCidr.split('/')[0]); // Very rough IPv6 fallback
  }

  if (child.mask < parent.mask) return false;

  const maskVal = parent.mask === 0 ? 0 : (~0 << (32 - parent.mask)) >>> 0;
  return (parent.ip & maskVal) === (child.ip & maskVal);
}
