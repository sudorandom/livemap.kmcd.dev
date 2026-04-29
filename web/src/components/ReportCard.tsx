import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Cell as ReCell } from 'recharts';
import { AlertTriangle, WifiOff, ShieldAlert, Activity, Search, Info, Globe, CheckCircle2, Clock, ShieldCheck, HeartPulse, ExternalLink } from 'lucide-react';
import { getRelativeTime, formatHumanNumber, getClassificationName, fetchDaySummary } from '../dataService';
import { BGPSecurityExplainer } from './BGPExplainer';

// Colors aligned with pkg/bgpengine/colors.go
const CLASSIFICATION_INFO: Record<number, { name: string, color: string, icon: any, hex: string }> = {
  0: { name: 'STABLE / NORMAL', color: 'text-[#39FF14] bg-[#39FF14]/10 border-[#39FF14]/20', icon: CheckCircle2, hex: '#39FF14' },
  1: { name: 'BOGON', color: 'text-slate-400 bg-slate-400/10 border-slate-400/20', icon: Info, hex: '#94a3b8' },
  2: { name: 'HIJACK', color: 'text-[#FF0000] bg-[#FF0000]/10 border-[#FF0000]/20', icon: ShieldAlert, hex: '#FF0000' },
  3: { name: 'ROUTE LEAK', color: 'text-[#FF0000] bg-[#FF0000]/10 border-[#FF0000]/20', icon: AlertTriangle, hex: '#FF0000' },
  4: { name: 'OUTAGE', color: 'text-[#FF3232] bg-[#FF3232]/10 border-[#FF3232]/20', icon: WifiOff, hex: '#FF3232' },
  5: { name: 'DDOS MITIGATION', color: 'text-[#9400D3] bg-[#9400D3]/10 border-[#9400D3]/20', icon: Activity, hex: '#9400D3' },
  6: { name: 'FLAPPING', color: 'text-[#FF7F00] bg-[#FF7F00]/10 border-[#FF7F00]/20', icon: Activity, hex: '#FF7F00' },
  8: { name: 'PATH HUNTING', color: 'text-[#9400D3] bg-[#9400D3]/10 border-[#9400D3]/20', icon: Search, hex: '#9400D3' },
  9: { name: 'DISCOVERY', color: 'text-[#00BFFF] bg-[#00BFFF]/10 border-[#00BFFF]/20', icon: Search, hex: '#00BFFF' },
  10: { name: 'MINOR LEAK', color: 'text-[#FF7F00] bg-[#FF7F00]/10 border-[#FF7F00]/20', icon: AlertTriangle, hex: '#FF7F00' },
};

const RPKI_COLORS = {
  valid: '#00FF9F',
  invalid: '#FF0060',
  unknown: '#828282'
};

const RPKI_ORDER: Record<string, number> = {
  'Valid': 1,
  'Not Found': 2,
  'Invalid': 3
};

const rpkiSorter = (item: any) => RPKI_ORDER[item.value] || 99;

