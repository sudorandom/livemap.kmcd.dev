import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GlobalMetadataIndex, PrefixSnapshot } from '../gen/historical/v1/historical_pb';
import { fetchPrefixShardMetadata, slugify } from '../dataService';
import { isSubnetOf } from '../cidrUtils';

interface Props {
  metadata: GlobalMetadataIndex | null;
  dates: string[];
}

export default function SearchPage({ metadata, dates }: Props) {
  const [query, setQuery] = useState('');
  const [prefixResults, setPrefixResults] = useState<PrefixSnapshot[]>([]);
  const [isSearchingPrefix, setIsSearchingPrefix] = useState(false);
  const navigate = useNavigate();

  const results = useMemo(() => {
    if (!metadata || query.length < 2) return { asns: [], orgs: [] };
    const q = query.toLowerCase();
    
    // Check if it's an ASN number
    const asnMatch = q.match(/^as(\d+)$/) || q.match(/^(\d+)$/);
    if (asnMatch && !q.includes('.') && !q.includes(':')) {
      const asnNum = parseInt(asnMatch[1]);
      const found = metadata.asns.find(a => a.asn === asnNum);
      if (found) return { asns: [found], orgs: [] };
    }

    return {
      asns: metadata.asns.filter(a => a.name.toLowerCase().includes(q) || a.asn.toString().includes(q)).slice(0, 10),
      orgs: metadata.orgs.filter(o => o.name.toLowerCase().includes(q)).slice(0, 10)
    };
  }, [metadata, query]);

  // Handle prefix search
  useEffect(() => {
    const q = query.trim();
    if (q.includes('.') || q.includes(':')) {
      const octet = q.split('.')[0] || "0";
      let cancelled = false;
      Promise.resolve().then(() => { if (!cancelled) setIsSearchingPrefix(true); });
      fetchPrefixShardMetadata(octet).then(shard => {
        if (cancelled) return;
        if (!shard) {
          Promise.resolve().then(() => setPrefixResults([]));
          Promise.resolve().then(() => setIsSearchingPrefix(false));
          return;
        }

        // Add a default mask if the user just typed an IP without CIDR
        const searchCidr = q.includes('/') ? q : (q.includes(':') ? `${q}/128` : `${q}/32`);

        const matches = shard.snapshots.filter(s => {
          // Check if searched IP/subnet is within the tracked prefix
          const isContained = isSubnetOf(s.prefix, searchCidr);
          // Check if tracked prefix is within the searched subnet (user searches for a larger block to find smaller blocks inside it)
          const contains = isSubnetOf(searchCidr, s.prefix);
          return isContained || contains;
        });

        // Sort exact matches to the top
        matches.sort((a, b) => {
          if (a.prefix === q || a.prefix === searchCidr) return -1;
          if (b.prefix === q || b.prefix === searchCidr) return 1;
          return 0;
        });

        setPrefixResults(matches.slice(0, 20));
        Promise.resolve().then(() => setIsSearchingPrefix(false));
      }).catch(err => {
        console.error(err);
        if (!cancelled) {
          Promise.resolve().then(() => setPrefixResults([]));
          Promise.resolve().then(() => setIsSearchingPrefix(false));
        }
      });
      return () => { cancelled = true; };
    } else {
      Promise.resolve().then(() => setPrefixResults([]));
      Promise.resolve().then(() => setIsSearchingPrefix(false));
    }
  }, [query]);

  const defaultDate = dates[0] || '';
  const hasResults = results.asns.length > 0 || results.orgs.length > 0 || prefixResults.length > 0;

  return (
    <div className="search-hero">
      <div className="search-center">
        <h2>Explore Global Routing History</h2>
        <p className="hero-sub">Enter an Autonomous System number, Organization name, or IP/Prefix to see real-time routing events.</p>
        
        <div className="hero-search-box">
          <input 
            type="text" 
            placeholder="AS15169, Google, 8.8.8.0/24..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {query.length >= 2 && (
          <div className="hero-results fade-in">
            {isSearchingPrefix && <div className="loader-small" style={{ margin: '1rem auto' }}></div>}

            {prefixResults.length > 0 && (
              <div className="hero-result-group">
                <label>Prefixes & Subnets</label>
                {prefixResults.map(p => (
                  <div key={p.prefix} className="hero-item" onClick={() => navigate(`/prefix/${slugify(p.prefix)}/${defaultDate}?p=${encodeURIComponent(p.prefix)}`)}>
                    <span className="hero-name">{p.prefix}</span>
                    <span className="hero-type">Origin AS{p.asn}</span>
                  </div>
                ))}
              </div>
            )}
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
            {!hasResults && !isSearchingPrefix && (
              <p className="no-res-hero">No matching records found in the global index.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
