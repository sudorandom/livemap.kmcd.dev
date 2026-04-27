import React, { useState, useEffect } from 'react';
import { Globe, RotateCcw, Zap } from 'lucide-react';
import { getRelativeTime } from '../dataService';

type ProbeResult = {
  url: string;
  status: 'pending' | 'reachable' | 'blocked' | 'error';
};

type IspInfo = {
  org: string;
  asn: string;
};

export function ISPSafetyTest() {
  const [status, setStatus] = useState<'idle' | 'testing' | 'safe' | 'unsafe' | 'error'>('idle');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ispInfo, setIspInfo] = useState<IspInfo | null>(null);
  const [probes, setProbes] = useState<ProbeResult[]>([
    { url: 'https://valid.rpki.cloudflare.com/', status: 'pending' },
    { url: 'https://invalid.rpki.cloudflare.com/', status: 'pending' }
  ]);

  const runTest = async () => {
    setStatus('testing');
    const newProbes: ProbeResult[] = [...probes].map(p => ({ ...p, status: 'pending' }));
    setProbes(newProbes);

    try {
      const ispPromise = fetch('https://ipapi.co/json/').then(res => res.json()).catch(() => null);
      const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

      const probeUrl = async (index: number) => {
        try {
          await Promise.race([
            fetch(newProbes[index].url, { mode: 'no-cors', cache: 'no-store' }),
            timeout(5000)
          ]);
          newProbes[index].status = 'reachable';
        } catch (e) {
          newProbes[index].status = 'blocked';
        }
        setProbes([...newProbes]);
      };

      const [ispData] = await Promise.all([
        ispPromise,
        probeUrl(0),
        probeUrl(1)
      ]);

      if (ispData) {
        setIspInfo({ org: ispData.org, asn: ispData.asn });
      }

      const validOk = newProbes[0].status === 'reachable';
      const invalidOk = newProbes[1].status === 'reachable';

      if (!validOk) {
        setStatus('error');
      } else if (invalidOk) {
        setStatus('unsafe');
      } else {
        setStatus('safe');
      }
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
      setStatus('error');
      setLastUpdated(new Date());
    }
  };

  return (
    <div className="w-full transition-all duration-500 h-full flex flex-col">
      {status === 'idle' && (
        <div className="flex-grow flex items-center justify-center w-full">
          <button 
            onClick={runTest}
            className="group relative px-10 py-5 bg-transparent border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white font-bold text-xs tracking-[0.2em] rounded-sm transition-all duration-300 transform hover:scale-105 active:scale-95 whitespace-nowrap flex items-center gap-3"
          >
            <Zap size={18} className="text-cyan-400 group-hover:text-white animate-pulse" />
            <span className="relative z-10 uppercase text-[11px]">Initiate Security Probe</span>
            <div className="absolute inset-0 bg-cyan-500/10 blur-md group-hover:blur-xl transition-all"></div>
          </button>
        </div>
      )}

      {status === 'testing' && (
        <div className="flex-grow flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-cyan-500/20 rounded-full"></div>
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-cyan-500 rounded-full animate-spin"></div>
          </div>
          <div className="text-[10px] font-bold text-cyan-500 animate-pulse uppercase tracking-[0.3em]">Analyzing Route Filtering...</div>
        </div>
      )}

      {(status === 'safe' || status === 'unsafe' || status === 'error') && (
        <div className={`w-full animate-in slide-in-from-left-4 duration-500 transition-all flex flex-col h-full border-2 rounded-xl p-8 ${
          status === 'safe' ? 'bg-emerald-500/10 border-emerald-500/40' : 
          status === 'unsafe' ? 'bg-red-500/10 border-red-500/40' : 
          'bg-slate-500/10 border-slate-500/40'
        }`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
            <div className={`flex flex-col gap-2 ${
              status === 'safe' ? 'text-emerald-500' : 
              status === 'unsafe' ? 'text-red-500' : 
              'text-slate-500'
            }`}>
              <div className="text-3xl font-cyber font-bold tracking-wider uppercase leading-none">
                {status === 'safe' ? 'SECURE' : status === 'unsafe' ? 'VULNERABLE' : 'PROBE ERROR'}
              </div>
              {ispInfo && (
                <div className="text-xs font-mono opacity-80 uppercase tracking-tighter mt-1">
                  <span className="opacity-50 font-bold">Network:</span> {ispInfo.org} <span className="opacity-40">[{ispInfo.asn}]</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
               <button 
                onClick={runTest} 
                className={`flex items-center gap-2 px-4 py-2 border rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all ${
                  status === 'safe' ? 'border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10' : 
                  status === 'unsafe' ? 'border-red-500/50 text-red-500 hover:bg-red-500/10' :
                  'border-slate-500/50 text-slate-500 hover:bg-slate-500/20'
                }`}
              >
                <RotateCcw size={12} />
                RE-SCAN
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-700 dark:text-slate-200 font-medium leading-relaxed mb-8 max-w-3xl">
            {status === 'safe' 
              ? <>Your ISP is successfully filtering invalid BGP routes. You are protected from the most common forms of routing hijacks and leaks.</>
              : status === 'unsafe' 
              ? <>Your ISP is not filtering invalid routes. Your internet traffic is susceptible to being intercepted or redirected by malicious actors.</>
              : <>The security probe could not establish a connection to the RPKI validation infrastructure. Please check your local network firewall.</>
            }
          </p>
          
          <div className="text-left bg-black/20 dark:bg-white/5 border border-slate-500/10 rounded-lg p-5 font-mono text-xs space-y-3 max-w-2xl mt-auto">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
              <div className="w-1 h-1 bg-cyan-500"></div>
              Technical Probe Details
            </div>
            {probes.map((p, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 border-b border-slate-500/10 pb-2 last:border-0 last:pb-0">
                <div className="truncate text-slate-500 dark:text-slate-400 text-[10px]">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-500 underline decoration-dotted">{p.url}</a>
                </div>
                <div className={`font-bold uppercase text-[10px] sm:text-xs ${
                  p.status === 'reachable' ? 'text-emerald-500' : 
                  p.status === 'blocked' ? 'text-orange-500' : 
                  p.status === 'error' ? 'text-red-500' : 
                  'text-slate-400'
                }`}>
                  [{p.status}]
                </div>
              </div>
            ))}
            <div className="pt-3 text-[10px] text-slate-500 leading-relaxed italic border-t border-slate-500/10">
              Note: A secure result requires the verified endpoint to be REACHABLE and the invalid endpoint to be BLOCKED.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
