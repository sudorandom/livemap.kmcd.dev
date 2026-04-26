import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchAsnHistory, slugify } from '../dataService';
import type { DailyAsnArchive, GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  dates: string[];
  metadata: GlobalMetadataIndex | null;
}

export default function AsnViewPage({ dates, metadata }: Props) {
  const { asn, date } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DailyAsnArchive | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedDate = date || dates[0];
  const asnNum = parseInt(asn || '0');

  useEffect(() => {
    if (!selectedDate || !asnNum) return;
    let cancelled = false;

    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    fetchAsnHistory(selectedDate, asnNum)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [asnNum, selectedDate]);

  const asnMeta = metadata?.asns.find(a => a.asn === asnNum);

  return (
    <div className="view-page">
      <div className="view-sidebar">
        <h3>Available Dates</h3>
        <ul className="date-nav">
          {dates.map(d => (
            <li key={d}>
              <Link to={`/asn/${asnNum}/${d}`} className={d === selectedDate ? 'active' : ''}>
                {d}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="view-main">
        <div className="view-header fade-in">
          <button className="back-link" onClick={() => navigate('/')}>← Back to Search</button>
          <div className="asn-title-block">
            <span className="asn-label">AS{asnNum}</span>
            <h2>{asnMeta?.name || 'Unknown Network'}</h2>
          </div>
          {asnMeta?.org && <p className="asn-org-tag">Organization: <Link to={`/org/${slugify(asnMeta.org)}`}>{asnMeta.org}</Link></p>}
          <p className="view-sub">Prefix updates captured on {selectedDate}</p>
        </div>

        {loading ? <div className="loader-center"><div className="loader"></div></div> : (
          <div className="view-content fade-in">
            {data && data.prefixes.length > 0 ? (
              <div className="prefix-list-modern">
                {data.prefixes.map(pfx => (
                  <div key={pfx.prefix} className="prefix-entry" style={{ padding: '1rem', borderBottom: '1px solid var(--bg-surface)'}}>
                    <div className="prefix-header">
                      <code>{pfx.prefix}</code>
                      <span className="event-count">{pfx.events.length} transitions</span>
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                      <Link
                        to={`/prefix/${slugify(pfx.prefix)}/${selectedDate}?p=${encodeURIComponent(pfx.prefix)}`}
                        className="btn-secondary"
                        style={{ fontSize: '0.9rem', padding: '0.4rem 0.8rem' }}
                      >
                        View Prefix History &rarr;
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>No routing events were recorded for AS{asnNum} on {selectedDate}.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
