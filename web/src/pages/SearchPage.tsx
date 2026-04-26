import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GlobalMetadataIndex } from '../gen/historical/v1/historical_pb';

interface Props {
  metadata: GlobalMetadataIndex | null;
  dates: string[];
}

export default function SearchPage({ metadata, dates }: Props) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const results = useMemo(() => {
    if (!metadata || query.length < 2) return { asns: [], orgs: [] };
    const q = query.toLowerCase();
    
    // Check if it's an ASN number
    const asnMatch = q.match(/^as(\d+)$/) || q.match(/^(\d+)$/);
    if (asnMatch) {
      const asnNum = parseInt(asnMatch[1]);
      const found = metadata.asns.find(a => a.asn === asnNum);
      if (found) return { asns: [found], orgs: [] };
    }

    return {
      asns: metadata.asns.filter(a => a.name.toLowerCase().includes(q) || a.asn.toString().includes(q)).slice(0, 10),
      orgs: metadata.orgs.filter(o => o.name.toLowerCase().includes(q)).slice(0, 10)
    };
  }, [metadata, query]);

  const defaultDate = dates[0] || '';

  return (
    <div className="search-hero">
      <div className="search-center">
        <h2>Explore Global Routing History</h2>
        <p className="hero-sub">Enter an Autonomous System number or Organization name to see real-time routing events.</p>
        
        <div className="hero-search-box">
          <input 
            type="text" 
            placeholder="AS15169, Google, Cloudflare..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {query.length >= 2 && (
          <div className="hero-results fade-in">
            {results.orgs.length > 0 && (
              <div className="hero-result-group">
                <label>Organizations</label>
                {results.orgs.map(o => (
                  <div key={o.slug} className="hero-item" onClick={() => navigate(`/org/${o.slug}/${defaultDate}`)}>
                    <span className="hero-name">{o.name}</span>
                    <span className="hero-type">ORG</span>
                  </div>
                ))}
              </div>
            )}
            {results.asns.length > 0 && (
              <div className="hero-result-group">
                <label>Autonomous Systems</label>
                {results.asns.map(a => (
                  <div key={a.asn} className="hero-item" onClick={() => navigate(`/asn/${a.asn}/${defaultDate}`)}>
                    <span className="hero-asn">AS{a.asn}</span>
                    <span className="hero-name">{a.name}</span>
                  </div>
                ))}
              </div>
            )}
            {results.asns.length === 0 && results.orgs.length === 0 && (
              <p className="no-res-hero">No matching records found in the global index.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
