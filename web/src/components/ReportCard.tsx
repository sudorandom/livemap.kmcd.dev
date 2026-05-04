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
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#0f172a] text-white text-xs rounded border border-[#1e293b] whitespace-nowrap opacity-0 group-hover/legend:opacity-100 transition-opacity pointer-events-none z-50 shadow-2xl font-mono">
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
    <div className="cyber-box p-6 rounded-lg flex flex-col group shadow-xl h-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-500/10 pb-4 mb-6 shrink-0">
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
                className={`text-[11px] md:text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded border transition-all ${
                  isActive 
                    ? `${info.color} border-current opacity-100 shadow-[0_0_10px_rgba(0,0,0,0.1)]` 
                    : 'text-slate-500 border-slate-500/20 opacity-40 hover:opacity-60'
                }`}
              >
                {info.name.replace('ROUTE ', '')}
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-y-auto flex-grow pr-2 custom-scrollbar mb-4">
        {filteredAlerts.length > 0 ? (
          <ul aria-live="polite" className="space-y-2">
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
                          <div className={`text-xs font-bold uppercase tracking-[0.15em] mb-0.5 ${info.color.split(' ')[0]}`}>
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
                          <div className="text-xs font-mono text-slate-400 dark:text-slate-500">
                            {new Date(Number(alert.timestamp)*1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second: '2-digit'})}
                          </div>
                          <div 
                            className={`text-xs font-bold mt-1 uppercase cursor-help ${alert.delta > 0 ? 'text-red-500' : 'text-emerald-500'}`}
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
                            className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/5 dark:bg-indigo-500/10 rounded border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors text-xs font-bold text-indigo-400 font-mono uppercase group/link"
                          >
                            AS{alert.asn}
                          </a>
                        )}
                        
                        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                          {(Number(alert.impactedIpv4Ips) > 0 || Number(alert.impactedIpv6Prefixes) > 0) && (
                            <div className="flex items-center gap-2.5 font-medium">
                              {Number(alert.impactedIpv4Ips) > 0 && (
                                <span className="text-xs text-slate-600 dark:text-slate-300">
                                  {formatHumanNumber(Number(alert.impactedIpv4Ips))} <span className="text-xs opacity-60 uppercase font-bold tracking-tighter">IPv4 Addrs</span>
                                </span>
                              )}
                              {Number(alert.impactedIpv4Ips) > 0 && Number(alert.impactedIpv6Prefixes) > 0 && (
                                <span className="w-px h-2 bg-slate-400/30"></span>
                              )}
                              {Number(alert.impactedIpv6Prefixes) > 0 && (
                                <span className="text-xs text-slate-600 dark:text-slate-300">
                                  {formatHumanNumber(Number(alert.impactedIpv6Prefixes))} <span className="text-xs opacity-60 uppercase font-bold tracking-tighter">IPv6 Prefixes</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <Globe size={10} className="opacity-50" aria-hidden="true" />
                            <span className="text-xs font-medium">
                              {alert.location?.city ? `${alert.location.city}, ` : ''}{alert.location?.country || alert.country || 'GLOBAL'}
                            </span>
                        </div>
                        
                        <div className="ml-auto text-xs font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest">
                          {alert.eventsCount || alert.events_count} EVENTS
                        </div>
                      </div>

                      {/* Sample Events */}
                      {alert.sampleEvents && alert.sampleEvents.length > 0 && (
                        <div className="mt-3 space-y-1 bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-200 dark:border-slate-500/10">
                          <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1 px-1">Activity Log:</div>
                          {alert.sampleEvents
                            .slice()
                            .sort((a: any, b: any) => {
                              const maskA = parseInt(a.prefix.split('/')[1] || (a.prefix.includes(':') ? '128' : '32'));
                              const maskB = parseInt(b.prefix.split('/')[1] || (b.prefix.includes(':') ? '128' : '32'));
                              return maskA - maskB;
                            })
                            .slice(0, 5)
                            .map((e: any, j: number) => (
                            <div key={j} className="flex items-center gap-3 px-1 py-0.5 rounded hover:bg-white dark:hover:bg-slate-500/10 transition-colors group/sample">
                              <span className="text-xs font-mono text-indigo-600 dark:text-cyan-400 font-bold shrink-0">{e.prefix}</span>
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400 uppercase tracking-tighter shrink-0 border border-slate-300/30 dark:border-slate-500/10">
                                {getClassificationName(e.newState)}
                              </span>
                              {e.asnName && (
                                <span className="text-xs text-slate-600 dark:text-slate-500 truncate opacity-70 group-hover/sample:opacity-100 transition-opacity">
                                  {e.asnName}
                                </span>
                              )}
                              <span className="ml-auto text-xs font-mono text-slate-500 dark:text-slate-600">
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

import { fromBinary } from '@bufbuild/protobuf';
import { DaySummarySchema } from '../gen/summary/v1/summary_pb';

export function ReportCard({ children, initialData }: { children?: React.ReactNode, initialData?: string }) {
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

    if (initialData) {
      try {
        const binary = Uint8Array.from(atob(initialData), c => c.charCodeAt(0));
        const summary = fromBinary(DaySummarySchema, binary);
        setData(summary);
        setLastUpdated(new Date());
        setLoading(false);
      } catch (err) {
        console.error("Failed to decode initialData:", err);
        load(true);
      }
    } else {
      load(true);
    }

    let interval: any;
    if (!initialData) {
      interval = setInterval(() => {
        load();
      }, 30000);
    }

    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 10000);

    return () => {
      if (interval) clearInterval(interval);
      clearInterval(timer);
    };
  }, [initialData]);

  if (loading) return (
    <div className="p-12 text-center">
      <div className="inline-block w-8 h-8 border-4 border-indigo-600 dark:border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <div className="text-indigo-600 dark:text-cyan-500 text-xs font-bold tracking-[0.2em] animate-pulse uppercase">Synchronizing Telemetry...</div>
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
          <ShieldCheck className="text-indigo-600 dark:text-cyan-500" size={32} aria-hidden="true" />
          <h2 className="text-4xl font-cyber font-bold tracking-tight text-slate-900 dark:text-white uppercase">BGP Security</h2>
        </div>

        <div className="cyber-box p-8 md:p-12 rounded-xl space-y-12 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-6 text-slate-600 dark:text-slate-400 leading-relaxed">
                <div className="space-y-4">
                  <h3 className="text-2xl font-cyber font-bold text-slate-900 dark:text-white uppercase">Built for an age of trust</h3>
                  <p className="text-base">
                    BGP was designed for an era of implicit trust. There is no built-in mechanism to verify that a network owns the IP addresses it represents. This trust by default model is the root cause of the internet's most significant routing vulnerabilities.
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-500/10">
                  <h4 className="text-xl font-bold text-slate-900 dark:text-slate-200 uppercase tracking-tight">How a route leak works</h4>
                  <p className="text-sm">
                    Misconfigurations spread because BGP propagates information quickly. A <strong>Route Leak</strong> usually occurs when a policy error allows prefixes from one peer to be unintentionally re-advertised to another:
                  </p>
                  <div className="space-y-4 pl-4 border-l-2 border-slate-200 dark:border-slate-800 text-xs">
                    <p>
                      A network accidentally re-announces routes learned from its high-speed transit provider to its other upstream peers. It effectively tells the world it is the best way to reach a popular destination.
                    </p>
                    <p>
                      Neighboring networks accept this false announcement because they lack strict filters. The route appears as a valid path, and BGP's path selection may favor it due to a deceptively "shorter" AS Path.
                    </p>
                    <p>
                      Global traffic for the leaked prefix is pulled into the originator's network. This congests its modest links, leading to massive packet loss and regional or global outages.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex flex-wrap gap-4">
                   <a href="https://blog.cloudflare.com/aspa-secure-internet/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-slate-200 dark:bg-slate-800 px-4 py-2 rounded hover:bg-slate-300 transition-colors">Latest Security Roadmap &rarr;</a>
                   <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-4 py-2 rounded border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">isbgpsafeyet.com &rarr;</a>
                </div>
              </div>
              <div className="w-full">
                {children}
              </div>
            </div>

            <div className="space-y-4 pt-12 border-t border-slate-500/10">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                  <ShieldAlert className="text-red-500" size={24} />
                </div>
                <h3 className="text-2xl font-cyber font-bold text-slate-900 dark:text-white uppercase">Threats and Defenses</h3>
              </div>
              <p className="text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed mb-8">
                Understanding the theory of BGP security is one thing; seeing a hijack in action is another. Use the simulation below to witness how malicious actors exploit the protocol and how modern defenses like <a href="https://datatracker.ietf.org/doc/html/rfc6811" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">Route Origin Validation (ROV)</a>, <a href="https://datatracker.ietf.org/doc/html/rfc5635" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">Remote Triggered Black Hole (RTBH)</a>, and <a href="https://datatracker.ietf.org/doc/html/rfc5575" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">BGP FlowSpec</a> identify and mitigate threats in real-time.
              </p>
              <BGPSecurityExplainer />
            </div>

            <div className="space-y-6 pt-12 border-t border-slate-500/10">
              <h3 className="text-2xl font-cyber font-bold text-slate-900 dark:text-white uppercase">Global RPKI Adoption</h3>
              <p className="text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                ISPs use <a href="https://blog.cloudflare.com/rpki/" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">RPKI</a> to mathematically prove Route Hijacks are invalid. The malicious path is dropped at the border, protecting the user. While RPKI has seen significant growth, global security depends on both widespread registration and active route filtering by all ISPs. You can track real-world deployment and enforcement progress at <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-400 hover:underline font-bold">isbgpsafeyet.com</a>.
              </p>            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* RPKI IPv4 */}
              <div className="cyber-box p-6 rounded-xl bg-white/50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 shadow-sm group hover:border-emerald-500/30 transition-all">
                <div className="group flex flex-col h-full">
                  <h2 className="text-lg font-cyber font-bold mb-2 flex items-center gap-2 text-emerald-500">
                    <span className="w-1.5 h-1.5 bg-emerald-500"></span>
                    RPKI STATUS IPv4
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 font-medium">Measuring: Unique IP Addresses</p>
                  <div className="flex-grow min-h-[320px]">
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
              </div>

              {/* RPKI IPv6 */}
              <div className="cyber-box p-6 rounded-xl bg-white/50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 shadow-sm group hover:border-emerald-500/30 transition-all">
                <div className="group flex flex-col h-full">
                  <h2 className="text-lg font-cyber font-bold mb-2 flex items-center gap-2 text-emerald-500">
                    <span className="w-1.5 h-1.5 bg-emerald-500"></span>
                    RPKI STATUS IPv6
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 font-medium">Measuring: Announced Prefixes</p>
                  <div className="flex-grow min-h-[320px]">
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
            </div>
          </div>
      </section>

      {/* INTERNET HEALTH SECTION */}
      <section className="space-y-8">
        <div className="flex items-center gap-4">
          <HeartPulse className="text-orange-500" size={32} aria-hidden="true" />
          <h2 className="text-4xl font-cyber font-bold tracking-tight text-slate-900 dark:text-white uppercase">Internet Health</h2>
        </div>

        <div className="grid grid-cols-1 gap-8">
          <div className="cyber-box p-8 md:p-12 rounded-xl flex flex-col space-y-12 shadow-2xl">
            <div className="space-y-8 text-slate-600 dark:text-slate-400 leading-relaxed text-sm md:text-base">
              <div>
               <h3 className="text-2xl font-cyber font-bold text-slate-900 dark:text-white uppercase mb-4">Internet Routing Dynamics</h3>
               <p className="text-lg">
                 BGP telemetry reveals the constant, chaotic "heartbeat" of the global internet. While most of the network is stable, technical failures and malicious actors create a background radiation of routing anomalies.
               </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10 pt-4">
                 <div className="space-y-4 border-l-2 border-red-500 pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-red-500 rounded-full"></div>
                   <h4 className="font-cyber font-bold text-xl text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <ShieldAlert size={20} className="text-[#FF0000]" /> Route Hijacks
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                     A <strong>Hijack</strong> occurs when an <a href="https://www.cloudflare.com/learning/network-layer/what-is-an-autonomous-system/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">Autonomous System (AS)</a> announces an <a href="https://community.cisco.com/t5/routing-and-sd-wan/bgp-prefix-concept/td-p/500111" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">IP prefix</a> it does not own. This can be a malicious attempt to intercept traffic or a simple "fat-finger" typo. Because BGP prefers the "most specific" route, a hijacker announcing a /24 can steal traffic from a legitimate /23 announcement globally.
                   </p>
                 </div>

                 <div className="space-y-4 border-l-2 border-orange-500 pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-orange-500 rounded-full"></div>
                   <h4 className="font-cyber font-bold text-xl text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <AlertTriangle size={20} className="text-orange-500" /> Route Leaks
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                     A <strong>Route Leak</strong> is typically a configuration error where an AS (often a customer) re-broadcasts routes from one upstream provider to another. This accidentally turns a small network into a <a href="https://en.wikipedia.org/wiki/Internet_transit" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">transit hub</a> for global traffic, quickly overwhelming its links and causing massive regional slowdowns or outages.
                   </p>
                 </div>

                 <div className="space-y-4 border-l-2 border-[#FF3232] pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-[#FF3232] rounded-full"></div>
                   <h4 className="font-cyber font-bold text-xl text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <WifiOff size={20} className="text-[#FF3232]" /> Mass Outages
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                     When a large network or data center loses power or fiber connectivity, its upstream peers detect the lost session and issue <a href="https://en.wikipedia.org/wiki/Border_Gateway_Protocol#BGP_withdrawals" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">withdrawals</a> for all its routes. This causes hundreds of thousands of IP addresses to vanish from the global routing table simultaneously. We track these "route drops" to identify major cloud or ISP failures in real-time.
                   </p>
                </div>

                 <div className="space-y-4 border-l-2 border-[#9400D3] pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-[#9400D3] rounded-full"></div>
                   <h4 className="font-cyber font-bold text-xl text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <Activity size={20} className="text-[#9400D3]" /> BGP Flapping
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                     <strong>Flapping</strong> is a high-frequency "up-down" cycle of a route. If a hardware link is loose, it forces every other router on the internet to repeatedly recalculate its best path. To protect themselves, routers use <a href="https://en.wikipedia.org/wiki/Route_flapping#Route_flap_damping" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">route dampening</a> to temporarily ignore networks that flap too often.
                   </p>
                 </div>

                 <div className="space-y-4 border-l-2 border-indigo-600 dark:border-cyan-500 pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-indigo-600 dark:bg-cyan-500 rounded-full"></div>
                   <h4 className="font-cyber font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <ShieldCheck size={18} className="text-indigo-600 dark:text-cyan-500" /> RPKI Propagation
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 text-sm">
                     While we cannot directly measure ISP-level filtering (enforcement), we track the global propagation of "Invalid" and "Unknown" prefixes. Reducing the visibility of invalid routes is a key goal of the <a href="https://isbgpsafeyet.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4">"Is BGP Safe Yet?"</a> initiative.
                   </p>
                 </div>

                 <div className="space-y-4 border-l-2 border-indigo-500 pl-6 relative">
                   <div className="absolute -left-1 top-0 w-2 h-2 bg-indigo-500 rounded-full"></div>
                   <h4 className="font-cyber font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2 uppercase tracking-tight">
                     <Activity size={18} className="text-indigo-500" /> DDoS Mitigation
                   </h4>
                   <p className="text-slate-600 dark:text-slate-400 text-sm">
                     During a <a href="https://www.cloudflare.com/learning/ddos/what-is-a-ddos-attack/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline decoration-dotted underline-offset-4 font-bold">DDoS attack</a>, networks use <a href="https://datatracker.ietf.org/doc/html/rfc5575" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline font-bold">BGP FlowSpec</a> for surgical traffic filtering or <a href="https://www.akamai.com/glossary/what-is-blackhole-routing" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-500 hover:underline font-bold">Remote Triggered Black Hole (RTBH)</a> to quickly drop all traffic to an IP at the network edge.
                   </p>
                 </div>
              </div>

              {/* LIVE TELEMETRY MAP */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-12 pt-12 border-t border-slate-500/10 items-center">
                 <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                      <h4 className="text-2xl font-cyber font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                        Live Global Telemetry
                      </h4>
                    </div>
                    <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                      This map visualizes real-time BGP routing events as they ripple across the global internet. Each pulse represents a routing update, withdrawal, or anomaly detected by the distributed route collectors.
                    </p>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="w-1 h-6 bg-red-500 mt-1"></div>
                        <p className="text-sm"><strong>Red Pulses</strong> indicate route hijacks, major leaks, or outages that require immediate validation.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1 h-6 bg-orange-500 mt-1"></div>
                        <p className="text-sm"><strong>Orange Pulses</strong> show route flapping or minor instabilities in the global routing table.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1 h-6 bg-[#9400D3] mt-1"></div>
                        <p className="text-sm"><strong>Purple Pulses</strong> represent active DDoS mitigations or a BGP behavior known as path hunting.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-1 h-6 bg-indigo-500 mt-1"></div>
                        <p className="text-sm"><strong>Blue Pulses</strong> show the background radiation of standard routing updates and peer exchanges.</p>
                      </div>
                    </div>
                    <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                      The map is a poetic look at the constant, chaotic dance of the global routing of the Internet.
                    </p>
                 </div>
                 <div className="cyber-box rounded-xl overflow-hidden shadow-2xl aspect-video bg-black group relative">
                    <iframe
                      src="https://www.youtube.com/embed/live_stream?channel=UCA9eO4Gt-Ua6lAEGzWQHQFA"
                      title="BGP Live Telemetry Stream"
                      className="w-full h-full"
                      frameBorder="0"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen>
                    </iframe>
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur-sm border border-white/10 rounded text-xs font-mono text-white/70 uppercase tracking-widest pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                      Live Stream Feed
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Monitoring Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          {/* Flappiest Networks */}
          <div className="cyber-box p-6 rounded-lg group flex flex-col shadow-xl h-[750px]">
            <div className="mb-6 border-b border-slate-500/10 pb-4 shrink-0">
              <h2 className="text-xl font-cyber font-bold flex items-center justify-between uppercase">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-orange-500"></span>
                  Top Flappy Networks
                </div>
                <span className="text-xs font-mono opacity-50 uppercase tracking-widest">Last 24 Hours</span>
              </h2>
              <p className="text-xs font-bold text-orange-500/60 uppercase tracking-[0.2em] mt-1">Networking Hall of Shame</p>
            </div>
            <div className="overflow-y-auto flex-grow pr-2 custom-scrollbar">
              {data.flappiestNetworks && data.flappiestNetworks.length > 0 ? (
                <div aria-live="polite" className="space-y-4 mb-4">
                  {data.flappiestNetworks.slice(0, 5).map((network: any, idx: number) => {
                    const cleanName = network.networkName && network.networkName !== `AS${network.asn}` ? network.networkName : '';

                    return (
                      <div key={idx} className="bg-orange-500/5 dark:bg-orange-500/10 border-l-4 border-orange-500 p-4 transition-all hover:bg-orange-500/10 dark:hover:bg-orange-500/20 group/row">
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-orange-600 dark:text-orange-400">RANK {idx+1}</span>
                              <h3 className="font-bold text-slate-900 dark:text-white truncate uppercase tracking-tight">
                                AS{network.asn}{cleanName && ` - ${cleanName}`}
                              </h3>
                            </div>
                            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span className="opacity-50 font-bold tracking-tighter uppercase text-[9px]">Prefix:</span>
                              <span className="text-orange-600/80 dark:text-orange-400/80">{network.prefix}</span>
                            </p>
                          </div>
                          <div className="text-right ml-4">
                            <div className="text-2xl font-mono font-bold text-orange-600 dark:text-orange-500 leading-none">{formatHumanNumber(Number(network.flapCount))}</div>
                            <div className="text-xs font-bold text-orange-500/70 dark:text-orange-500/50 uppercase tracking-widest mt-1">FLAPS</div>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-orange-500/10 flex justify-end items-center">
                          <div className="flex gap-3 text-xs font-bold uppercase tracking-wider">
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
          </div>

          {/* Anomalous Events */}
          <div className="h-[750px]">
            <AlertsList alerts={data.topAlerts || []} />
          </div>
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
            <p>
              The internet is currently undergoing a critical multi-decade migration. <a href="https://datatracker.ietf.org/doc/html/rfc791" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">IPv4</a>, the protocol that built the modern web, only supports approximately 4.3 billion addresses. These were functionally exhausted years ago, forcing the world to rely on complex workarounds like <a href="https://www.cisco.com/site/us/en/learn/topics/networking/what-is-network-address-translation-nat.html" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-cyan-400 hover:underline font-semibold">Carrier-Grade NAT (CGNAT)</a>.
            </p>
            <p>
              <a href="https://datatracker.ietf.org/doc/html/rfc8200" target="_blank" className="text-indigo-600 dark:text-cyan-400 underline decoration-dotted font-bold">IPv6</a> is the modern successor, providing a virtually infinite address space and improved routing efficiency. However, the global BGP table shows a significant lag in adoption. This data tracks the relative presence of both protocols, highlighting the ongoing effort to build a truly scalable internet foundation.
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
              <p className="text-center text-xs text-slate-500 uppercase tracking-tighter">BGP Table Distribution (%)</p>
              <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded text-xs text-slate-500 leading-relaxed">
                <span className="font-bold text-blue-400">NOTE:</span> This metrics tracks <strong>routable prefixes</strong> visible in the global BGP table. Protocol distribution in BGP is not a direct proxy for user adoption; a single IPv4 prefix may hide thousands of users behind NAT, while IPv6 prefixes typically represent significantly larger address blocks.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
