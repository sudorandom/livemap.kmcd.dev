import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Router, Share2, User, ShieldAlert, ArrowRight, Ban, Activity, ShieldCheck, Globe, ChevronLeft, ChevronRight, RotateCcw, Zap, Filter, CheckCircle2 } from 'lucide-react';

export const PanelContainer = ({ title, children, footer, description, className = "", onPrev, onNext, isFirst, isLast, nextHighlighted }: { title: string, children: React.ReactNode, footer?: React.ReactNode, description: string, className?: string, onPrev?: () => void, onNext?: () => void, isFirst?: boolean, isLast?: boolean, nextHighlighted?: boolean }) => (
  <div className="cyber-box p-4 md:p-6 rounded-xl bg-white/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-500/20 flex flex-col h-full relative">
    <div className="mb-4 flex justify-between items-start">
      <div className="flex-1">
        <h3 className="text-lg font-cyber font-bold text-indigo-600 dark:text-cyan-400 uppercase tracking-wider mb-1">{title}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">{description}</p>
      </div>
      {nextHighlighted && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 animate-in fade-in zoom-in duration-500 ml-4">
          <CheckCircle2 size={12} className="animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-tighter">Step Complete</span>
        </div>
      )}
    </div>
    <div 
      aria-live="polite"
      className={`flex-grow flex items-center justify-center bg-transparent rounded-lg p-0 relative overflow-hidden min-h-[350px] ${className}`}
    >
      {children}
    </div>
    <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800 pt-6 relative">
      {(onPrev || onNext) && (
        <div className="flex items-center gap-2 order-2 sm:order-1">
           <button 
             onClick={onPrev} 
             disabled={isFirst}
             className={`p-2.5 rounded-lg border transition-all shadow-sm active:scale-95 ${isFirst ? 'bg-slate-50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800 text-slate-300 dark:text-slate-700 cursor-not-allowed' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-700'}`}
             aria-label="Previous Diagram"
           >
             <ChevronLeft className="w-5 h-5" />
           </button>
           <button 
             onClick={onNext} 
             disabled={isLast}
             className={`p-2.5 rounded-lg border transition-all shadow-sm active:scale-95 ${isLast ? 'bg-slate-50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800 text-slate-300 dark:text-slate-700 cursor-not-allowed' : (nextHighlighted ? 'bg-indigo-600 text-white border-indigo-400 animate-bounce-once shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-white dark:hover:bg-slate-700')}`}
             aria-label="Next Diagram"
           >
             <ChevronRight className="w-5 h-5" />
           </button>
        </div>
      )}

      <div className="flex flex-1 justify-center sm:justify-end gap-4 order-1 sm:order-2">
        {footer}
      </div>
    </div>
  </div>
);

const ActionButton = ({ onClick, active, label, activeLabel, icon: Icon, color = "indigo", disabled = false, className = "" }: { onClick: () => void, active?: boolean, label: string, activeLabel?: string, icon: any, color?: "indigo" | "red" | "slate", disabled?: boolean, className?: string }) => {
  const isIndigo = color === "indigo";
  const isRed = color === "red";
  const isSlate = color === "slate";
  
  const bgColor = disabled 
    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed shadow-none" 
    : (isIndigo ? "bg-indigo-600 hover:bg-indigo-500 border-indigo-400/50 shadow-xl" : 
       isRed ? "bg-red-600 hover:bg-red-500 border-red-400/50 shadow-xl" : 
       "bg-slate-600 hover:bg-slate-500 border-slate-400/50 shadow-xl");
  
  const glowColor = isIndigo ? "bg-indigo-500/40 dark:bg-cyan-500/30" : 
                    isRed ? "bg-red-500/40 dark:bg-red-500/30" : 
                    "bg-slate-500/40 dark:bg-slate-500/30";
  
  const pulseClass = (!active && !disabled && !isSlate) ? "animate-pulse-border" : "";

  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`group relative ${bgColor} border text-xs font-bold py-2.5 px-6 rounded-full transition-all flex items-center gap-2 z-20 ${!disabled && 'transform hover:scale-105 active:scale-95 text-white'} ${pulseClass} ${className}`}
    >
      <span className="relative z-10 flex items-center gap-2 uppercase tracking-widest">
        {active ? (activeLabel || label) : label}
        <Icon size={14} className={(!active && !disabled && !isSlate) ? "animate-pulse" : ""} />
      </span>
      {!active && !disabled && !isSlate && (
        <div className={`absolute inset-0 ${glowColor} blur-md group-hover:blur-xl transition-all rounded-full animate-pulse`}></div>
      )}
    </button>
  );
};

