import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  metadata: GlobalMetadataIndex | null;

}

export default function OrganizationsPage({ metadata }: Props) {
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  const sortedOrgs = useMemo(() => {
    if (!metadata) return [];
    const lower = filter.toLowerCase();
    return metadata.orgs
      .filter(o => o.name.toLowerCase().includes(lower))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [metadata, filter]);

  return (
    <div className="orgs-page">
      <div className="view-header">
        <h2>Global Organizations</h2>
        <p className="view-sub">Index of tracked entities and their Autonomous Systems.</p>

        <input
          type="text"
          placeholder="Filter organizations..."
          className="org-filter-input"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className="org-grid fade-in">
        {sortedOrgs.map(o => (
          <div key={o.slug} className="org-card" onClick={() => navigate(`/org/${o.slug}`)}>
            <h3>{o.name}</h3>
            <span className="btn-secondary">View Profile &rarr;</span>
          </div>
        ))}
      </div>
      {sortedOrgs.length === 0 && <p className="empty-state">No organizations found.</p>}
    </div>
  );
}
