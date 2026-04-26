import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './App.css';
import { fetchMetadataIndex } from './dataService';
import type { GlobalMetadataIndex } from './gen/historical/v1/historical_pb';

import SearchPage from './pages/SearchPage';
import OrganizationsPage from './pages/OrganizationsPage';
import OrgViewPage from './pages/OrgViewPage';
import AsnViewPage from './pages/AsnViewPage';
import IndexPage from './pages/IndexPage';
import PrefixViewPage from './pages/PrefixViewPage';

function App() {
  const [dates, setDates] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<GlobalMetadataIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Load available dates
    fetch('/data/index.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch index');
        return res.json();
      })
      .then((data: string[]) => setDates(data))
      .catch((err) => {
        console.error(err);
        setError('No data found. The indexer may not have run yet.');
      });

    // Load global metadata for search
    fetchMetadataIndex().then(setMetadata).finally(() => setLoading(false));
  }, []);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  if (error) {
    return (
      <div className="error-box">
        <p>{error}</p>
        <p className="hint">Try running <code>just indexer</code> to generate local data.</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="app-container">
        <header className="main-header">
          <div className="header-content">
            <Link to="/" className="brand">
              <h1>bgp.kmcd.dev</h1>
            </Link>
            <nav className="main-nav">
              <NavLink to="/" end>Explore</NavLink>
              <NavLink to="/search">Search</NavLink>
              <NavLink to="/orgs">Organizations</NavLink>
              <button className="theme-toggle" onClick={toggleTheme}>
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </nav>
          </div>
        </header>

        <main className="page-content">
          {loading ? (
            <div className="loading-screen">
              <div className="loader"></div>
              <p>Initializing Global Index...</p>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<IndexPage dates={dates} metadata={metadata} />} />
              <Route path="/search" element={<SearchPage metadata={metadata} dates={dates} />} />
              <Route path="/orgs" element={<OrganizationsPage metadata={metadata} dates={dates} />} />
              <Route path="/org/:slug" element={<OrgViewPage dates={dates} metadata={metadata} />} />
              <Route path="/asn/:asn" element={<AsnViewPage dates={dates} metadata={metadata} />} />
              <Route path="/prefix/:slug" element={<PrefixViewPage dates={dates} />} />
              <Route path="/prefix/:slug/:date" element={<PrefixViewPage dates={dates} />} />
            </Routes>
          )}
        </main>

        <footer className="main-footer">
          <p>Powered by BGP-Stream & BGPKit. Real-time internet routing telemetry.</p>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
