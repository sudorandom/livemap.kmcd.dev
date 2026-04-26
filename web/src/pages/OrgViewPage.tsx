import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchOrgHistoryAggregated } from '../dataService';
import type { OrgArchive, GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  dates: string[];
  metadata: GlobalMetadataIndex | null;
}

export default function OrgViewPage({ dates, metadata }: Props) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<OrgArchive | null>(null);
  const [loading, setLoading] = useState(false);

  const orgMeta = metadata?.orgs.find(o => o.slug === slug);

  useEffect(() => {
    if (!slug || dates.length === 0) return;
    let cancelled = false;

    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    fetchOrgHistoryAggregated(dates, slug)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug, dates]);

  return (
    <div className="view-page single-col">
      <div className="view-main">
        <div className="view-header fade-in">
          <button className="back-link" onClick={() => navigate('/orgs')}>← Back to Organizations</button>
          <div className="asn-title-block">
            <h2>{orgMeta?.name || slug}</h2>
          </div>
          <p className="view-sub">Aggregated activity over the last 7 days</p>
        </div>

        {loading ? <div className="loader-center"><div className="loader"></div></div> : (
          <div className="view-content fade-in">
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-val">{data?.eventCount || 0}</span>
                <span className="stat-lbl">Events (7d)</span>
              </div>
              <div className="stat-card">
                <span className="stat-val">{data?.asns.length || 0}</span>
                <span className="stat-lbl">Active ASNs</span>
              </div>
            </div>

            {data && data.asns.length > 0 ? (
              <div className="asn-grid mt-2">
                {data.asns.map(a => {
                  const m = metadata?.asns.find(x => x.asn === a);
                  return (
                    <Link key={a} to={`/asn/${a}`} className="asn-card">
                      <span className="asn-num">AS{a}</span>
                      <span className="asn-name">{m?.name || 'Unknown'}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state mt-2">
                <p>No routing events were recorded for this organization in the last 7 days.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
