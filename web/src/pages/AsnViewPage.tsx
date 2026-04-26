import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchAsnHistoryAggregated, slugify } from '../dataService';
import type { DailyAsnArchive, GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  dates: string[];
  metadata: GlobalMetadataIndex | null;
}

export default function AsnViewPage({ dates, metadata }: Props) {
  const { asn } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DailyAsnArchive | null>(null);
  const [loading, setLoading] = useState(false);

  const asnNum = parseInt(asn || '0');

  useEffect(() => {
    if (!asnNum || dates.length === 0) return;
    let cancelled = false;

    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    fetchAsnHistoryAggregated(dates, asnNum)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [asnNum, dates]);

  const asnMeta = metadata?.asns.find(a => a.asn === asnNum);

  return (
    <div className="view-page single-col">
      <div className="view-main">
        <div className="view-header fade-in">
          <button className="back-link" onClick={() => navigate('/')}>← Back to Search</button>
          <div className="asn-title-block">
            <span className="asn-label">AS{asnNum}</span>
            <h2>{asnMeta?.name || 'Unknown Network'}</h2>
          </div>
          {asnMeta?.org && <p className="asn-org-tag">Organization: <Link to={`/org/${slugify(asnMeta.org)}`}>{asnMeta.org}</Link></p>}
          <p className="view-sub">Prefix updates aggregated over the last 7 days</p>
        </div>

        {loading ? <div className="loader-center"><div className="loader"></div></div> : (
          <div className="view-content fade-in">
            {data && data.prefixes.length > 0 ? (
              <div className="prefix-list-modern">
                {data.prefixes.map(pfx => (
                  <div key={pfx.prefix} className="prefix-entry" style={{ padding: '1rem', borderBottom: '1px solid var(--bg-surface)'}}>
                    <div className="prefix-header">
                      <code>{pfx.prefix}</code>
                      <span className="event-count">{pfx.events.length} transitions (7d)</span>
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                      <Link
                        to={`/prefix/${slugify(pfx.prefix)}/${dates[0] || ''}?p=${encodeURIComponent(pfx.prefix)}`}
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
                <p>No routing events were recorded for AS{asnNum} in the last 7 days.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