const RPKIPieChart = ({ data, isMobile, type }: { data: any[], isMobile?: boolean, type: 'ipv4' | 'ipv6' }) => {
  const total = data.reduce((acc, entry) => acc + (entry.value || 0), 0);

  return (
    <PieChart accessibilityLayer={false}>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx={isMobile ? "50%" : "60%"}
        cy={isMobile ? "40%" : "50%"}
        innerRadius={isMobile ? 60 : 80}
        outerRadius={isMobile ? 90 : 110}
        paddingAngle={5}
      >
        {data.map((entry, index) => <Cell key={index} fill={entry.fill} stroke="transparent" tabIndex={-1} />)}
      </Pie>
      <Tooltip
        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px' }}
        itemStyle={{ color: '#fff' }}
        formatter={(val: any) => {
          const percentage = total > 0 ? ((Number(val) / total) * 100).toFixed(1) : '0.0';
          return [
            `${formatHumanNumber(Number(val))} ${type === 'ipv4' ? 'Addresses' : 'Prefixes'} (${percentage}%)`,
            'Count'
          ];
        }}
      />
      <Legend
        layout={isMobile ? "horizontal" : "vertical"}
        verticalAlign={isMobile ? "bottom" : "middle"}
        align={isMobile ? "center" : "left"}
        iconType="circle"
        wrapperStyle={{ fontSize: '12px', paddingBottom: isMobile ? '20px' : '0px' }}
        itemSorter={rpkiSorter}
        formatter={(value, entry: any) => {
          const val = entry.payload.value;
          const percentage = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
          return (
            <span className="relative group/legend ml-2 cursor-help inline-block">
              <span className="text-slate-700 dark:text-slate-300">
                {value}: <span className="font-mono font-bold text-slate-900 dark:text-white">{percentage}%</span>
              </span>
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#0f172a] text-white text-[10px] rounded border border-[#1e293b] whitespace-nowrap opacity-0 group-hover/legend:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl font-mono">
                {formatHumanNumber(val)} {type === 'ipv4' ? 'Addresses' : 'Prefixes'}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[#1e293b] -mb-4"></span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-[7px] border-transparent border-t-[#0f172a] -mb-3.5"></span>
              </span>
            </span>
          );
        }}
      />
    </PieChart>
  );
};

const AlertsList = React.memo(({ alerts }: { alerts: any[] }) => {
  const [selectedCategories, setSelectedCategories] = useState<number[]>([2, 3, 4]);

  const toggleCategory = (cat: number) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const filteredAlerts = React.useMemo(() => {
    return alerts
      .filter((a: any) => selectedCategories.includes(a.classification))
      .sort((a: any, b: any) => b.anomalyScore - a.anomalyScore);
  }, [alerts, selectedCategories]);

  return (
    <div className="cyber-box p-6 rounded-lg flex flex-col group shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-500/10 pb-4 mb-6">
        <h2 className="text-xl font-cyber font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 animate-pulse"></span>
          CRITICAL ALERTS
        </h2>
        <div className="flex flex-wrap gap-2">
          {[2, 3, 4].map(cat => {
            const info = CLASSIFICATION_INFO[cat];
            const isActive = selectedCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all ${
                  isActive 
                    ? `${info.color} border-current opacity-100` 
                    : 'text-slate-500 border-slate-500/20 opacity-40 hover:opacity-60'
                }`}
              >
                {info.name.replace('ROUTE ', '')}
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-y-auto flex-grow h-[550px] pr-2 custom-scrollbar mb-4">
        {filteredAlerts.length > 0 ? (
          <ul className="space-y-2">
            {filteredAlerts.map((alert: any, i: number) => {
              const info = CLASSIFICATION_INFO[alert.classification] || { name: 'UNKNOWN', color: 'text-slate-500 bg-slate-500/10', icon: Info, hex: '#666' };
              const Icon = info.icon;
              
              return (
                <li key={i} className="group/alert relative p-3 rounded-lg hover:bg-slate-500/5 transition-colors border border-transparent hover:border-slate-500/10">
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center transition-colors ${info.color}`}>
                      <Icon size={20} />
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start mb-1 gap-4">
                        <div className="min-w-0 flex-1">
                          <div className={`text-[10px] font-bold uppercase tracking-[0.15em] mb-0.5 ${info.color.split(' ')[0]}`}>
                            {info.name}
                          </div>
                          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight break-words">
                            {alert.asn > 0 
                              ? (alert.asName || `AS${alert.asn}`) 
                              : (alert.organization || (alert.country ? `Regional Anomaly (${alert.country})` : 'Distributed Anomaly'))
                            }
                          </h4>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                            {new Date(Number(alert.timestamp)*1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second: '2-digit'})}
                          </div>
                          <div 
                            className={`text-[10px] font-bold mt-1 uppercase cursor-help ${alert.delta > 0 ? 'text-red-500' : 'text-emerald-500'}`}
                            title="Routing Shift: Percentage change in BGP update volume compared to the 1-hour moving average baseline."
                          >
                            {alert.delta > 0 ? '+' : ''}{alert.delta}% SHIFT
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1.5 font-sans">
                        {alert.asn > 0 && (
                          <a 
                            href={`https://bgp.he.net/AS${alert.asn}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/5 dark:bg-indigo-500/10 rounded border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors text-[9px] font-bold text-indigo-400 font-mono uppercase group/link"
                          >
                            AS{alert.asn}
                          </a>
                        )}
                        
                        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                          {(Number(alert.impactedIpv4Ips) > 0 || Number(alert.impactedIpv6Prefixes) > 0) && (
                            <div className="flex items-center gap-2.5 font-medium">
                              {Number(alert.impactedIpv4Ips) > 0 && (
                                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                                  {formatHumanNumber(Number(alert.impactedIpv4Ips))} <span className="text-[9px] opacity-60 uppercase font-bold tracking-tighter">IPv4 Addrs</span>
                                </span>
                              )}
                              {Number(alert.impactedIpv4Ips) > 0 && Number(alert.impactedIpv6Prefixes) > 0 && (
                                <span className="w-px h-2 bg-slate-400/30"></span>
                              )}
                              {Number(alert.impactedIpv6Prefixes) > 0 && (
                                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                                  {formatHumanNumber(Number(alert.impactedIpv6Prefixes))} <span className="text-[9px] opacity-60 uppercase font-bold tracking-tighter">IPv6 Prefixes</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <Globe size={10} className="opacity-50" aria-hidden="true" />
                            <span className="text-[10px] font-medium">
                              {alert.location?.city ? `${alert.location.city}, ` : ''}{alert.location?.country || alert.country || 'GLOBAL'}
                            </span>
                        </div>
                        
                        <div className="ml-auto text-[9px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest">
                          {alert.eventsCount || alert.events_count} EVENTS
                        </div>
                      </div>

                      {/* Sample Events */}
                      {alert.sampleEvents && alert.sampleEvents.length > 0 && (
                        <div className="mt-3 space-y-1 bg-slate-900/50 p-2 rounded border border-slate-500/10">
                          <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">Sample Activity Log:</div>
                          {alert.sampleEvents
                            .slice()
                            .sort((a: any, b: any) => {
                              const maskA = parseInt(a.prefix.split('/')[1] || (a.prefix.includes(':') ? '128' : '32'));
                              const maskB = parseInt(b.prefix.split('/')[1] || (b.prefix.includes(':') ? '128' : '32'));
                              return maskA - maskB;
                            })
                            .slice(0, 5)
                            .map((e: any, j: number) => (
                            <div key={j} className="flex items-center gap-3 px-1 py-0.5 rounded hover:bg-slate-500/10 transition-colors group/sample">
                              <span className="text-[10px] font-mono text-cyan-400 font-bold shrink-0">{e.prefix}</span>
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400 uppercase tracking-tighter shrink-0 border border-slate-500/10">
                                {getClassificationName(e.newState)}
                              </span>
                              {e.asnName && (
                                <span className="text-[9px] text-slate-500 truncate opacity-70 group-hover/sample:opacity-100 transition-opacity">
                                  {e.asnName}
                                </span>
                              )}
                              <span className="ml-auto text-[8px] font-mono text-slate-600">
                                {new Date(Number(e.ts) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-20 text-center">
            <p className="text-slate-500 italic font-mono text-sm uppercase tracking-widest">No critical anomalies detected in the current window.</p>
          </div>
        )}
      </div>
    </div>
  );
});

export function ReportCard({ children }: { children?: React.ReactNode }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    async function load(isInitial = false) {
      if (isInitial) setLoading(true);
      try {
        const summary = await fetchDaySummary();
        setData(summary);
        setLastUpdated(new Date());
      } catch (err) {
        console.error(err);
      } finally {
        if (isInitial) setLoading(false);
      }
    }

    load(true);

    const interval = setInterval(() => {
      load();
    }, 30000);

    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, []);

  if (loading) return (
    <div className="p-12 text-center">
      <div className="inline-block w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <div className="text-cyan-500 text-xs font-bold tracking-[0.2em] animate-pulse uppercase">Synchronizing Telemetry...</div>
    </div>
  );

  if (!data) return (
    <div className="p-12 text-center cyber-box rounded-lg">
      <div className="text-red-500 font-bold mb-2">ERROR: DATA_NOT_FOUND</div>
      <div className="text-slate-500 text-sm font-mono">Ensure the indexer has successfully initialized the database.</div>
    </div>
  );

  const ipv4Prefixes = Number(data.ipv4PrefixCount || 0);
  const ipv6Prefixes = Number(data.ipv6PrefixCount || 0);
  const totalPrefixes = ipv4Prefixes + ipv6Prefixes || 1;

  const prefixData = [
    { name: 'IPv4', count: ipv4Prefixes, percentage: Math.round((ipv4Prefixes / totalPrefixes) * 100) },
    { name: 'IPv6', count: ipv6Prefixes, percentage: Math.round((ipv6Prefixes / totalPrefixes) * 100) },
  ];

  const rpkiData4 = [
    { name: 'Valid', value: Number(data.rpkiValidIpv4 || 0), fill: RPKI_COLORS.valid },
    { name: 'Not Found', value: Number(data.rpkiNotFoundIpv4 || 0), fill: RPKI_COLORS.unknown },
    { name: 'Invalid', value: Number(data.rpkiInvalidIpv4 || 0), fill: RPKI_COLORS.invalid },
  ].filter(d => d.value > 0);

  const rpkiData6 = [
    { name: 'Valid', value: Number(data.rpkiValidIpv6 || 0), fill: RPKI_COLORS.valid },
    { name: 'Not Found', value: Number(data.rpkiNotFoundIpv6 || 0), fill: RPKI_COLORS.unknown },
    { name: 'Invalid', value: Number(data.rpkiInvalidIpv6 || 0), fill: RPKI_COLORS.invalid },
  ].filter(d => d.value > 0);

  // Filter and sort classification counts for the summary row
  const activeClassifications = (data.classificationCounts || [])
    .filter((c: any) => c.prefixCount > 0)
    .sort((a: any, b: any) => b.prefixCount - a.prefixCount);

  // Data for the Health Summary bar chart
  const healthChartData = activeClassifications.map((c: any) => {
    const info = CLASSIFICATION_INFO[c.classification] || { name: 'OTHER', hex: '#666' };
    return {
      name: info.name,
      count: Number(c.prefixCount),
      fill: info.hex
    };
  });

  return (
    <div className="space-y-20">

      {/* BGP SECURITY SECTION */}
      <section className="space-y-8">
        <div className="flex items-center gap-4">
          <ShieldCheck className="text-cyan-500" size={32} aria-hidden="true" />
          <h2 className="text-4xl font-cyber font-bold tracking-tight text-slate-900 dark:text-white uppercase">BGP Security</h2>
        </div>

        <div className="cyber-box p-8 md:p-12 rounded-xl space-y-12 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-6 text-slate-600 dark:text-slate-400 leading-relaxed">
                <h3 className="text-xl font-cyber font-bold text-slate-900 dark:text-white uppercase">Routing Security & RPKI</h3>
                <p className="text-base text-slate-700 dark:text-slate-300">
                  The internet relies on <a href="https://www.cloudflare.com/learning/security/glossary/what-is-bgp/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-400 hover:underline font-semibold">BGP (Border Gateway Protocol)</a> to facilitate global traffic routing. Designed in the 1980s, it has no built-in way to verify that a network actually owns the IP addresses it claims to represent.
                </p>
                <p>
                  <a href="https://blog.cloudflare.com/is-bgp-safe-yet-rpki-routing-security-initiative/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-400 hover:underline font-bold">RPKI</a> fixes this by adding digital signatures to IP blocks, allowing internet providers to automatically ignore unauthorized routes using <a href="https://rpki.readthedocs.io/" target="_blank" rel="noopener noreferrer" className="text-slate-800 dark:text-slate-200 font-bold hover:underline">Route Origin Validation (ROV)</a>.
                </p>
                <div className="pt-4 flex flex-wrap gap-4">
                   <a href="https://blog.cloudflare.com/aspa-secure-internet/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-slate-200 dark:bg-slate-800 px-4 py-2 rounded hover:bg-slate-300 transition-colors">Latest Security Roadmap &rarr;</a>
                   <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-4 py-2 rounded border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">isbgpsafeyet.com &rarr;</a>
                </div>
              </div>
              <div className="w-full h-full">
                {children}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-t border-slate-500/10 pt-12">              {/* RPKI IPv4 */}
              <div className="group flex flex-col">
                <h2 className="text-lg font-cyber font-bold mb-2 flex items-center gap-2 text-emerald-500">
                  <span className="w-1.5 h-1.5 bg-emerald-500"></span>
                  RPKI STATUS IPv4
                </h2>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 font-medium">Measuring: Unique IP Addresses</p>
                <div className="h-80 md:h-80">
                  {/* Mobile version */}
                  <div className="md:hidden h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RPKIPieChart data={rpkiData4} type="ipv4" isMobile />
                    </ResponsiveContainer>
                  </div>
                  {/* Desktop version */}
                  <div className="hidden md:block h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RPKIPieChart data={rpkiData4} type="ipv4" />
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* RPKI IPv6 */}
              <div className="group flex flex-col">
                <h2 className="text-lg font-cyber font-bold mb-2 flex items-center gap-2 text-emerald-500">
                  <span className="w-1.5 h-1.5 bg-emerald-500"></span>
                  RPKI STATUS IPv6
                </h2>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 font-medium">Measuring: Announced Prefixes</p>
                <div className="h-80 md:h-80">
                  {/* Mobile version */}
                  <div className="md:hidden h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RPKIPieChart data={rpkiData6} type="ipv6" isMobile />
                    </ResponsiveContainer>
                  </div>
                  {/* Desktop version */}
                  <div className="hidden md:block h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RPKIPieChart data={rpkiData6} type="ipv6" />
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
            
            <BGPSecurityExplainer />
        </div>
      </section>

      {/* INTERNET HEALTH SECTION */}
      <section className="space-y-8">
        <div className="flex items-center gap-4">
          <HeartPulse className="text-orange-500" size={32} aria-hidden="true" />
          <h2 className="text-4xl font-cyber font-bold tracking-tight text-slate-900 dark:text-white uppercase">Internet Health</h2>
        </div>

        <div className="grid grid-cols-1 gap-8">
           <div className="cyber-box p-8 md:p-12 rounded-xl flex flex-col space-y-8 shadow-2xl">
             <div className="space-y-6 text-slate-600 dark:text-slate-400 leading-relaxed text-sm md:text-base">
               <h3 className="text-xl font-cyber font-bold text-slate-900 dark:text-white uppercase">Observing Global Instability</h3>
               <p>
                 BGP telemetry reveals the constant, chaotic "heartbeat" of the global internet. While most of the network is stable, we can infer significant technical failures through specific behaviors:
               </p>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pt-4">
                  <div className="space-y-3">
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <WifiOff size={16} className="text-[#FF3232]" /> OUTAGES & FLAPPING
                    </h4>
                    <p className="text-xs">
                      An <strong>Outage</strong> appears as a mass withdrawal of routes, causing a prefix to vanish from the global table. <strong>Flapping</strong> occurs when a network repeatedly fails and recovers, causing a "yo-yo" effect that forces global path re-calculation.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-bold text-[#FF0000] flex items-center gap-2">
                      <AlertTriangle size={16} /> ROUTE LEAKS
                    </h4>
                    <p className="text-xs">
                      These are the most common BGP events. A <strong>Route Leak</strong> is typically a technical mistake where a network re-broadcasts routes learned from one provider to another, accidentally turning itself into an overwhelmed transit hub.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-bold text-[#9400D3] flex items-center gap-2">
                      <Activity size={16} /> DDOS PROTECTION
                    </h4>
                    <p className="text-xs">
                      Networks defend against attacks using <strong>Remote Triggered Black Holes (RTBH)</strong> and <strong>BGP Flowspec</strong>. By announcing discard routes, they drop malicious traffic at the network edge, thousands of miles from the target.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-bold text-[#9400D3] flex items-center gap-2">
                      <Search size={16} /> PATH HUNTING
                    </h4>
                    <p className="text-xs">
                      When a route is withdrawn, routers don't always give up immediately. <strong>Path Hunting</strong> is the "echo" as routers cycle through increasingly worse backup paths before finally realizing the destination is unreachable.
                    </p>
                  </div>
               </div>
             </div>

             <div className="border-t border-slate-500/10 pt-10">
               <h3 className="text-xl font-cyber font-bold mb-6 text-slate-900 dark:text-white uppercase">Global Status Summary</h3>
               <div className="h-96 flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={healthChartData} layout="vertical" margin={{ left: 40, right: 40 }} accessibilityLayer={false}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} width={120} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{fill: 'rgba(255, 255, 255, 0.05)'}}
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(val: any) => [formatHumanNumber(val), 'Prefixes']}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {healthChartData.map((entry: any, index: number) => (
                        <ReCell key={`cell-${index}`} fill={entry.fill} tabIndex={-1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
               </div>
             </div>
           </div>
        </div>

        {/* Flappiest Networks & Anomalies */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Flappiest */}
          <div className="cyber-box p-6 rounded-lg group flex flex-col shadow-xl">
            <div className="mb-6 border-b border-slate-500/10 pb-4">
              <h2 className="text-xl font-cyber font-bold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-orange-500"></span>
                  TOP FLAPPY NETWORKS
                </div>
                <span className="text-[10px] font-mono opacity-50 uppercase tracking-widest">Last 24 Hours</span>
              </h2>
              <p className="text-[10px] font-bold text-orange-500/60 uppercase tracking-[0.2em] mt-1">Network Hall of Shame</p>
            </div>
            {data.flappiestNetworks && data.flappiestNetworks.length > 0 ? (
              <div className="space-y-4 mb-4">
                {data.flappiestNetworks.slice(0, 5).map((network: any, idx: number) => {
                  const cleanName = network.networkName && network.networkName !== `AS${network.asn}` ? network.networkName : '';

                  return (
                    <div key={idx} className="bg-orange-500/5 dark:bg-orange-500/10 border-l-4 border-orange-500 p-4 transition-all hover:bg-orange-500/10 dark:hover:bg-orange-500/20 group/row">
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">RANK {idx+1}</span>
                            <h3 className="font-bold text-slate-900 dark:text-white truncate">
                              AS{network.asn}{cleanName && ` — ${cleanName}`}
                            </h3>
                          </div>
                          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span className="opacity-50 font-bold tracking-tighter uppercase text-[9px]">Prefix:</span>
                            <span className="text-orange-600/80 dark:text-orange-400/80">{network.prefix}</span>
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-2xl font-mono font-bold text-orange-600 dark:text-orange-500 leading-none">{formatHumanNumber(Number(network.flapCount))}</div>
                          <div className="text-[10px] font-bold text-orange-500/70 dark:text-orange-500/50 uppercase tracking-widest mt-1">FLAPS</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-orange-500/10 flex justify-end items-center">
                        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-wider">
                          <a
                            href={`https://bgp.he.net/AS${network.asn}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-orange-600 dark:text-orange-400 hover:text-orange-400"
                          >
                            HE.NET &rarr;
                          </a>
                          <a
                            href={`https://radar.cloudflare.com/routing/as${network.asn}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-500 hover:text-indigo-400"
                          >
                            RADAR &rarr;
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center border border-dashed border-slate-700 rounded-lg mb-4">
                <p className="text-slate-500 italic font-mono text-sm uppercase tracking-widest">No significant flap telemetry detected.</p>
              </div>
            )}
          </div>

          {/* Anomalous Events */}
          <AlertsList alerts={data.topAlerts || []} />
        </div>
      </section>

      {/* NETWORK EVOLUTION SECTION */}
      <section className="space-y-8">
        <div className="flex items-center gap-4">
          <Globe className="text-blue-500" size={32} aria-hidden="true" />
          <h2 className="text-4xl font-cyber font-bold tracking-tight text-slate-900 dark:text-white uppercase">Network Evolution</h2>
        </div>

        <div className="cyber-box p-8 md:p-12 rounded-xl flex flex-col lg:flex-row gap-12 items-start shadow-2xl">
          <div className="flex-1 space-y-6 text-slate-600 dark:text-slate-400 leading-relaxed">
            <h3 className="text-xl font-cyber font-bold text-slate-900 dark:text-white uppercase">The IPv4 to IPv6 Transition</h3>
            <p className="text-base text-slate-700 dark:text-slate-300">
              The internet is currently undergoing a critical multi-decade migration. IPv4, the protocol that built the modern web, only supports approximately 4.3 billion addresses. These were functionally exhausted years ago, forcing the world to rely on complex workarounds like <a href="https://www.cloudflare.com/learning/network-layer/what-is-network-address-translation/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-400 hover:underline font-semibold">Carrier-Grade NAT (CGNAT)</a>.
            </p>
            <p>
              IPv6 is the modern successor, providing a virtually infinite address space and improved routing efficiency. However, the global BGP table shows a significant lag in adoption. This data tracks the relative presence of both protocols, highlighting the ongoing effort to build a truly scalable internet foundation.
            </p>
            <div className="pt-4 flex flex-wrap gap-4">
              <a href="https://www.google.com/intl/en/ipv6/statistics.html" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 px-4 py-2 rounded border border-blue-500/20 hover:bg-blue-500/20 transition-colors">Google IPv6 Stats &rarr;</a>
              <a href="https://pulse.internetsociety.org/en/technologies/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-slate-200 dark:bg-slate-800 px-4 py-2 rounded hover:bg-slate-300 transition-colors">ISOC Adoption Pulse &rarr;</a>
            </div>
          </div>

          <div className="w-full lg:w-1/3 space-y-6">
            <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest text-center lg:text-left">Protocol Distribution</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={prefixData} accessibilityLayer={false}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(val) => `${val}%`} domain={[0, 100]} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{fill: 'rgba(0, 243, 255, 0.05)'}}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px' }}
                    itemStyle={{ color: '#00f3ff' }}
                    formatter={(val: any, name: any, props: any) => [formatHumanNumber(props.payload.count), 'Count']}
                    labelFormatter={(label) => `${label} Prefixes`}
                  />
                  <Bar dataKey="percentage" fill="#3b82f6" radius={[4, 4, 0, 0]} tabIndex={-1} label={{ position: 'top', fill: '#94a3b8', fontSize: 10, formatter: (val: any) => `${val}%` }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              <p className="text-center text-[10px] text-slate-500 uppercase tracking-tighter">BGP Table Distribution (%)</p>
              <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded text-[10px] text-slate-500 leading-relaxed">
                <span className="font-bold text-blue-400">NOTE:</span> This metrics tracks <strong>routable prefixes</strong> visible in the global BGP table. Protocol distribution in BGP is not a direct proxy for user adoption; a single IPv4 prefix may hide thousands of users behind NAT, while IPv6 prefixes typically represent significantly larger address blocks.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="pt-12 pb-8 border-t border-slate-500/10 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4">
           <a
             href="https://kmcd.dev"
             target="_blank"
             rel="noopener noreferrer"
             className="text-xs font-cyber font-bold tracking-widest text-slate-400 hover:text-cyan-500 transition-colors uppercase"
           >
             kmcd.dev &rarr;
           </a>
        </div>

        {lastUpdated && (
          <div className="flex justify-center items-center gap-3">
            <Clock size={14} className="text-cyan-500 animate-pulse" aria-hidden="true" />
            <div className="text-[11px] font-mono text-slate-500 uppercase tracking-[0.2em]">
              SYSTEM SYNC: <span className="text-slate-900 dark:text-slate-100 font-bold">{lastUpdated.toLocaleTimeString()}</span>
              <span className="mx-2 opacity-30">/</span>
              <span className="text-cyan-600 dark:text-cyan-400">{getRelativeTime(lastUpdated)}</span>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
