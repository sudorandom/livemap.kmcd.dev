import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchOrgHistory } from '../dataService';
import type { OrgArchive, GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  dates: string[];
  metadata: GlobalMetadataIndex | null;
}

export default function OrgViewPage({ dates, metadata }: Props) {
  const { slug, date } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<OrgArchive | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const selectedDate = date || dates[0];

  useEffect(() => {
    if (!selectedDate || !slug) return;
    let cancelled = false;
    
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    fetchOrgHistory(selectedDate, slug)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug, selectedDate]);

  const orgMeta = metadata?.orgs.find(o => o.slug === slug);

  const enrichedAsns = useMemo(() => {
    if (!data) return [];
    return data.asns.map(asn => {
      const meta = metadata?.asns.find(a => a.asn === asn);
      return {
        asn,
        name: meta?.name || 'Unknown Network',
      };
    }).filter(a => 
      a.name.toLowerCase().includes(filter.toLowerCase()) || 
      a.asn.toString().includes(filter)
    );
  }, [data, metadata, filter]);

  return (
    <div className="view-page">
      <div className="view-sidebar">
        <h3>Available Dates</h3>
        <ul className="date-nav">
          {dates.map(d => (
            <li key={d}>
              <Link to={`/org/${slug}/${d}`} className={d === selectedDate ? 'active' : ''}>
                {d}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="view-main">
        <div className="view-header fade-in">
          <div className="view-title-row">
            <div className="view-title-group">
              <button className="back-link" onClick={() => navigate('/orgs')}>← All Organizations</button>
              <h2>{orgMeta?.name || slug}</h2>
              <p className="view-sub">Routing footprint for {selectedDate}</p>
            </div>
            {data && data.eventCount > 0 && (
              <div className="event-badge-large">
                <span className="badge-count">{data.eventCount}</span>
                <span className="badge-label">Events Today</span>
              </div>
            )}
          </div>
        </div>

        {loading ? <div className="loader-center"><div className="loader"></div></div> : (
          <div className="view-content fade-in">
            <div className="view-actions">
              <input 
                type="text" 
                placeholder="Filter ASNs by number or name..." 
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="table-filter"
              />
            </div>

            {enrichedAsns.length > 0 ? (
              <div className="table-container-modern">
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th>ASN</th>
                      <th>Network Name</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedAsns.map(item => (
                      <tr key={item.asn} onClick={() => navigate(`/asn/${item.asn}/${selectedDate}`)} className="clickable-row">
                        <td className="asn-cell">AS{item.asn}</td>
                        <td className="name-cell">{item.name}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="view-link">View History →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>{data ? 'No ASNs matching your filter.' : `No routing events were recorded for this organization on ${selectedDate}.`}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
