import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { fetchPrefixHistory } from '../dataService';
import type { DailyPrefixArchive, Transition } from '../gen/historical/v1/historical_pb';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { RpkiBadge } from '../components/RpkiBadge';

interface Props {
  dates: string[];
}

export default function PrefixViewPage({ dates }: Props) {
  const { slug, date } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DailyPrefixArchive | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const selectedDate = date || dates[0];
  const actualPrefix = searchParams.get('p') || slug; // try to get unslugged from query params if possible, else rely on data

  useEffect(() => {
    if (!selectedDate || !actualPrefix) return;
    let cancelled = false;

    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    fetchPrefixHistory(selectedDate, actualPrefix)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [actualPrefix, selectedDate]);

  const toggleExpand = (idx: number) => {
    setExpandedEvents(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="view-page">
      <div className="view-sidebar">
        <h3>Available Dates</h3>
        <ul className="date-nav">
          {dates.map(d => (
            <li key={d}>
              <Link to={`/prefix/${slug}/${d}?p=${encodeURIComponent(actualPrefix || '')}`} className={d === selectedDate ? 'active' : ''}>
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
            <h2>{data?.prefix || actualPrefix || 'Unknown Prefix'}</h2>
          </div>
          {data?.asn ? (
            <p className="asn-org-tag">Origin ASN: <Link to={`/asn/${data.asn}/${selectedDate}`}>AS{data.asn}</Link></p>
          ) : null}
          <p className="view-sub">Prefix updates captured on {selectedDate}</p>
        </div>

        {loading ? <div className="loader-center"><div className="loader"></div></div> : (
          <div className="view-content fade-in">
            {data && data.events.length > 0 ? (
              <div className="prefix-list-modern">
                <div className="prefix-entry">
                  <div className="prefix-header">
                    <span className="event-count">{data.events.length} transitions</span>
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
                        {data.events.map((ev, i) => (
                          <EventRow
                            key={i}
                            ev={ev}
                            expanded={expandedEvents[i]}
                            onToggle={() => toggleExpand(i)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <p>No routing events were recorded for {actualPrefix} on {selectedDate}.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ ev, expanded, onToggle }: { ev: Transition, expanded: boolean, onToggle: () => void }) {
  const hasExtra = ev.incidentId || ev.anomalyDetails || ev.leakDetail || ev.rpkiStatus;

  return (
    <>
      <tr className={expanded ? 'expanded' : ''} onClick={hasExtra ? onToggle : undefined} style={{ cursor: hasExtra ? 'pointer' : 'default' }}>
        <td className="time">{new Date(Number(ev.ts) * 1000).toLocaleTimeString()}</td>
        <td><ClassificationBadge classification={ev.oldState} /></td>
        <td><ClassificationBadge classification={ev.newState} /></td>
        <td className="expand-cell">
          <div className="row-actions">
            {hasExtra && (expanded ? '▼' : '▶')}
          </div>
        </td>
      </tr>
      {expanded && hasExtra && (
        <tr className="details-row">
          <td colSpan={4}>
            <div className="event-details-box fade-in">
              <div className="detail-item">
                 <RpkiBadge status={ev.rpkiStatus} />
              </div>
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
