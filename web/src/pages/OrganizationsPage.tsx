import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDaySummary } from '../dataService';
import type { GlobalMetadataIndex, DaySummary } from '../gen/historical/v1/historical_pb';

interface Props {
  metadata: GlobalMetadataIndex | null;
  dates: string[];
}

const PAGE_SIZE = 48;

export default function OrganizationsPage({ metadata, dates }: Props) {
  const [filter, setFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [todaySummary, setDaySummary] = useState<DaySummary | null>(null);
  const navigate = useNavigate();

  const selectedDate = dates && dates.length > 0 ? dates[0] : null;

  useEffect(() => {
    if (!selectedDate) return;
    fetchDaySummary(selectedDate).then(setDaySummary);
  }, [selectedDate]);

  const activeOrgSlugs = useMemo(() => {
    if (!todaySummary) return new Set<string>();
    return new Set(todaySummary.latestEvents.map(ev => slugify(ev.org)).filter(s => s !== ''));
  }, [todaySummary]);

  const filteredOrgs = useMemo(() => {
    const orgs = metadata?.orgs || [];
    const query = filter.toLowerCase();
    return orgs.filter(o => {
      const matchesQuery = o.name.toLowerCase().includes(query);
      const matchesActive = !activeOnly || activeOrgSlugs.has(o.slug);
      return matchesQuery && matchesActive;
    });
  }, [metadata, filter, activeOnly, activeOrgSlugs]);

  const totalPages = Math.ceil(filteredOrgs.length / PAGE_SIZE);
  const currentOrgs = useMemo(() => {
    return filteredOrgs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [filteredOrgs, page]);

  return (
    <div className="orgs-page fade-in">
      <div className="orgs-header">
        <div>
          <h2>Global Organizations</h2>
          <p className="orgs-sub">Browsing {filteredOrgs.length.toLocaleString()} unique entities.</p>
        </div>
        <div className="org-filters">
          <label className="checkbox-filter">
            <input 
              type="checkbox" 
              checked={activeOnly} 
              onChange={(e) => { setActiveOnly(e.target.checked); setPage(0); }} 
            />
            Active Today
          </label>
          <div className="filter-box">
            <input 
              type="text" 
              placeholder="Filter by name..." 
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
            />
          </div>
        </div>
      </div>

      <div className="org-list-grid">
        {currentOrgs.map(org => (
          <div key={org.slug} className="org-card" onClick={() => navigate(`/org/${org.slug}/${selectedDate}`)}>
            <div className="org-card-name">{org.name}</div>
            <div className="org-card-slug">
              {org.slug}
              {activeOrgSlugs.has(org.slug) && <span className="active-tag">Active</span>}
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
          <div className="page-numbers">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i;
              if (p < 0 || p >= totalPages) return null;
              return (
                <button 
                  key={p} 
                  className={p === page ? 'active' : ''} 
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </button>
              );
            })}
          </div>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}
