import type { OrgArchive } from "../gen/historical/v1/historical_pb";

export function OrgView({ data, onAsnClick }: { data: OrgArchive, onAsnClick: (asn: number) => void }) {
  return (
    <div className="org-view">
      <div className="org-header">
        <h3>{data.org}</h3>
        <p>Organization View</p>
      </div>

      <div className="asn-grid">
        {data.asns.map((asn) => (
          <div key={asn} className="asn-card" onClick={() => onAsnClick(asn)}>
            <span className="asn-number">AS{asn}</span>
            <span className="view-link">View History →</span>
          </div>
        ))}
      </div>
    </div>
  );
}
