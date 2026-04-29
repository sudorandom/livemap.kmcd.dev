import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Router, Share2, User, ShieldAlert, ArrowRight, Ban, Activity, ShieldCheck, Globe, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export const PanelContainer = ({ title, children, description, className = "", onPrev, onNext }: { title: string, children: React.ReactNode, description: string, className?: string, onPrev?: () => void, onNext?: () => void }) => (
  <div className="cyber-box p-6 rounded-xl bg-white/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-500/20 flex flex-col h-full relative">
    <div className="mb-4 flex justify-between items-start">
      <div className="flex-1">
        <h3 className="text-lg font-cyber font-bold text-indigo-600 dark:text-cyan-400 uppercase tracking-wider mb-1">{title}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">{description}</p>
      </div>
      {(onPrev || onNext) && (
        <div className="flex items-center gap-1.5 ml-4 pt-1">
           <button 
             onClick={onPrev} 
             className="p-1.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-700 transition-all shadow-sm dark:shadow-lg active:scale-95"
             aria-label="Previous Diagram"
           >
             <ChevronLeft size={16} />
           </button>
           <button 
             onClick={onNext} 
             className="p-1.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-700 transition-all shadow-sm dark:shadow-lg active:scale-95"
             aria-label="Next Diagram"
           >
             <ChevronRight size={16} />
           </button>
        </div>
      )}
    </div>
    <div className={`flex-grow flex items-center justify-center bg-transparent rounded-lg border border-slate-200/50 dark:border-slate-500/10 p-4 relative overflow-hidden min-h-[350px] ${className}`}>
      {children}
    </div>
  </div>
);

// Shared Coordinates for Consistency
export const COORDS = {
  USER: { x: 200, y: 50 },
  ENTRY: { x: 200, y: 120 },
  MID_L: { x: 100, y: 200 },
  MID_R: { x: 300, y: 200 },
  ORIGIN: { x: 200, y: 300 },
  MALICIOUS: { x: 40, y: 200 }
};

export const Node = ({ x, y, type, label, color = "slate", offline = false }: { x: number, y: number, type: 'router' | 'user', label?: string, color?: string, offline?: boolean }) => {
  const isRouter = type === 'router';
  const hasDarkBg = color === 'indigo' || color === 'emerald' || color === 'red';
  
  let baseColor = color === 'indigo' ? 'fill-indigo-600 stroke-indigo-400' : 
                   color === 'emerald' ? 'fill-emerald-600 stroke-emerald-400' :
                   color === 'red' ? 'fill-red-600 stroke-red-400' :
                   'fill-slate-200 dark:fill-slate-800 stroke-slate-400 dark:stroke-slate-600';
  
  if (offline) {
    baseColor = 'fill-slate-100 dark:fill-slate-800 stroke-red-500';
  }

  return (
    <g className="transition-opacity duration-500 opacity-100">
      <circle cx={x} cy={y} r={isRouter ? 15 : 18} className={`${baseColor} stroke-2 transition-colors duration-500`} />
      {isRouter ? (
        <Router x={x - 9} y={y - 9} size={18} className={`${offline ? 'text-red-500' : (hasDarkBg ? 'text-white' : 'text-slate-600 dark:text-white')} pointer-events-none transition-colors duration-500`} />
      ) : (
        <User x={x - 9} y={y - 9} size={18} className="text-white pointer-events-none" />
      )}
      {label && (
        <text x={x} y={type === 'user' ? y - 25 : y + 30} textAnchor="middle" className={`fill-slate-500 dark:fill-slate-400 text-[9px] font-bold uppercase tracking-tighter ${offline ? 'text-red-500' : ''}`}>
          {label}
        </text>
      )}
    </g>
  );
};

