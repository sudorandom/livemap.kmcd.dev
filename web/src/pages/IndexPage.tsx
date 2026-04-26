import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDaySummary, slugify } from '../dataService';
import type { DaySummary } from '../gen/historical/v1/historical_pb';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { RpkiBadge } from '../components/RpkiBadge';

interface Props {
  dates: string[];
}

export default function IndexPage({ dates }: Props) {
  const [data, setData] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedDate = dates[0];

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });

    fetchDaySummary(selectedDate)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedDate]);

  return (
    <div className="index-page fade-in">
      {/* Hero / About Section */}
      <section className="about-section">
        <div className="about-grid">
          <div className="about-content">
            <h2>The Global Routing Nervous System</h2>
            <p>
              This archive captures the "gossip" of the internet. <strong>BGP (Border Gateway Protocol)</strong> is the 
              postal service of the digital world, allowing millions of disparate networks to exchange information about 
              how to reach specific IP addresses.
            </p>
            <p>
              However, BGP was built on trust, making it vulnerable to accidental "fat-finger" errors and malicious 
              <strong> Route Hijacks</strong>. Every day, we monitor these transitions in real-time to visualize 
              the health and stability of the global internet.
            </p>
          </div>
          <div className="about-stats-box">
            <div className="mini-stat">
              <span className="mini-label">Total Events Today</span>
              <span className="mini-value">{data?.totalTransitions.toLocaleString() || '---'}</span>
            </div>
            <div className="mini-stat">
              <span className="mini-label">Active Organizations</span>
              <span className="mini-value">{data?.uniqueOrgs.toLocaleString() || '---'}</span>
            </div>
            <div className="mini-stat">
              <span className="mini-label">Reporting Period</span>
              <span className="mini-value">{selectedDate || '---'}</span>
            </div>
          </div>
        </div>

        <div className="rpki-explain-box">
          <h3>🛡️ Why Routing Security Matters</h3>
          <p>
            To secure the internet, we rely on <strong>RPKI (Resource Public Key Infrastructure)</strong>. RPKI allows 
            networks to cryptographically sign their routing announcements, proving they are authorized to hold specific 
            IP space. 
          </p>
          <div className="rpki-links">
            <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer">Is BGP Safe Yet?</a>
            <a href="https://blog.cloudflare.com/is-bgp-safe-yet-rpki-routing-security-initiative/" target="_blank" rel="noopener noreferrer">Cloudflare: RPKI Initiative</a>
          </div>
        </div>
      </section>

      <div className="recent-header-v2">
        <h3>Latest Global Events</h3>
      </div>

      {loading ? <div className="loader-center"><div className="loader"></div></div> : (
        <div className="recent-feed">
          {data && data.latestEvents.length > 0 ? (
            <div className="feed-table-container">
              <table className="feed-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Network / Organization</th>
                    <th>Prefix</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latestEvents.map((ev, i) => (
                    <tr key={i}>
                      <td className="time">{new Date(Number(ev.ts) * 1000).toLocaleTimeString()}</td>
                      <td>
                        <div className="feed-entity">
                          <Link to={`/asn/${ev.asn}/${selectedDate}`} className="feed-asn">AS{ev.asn}</Link>
                          <span className="feed-name">{ev.asnName}</span>
                          {ev.org && (
                            <Link to={`/org/${slugify(ev.org)}/${selectedDate}`} className="feed-org-tag">
                              {ev.org}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="feed-prefix"><code>{ev.prefix}</code></td>
                      <td>
                        <div className="feed-actions-cell">
                          <RpkiBadge status={ev.rpkiStatus} />
                          <div className="feed-transition">
                            <ClassificationBadge classification={ev.oldState} />
                            <span className="arrow">→</span>
                            <ClassificationBadge classification={ev.newState} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No recent events found. The indexer may still be warming up.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
