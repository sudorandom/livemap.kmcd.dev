import { RPKIStatus } from "../gen/livemap/v1/livemap_pb";

function getRpkiStatusName(s: RPKIStatus): string {
  switch (s) {
    case RPKIStatus.RPKI_STATUS_VALID: return 'Valid';
    case RPKIStatus.RPKI_STATUS_INVALID: return 'Invalid';
    case RPKIStatus.RPKI_STATUS_NOT_FOUND: return 'Unknown';
    default: return 'Unspecified';
  }
}

function getRpkiStatusColor(s: RPKIStatus): string {
  switch (s) {
    case RPKIStatus.RPKI_STATUS_VALID: return 'var(--accent-green)';
    case RPKIStatus.RPKI_STATUS_INVALID: return 'var(--accent-pink)';
    case RPKIStatus.RPKI_STATUS_NOT_FOUND: return 'var(--text-dim)';
    default: return '#555';
  }
}

export function RpkiBadge({ status }: { status: RPKIStatus | number }) {
  const name = getRpkiStatusName(status as RPKIStatus);
  const color = getRpkiStatusColor(status as RPKIStatus);
  
  const isInvalid = status === RPKIStatus.RPKI_STATUS_INVALID;

  return (
    <div className="rpki-badge-container">
      <span className="badge rpki-badge" style={{ borderColor: color, color: color }}>
        RPKI: {name}
      </span>
      {isInvalid && (
        <div className="rpki-warning-links">
          <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer">Learn More</a>
        </div>
      )}
    </div>
  );
}