export const Path = ({ from, to, state, delay = 0, color, width, reverse = false }: { from: any, to: any, state: 'idle' | 'announcing' | 'withdrawing' | 'primary' | 'secondary', delay?: number, color?: string, width?: number, reverse?: boolean }) => {
  let strokeColor = 'text-slate-300 dark:text-slate-600';
  let dashed = false;
  let animate = false;
  let opacity = 'opacity-100';
  let actualWidth = width || 2;

  switch (state) {
    case 'idle':
      strokeColor = 'text-slate-300 dark:text-slate-600';
      dashed = true;
      animate = false;
      opacity = 'opacity-40';
      break;
    case 'announcing':
      strokeColor = color === 'red' ? 'text-red-500' : 'text-indigo-600 dark:text-cyan-500';
      dashed = true;
      animate = true;
      opacity = 'opacity-100';
      break;
    case 'withdrawing':
      strokeColor = 'text-red-500';
      dashed = true;
      animate = true;
      opacity = 'opacity-100';
      break;
    case 'primary':
      strokeColor = color === 'red' ? 'text-red-500' : 'text-indigo-600 dark:text-cyan-500';
      dashed = false;
      animate = false;
      opacity = 'opacity-100';
      actualWidth = width || 3;
      break;
    case 'secondary':
      strokeColor = 'text-slate-400 dark:text-slate-500';
      dashed = false;
      animate = false;
      opacity = 'opacity-40';
      actualWidth = 2;
      break;
  }

  // d = M from L to. Announcements travel AWAY from Origin.
  // reverse flips it.
  const d = reverse ? `M${to.x},${to.y} L${from.x},${from.y}` : `M${from.x},${from.y} L${to.x},${to.y}`;

  return (
    <path 
      d={d} 
      stroke="currentColor" 
      fill="none" 
      strokeWidth={actualWidth} 
      strokeDasharray={dashed ? "5,5" : "none"}
      className={`transition-all duration-700 ${strokeColor} ${opacity} ${animate ? 'stroke-dash-offset-animate' : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    />
  );
};

// Shared pulse spawning logic
const spawnPulse = (setter: React.Dispatch<React.SetStateAction<any[]>>, duration: number = 3000, data: any = {}) => {
  const id = Date.now() + Math.random();
  setter(p => [...p, { ...data, id }]);
  setTimeout(() => {
    setter(p => p.filter(x => x.id !== id));
  }, duration + 500);
};

// DataPulse component using CSS Motion Paths for reliable replaying
const DataPulse = ({ path, color = "white", duration = "3s", delay = "0s" }: { path: string, color?: string, duration?: string, delay?: string }) => {
  const isRed = color === 'red';
  const isCyan = color === 'cyan';
  const isPurple = color === 'purple';
  const isWhite = color === 'white';
  
  const fillColor = isRed ? 'fill-red-500' : 
                   (isCyan ? 'fill-indigo-500 dark:fill-cyan-400' : 
                   (isPurple ? 'fill-purple-500' : 
                   (isWhite ? 'fill-slate-600 dark:fill-white' : 'fill-slate-600 dark:fill-white')));

  const glowClass = isRed ? 'shadow-glow-red' : 
                    (isCyan ? 'shadow-glow-cyan' : 
                    (isPurple ? 'shadow-glow-purple' : 
                    'shadow-glow-white'));

  return (
    <circle 
      r="4" 
      className={`fill-current ${fillColor} ${glowClass} animate-pulse-path opacity-0`}
      style={{ 
        offsetPath: `path('${path}')`,
        animationDuration: duration,
        animationDelay: delay,
      } as any}
    />
  );
};

export const BGPRoutingExplainer = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [announcing, setAnnouncing] = useState(false);
  const [midLearned, setMidLearned] = useState(false);
  const [entryLearned, setEntryLearned] = useState(false);
  const [announcementComplete, setAnnouncementComplete] = useState(false);
  const [routingActive, setRoutingActive] = useState(false);
  const [routingPulses, setRoutingPulses] = useState<{id: number}[]>([]);
  const [withdrawn, setWithdrawn] = useState(false);
  const [withdrawalPulses, setWithdrawalPulses] = useState<{id: number, path: string, duration: string}[]>([]);
  const [withdrawalStage, setWithdrawalStage] = useState(0);
  const [asymmetricActive, setAsymmetricActive] = useState(false);
  const [asymmetricPulses, setAsymmetricPulses] = useState<{id: number}[]>([]);
  const [multipathActive, setMultipathActive] = useState(false);
  const [multipathPulses, setMultipathPulses] = useState<{id: number, color: string, path: string}[]>([]);
  const [anycastLocation, setAnycastLocation] = useState(false);
  const [anycastPulses, setAnycastPulses] = useState<{id: number, path: string}[]>([]);

  const tabs = [
    { title: "Announcing", icon: Share2, description: "Propagation of network reachability" },
    { title: "Routing", icon: ArrowRight, description: "Shortest-path selection" },
    { title: "Withdrawals", icon: Ban, description: "Handling link failures" },
    { title: "Asymmetry", icon: Activity, description: "Non-matching return paths" },
    { title: "Multipath", icon: Share2, description: "Traffic load balancing" },
    { title: "Anycast", icon: Globe, description: "Topological proximity routing" }
  ];

  useEffect(() => {
    if (announcing) {
      setMidLearned(true);
      const t1 = setTimeout(() => setEntryLearned(true), 1000);
      const t2 = setTimeout(() => setAnnouncementComplete(true), 2000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setMidLearned(false);
      setEntryLearned(false);
      setAnnouncementComplete(false);
    }
  }, [announcing]);

  const fullPathL = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const fullPathR = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const outboundPath = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y}`, []);
  const returnPath = useMemo(() => `M${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);

  useEffect(() => {
    if (withdrawn) {
      setWithdrawalStage(1);
      const t1 = setTimeout(() => setWithdrawalStage(2), 1000);
      return () => clearTimeout(t1);
    } else {
      setWithdrawalStage(0);
    }
  }, [withdrawn]);

  const withdrawalSettings = useRef({ path: fullPathL, duration: "3s" });
  useEffect(() => {
    let path = fullPathL;
    let duration = "3s";
    if (withdrawalStage === 1) {
      path = `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y}`;
      duration = "1s";
    } else if (withdrawalStage === 2) {
      path = `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y}`;
      duration = "0.4s";
    }
    withdrawalSettings.current = { path, duration };
  }, [withdrawalStage, fullPathL]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { path, duration } = withdrawalSettings.current;
      spawnPulse(setWithdrawalPulses, 3000, { path, duration });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handlePrev = () => setActiveTab(prev => (prev - 1 + tabs.length) % tabs.length);
  const handleNext = () => setActiveTab(prev => (prev + 1) % tabs.length);

  return (
    <div className="flex flex-col lg:flex-row gap-8 mb-16 items-stretch">
      <style>{`
        @keyframes dash { to { stroke-dashoffset: -20; } }
        .stroke-dash-offset-animate { animation: dash 1s linear infinite; }
        .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(100, 116, 139, 0.4)); }
        .dark .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9)); }
        .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(79, 70, 229, 0.4)); }
        .dark .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(0, 243, 255, 0.9)); }
        .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.6)); }
        .dark .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.9)); }
        .shadow-glow-purple { filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.6)); }
        .dark .shadow-glow-purple { filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.9)); }

        @keyframes pulse-motion {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .animate-pulse-path {
          offset-rotate: 0deg;
          animation-name: pulse-motion;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
      `}</style>

      {/* TABS SIDEBAR */}
      <div className="lg:w-1/3 flex flex-col gap-2">
        {/* Mobile Tabs (Wrapped) */}
        <div className="lg:hidden flex flex-wrap mb-6 gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  isActive 
                    ? 'bg-indigo-600/10 dark:bg-indigo-600/20 border-indigo-500 text-indigo-700 dark:text-white shadow-sm dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={14} />
                <span className="text-[10px] font-cyber font-bold uppercase tracking-wider">{tab.title}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop Vertical Tabs */}
        <div className="hidden lg:flex flex-col gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all text-left group ${
                  isActive 
                    ? 'bg-indigo-50 dark:bg-indigo-600/10 border-indigo-500 dark:border-indigo-500/50 ring-1 ring-indigo-500 dark:ring-indigo-500/50 shadow-md' 
                    : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <div className={`p-2 rounded-lg ${isActive ? 'bg-indigo-500 text-white shadow-indigo-200 dark:shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-slate-300'}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-cyber font-bold uppercase tracking-wider ${isActive ? 'text-indigo-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 group-hover:text-indigo-700 dark:group-hover:text-slate-200'}`}>
                    {tab.title}
                  </div>
                  <div className={`text-[10px] font-medium leading-tight mt-1 ${isActive ? 'text-indigo-600 dark:text-slate-400 opacity-90' : 'text-slate-500 dark:text-slate-500 opacity-80'}`}>
                    {tab.description}
                  </div>
                </div>
                {isActive && (
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2 animate-pulse shadow-indigo-500 dark:shadow-[0_0_8px_rgba(99,102,241,1)]"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="lg:w-2/3 h-[700px]">
        {activeTab === 0 && (
          <PanelContainer 
            title="1. Announcing" 
            description="The Origin AS 'announces' its IP space. Routers propagate this information so that every network knows the path back to the origin."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state={announcing ? 'announcing' : 'idle'} />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state={announcing ? 'announcing' : 'idle'} />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={announcing ? 'announcing' : 'idle'} delay={announcing ? 1000 : 0} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={announcing ? 'announcing' : 'idle'} delay={announcing ? 1000 : 0} />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" color={entryLearned ? "emerald" : "slate"} />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" color={midLearned ? "emerald" : "slate"} />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" color={midLearned ? "emerald" : "slate"} />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Origin AS" color="indigo" />

              {announcementComplete && (
                <g className="transition-opacity duration-500 opacity-100">
                   <rect x={COORDS.ENTRY.x + 30} y={COORDS.ENTRY.y - 9} width={90} height={18} rx={9} className="fill-cyan-500/20 stroke-cyan-400 stroke-1" />
                   <text x={COORDS.ENTRY.x + 75} y={COORDS.ENTRY.y + 3} textAnchor="middle" className="fill-indigo-600 dark:fill-cyan-400 text-[8px] font-bold uppercase tracking-tighter">Route Learned</text>
                </g>
              )}
            </svg>

            <button 
              onClick={() => setAnnouncing(!announcing)}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              {announcing ? 'Reset' : 'Start Announcement'}
              <Share2 size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 1 && (
          <PanelContainer 
            title="2. Routing" 
            description="Data follows the established paths. BGP selects the shortest route to reach the destination AS."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state={routingActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={routingActive ? 'primary' : 'announcing'} />
              
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state={routingActive ? 'secondary' : 'announcing'} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={routingActive ? 'secondary' : 'announcing'} />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Destination" color="indigo" />

              {routingPulses.map(pulse => (
                <DataPulse key={pulse.id} path={fullPathL} />
              ))}
            </svg>

            <button 
              onClick={() => {
                setRoutingActive(true);
                spawnPulse(setRoutingPulses);
              }}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              Trace Route
              <ArrowRight size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 2 && (
          <PanelContainer 
            title="3. Withdrawals" 
            description="When a prefix is no longer reachable, a 'withdrawal' message is sent. If an origin AS goes dark, its upstream peers detect the lost session and propagate the withdrawal to the rest of the internet."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
              {!withdrawn && (
                <>
                  <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state="announcing" />
                  <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state="announcing" />
                </>
              )}
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={withdrawn ? 'withdrawing' : 'announcing'} delay={withdrawn ? 0 : 1000} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={withdrawn ? 'withdrawing' : 'announcing'} delay={withdrawn ? 0 : 1000} />
              
              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label={withdrawn ? "Offline" : "Origin"} color={withdrawn ? "red" : "indigo"} offline={withdrawn} />
              
              {withdrawn && <Ban x={COORDS.ORIGIN.x - 12} y={COORDS.ORIGIN.y - 12} size={24} className="text-red-500 animate-pulse" />}

              {withdrawalPulses.map(pulse => (
                <DataPulse key={pulse.id} path={pulse.path} duration={pulse.duration} />
              ))}
            </svg>

            <button 
              onClick={() => {
                setWithdrawn(!withdrawn);
                setWithdrawalPulses([]);
              }}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              {withdrawn ? 'Restore Path' : 'Send Withdrawal'}
              <Ban size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 3 && (
          <PanelContainer 
            title="4. Asymmetric Routing" 
            description="In BGP, the path taken to reach a destination may differ from the path taken for return traffic. This is normal but can complicate troubleshooting."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state={asymmetricActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={asymmetricActive ? 'primary' : 'announcing'} />
              
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state={asymmetricActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={asymmetricActive ? 'primary' : 'announcing'} />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Destination" color="indigo" />

              {asymmetricPulses.map(pulse => (
                <React.Fragment key={pulse.id}>
                  <DataPulse path={outboundPath} color="cyan" duration="1.5s" />
                  <DataPulse path={returnPath} color="purple" duration="1.5s" delay="1.5s" />
                </React.Fragment>
              ))}
            </svg>

            <button 
              onClick={() => {
                setAsymmetricActive(true);
                spawnPulse(setAsymmetricPulses);
              }}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              Trace Route
              <ArrowRight size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 4 && (
          <PanelContainer 
            title="5. Multipath & Load Balancing" 
            description="While BGP defaults to a single path, technologies like ECMP (Equal-Cost) and UCMP (Unequal-Cost) allow routers to distribute traffic across multiple paths for redundancy and throughput. Advanced steering can also be achieved via Segment Routing (SR-TE)."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state={multipathActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state={multipathActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={multipathActive ? 'primary' : 'announcing'} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={multipathActive ? 'primary' : 'announcing'} />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Destination" color="indigo" />

              {multipathPulses.map(pulse => (
                <DataPulse 
                  key={pulse.id} 
                  duration="3.75s" 
                  path={pulse.path} 
                  color={pulse.color} 
                />
              ))}
            </svg>

            <button 
              onClick={() => {
                setMultipathActive(true);
                const useLeft = Math.random() < 0.5;
                spawnPulse(setMultipathPulses, 3750, { 
                  path: useLeft ? fullPathL : fullPathR,
                  color: useLeft ? "white" : "cyan"
                });
              }}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              Trace Route
              <Activity size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 5 && (
          <PanelContainer 
            title="6. Anycast Routing" 
            description="Multiple servers announce the exact same IP address. BGP naturally routes user traffic to the topologically closest destination, enabling global CDNs and root DNS."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <path 
                d={`M100,150 L300,150`} 
                stroke="currentColor" 
                fill="none" 
                strokeWidth="2"
                strokeDasharray="5,5"
                className="text-slate-700 opacity-30"
              />
              <text x="200" y="140" textAnchor="middle" className="fill-slate-500 dark:fill-slate-600 text-[7px] uppercase font-bold tracking-widest">Global Transit (Longer Path)</text>
              <Path from={{x: 100, y: 150}} to={{x: 100, y: 270}} state="primary" />
              <Path from={{x: 300, y: 150}} to={{x: 300, y: 270}} state="primary" />
              <path d="M100,50 L100,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-indigo-600 dark:text-cyan-500" />
              <path d="M300,50 L300,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-indigo-600 dark:text-cyan-500" />
              <Node x={100} y={50} type="user" label="User (EU)" color="emerald" />
              <Node x={300} y={50} type="user" label="User (Asia)" color="emerald" />
              <Node x={100} y={150} type="router" />
              <Node x={300} y={150} type="router" />
              <Node x={100} y={270} type="router" label="Origin (1.1.1.1)" color="indigo" />
              <Node x={300} y={270} type="router" label="Origin (1.1.1.1)" color="indigo" />
              {anycastPulses.map(pulse => (
                <DataPulse 
                  key={pulse.id} 
                  path={pulse.path}
                  duration="3s"
                  color="white"
                />
              ))}
            </svg>

            <button 
              onClick={() => {
                spawnPulse(setAnycastPulses, 3000, { path: `M100,50 L100,150 L100,270 L100,150 L100,50` });
                spawnPulse(setAnycastPulses, 3000, { path: `M300,50 L300,150 L300,270 L300,150 L300,50` });
              }}
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              Trace Route
              <Activity size={12} />
            </button>
          </PanelContainer>
        )}
      </div>
    </div>
  );
};


export const BGPAdvancedTopics = () => (
  <PanelContainer 
    title="Advanced BGP Topics" 
    description="Explore the complex protocols and architectural standards built on top of BGP's extensible framework."
    className="bg-transparent border-none p-0"
  >
    <div className="flex flex-col gap-6 w-full h-full overflow-y-auto custom-scrollbar p-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        <div className="space-y-4 border-b border-slate-500/10 pb-4 md:border-b-0">
          <h4 className="text-indigo-600 dark:text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Activity size={16} /> Path & Scalability
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc4456" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">Route Reflection (RFC 4456)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Eliminates the need for a full iBGP mesh by using reflectors to propagate internal routes.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7911" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGP ADD-PATH (RFC 7911)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Allows advertising multiple paths for the same prefix to enable better ECMP and faster convergence.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/draft-ietf-rtgwg-bgp-pic" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGP PIC</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Prefix Independent Convergence allows millisecond failover by using pre-calculated backup paths.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc5065" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">Confederations (RFC 5065)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Dividing a large AS into smaller sub-ASs to simplify management and reduce peering overhead.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4 border-b border-slate-500/10 pb-4 md:border-b-0">
          <h4 className="text-indigo-600 dark:text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <ShieldCheck size={16} /> Security & Integrity
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc8205" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGPsec (RFC 8205)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Full path signing. Rarely deployed due to high CPU load; RPKI is the preferred modern alternative.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7454" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGP OPSEC (RFC 7454)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Best practices for securing BGP sessions including TTL security and prefix filtering.</p>
            </li>
            <li>
              <a href="https://blog.cloudflare.com/rpki/" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">RPKI Validation</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Cryptographic verification that an AS is authorized to originate specific IP prefixes.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4 border-b border-slate-500/10 pb-4 md:border-b-0">
          <h4 className="text-indigo-600 dark:text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Activity size={16} /> Traffic Engineering & Resiliency
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc5575" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGP FlowSpec (RFC 5575)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Propagating firewall-like traffic filtering rules across AS boundaries for DDoS mitigation.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc8402" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">Segment Routing (SR)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Steering traffic using source-routing instructions, often distributed via BGP (SR-TE).</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc4724" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">Graceful Restart (RFC 4724)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Mechanism to maintain packet forwarding during a BGP control-plane restart.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4">
          <h4 className="text-indigo-600 dark:text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Globe size={16} /> Modern Overlays
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7432" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">EVPN (RFC 7432)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">The industry standard control plane for modern Layer 2 and Layer 3 virtualization.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7752" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BGP Link-State (RFC 7752)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">Exporting IGP topology information to controllers for centralized traffic engineering.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7854" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">BMP Monitoring (RFC 7854)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">A protocol to monitor BGP sessions and peer information without impacting forwarding.</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </PanelContainer>
);

export const BGPSecurityExplainer = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [hijacked, setHijacked] = useState(false);
  const [filtered, setFiltered] = useState(false);
  
  const [hijackPulses, setHijackPulses] = useState<{id: number, path: string, color: string}[]>([]);
  const [filterPulses, setFilteredPulses] = useState<{id: number, path: string, color: string}[]>([]);

  const fullPathR = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const hijackPath = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.MALICIOUS.x},${COORDS.MALICIOUS.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);

  const tabs = [
    { title: "Route Hijack", icon: ShieldAlert, description: "Path stealing via malicious announcements" },
    { title: "RPKI Filtering", icon: ShieldCheck, description: "Automated mitigation of invalid routes" }
  ];

  // Snapshot refs for security panels
  const securitySettings = useRef({ hijacked: false, filtered: false });
  useEffect(() => {
    securitySettings.current = { hijacked, filtered };
  }, [hijacked, filtered]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { hijacked: isH, filtered: isF } = securitySettings.current;
      
      // Hijack Panel Pulse
      spawnPulse(setHijackPulses, 3000, {
        path: isH ? hijackPath : fullPathR,
        color: isH ? "red" : "white"
      });

      // Filter Panel Pulse (always safe path since malicious is dropped)
      spawnPulse(setFilteredPulses, 3000, {
        path: fullPathR,
        color: "cyan"
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fullPathR, hijackPath]);

  const handlePrev = () => setActiveTab(prev => (prev - 1 + tabs.length) % tabs.length);
  const handleNext = () => setActiveTab(prev => (prev + 1) % tabs.length);

  return (
    <div className="flex flex-col lg:flex-row gap-8 mt-12 pt-12 border-t border-slate-500/10 items-stretch">
      <style>{`
        .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(100, 116, 139, 0.4)); }
        .dark .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9)); }
        .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(79, 70, 229, 0.4)); }
        .dark .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(0, 243, 255, 0.9)); }
        .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.6)); }
        .dark .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.9)); }
        .stroke-dash-offset-animate { animation: dash 1s linear infinite; }

        @keyframes pulse-motion-sec {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .animate-pulse-path-sec {
          offset-rotate: 0deg;
          animation-name: pulse-motion-sec;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
      `}</style>

      {/* TABS SIDEBAR */}
      <div className="lg:w-1/3 flex flex-col gap-2">
        {/* Mobile Tabs (Wrapped) */}
        <div className="lg:hidden flex flex-wrap mb-6 gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  isActive 
                    ? 'bg-red-600/10 dark:bg-red-600/20 border-red-500 text-red-700 dark:text-white shadow-sm dark:shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={14} />
                <span className="text-[10px] font-cyber font-bold uppercase tracking-wider">{tab.title}</span>
              </button>
            );
          })}
        </div>

        {/* Desktop Vertical Tabs */}
        <div className="hidden lg:flex flex-col gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all text-left group ${
                  isActive 
                    ? 'bg-red-50 dark:bg-red-600/10 border-red-500 dark:border-red-500/50 ring-1 ring-red-500 dark:ring-red-500/50 shadow-md' 
                    : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-red-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <div className={`p-2 rounded-lg ${isActive ? 'bg-red-500 text-white shadow-red-200 dark:shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-red-600 dark:group-hover:text-slate-300'}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-cyber font-bold uppercase tracking-wider ${isActive ? 'text-red-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 group-hover:text-red-700 dark:group-hover:text-slate-200'}`}>
                    {tab.title}
                  </div>
                  <div className={`text-[10px] font-medium leading-tight mt-1 ${isActive ? 'text-red-600 dark:text-slate-400 opacity-90' : 'text-slate-500 dark:text-slate-500 opacity-80'}`}>
                    {tab.description}
                  </div>
                </div>
                {isActive && (
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 animate-pulse shadow-red-500 dark:shadow-[0_0_8px_rgba(239,68,68,1)]"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="lg:w-2/3 h-[700px]">
        {activeTab === 0 && (
          <PanelContainer 
            title="1. Route Hijack" 
            description="A hijacker announces a more specific or attractive path to the legitimate Destination, stealing internet traffic."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state={hijacked ? 'secondary' : 'primary'} />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state={hijacked ? 'secondary' : 'primary'} />
              
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state="secondary" />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state={hijacked ? 'primary' : 'secondary'} color={hijacked ? "red" : "cyan"} />
              
              <Path from={COORDS.MALICIOUS} to={COORDS.MID_L} state={hijacked ? 'announcing' : 'idle'} color="red" />
              
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Destination" color="indigo" />
              <Node x={COORDS.MALICIOUS.x} y={COORDS.MALICIOUS.y} type="router" label="Hijacker" color="red" />

              {hijackPulses.map(pulse => (
                <DataPulse 
                  key={pulse.id} 
                  color={pulse.color}
                  path={pulse.path} 
                />
              ))}
            </svg>

            <button 
              onClick={() => {
                setHijacked(!hijacked);
                setHijackPulses([]);
              }}
              className="absolute bottom-4 right-4 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              {hijacked ? 'Reset' : 'Trigger Hijack'}
              <ShieldAlert size={12} />
            </button>
          </PanelContainer>
        )}

        {activeTab === 1 && (
          <PanelContainer 
            title="2. RPKI Route Filtering" 
            description="ISPs use RPKI to mathematically prove Route Hijacks are invalid. The malicious path is dropped at the border, protecting the user."
            onPrev={handlePrev}
            onNext={handleNext}
          >
            <svg viewBox="0 0 400 350" className="w-full h-full">
              <Path from={COORDS.ORIGIN} to={COORDS.MID_R} state="primary" />
              <Path from={COORDS.MID_R} to={COORDS.ENTRY} state="primary" />
              
              <Path from={COORDS.ORIGIN} to={COORDS.MID_L} state="secondary" />
              <Path from={COORDS.MID_L} to={COORDS.ENTRY} state="secondary" />
              
              <Path from={COORDS.MALICIOUS} to={COORDS.MID_L} state={filtered ? 'announcing' : 'idle'} color="red" />
              
              <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />

              <Node x={COORDS.USER.x} y={COORDS.USER.y} type="user" label="User" color="emerald" />
              <Node x={COORDS.ENTRY.x} y={COORDS.ENTRY.y} type="router" />
              <Node x={COORDS.MID_L.x} y={COORDS.MID_L.y} type="router" label={filtered ? "" : "RPKI Enabled"} color={filtered ? "slate" : "emerald"} />
              <Node x={COORDS.MID_R.x} y={COORDS.MID_R.y} type="router" />
              <Node x={COORDS.ORIGIN.x} y={COORDS.ORIGIN.y} type="router" label="Destination" color="indigo" />
              <Node x={COORDS.MALICIOUS.x} y={COORDS.MALICIOUS.y} type="router" label="Hijacker" color="red" />

              {filtered && (
                <g>
                  <circle cx={COORDS.MID_L.x} cy={COORDS.MID_L.y} r={22} className="fill-slate-900 stroke-emerald-500 stroke-[3px]" />
                  <ShieldCheck x={COORDS.MID_L.x - 14} y={COORDS.MID_L.y - 14} size={28} className="text-emerald-400 absolute" />
                  <text x={COORDS.MID_L.x} y={COORDS.MID_L.y - 30} textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-bold uppercase">Dropped</text>
                </g>
              )}

              {filterPulses.map(pulse => (
                <DataPulse key={pulse.id} color={pulse.color} path={pulse.path} />
              ))}
            </svg>

            <button 
              onClick={() => {
                setFiltered(!filtered);
              }}
              className="absolute bottom-4 right-4 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold py-2 px-4 rounded-full shadow-lg transition-all flex items-center gap-2"
            >
              {filtered ? 'Reset' : 'Simulate Hijack'}
              <ShieldCheck size={12} />
            </button>
          </PanelContainer>
        )}
      </div>
    </div>
  );
};
