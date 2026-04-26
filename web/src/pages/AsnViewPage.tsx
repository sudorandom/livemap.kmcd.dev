import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchAsnHistory } from '../dataService';
import type { DailyAsnArchive, GlobalMetadataIndex, Transition } from '../gen/historical/v1/historical_pb';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { RpkiBadge } from '../components/RpkiBadge';

interface Props {
  dates: string[];
  metadata: GlobalMetadataIndex | null;
}

export default function AsnViewPage({ dates, metadata }: Props) {
  const { asn, date } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DailyAsnArchive | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const selectedDate = date || dates[0];
  const asnNum = parseInt(asn || '0');

  useEffect(() => {
    if (!selectedDate || !asnNum) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
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

  const toggleExpand = (prefix: string, idx: number) => {
    const key = `${prefix}-${idx}`;
    setExpandedEvents(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
                  <div key={pfx.prefix} className="prefix-entry">
                    <div className="prefix-header">
                      <code>{pfx.prefix}</code>
                      <span className="event-count">{pfx.events.length} transitions</span>
                    </div>
                    <div className="event-table-container">
                      <table className="transition-log">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Old State</th>
                            <th>New State</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pfx.events.map((ev, i) => (
                            <EventRow 
                              key={i} 
                              ev={ev} 
                              expanded={expandedEvents[`${pfx.prefix}-${i}`]}
                              onToggle={() => toggleExpand(pfx.prefix, i)}
                            />
                          ))}
                        </tbody>
                      </table>
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

function EventRow({ ev, expanded, onToggle }: { ev: Transition, expanded: boolean, onToggle: () => void }) {
  const hasExtra = ev.incidentId || ev.anomalyDetails || ev.leakDetail;

  return (
    <>
      <tr className={expanded ? 'expanded' : ''} onClick={hasExtra ? onToggle : undefined} style={{ cursor: hasExtra ? 'pointer' : 'default' }}>
        <td className="time">{new Date(Number(ev.ts) * 1000).toLocaleTimeString()}</td>
        <td><ClassificationBadge classification={ev.oldState} /></td>
        <td><ClassificationBadge classification={ev.newState} /></td>
        <td className="expand-cell">
          <div className="row-actions">
            <RpkiBadge status={ev.rpkiStatus} />
            {hasExtra && (expanded ? '▼' : '▶')}
          </div>
        </td>
      </tr>
      {expanded && hasExtra && (
        <tr className="details-row">
          <td colSpan={4}>
            <div className="event-details-box fade-in">
              {ev.incidentId && (
                <div className="detail-item">
                  <label>Incident ID</label>
                  <span>{ev.incidentId}</span>
                </div>
              )}
              {ev.anomalyDetails && (
                <div className="detail-item">
                  <label>Anomaly Details</label>
                  <p>{ev.anomalyDetails}</p>
                </div>
              )}
              {ev.leakDetail && (
                <div className="detail-item">
                  <label>Route Leak Context</label>
                  <div className="leak-grid">
                    <div className="leak-sub">
                      <label>Leaker</label>
                      <div className="leak-entity-info">
                        <span>AS{ev.leakDetail.leakerAsn} ({ev.leakDetail.leakerName})</span>
                        <RpkiBadge status={ev.leakDetail.leakerRpkiStatus} />
                      </div>
                    </div>
                    <div className="leak-sub">
                      <label>Victim</label>
                      <div className="leak-entity-info">
                        <span>AS{ev.leakDetail.victimAsn} ({ev.leakDetail.victimName})</span>
                        <RpkiBadge status={ev.leakDetail.victimRpkiStatus} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}