const ToggleSwitch = ({ enabled, onChange, label, className = "" }: { enabled: boolean, onChange: (val: boolean) => void, label?: string, className?: string }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    {label && <span className="text-[10px] font-bold uppercase tracking-tighter text-slate-500 dark:text-slate-400">{label}</span>}
    <button
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      className={`relative w-8 h-4 rounded-full transition-colors duration-300 focus:outline-none ${enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-300 ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
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

export const Node = ({ x, y, type, label, color = "slate", offline = false, labelPos, labelBg, labelOffset = 0, labelVOffset = 0, onClick }: { x: number, y: number, type: 'router' | 'user', label?: string, color?: string, offline?: boolean, labelPos?: 'top' | 'bottom', labelBg?: boolean, labelOffset?: number, labelVOffset?: number, onClick?: () => void }) => {
  const isRouter = type === 'router';
  const hasDarkBg = color === 'indigo' || color === 'emerald' || color === 'red' || color === 'blue';
  
  let baseColor = color === 'indigo' ? 'fill-indigo-600 stroke-indigo-400' : 
                   color === 'emerald' ? 'fill-emerald-600 stroke-emerald-400' :
                   color === 'red' ? 'fill-red-600 stroke-red-400' :
                   color === 'blue' ? 'fill-blue-600 stroke-blue-400' :
                   'fill-slate-200 dark:fill-slate-800 stroke-slate-400 dark:stroke-slate-600';
  
  if (offline) {
    baseColor = 'fill-slate-100 dark:fill-slate-800 stroke-red-500';
  }

  const defaultPos = type === 'user' ? 'top' : 'bottom';
  const finalPos = labelPos || defaultPos;
  const labelY = finalPos === 'top' ? y - 25 : y + 30;

  return (
    <g 
      className={`transition-opacity duration-500 opacity-100 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <circle cx={x} cy={y} r={isRouter ? 15 : 18} className={`${baseColor} stroke-2 transition-colors duration-500`} />
      {isRouter ? (
        <Router x={x - 9} y={y - 9} size={18} className={`${offline ? 'text-red-500' : (hasDarkBg ? 'text-white' : 'text-slate-600 dark:text-white')} pointer-events-none transition-colors duration-500`} />
      ) : (
        <User x={x - 9} y={y - 9} size={18} className="text-white pointer-events-none" />
      )}
      {label && (
        <g transform={`translate(${labelOffset}, 0)`}>
          {labelBg && (
            <rect x={x - 45} y={labelY - 9} width={90} height={14} rx={7} className="fill-slate-100/80 dark:fill-slate-800/80 stroke-slate-200 dark:stroke-slate-700 stroke-1" />
          )}
          <text x={x} y={labelY + 1} textAnchor="middle" className={`fill-slate-500 dark:fill-slate-400 text-[9px] font-bold uppercase tracking-tighter ${offline ? 'text-red-500' : ''}`}>
            {label}
          </text>
        </g>
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
      strokeColor = color === 'red' ? 'text-red-500' : 
                   color === 'blue' ? 'text-blue-500' : 
                   'text-indigo-600 dark:text-cyan-500';
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
      strokeColor = color === 'red' ? 'text-red-500' : 
                   color === 'blue' ? 'text-blue-500' : 
                   'text-indigo-600 dark:text-cyan-500';
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
  setter(p => [...p, { ...data, id, startTime: Date.now() }]);
  setTimeout(() => {
    setter(p => p.filter(x => x.id !== id));
  }, duration + 500);
};

// DataPulse component using CSS Motion Paths for reliable replaying
const DataPulse = ({ path, color = "white", duration = "3s", delay = "0s", clipped = false, clipId = "drop-clip" }: { path: string, color?: string, duration?: string, delay?: string, clipped?: boolean, clipId?: string }) => {
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
    <g style={{ clipPath: clipped ? `url(#${clipId})` : "none" }}>
      <circle 
        r="4" 
        className={`fill-current ${fillColor} ${glowClass} animate-pulse-path opacity-0`}
        style={{ 
          offsetPath: `path('${path}')`,
          animationDuration: duration,
          animationDelay: delay,
        } as any}
      />
    </g>
  );
};

export const BGPStateMachine = () => {
  const [activeState, setActiveState] = useState(0);
  const states = [
    { name: "Idle", desc: "Starting state" },
    { name: "Connect", desc: "Waiting for TCP" },
    { name: "Active", desc: "TCP link up" },
    { name: "OpenSent", desc: "OPEN msg sent" },
    { name: "OpenConfirm", desc: "KEEPALIVE sent" },
    { name: "Established", desc: "Session up" }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveState((prev) => (prev + 1) % states.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="py-12 bg-slate-50/50 dark:bg-slate-900/20 rounded-xl border border-slate-200 dark:border-slate-800 px-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent"></div>
      
      <ol className="flex flex-col md:flex-row justify-between items-center gap-4 relative z-10 list-none p-0">
        {states.map((s, idx) => {
          const isPast = idx < activeState;
          const isActive = idx === activeState;
          
          return (
            <React.Fragment key={idx}>
              <li className="flex flex-col items-center group relative">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 border-2 ${
                  isActive ? "bg-indigo-600 border-indigo-400 shadow-[0_0_20px_rgba(79,70,229,0.5)] scale-110" : 
                  isPast ? "bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]" : 
                  "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                }`}>
                  <span className={`text-xs font-bold ${isActive || isPast ? "text-white" : "text-slate-400"}`}>
                    {idx + 1}
                  </span>
                </div>
                
                <div className="mt-4 text-center">
                  <div className={`text-xs font-cyber font-bold uppercase tracking-wider transition-colors duration-500 ${
                    isActive ? "text-indigo-600 dark:text-cyan-400" : 
                    isPast ? "text-emerald-600 dark:text-emerald-400" : 
                    "text-slate-400 dark:text-slate-600"
                  }`}>
                    {s.name}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 font-medium mt-1 opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white dark:bg-slate-900 px-2 py-1 rounded shadow-lg border border-slate-100 dark:border-slate-800 pointer-events-none">
                    {s.desc}
                  </div>
                </div>
              </li>
              
              {idx < states.length - 1 && (
                <div className="hidden md:block flex-1 h-0.5 relative mx-2" aria-hidden="true">
                  <div className="absolute inset-0 bg-slate-200 dark:bg-slate-800"></div>
                  <div 
                    className={`absolute inset-0 transition-all duration-1000 origin-left ${
                      isPast ? "bg-emerald-400 scale-x-100" : "scale-x-0"
                    }`}
                  ></div>
                  {isActive && (
                    <div className="absolute inset-0 bg-indigo-500 animate-pulse-width"></div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </ol>
      
      <style>{`
        @keyframes pulse-width {
          0% { transform: scaleX(0); opacity: 0; transform-origin: left; }
          50% { transform: scaleX(1); opacity: 1; transform-origin: left; }
          51% { transform-origin: right; }
          100% { transform: scaleX(0); opacity: 0; transform-origin: right; }
        }
        .animate-pulse-width {
          animation: pulse-width 2.5s infinite ease-in-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse-width {
            animation: none;
            background-color: rgb(79 70 229);
            transform: scaleX(1);
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
};

export const BGPRoutingExplainer = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [completedTabs, setCompletedTabs] = useState<number[]>([]);
  
  const markTabComplete = (idx: number) => {
    if (!completedTabs.includes(idx)) {
      setCompletedTabs(prev => [...prev, idx]);
    }
  };

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
  const [asymmetricPulses, setAsymmetricPulses] = useState<{id: number, path: string}[]>([]);
  const [multipathActive, setMultipathActive] = useState(false);
  const [multipathPulses, setMultipathPulses] = useState<{id: number, color: string, path: string, duration?: string}[]>([]);
  const [anycastLocation, setAnycastLocation] = useState(false);
  const [anycastNode1Offline, setAnycastNode1Offline] = useState(false);
  const [anycastNode2Offline, setAnycastNode2Offline] = useState(false);
  const [anycastPulses, setAnycastPulses] = useState<{id: number, path: string, duration?: string, node?: number}[]>([]);

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
      const t2 = setTimeout(() => {
        setAnnouncementComplete(true);
        markTabComplete(0);
      }, 2000);
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

        @keyframes pulse-border {
          0% { border-color: rgba(99, 102, 241, 0.2); box-shadow: 0 0 0 rgba(99, 102, 241, 0); }
          50% { border-color: rgba(99, 102, 241, 0.6); box-shadow: 0 0 15px rgba(99, 102, 241, 0.2); }
          100% { border-color: rgba(99, 102, 241, 0.2); box-shadow: 0 0 0 rgba(99, 102, 241, 0); }
        }
        .animate-pulse-border {
          animation: pulse-border 2s ease-in-out infinite;
        }

        @keyframes pulse-motion {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          98% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .animate-pulse-path {
          offset-rotate: 0deg;
          animation-name: pulse-motion;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        @keyframes shake-x {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake-x {
          animation: shake-x 0.15s ease-in-out;
          animation-iteration-count: 3;
        }

        @media (prefers-reduced-motion: reduce) {
          .stroke-dash-offset-animate,
          .animate-pulse-border,
          .animate-pulse-path,
          .animate-shake-x,
          .animate-pulse,
          .animate-bounce-once {
            animation: none !important;
          }
          .animate-pulse-path {
            opacity: 1 !important;
            offset-distance: 100% !important;
          }
        }
      `}</style>

      {/* TABS SIDEBAR */}
      <div className="lg:w-1/3 flex flex-col gap-2">
        {/* Mobile Tabs (Wrapped) */}
        <div className="lg:hidden flex flex-wrap mb-6 gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            const isComplete = completedTabs.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                aria-pressed={isActive}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  isActive 
                    ? 'bg-indigo-600/10 dark:bg-indigo-600/20 border-indigo-500 text-indigo-700 dark:text-white shadow-sm' 
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={14} className={isComplete ? 'text-emerald-500' : ''} />
                <span className="text-xs font-cyber font-bold uppercase tracking-wider">{tab.title}</span>
                {isComplete && <CheckCircle2 size={10} className="text-emerald-500" />}
              </button>
            );
          })}
        </div>

        {/* Desktop Vertical Tabs */}
        <div className="hidden lg:flex flex-col gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            const isComplete = completedTabs.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                aria-pressed={isActive}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all text-left group ${
                  isActive 
                    ? 'bg-indigo-50 dark:bg-indigo-600/10 border-indigo-500 dark:border-indigo-500/50 ring-1 ring-indigo-500 dark:ring-indigo-500/50 shadow-md' 
                    : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <div className={`p-2 rounded-lg relative ${isActive ? 'bg-indigo-500 text-white shadow-indigo-200 dark:shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600'}`}>
                  <Icon size={18} className={isComplete ? (isActive ? 'text-emerald-300' : 'text-emerald-500') : ''} />
                  {isComplete && (
                    <div className="absolute -top-1.5 -right-1.5 bg-white dark:bg-slate-950 rounded-full border border-white dark:border-slate-900">
                       <CheckCircle2 size={13} className="text-emerald-500 shadow-sm" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-cyber font-bold uppercase tracking-wider ${isActive ? 'text-indigo-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 group-hover:text-indigo-700'}`}>
                    {tab.title}
                  </div>
                  <div className={`text-xs font-medium leading-tight mt-1 ${isActive ? 'text-indigo-600 dark:text-slate-400 opacity-90' : 'text-slate-500 dark:text-slate-500 opacity-80'}`}>
                    {tab.description}
                  </div>
                </div>
                {isActive && !isComplete && (
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2 animate-pulse shadow-indigo-500"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>


      {/* CONTENT AREA */}
      <div className="lg:w-2/3 min-h-[500px] lg:h-[700px]">
        {activeTab === 0 && (
          <PanelContainer 
            title="1. Announcing" 
            description="The Origin AS 'announces' its IP space. Routers propagate this information so that every network knows the path back to the origin."
            onPrev={handlePrev}
            onNext={handleNext}
            isFirst
            nextHighlighted={completedTabs.includes(0)}
            footer={
              <>
                <ActionButton 
                  onClick={() => setAnnouncing(false)}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!announcing}
                />
                <ActionButton 
                  onClick={() => setAnnouncing(true)}
                  label="Announce"
                  icon={Share2}
                  disabled={announcing}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="announcing-svg-title">
              <title id="announcing-svg-title">BGP Route Announcement Diagram</title>
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
                   <text x={COORDS.ENTRY.x + 75} y={COORDS.ENTRY.y + 3} textAnchor="middle" className="fill-indigo-600 dark:fill-cyan-400 text-[10px] font-bold uppercase tracking-tighter">Route Learned</text>
                </g>
              )}
            </svg>
          </PanelContainer>
        )}

        {activeTab === 1 && (
          <PanelContainer 
            title="2. Routing" 
            description="Data follows the established paths. BGP selects the shortest route to reach the destination AS."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(1)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setRoutingActive(false);
                    setRoutingPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!routingActive && routingPulses.length === 0}
                />
                <ActionButton 
                  onClick={() => {
                    setRoutingActive(true);
                    spawnPulse(setRoutingPulses);
                    setTimeout(() => markTabComplete(1), 3000);
                  }}
                  label="Trace Route"
                  icon={Zap}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="routing-svg-title">
              <title id="routing-svg-title">BGP Route Selection Diagram</title>
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
          </PanelContainer>
        )}

        {activeTab === 2 && (
          <PanelContainer 
            title="3. Withdrawals" 
            description="When a prefix is no longer reachable, a 'withdrawal' message is sent. If an origin AS goes dark, its upstream peers detect the lost session and propagate the withdrawal to the rest of the internet."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(2)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setWithdrawn(false);
                    setWithdrawalPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!withdrawn}
                />
                <ActionButton 
                  onClick={() => {
                    setWithdrawn(true);
                    setWithdrawalPulses([]);
                    setTimeout(() => markTabComplete(2), 1500);
                  }}
                  label="Take Offline"
                  icon={Ban}
                  disabled={withdrawn}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="withdrawal-svg-title">
              <title id="withdrawal-svg-title">BGP Route Withdrawal Diagram</title>
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
          </PanelContainer>
        )}

        {activeTab === 3 && (
          <PanelContainer 
            title="4. Asymmetric Routing" 
            description="In BGP, the path taken to reach a destination may differ from the path taken for return traffic. This is normal but can complicate troubleshooting."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(3)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setAsymmetricActive(false);
                    setAsymmetricPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!asymmetricActive && asymmetricPulses.length === 0}
                />
                <ActionButton 
                  onClick={() => {
                    setAsymmetricActive(true);
                    const pulsesCount = asymmetricPulses.length;
                    spawnPulse(setAsymmetricPulses, 3000, {
                        path: pulsesCount % 2 === 0 ? fullPathL : fullPathR
                    });
                    setTimeout(() => markTabComplete(3), 3000);                  }}
                  label="Trace Route"
                  icon={Zap}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="asymmetry-svg-title">
              <title id="asymmetry-svg-title">Asymmetric Routing Diagram</title>
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
          </PanelContainer>
        )}

        {activeTab === 4 && (
          <PanelContainer 
            title="5. Multipath & Load Balancing" 
            description="While BGP defaults to a single path, technologies like ECMP (Equal-Cost) and UCMP (Unequal-Cost) allow routers to distribute traffic across multiple paths for redundancy and throughput. Advanced steering can also be achieved via Segment Routing (SR-TE)."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(4)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setMultipathActive(false);
                    setMultipathPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!multipathActive && multipathPulses.length === 0}
                />
                <ActionButton 
                  onClick={() => {
                    setMultipathActive(true);
                    
                    // If not completed yet, trigger double pulse sequence
                    if (!completedTabs.includes(4)) {
                      // First pulse (Left)
                      spawnPulse(setMultipathPulses, 3750, { 
                        path: fullPathL,
                        color: "white",
                        duration: "3750ms"
                      });
                      
                      // Second pulse (Right) after 0.5s
                      setTimeout(() => {
                        spawnPulse(setMultipathPulses, 3750, { 
                          path: fullPathR,
                          color: "cyan",
                          duration: "3750ms"
                        });
                      }, 500);

                      // Mark complete after sequence finishes (0.5s delay + 3.75s duration)
                      setTimeout(() => markTabComplete(4), 4250);
                    } else {
                      // Subsequent presses: Random single pulse
                      const useLeft = Math.random() < 0.5;
                      spawnPulse(setMultipathPulses, 3750, { 
                        path: useLeft ? fullPathL : fullPathR,
                        color: useLeft ? "white" : "cyan",
                        duration: "3750ms"
                      });
                    }
                  }}
                  label="Trace Route"
                  icon={Zap}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="multipath-svg-title">
              <title id="multipath-svg-title">BGP Multipath Diagram</title>
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
          </PanelContainer>
        )}

        {activeTab === 5 && (
          <PanelContainer 
            title="6. Anycast Routing & Failover" 
            description="Multiple servers announce the same IP. BGP routes to the closest one. If one goes offline, BGP automatically reroutes traffic to the next closest instance, often via longer transit paths."
            onPrev={handlePrev}
            onNext={handleNext}
            isLast
            nextHighlighted={completedTabs.includes(5)}
            footer={
              <div className="flex flex-wrap justify-center gap-3">
                <ActionButton 
                  onClick={() => {
                    setAnycastNode1Offline(false);
                    setAnycastNode2Offline(false);
                    setAnycastPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!anycastNode1Offline && !anycastNode2Offline && anycastPulses.length === 0}
                />
                <ActionButton 
                  onClick={() => {
                    const node1Offline = anycastNode1Offline;
                    const node2Offline = anycastNode2Offline;
                    
                    let path1 = "";
                    let path2 = "";
                    let dur1 = 3000;
                    let dur2 = 3000;

                    if (node1Offline && node2Offline) {
                      // Both offline: stop at first hop (very fast)
                      path1 = `M100,50 L100,150`;
                      path2 = `M300,50 L300,150`;
                      dur1 = dur2 = 800;
                    } else {
                      // EU User Path
                      if (node1Offline) {
                        path1 = `M100,50 L100,150 L300,150 L300,270 L300,150 L100,150 L100,50`;
                        dur1 = 4500; // Longer path is slower
                      } else {
                        path1 = `M100,50 L100,150 L100,270 L100,150 L100,50`;
                        dur1 = 3000;
                      }

                      // Asia User Path
                      if (node2Offline) {
                        path2 = `M300,50 L300,150 L100,150 L100,270 L100,150 L300,150 L300,50`;
                        dur2 = 4500; // Longer path is slower
                      } else {
                        path2 = `M300,50 L300,150 L300,270 L300,150 L300,50`;
                        dur2 = 3000;
                      }
                    }

                    spawnPulse(setAnycastPulses, dur1, { path: path1, duration: `${dur1}ms`, node: 1 });
                    spawnPulse(setAnycastPulses, dur2, { path: path2, duration: `${dur2}ms`, node: 2 });
                    setTimeout(() => markTabComplete(5), Math.max(dur1, dur2));
                  }}
                  label="Trace Route"
                  icon={Zap}
                />
              </div>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="anycast-svg-title">
              <title id="anycast-svg-title">BGP Anycast Diagram</title>
              <path 
                d={`M100,150 L300,150`} 
                stroke="currentColor" 
                fill="none" 
                strokeWidth="2"
                strokeDasharray="5,5"
                className={`transition-opacity duration-500 ${ (anycastNode1Offline || anycastNode2Offline) ? 'text-indigo-500 opacity-60' : 'text-slate-700 opacity-30'}`}
              />
              <text x="200" y="140" textAnchor="middle" className="fill-slate-500 dark:fill-slate-600 text-[7px] uppercase font-bold tracking-widest">
                {(anycastNode1Offline || anycastNode2Offline) ? 'Rerouting via Transit' : 'Global Transit (Longer Path)'}
              </text>
              <Path from={{x: 100, y: 150}} to={{x: 100, y: 270}} state={anycastNode1Offline ? "idle" : "primary"} />
              <Path from={{x: 300, y: 150}} to={{x: 300, y: 270}} state={anycastNode2Offline ? "idle" : "primary"} />
              <path d="M100,50 L100,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-indigo-600 dark:text-cyan-500" />
              <path d="M300,50 L300,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-indigo-600 dark:text-cyan-500" />
              <Node x={100} y={50} type="user" label="User (EU)" color="emerald" />
              <Node x={300} y={50} type="user" label="User (Asia)" color="emerald" />
              <Node x={100} y={150} type="router" />
              <Node x={300} y={150} type="router" />
              <Node x={100} y={270} type="router" label="Origin (EU)" color={anycastNode1Offline ? "slate" : "indigo"} offline={anycastNode1Offline} />
              <Node x={300} y={270} type="router" label="Origin (Asia)" color={anycastNode2Offline ? "slate" : "indigo"} offline={anycastNode2Offline} />
              
              <foreignObject x={135} y={290} width={40} height={20}>
                <ToggleSwitch 
                  enabled={!anycastNode1Offline} 
                  onChange={(val) => {
                    const wasOnline = !anycastNode1Offline;
                    setAnycastNode1Offline(!val);
                    // If taking offline, kill pulses that haven't made it back to the peer yet
                    if (wasOnline && !val) {
                      const now = Date.now();
                      setAnycastPulses(prev => prev.filter(p => {
                        if (p.node !== 1) return true;
                        const elapsed = now - (p as any).startTime;
                        const dur = parseInt(p.duration || "3000");
                        const threshold = dur > 4000 ? 2900 : 2300;
                        return elapsed > threshold;
                      }));
                    }
                  }} 
                />
              </foreignObject>

              <foreignObject x={335} y={290} width={40} height={20}>
                <ToggleSwitch 
                  enabled={!anycastNode2Offline} 
                  onChange={(val) => {
                    const wasOnline = !anycastNode2Offline;
                    setAnycastNode2Offline(!val);
                    // If taking offline, kill pulses that haven't made it back to the peer yet
                    if (wasOnline && !val) {
                      const now = Date.now();
                      setAnycastPulses(prev => prev.filter(p => {
                        if (p.node !== 2) return true;
                        const elapsed = now - (p as any).startTime;
                        const dur = parseInt(p.duration || "3000");
                        const threshold = dur > 4000 ? 2900 : 2300;
                        return elapsed > threshold;
                      }));
                    }
                  }} 
                />
              </foreignObject>

              {anycastNode1Offline && <Ban x={100 - 10} y={270 - 10} size={20} className="text-red-500/50" />}
              {anycastNode2Offline && <Ban x={300 - 10} y={270 - 10} size={20} className="text-red-500/50" />}

              {anycastPulses.map(pulse => (
                <DataPulse 
                  key={pulse.id} 
                  path={pulse.path}
                  duration={pulse.duration || "3s"}
                  color="white"
                />
              ))}
            </svg>
          </PanelContainer>
        )}
      </div>
    </div>
  );
};


interface MessageField {
  label: string;
  value: string | number[] | string[];
  highlight?: string;
  isAsPath?: boolean;
  isWithdrawals?: boolean;
  isPrefix?: boolean;
}

interface BGPMessage {
  title: string;
  color: string;
  bg: string;
  description: string;
  subType?: string;
  fields: MessageField[];
  extra?: React.ReactNode;
}

export const BGPMessageAnatomy = () => {
  const [activeTab, setActiveTab] = useState(0);
  
  const messages: BGPMessage[] = [
    {
      title: "Open",
      color: "emerald",
      bg: "bg-emerald-500",
      description: "The first packet sent after the TCP handshake. It establishes the 'ground rules' for the peering session, including optional capabilities like IPv6 support or Route Refresh.",
      fields: [
        { label: "TYPE", value: "OPEN" },
        { label: "VERSION", value: "4" },
        { label: "MY ASN", value: "10122", highlight: "text-indigo-400" },
        { label: "HOLD TIME", value: "90" },
        { label: "BGP IDENTIFIER", value: "10.255.255.36", highlight: "text-cyan-400" }
      ]
    },
    {
      title: "Announcement",
      color: "indigo",
      bg: "bg-indigo-500",
      description: "The most common form of BGP Update. It advertises new reachability for an IP prefix and contains the path attributes used for route selection.",
      fields: [
        { label: "TYPE", value: "UPDATE (Announcement)" },
        { label: "PEER ASN", value: "199524", highlight: "text-indigo-400" },
        { 
          label: "AS PATH", 
          value: [199524, 1299, 7922, 46427, 64289],
          isAsPath: true
        },
        { label: "COMMUNITIES", value: "1299:30000, 7922:101", highlight: "text-purple-400" },
        { label: "NEXT HOP", value: "2001:504:1::a519:9524:1", highlight: "text-emerald-400" },
        { label: "PREFIXES", value: "2a14:3f87:9800::/38", isPrefix: true }
      ],
      extra: (
        <div className="mt-6 space-y-4 italic border-l-2 border-indigo-500/20 pl-4">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            The <strong className="text-indigo-600 dark:text-cyan-400">AS PATH</strong> shows the chain of networks this update traversed. Each network appends its own ASN to the beginning.
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            The <strong className="text-indigo-600 dark:text-cyan-400">NEXT HOP</strong> specifies the exact IP address to which packets must be forwarded.
          </p>
        </div>
      )
    },
    {
      title: "Withdrawal",
      color: "red",
      bg: "bg-red-500",
      description: "Removes prefixes from the global routing table immediately. This happens when a network link goes down or a peering session is disconnected.",
      fields: [
        { label: "TYPE", value: "UPDATE (Withdrawal)" },
        { label: "PEER ASN", value: "19151", highlight: "text-red-400" },
        { 
          label: "WITHDRAWALS", 
          value: ["199.199.238.0/23", "204.221.20.0/24", "206.10.88.0/22"],
          isWithdrawals: true
        }
      ]
    },
    {
      title: "KeepAlive",
      color: "cyan",
      bg: "bg-cyan-500",
      description: "The heartbeat of BGP. These are minimal 19-byte messages sent periodically to confirm that the peer is still reachable.",
      fields: [
        { label: "TYPE", value: "KEEPALIVE" },
        { label: "PEER", value: "195.208.208.15", highlight: "text-indigo-400" },
        { label: "PEER ASN", value: "39821", highlight: "text-cyan-400" }
      ]
    },
    {
      title: "Notification",
      color: "red",
      bg: "bg-red-500",
      description: "Sent when an error condition is detected. It contains an error code and subcode. Once sent, the BGP session is immediately closed.",
      fields: [
        { label: "TYPE", value: "NOTIFICATION" },
        { label: "ERROR CODE", value: "6 (Cease)", highlight: "text-red-400" },
        { label: "ERROR SUBCODE", value: "5 (Connection Rejected)", highlight: "text-red-400" },
        { label: "PEER", value: "195.208.208.187", highlight: "text-indigo-400" }
      ]
    }
  ];

  const activeMsg = messages[activeTab];

  return (
    <div className="cyber-box p-1 rounded-xl bg-white/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-500/20 overflow-hidden">
      <div className="flex flex-wrap border-b border-slate-200 dark:border-slate-800">
        {messages.map((msg, idx) => (
          <button
            key={idx}
            onClick={() => setActiveTab(idx)}
            aria-pressed={activeTab === idx}
            className={`px-4 py-3 text-xs font-cyber font-bold uppercase tracking-wider transition-all relative ${
              activeTab === idx 
                ? "text-slate-900 dark:text-white" 
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {msg.title}
            {activeTab === idx && (
              <div className={`absolute bottom-0 left-0 w-full h-0.5 ${msg.bg}`}></div>
            )}
          </button>
        ))}
      </div>
      
      <div aria-live="polite" className="p-6 md:p-8 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 rounded-t-lg border-b border-slate-700">
              <span className={`text-[10px] font-mono font-bold uppercase tracking-widest ${activeMsg.color === 'red' ? 'text-red-400' : 'text-cyan-400'}`}>
                Type: {activeMsg.subType || activeMsg.title}
              </span>
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-600"></div>
                <div className="w-2 h-2 rounded-full bg-slate-600"></div>
                <div className="w-2 h-2 rounded-full bg-slate-600"></div>
              </div>
            </div>
            <div className="bg-slate-900 rounded-b-lg border border-slate-800 shadow-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <caption className="sr-only">{activeMsg.title} Message Details</caption>
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/50">
                    <th className="p-3 text-[10px] font-cyber font-bold text-slate-400 uppercase tracking-wider w-1/3">Attribute</th>
                    <th className="p-3 text-[10px] font-cyber font-bold text-slate-400 uppercase tracking-wider">Value</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-mono">
                  {activeMsg.fields.map((field, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-white/5 transition-colors">
                      <td className="p-3 text-slate-500 font-bold uppercase">{field.label}</td>
                      <td className="p-3">
                        {field.isAsPath ? (
                          <span className="flex flex-wrap gap-1">
                            {(field.value as number[]).map(asn => (
                              <span key={asn} className="bg-indigo-500/20 text-indigo-300 px-1 rounded border border-indigo-500/20">AS{asn}</span>
                            ))}
                          </span>
                        ) : field.isWithdrawals ? (
                          <div className="space-y-1">
                            {(field.value as string[]).map(p => (
                              <div key={p} className="text-red-300 font-bold text-sm">{p}</div>
                            ))}
                          </div>
                        ) : field.isPrefix ? (
                          <span className="font-bold text-white text-sm">{field.value}</span>
                        ) : (
                          <span className={field.highlight || "text-slate-300"}>{field.value}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="lg:col-span-1 space-y-4">
            <h4 className="text-lg font-cyber font-bold text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-3">
              <div className={`w-2 h-6 ${activeMsg.bg}`}></div> Details
            </h4>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed italic border-l-2 border-slate-500/20 pl-4">
              {activeMsg.description}
            </p>
            {activeMsg.extra}
          </div>
        </div>
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
              <a href="https://www.bgp.us/ibgp-and-ebgp/" target="_blank" className="text-indigo-600 dark:text-cyan-500 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">eBGP vs iBGP</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">External BGP is used between networks while Internal BGP distributes those routes within a single AS.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc4456" target="_blank" className="text-indigo-600 dark:text-cyan-400 hover:text-indigo-500 dark:hover:text-cyan-300 underline decoration-dotted font-bold">Route Reflection (RFC 4456)</a>
              <p className="text-slate-600 dark:text-slate-400 italic mt-1 text-xs">A method to scale internal networks by reducing the need for every router to talk to every other router.</p>
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
  const [completedTabs, setCompletedTabs] = useState<number[]>([]);
  
  const markTabComplete = (idx: number) => {
    if (!completedTabs.includes(idx)) {
      setCompletedTabs(prev => [...prev, idx]);
    }
  };

  const [hijacked, setHijacked] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const [leaked, setLeaked] = useState(false);
  const [rtbhActive, setRtbhActive] = useState(false);
  const [flowspecActive, setFlowspecActive] = useState(false);
  
  const [hijackPulses, setHijackPulses] = useState<{id: number, path: string, color: string, duration: string}[]>([]);
  const [filterPulses, setFilteredPulses] = useState<{id: number, path: string, color: string, duration: string}[]>([]);
  const [leakPulses, setLeakPulses] = useState<{id: number, path: string, color: string, duration: string}[]>([]);
  const [rtbhPulses, setRtbhPulses] = useState<{id: number, path: string, color: string, duration: string}[]>([]);
  const [flowspecPulses, setFlowspecPulses] = useState<{id: number, path: string, color: string, duration: string}[]>([]);

  const fullPathR = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const hijackPath = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.MALICIOUS.x},${COORDS.MALICIOUS.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const leakPathIntended = useMemo(() => `M300,80 L100,80`, []); // Provider B -> Provider A (Direct)
  const leakPathLeaked = useMemo(() => `M300,80 L200,220 L100,80`, []); // Provider B -> Customer -> Provider A

  const pathUserToProvider = useMemo(() => `M100,40 L100,120 L200,210`, []);
  const pathAttackerToProvider1 = useMemo(() => `M300,40 L100,120 L200,210`, []);
  const pathAttackerToProvider2 = useMemo(() => `M300,40 L300,120 L200,210`, []);
  
  const pathFullUser = useMemo(() => `M100,40 L100,120 L200,210 L200,300`, []);
  const pathFullAttacker1 = useMemo(() => `M300,40 L100,120 L200,210 L200,300`, []);
  const pathFullAttacker2 = useMemo(() => `M300,40 L300,120 L200,210 L200,300`, []);

  const tabs = [
    { title: "Route Hijack", icon: ShieldAlert, description: "Path stealing via malicious announcements" },
    { title: "RPKI Filtering", icon: ShieldCheck, description: "Automated mitigation of invalid routes" },
    { title: "Route Leak", icon: Activity, description: "Unintentional transit via misconfiguration" },
    { title: "BGP RTBH", icon: Ban, description: "Remote Triggered Black Hole for DDoS mitigation" },
    { title: "BGP FlowSpec", icon: Filter, description: "Granular traffic filtering across AS boundaries" }
  ];

  // Snapshot refs for security panels
  const securitySettings = useRef({ hijacked: false, filtered: false, leaked: false, rtbh: false, flowspec: false });
  useEffect(() => {
    securitySettings.current = { hijacked, filtered, leaked, rtbh: rtbhActive, flowspec: flowspecActive };
  }, [hijacked, filtered, leaked, rtbhActive, flowspecActive]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { hijacked: isH, filtered: isF, leaked: isL, rtbh: isR, flowspec: isFS } = securitySettings.current;
      
      // Hijack Panel Pulse
      spawnPulse(setHijackPulses, 3000, {
        path: isH ? hijackPath : fullPathR,
        color: isH ? "red" : "white",
        duration: "3000ms"
      });

      // Filter Panel Pulse (always safe path since malicious is dropped)
      spawnPulse(setFilteredPulses, 3000, {
        path: fullPathR,
        color: "cyan",
        duration: "3000ms"
      });

      // Leak Panel Pulse
      if (isL) {
         // Traffic from B leaks through Customer to A
         spawnPulse(setLeakPulses, 3000, { path: leakPathLeaked, color: "red", duration: "3000ms" });
      } else {
         // Normal: Traffic from B goes directly to A
         spawnPulse(setLeakPulses, 3000, { path: leakPathIntended, color: "white", duration: "3000ms" });
      }

      // RTBH Panel Pulses
      const rtbhState = securitySettings.current.rtbh;
      spawnPulse(setRtbhPulses, rtbhState ? 1500 : 3000, { 
        path: rtbhState ? pathUserToProvider : pathFullUser, 
        color: "white", 
        duration: rtbhState ? "1500ms" : "3000ms" 
      });
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const active = securitySettings.current.rtbh;
          const usePath1 = Math.random() < 0.5;
          spawnPulse(setRtbhPulses, active ? 2000 : 3000, { 
            path: active ? (usePath1 ? pathAttackerToProvider1 : pathAttackerToProvider2) : (usePath1 ? pathFullAttacker1 : pathFullAttacker2), 
            color: "red", 
            duration: active ? "2000ms" : "3000ms" 
          });
        }, Math.random() * 800);
      }

      // FlowSpec Panel Pulses
      spawnPulse(setFlowspecPulses, 3000, { path: pathFullUser, color: "white", duration: "3000ms" });
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const active = securitySettings.current.flowspec;
          const usePath1 = Math.random() < 0.5;
          spawnPulse(setFlowspecPulses, active ? 2000 : 3000, { 
            path: active ? (usePath1 ? pathAttackerToProvider1 : pathAttackerToProvider2) : (usePath1 ? pathFullAttacker1 : pathFullAttacker2), 
            color: "red", 
            duration: active ? "2000ms" : "3000ms" 
          });
        }, Math.random() * 800);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [fullPathR, hijackPath, leakPathIntended, leakPathLeaked, pathUserToProvider, pathAttackerToProvider1, pathAttackerToProvider2, pathFullUser, pathFullAttacker1, pathFullAttacker2]);

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

        @keyframes pulse-border {
          0% { border-color: rgba(99, 102, 241, 0.2); box-shadow: 0 0 0 rgba(99, 102, 241, 0); }
          50% { border-color: rgba(99, 102, 241, 0.6); box-shadow: 0 0 15px rgba(99, 102, 241, 0.2); }
          100% { border-color: rgba(99, 102, 241, 0.2); box-shadow: 0 0 0 rgba(99, 102, 241, 0); }
        }
        .animate-pulse-border {
          animation: pulse-border 2s ease-in-out infinite;
        }

        @keyframes pulse-motion-sec {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          98% { opacity: 1; }
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
            const isComplete = completedTabs.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                aria-pressed={isActive}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  isActive 
                    ? 'bg-red-600/10 dark:bg-red-600/20 border-red-500 text-red-700 dark:text-white shadow-sm' 
                    : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon size={14} className={isComplete ? 'text-emerald-500' : ''} />
                <span className={`text-xs font-cyber font-bold uppercase tracking-wider ${isActive ? (isActive ? 'text-red-700 dark:text-white' : '') : ''}`}>{tab.title}</span>
                {isComplete && <CheckCircle2 size={10} className="text-emerald-500" />}
              </button>
            );
          })}
        </div>

        {/* Desktop Vertical Tabs */}
        <div className="hidden lg:flex flex-col gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            const isComplete = completedTabs.includes(idx);
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(idx)}
                aria-pressed={isActive}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all text-left group ${
                  isActive 
                    ? 'bg-red-50 dark:bg-red-600/10 border-red-500 dark:border-red-500/50 ring-1 ring-red-500 dark:ring-red-500/50 shadow-md' 
                    : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-red-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                }`}
              >
                <div className={`p-2 rounded-lg relative ${isActive ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-red-600'}`}>
                  <Icon size={18} className={isComplete ? (isActive ? 'text-emerald-300' : 'text-emerald-500') : ''} />
                  {isComplete && (
                    <div className="absolute -top-1.5 -right-1.5 bg-white dark:bg-slate-950 rounded-full border border-white dark:border-slate-900">
                       <CheckCircle2 size={13} className="text-emerald-500 shadow-sm" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-cyber font-bold uppercase tracking-wider ${isActive ? 'text-red-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 group-hover:text-red-700'}`}>
                    {tab.title}
                  </div>
                  <div className={`text-xs font-medium leading-tight mt-1 ${isActive ? 'text-red-600 dark:text-slate-400 opacity-90' : 'text-slate-500 dark:text-slate-500 opacity-80'}`}>
                    {tab.description}
                  </div>
                </div>
                {isActive && !isComplete && (
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 animate-pulse shadow-red-500"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="lg:w-2/3 min-h-[500px] lg:h-[700px]">
        {activeTab === 0 && (
          <PanelContainer 
            title="1. Route Hijack" 
            description="A hijacker announces a more specific or attractive path to the legitimate Destination, stealing internet traffic."
            onPrev={handlePrev}
            onNext={handleNext}
            isFirst
            nextHighlighted={completedTabs.includes(0)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setHijacked(false);
                    setHijackPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!hijacked}
                />
                <ActionButton 
                  onClick={() => {
                    setHijacked(true);
                    setTimeout(() => markTabComplete(0), 3000);
                  }}
                  label="Trigger Hijack"
                  icon={ShieldAlert}
                  color="red"
                  disabled={hijacked}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="hijack-svg-title">
              <title id="hijack-svg-title">BGP Route Hijack Diagram</title>
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
                  duration={pulse.duration}
                />
              ))}
            </svg>
          </PanelContainer>
        )}

        {activeTab === 1 && (
          <PanelContainer 
            title="2. RPKI Route Filtering" 
            description="ISPs use RPKI to mathematically prove Route Hijacks are invalid. The malicious path is dropped at the border, protecting the user."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(1)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setFiltered(false);
                    setFilteredPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!filtered}
                />
                <ActionButton 
                  onClick={() => {
                    setFiltered(true);
                    setTimeout(() => markTabComplete(1), 3000);
                  }}
                  label="Enable RPKI ROV"
                  icon={ShieldCheck}
                  color="indigo"
                  disabled={filtered}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="rpki-svg-title">
              <title id="rpki-svg-title">RPKI Filtering Diagram</title>
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
                  <g transform={`translate(${COORDS.MID_L.x - 14}, ${COORDS.MID_L.y - 14})`}>
                    <ShieldCheck size={28} className="text-emerald-400" />
                  </g>
                  <text x={COORDS.MID_L.x} y={COORDS.MID_L.y - 35} textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400 text-xs font-bold uppercase">Dropped</text>
                </g>
              )}

              {filterPulses.map(pulse => (
                <DataPulse key={pulse.id} color={pulse.color} path={pulse.path} duration={pulse.duration} />
              ))}
            </svg>
          </PanelContainer>
        )}

        {activeTab === 2 && (
          <PanelContainer 
            title="3. Route Leak" 
            description="A Customer AS accidentally announces routes learned from Provider A to Provider B. This creates a 'valley' where Provider B sends backbone traffic through the customer's limited link to reach Provider A."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(2)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setLeaked(false);
                    setLeakPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!leaked}
                />
                <ActionButton 
                  onClick={() => {
                    setLeaked(true);
                    setTimeout(() => markTabComplete(2), 3000);
                  }}
                  label="Trigger Leak"
                  icon={Activity}
                  color="red"
                  disabled={leaked}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="leak-svg-title">
              <title id="leak-svg-title">BGP Route Leak Diagram</title>
              {/* Main Provider-to-Provider intended path */}
              <Path from={{x: 300, y: 80}} to={{x: 100, y: 80}} state={leaked ? "secondary" : "primary"} />
              
              {/* Customer Links */}
              <Path from={{x: 200, y: 220}} to={{x: 100, y: 80}} state="primary" />
              <Path from={{x: 300, y: 80}} to={{x: 200, y: 220}} state={leaked ? "announcing" : "primary"} color={leaked ? "red" : "white"} />
              
              <Node x={100} y={80} type="router" label="Provider A" color="emerald" labelPos="top" />
              <Node x={300} y={80} type="router" label="Provider B" color="emerald" labelPos="top" />
              <Node x={200} y={220} type="router" label="Customer AS" color="indigo" labelPos="bottom" />

              <text x="200" y="55" textAnchor="middle" className="fill-slate-500 text-[10px] uppercase font-bold tracking-tighter">High-Speed Backbone</text>
              
              {leaked && (
                <g className="animate-pulse">
                   <rect x={155} y={270} width={90} height={16} rx={8} className="fill-red-500/20 stroke-red-500 stroke-1" />
                   <text x={200} y={281} textAnchor="middle" className="fill-red-600 dark:fill-red-400 text-[10px] font-bold uppercase">Congested Leak</text>
                   
                   <g transform="translate(0, 20)">
                      <text x={200} y={285} textAnchor="middle" className="fill-red-500/80 text-[7px] font-bold uppercase">High Latency</text>
                      <text x={200} y={295} textAnchor="middle" className="fill-red-500/80 text-[7px] font-bold uppercase">Packet Loss</text>
                      <text x={200} y={305} textAnchor="middle" className="fill-red-500/80 text-[7px] font-bold uppercase">Service Outage</text>
                   </g>
                </g>
              )}

              {leakPulses.map(pulse => (
                <DataPulse key={pulse.id} color={pulse.color} path={pulse.path} duration={pulse.duration} />
              ))}
            </svg>
          </PanelContainer>
        )}

        {activeTab === 3 && (
          <PanelContainer 
            title="4. BGP RTBH (Black-Hole)" 
            description="Remote Triggered Black Hole (RTBH, RFC 5635) allows a network to tell its providers to drop all traffic destined for an IP under a Distributed Denial of Service (DDoS) attack. This protects the network link capacity at the cost of the target IP's reachability."
            onPrev={handlePrev}
            onNext={handleNext}
            nextHighlighted={completedTabs.includes(3)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setRtbhActive(false);
                    setRtbhPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!rtbhActive}
                />
                <ActionButton 
                  onClick={() => {
                    setRtbhActive(true);
                    // Tag ALL existing pulses to stop at the provider
                    setRtbhPulses(prev => prev.map(p => ({ ...p, clipped: true })));
                    setTimeout(() => markTabComplete(3), 3000);
                  }}
                  label="Activate RTBH"
                  icon={Ban}
                  color="red"
                  disabled={rtbhActive}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="rtbh-svg-title">
              <title id="rtbh-svg-title">BGP RTBH Mitigation Diagram</title>
              <defs>
                <clipPath id="rtbh-clip">
                  <rect x="0" y="0" width="400" height="212" />
                </clipPath>
              </defs>
              {/* Layout: Layer 1 (y=40), Layer 2 (y=120), Layer 3 (y=210), Layer 4 (y=300) */}
              
              {/* Paths from Layer 1 to Layer 2 */}
              <Path from={{x: 100, y: 40}} to={{x: 100, y: 120}} state="primary" />
              <Path from={{x: 300, y: 40}} to={{x: 100, y: 120}} state="primary" color="blue" />
              <Path from={{x: 300, y: 40}} to={{x: 300, y: 120}} state="primary" color="blue" />

              {/* Paths from Layer 2 to Layer 3 (Upstream) */}
              <Path from={{x: 100, y: 120}} to={{x: 200, y: 210}} state="primary" color="white" />
              <Path from={{x: 300, y: 120}} to={{x: 200, y: 210}} state="primary" color="white" />

              {/* Path from Layer 3 to Layer 4 (Victim) */}
              <Path from={{x: 200, y: 210}} to={{x: 200, y: 300}} state={rtbhActive ? "idle" : "primary"} color={rtbhActive ? "white" : "red"} />

              {rtbhActive && (
                <Path from={{x: 200, y: 300}} to={{x: 200, y: 210}} state="announcing" color="indigo" />
              )}

              {/* Layer 1: Clients */}
              <Node x={100} y={40} type="user" label="User" color="emerald" labelPos="top" />
              <Node x={260} y={40} type="router" color="blue" />
              <Node x={300} y={40} type="router" label="Botnet" color="blue" labelPos="top" />
              <Node x={340} y={40} type="router" color="blue" />

              {/* Layer 2: Peers */}
              <Node x={100} y={120} type="router" labelOffset={-10} />
              <Node x={300} y={120} type="router" labelOffset={25} />

              {/* Layer 3: Upstream Provider */}
              <Node x={200} y={210} type="router" label={rtbhActive ? "All Dropped" : "Upstream Provider"} color={rtbhActive ? "red" : "slate"} labelBg labelVOffset={10} />

              {/* Layer 4: Victim */}
              <Node x={200} y={300} type="router" label={rtbhActive ? "Victim" : "Victim (Down)"} color={rtbhActive ? "indigo" : "red"} labelPos="bottom" offline={!rtbhActive} />

              {rtbhActive && (
                <g>
                   <circle cx={200} cy={210} r={22} className="fill-slate-900 stroke-red-500 stroke-[3px]" />
                   <Ban x={200 - 14} y={210 - 14} size={28} className="text-red-500" />
                </g>
              )}

              {!rtbhActive && (
                <g>
                   <text x={200} y={345} textAnchor="middle" className="fill-red-500 text-[9px] font-bold uppercase animate-pulse">Service Outage</text>
                </g>
              )}

              {rtbhPulses.map(pulse => (
                <DataPulse key={pulse.id} color={pulse.color} path={pulse.path} duration={pulse.duration} clipped={(pulse as any).clipped} clipId="rtbh-clip" />
              ))}
            </svg>
          </PanelContainer>
        )}

        {activeTab === 4 && (
          <PanelContainer 
            title="5. BGP FlowSpec" 
            description="BGP FlowSpec (RFC 5575) allows a victim to distribute precise filtering rules (e.g., 'drop UDP port 53 traffic to this IP') to upstream providers to mitigate DDoS attacks. Unlike RTBH, FlowSpec only drops attack traffic while allowing legitimate users through. However, FlowSpec is less effective if attack traffic perfectly mimics production traffic, as it relies on identifiable patterns. RTBH is typically preferred when attack volumes are so massive they exceed the processing capacity of upstream hardware, or as a 'nuclear option' to protect core stability."
            onPrev={handlePrev}
            onNext={handleNext}
            isLast
            nextHighlighted={completedTabs.includes(4)}
            footer={
              <>
                <ActionButton 
                  onClick={() => {
                    setFlowspecActive(false);
                    setFlowspecPulses([]);
                  }}
                  label="Reset"
                  icon={RotateCcw}
                  color="slate"
                  disabled={!flowspecActive}
                />
                <ActionButton 
                  onClick={() => {
                    setFlowspecActive(true);
                    // Tag ALL existing RED pulses to stop at the provider
                    setFlowspecPulses(prev => prev.map(p => {
                      if (p.color === "red") {
                        return { ...p, clipped: true };
                      }
                      return p;
                    }));
                    setTimeout(() => markTabComplete(4), 3000);
                  }}
                  label="Deploy FlowSpec"
                  icon={Filter}
                  color="indigo"
                  disabled={flowspecActive}
                />
              </>
            }
          >
            <svg viewBox="0 0 400 350" className="w-full h-full" role="img" aria-labelledby="flowspec-svg-title">
              <title id="flowspec-svg-title">BGP FlowSpec Mitigation Diagram</title>
              <defs>
                <clipPath id="flowspec-clip">
                  <rect x="0" y="0" width="400" height="212" />
                </clipPath>
              </defs>
              {/* Layout: Layer 1 (y=40), Layer 2 (y=120), Layer 3 (y=210), Layer 4 (y=300) */}
              
              {/* Paths from Layer 1 to Layer 2 */}
              <Path from={{x: 100, y: 40}} to={{x: 100, y: 120}} state="primary" />
              <Path from={{x: 300, y: 40}} to={{x: 100, y: 120}} state="primary" color="blue" />
              <Path from={{x: 300, y: 40}} to={{x: 300, y: 120}} state="primary" color="blue" />

              {/* Paths from Layer 2 to Layer 3 (Upstream) */}
              <Path from={{x: 100, y: 120}} to={{x: 200, y: 210}} state="primary" color="white" />
              <Path from={{x: 300, y: 120}} to={{x: 200, y: 210}} state="primary" color="white" />

              {/* Path from Layer 3 to Layer 4 (Victim) */}
              <Path from={{x: 200, y: 210}} to={{x: 200, y: 300}} state="primary" color={flowspecActive ? "white" : "red"} />

              {flowspecActive && (
                <Path from={{x: 200, y: 300}} to={{x: 200, y: 210}} state="announcing" color="indigo" />
              )}

              {/* Layer 1: Clients */}
              <Node x={100} y={40} type="user" label="User" color="emerald" labelPos="top" />
              <Node x={260} y={40} type="router" color="blue" />
              <Node x={300} y={40} type="router" label="Botnet" color="blue" labelPos="top" />
              <Node x={340} y={40} type="router" color="blue" />

              {/* Layer 2: Peers */}
              <Node x={100} y={120} type="router" labelOffset={-10} />
              <Node x={300} y={120} type="router" labelOffset={25} />

              {/* Layer 3: Upstream Provider */}
              <Node x={200} y={210} type="router" label={flowspecActive ? "Attack Filtered" : "Upstream Provider"} color={flowspecActive ? "emerald" : "slate"} labelBg labelVOffset={10} />

              {/* Layer 4: Victim */}
              <Node x={200} y={300} type="router" label={flowspecActive ? "Victim" : "Victim (Stressed)"} color={flowspecActive ? "indigo" : "red"} labelPos="bottom" offline={!flowspecActive} />

              {flowspecActive && (
                <g>
                   <circle cx={200} cy={210} r={22} className="fill-slate-900 stroke-emerald-500 stroke-[3px]" />
                   <Filter x={200 - 14} y={210 - 14} size={28} className="text-emerald-400" />
                </g>
              )}

              {!flowspecActive && (
                <g>
                   <text x={200} y={345} textAnchor="middle" className="fill-red-500 text-[9px] font-bold uppercase animate-pulse">Critical Latency</text>
                </g>
              )}

              {flowspecPulses.map(pulse => (
                <DataPulse key={pulse.id} color={pulse.color} path={pulse.path} duration={pulse.duration} clipped={(pulse as any).clipped} clipId="flowspec-clip" />
              ))}
            </svg>
          </PanelContainer>
        )}
      </div>
    </div>
  );
};
