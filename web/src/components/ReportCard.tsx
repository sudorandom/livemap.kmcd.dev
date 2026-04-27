import React, { useEffect, useState } from 'react';
import { fromBinary } from '@bufbuild/protobuf';
import { DaySummarySchema } from '../gen/historical/v1/historical_pb';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// Data fetching helper
async function fetchDaySummary(date: string) {
  const url = `/data/${date}/summary.pb`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return fromBinary(DaySummarySchema, new Uint8Array(arrayBuffer));
  } catch (err) {
    console.error("Protobuf decoding error:", err);
    return null;
  }
}

export function ReportCard({ date }: { date?: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If no date provided, try fetching index.json
    async function load() {
      try {
        let selectedDate = date;
        if (!selectedDate) {
          const res = await fetch('/data/index.json');
          if (res.ok) {
            const dates = await res.json();
            if (dates.length > 0) {
              selectedDate = dates[0];
            }
          }
        }

        if (selectedDate) {
          const summary = await fetchDaySummary(selectedDate);
          setData(summary);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [date]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading BGP data...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">No data found. Ensure the indexer has run.</div>;

  const ipv4Prefixes = Number(data.ipv4PrefixCount || 0);
  const ipv6Prefixes = Number(data.ipv6PrefixCount || 0);
  const totalPrefixes = ipv4Prefixes + ipv6Prefixes || 1;

  const prefixData = [
    { name: 'IPv4', count: ipv4Prefixes, percentage: Math.round((ipv4Prefixes / totalPrefixes) * 100) },
    { name: 'IPv6', count: ipv6Prefixes, percentage: Math.round((ipv6Prefixes / totalPrefixes) * 100) },
  ];

  const totalValid4 = Number(data.rpkiValidIpv4 || 0);
  const totalInvalid4 = Number(data.rpkiInvalidIpv4 || 0);
  const totalUnknown4 = Number(data.rpkiNotFoundIpv4 || 0);

  const totalValid6 = Number(data.rpkiValidIpv6 || 0);
  const totalInvalid6 = Number(data.rpkiInvalidIpv6 || 0);
  const totalUnknown6 = Number(data.rpkiNotFoundIpv6 || 0);

  const rpkiData4 = [
    { name: 'Valid', value: totalValid4, fill: '#10b981' },
    { name: 'Invalid', value: totalInvalid4, fill: '#ef4444' },
    { name: 'Not Found', value: totalUnknown4, fill: '#6b7280' },
  ].filter(d => d.value > 0);

  const rpkiData6 = [
    { name: 'Valid', value: totalValid6, fill: '#10b981' },
    { name: 'Invalid', value: totalInvalid6, fill: '#ef4444' },
    { name: 'Not Found', value: totalUnknown6, fill: '#6b7280' },
  ].filter(d => d.value > 0);


  return (
    <div className="space-y-8">
      {/* Summary Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* IP Prefix Bar Chart */}
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-xl font-bold mb-4">Prefixes Tracked</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={prefixData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(val) => `${val}%`} domain={[0, 100]} />
                <Tooltip
                  formatter={(val: any, name: any, props: any) => {
                    return [props.payload.count.toLocaleString(), 'Count'];
                  }}
                  labelFormatter={(label) => `${label} Prefixes`}
                />
                <Bar dataKey="percentage" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center mt-2 text-sm text-gray-500">
            Total Unique Prefixes: {data.uniquePrefixes?.toLocaleString()}
          </div>
        </div>

        {/* RPKI IPv4 */}
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-xl font-bold mb-4 text-center">RPKI IPv4 Status</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rpkiData4} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80}>
                  {rpkiData4.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(val: any) => Number(val).toLocaleString()} />
                <Tooltip formatter={(val: any) => Number(val).toLocaleString()} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* RPKI IPv6 */}
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-xl font-bold mb-4 text-center">RPKI IPv6 Status</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rpkiData6} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80}>
                  {rpkiData6.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(val: any) => Number(val).toLocaleString()} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Flappiest Networks & Anomalies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Flappiest */}
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-xl font-bold mb-4">Most Flappy Network</h2>
          {data.flappiestNetwork ? (
            <div className="space-y-4">
              <div className="bg-orange-50 border-l-4 border-orange-500 p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-orange-900">
                      AS{data.flappiestNetwork.asn} - {data.flappiestNetwork.networkName || 'Unknown Network'}
                    </h3>
                    <p className="text-sm text-orange-700 mt-1">
                      Prefix: <code className="bg-orange-100 px-1 rounded">{data.flappiestNetwork.prefix}</code>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-orange-600">{data.flappiestNetwork.flapCount}</div>
                    <div className="text-xs text-orange-500 uppercase tracking-wide">Flaps (24h)</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-orange-200">
                  <a
                    href={`https://bgp.he.net/AS${data.flappiestNetwork.asn}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-orange-600 hover:text-orange-800 text-sm font-medium"
                  >
                    View ASN Details on bgp.he.net &rarr;
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 italic">No flap data currently available.</p>
          )}
        </div>

        {/* Anomalous Events */}
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col">
          <h2 className="text-xl font-bold mb-4">Top Recent Alerts</h2>
          <div className="overflow-y-auto flex-grow h-[300px]">
            {data.topAlerts && data.topAlerts.length > 0 ? (
              <ul className="space-y-3">
                {data.topAlerts.slice(0, 100).map((alert: any, i: number) => (
                  <li key={i} className="border-b border-gray-100 pb-3 last:border-0">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="inline-block px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded mb-1">
                          Severity Score: {Number(alert.anomalyScore).toFixed(1)}
                        </span>
                        <h4 className="font-medium text-gray-900">
                          AS{alert.asn} ({alert.asName || 'Unknown'})
                        </h4>
                        <p className="text-sm text-gray-500">
                          {alert.location?.country || alert.country || 'Global'}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium">{alert.eventsCount} events</div>
                        <div className="text-gray-400">{new Date(Number(alert.timestamp)*1000).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 italic">No significant anomalous events recently detected.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
