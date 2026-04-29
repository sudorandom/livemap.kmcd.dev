import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Router, Share2, User, ShieldAlert, ArrowRight, Ban, Activity, ShieldCheck, Globe } from 'lucide-react';

export const PanelContainer = ({ title, children, description, className = "" }: { title: string, children: React.ReactNode, description: string, className?: string }) => (
  <div className="cyber-box p-6 rounded-xl bg-slate-900/50 border border-slate-500/20 flex flex-col h-full">
    <div className="mb-4">
      <h3 className="text-lg font-cyber font-bold text-cyan-400 uppercase tracking-wider mb-1">{title}</h3>
      <p className="text-xs text-slate-400 font-medium leading-relaxed">{description}</p>
    </div>
    <div className={`flex-grow flex items-center justify-center bg-black/40 rounded-lg border border-slate-500/10 p-4 relative overflow-hidden min-h-[350px] ${className}`}>
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
  let baseColor = color === 'indigo' ? 'fill-indigo-600 stroke-indigo-400' : 
                   color === 'emerald' ? 'fill-emerald-600 stroke-emerald-400' :
                   color === 'red' ? 'fill-red-600 stroke-red-400' :
                   'fill-slate-800 stroke-slate-600';
  
  if (offline) {
    baseColor = 'fill-slate-800 stroke-red-500';
  }

  return (
    <g className="transition-opacity duration-500 opacity-100">
      <circle cx={x} cy={y} r={isRouter ? 15 : 18} className={`${baseColor} stroke-2 transition-colors duration-500`} />
      {isRouter ? (
        <Router x={x - 9} y={y - 9} size={18} className={`${offline ? 'text-red-500' : 'text-white'} pointer-events-none transition-colors duration-500`} />
      ) : (
        <User x={x - 9} y={y - 9} size={18} className="text-white pointer-events-none" />
      )}
      {label && (
        <text x={x} y={type === 'user' ? y - 25 : y + 30} textAnchor="middle" className={`fill-slate-500 text-[9px] font-bold uppercase tracking-tighter ${offline ? 'text-red-500' : ''}`}>
          {label}
        </text>
      )}
    </g>
  );
};

export const Path = ({ from, to, state, delay = 0, color, width, reverse = false }: { from: any, to: any, state: 'idle' | 'announcing' | 'withdrawing' | 'primary' | 'secondary', delay?: number, color?: string, width?: number, reverse?: boolean }) => {
  let strokeColor = 'text-slate-600';
  let dashed = false;
  let animate = false;
  let opacity = 'opacity-100';
  let actualWidth = width || 2;

  switch (state) {
    case 'idle':
      strokeColor = 'text-slate-600';
      dashed = true;
      animate = false;
      opacity = 'opacity-40';
      break;
    case 'announcing':
      strokeColor = color === 'red' ? 'text-red-500' : 'text-cyan-500';
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
      strokeColor = color === 'red' ? 'text-red-500' : 'text-cyan-500';
      dashed = false;
      animate = false;
      opacity = 'opacity-100';
      actualWidth = width || 3;
      break;
    case 'secondary':
      strokeColor = 'text-slate-500';
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
  const fillColor = isRed ? 'fill-red-500' : (isCyan ? 'fill-cyan-400' : (isPurple ? 'fill-purple-500' : 'fill-white'));
  const glowClass = isRed ? 'shadow-glow-red' : (isCyan ? 'shadow-glow-cyan' : (isPurple ? 'shadow-glow-purple' : 'shadow-glow-white'));

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

  // Track current withdrawal settings for the interval
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-16">
      <style>{`
        @keyframes dash { to { stroke-dashoffset: -20; } }
        .stroke-dash-offset-animate { animation: dash 1s linear infinite; }
        .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9)); }
        .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(0, 243, 255, 0.9)); }
        .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.9)); }
        .shadow-glow-purple { filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.9)); }

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
      
      {/* Panel 1: Announcing */}
      <PanelContainer 
        title="1. Announcing" 
        description="The Origin AS 'announces' its IP space. Routers propagate this information so that every network knows the path back to the origin."
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
               <text x={COORDS.ENTRY.x + 75} y={COORDS.ENTRY.y + 3} textAnchor="middle" className="fill-cyan-400 text-[8px] font-bold uppercase tracking-tighter">Route Learned</text>
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

      {/* Panel 2: Routing */}
      <PanelContainer 
        title="2. Routing" 
        description="Data follows the established paths. BGP selects the shortest route to reach the destination AS."
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

      {/* Panel 3: Withdrawals */}
      <PanelContainer 
        title="3. Withdrawals" 
        description="When a prefix is no longer reachable, a 'withdrawal' message is sent. If an origin AS goes dark, its upstream peers detect the lost session and propagate the withdrawal to the rest of the internet."
      >
        <svg viewBox="0 0 400 350" className="w-full h-full">
          <Path from={COORDS.USER} to={COORDS.ENTRY} state="primary" />
          
          {/* Connection is lost when withdrawn */}
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

      {/* Panel 4: Asymmetric Routing */}
      <PanelContainer 
        title="4. Asymmetric Routing" 
        description="In BGP, the path taken to reach a destination may differ from the path taken for return traffic. This is normal but can complicate troubleshooting."
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

      {/* Panel 5: Multipath (ECMP) */}
      <PanelContainer 
        title="5. Multipath (ECMP)" 
        description="Equal-Cost Multi-Path (ECMP) allows a router to distribute traffic across multiple best-paths simultaneously for better load balancing."
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

      {/* Panel 6: Anycast */}
      <PanelContainer 
        title="6. Anycast Routing" 
        description="Multiple servers announce the exact same IP address. BGP naturally routes user traffic to the topologically closest destination, enabling global CDNs and root DNS."
      >
        <svg viewBox="0 0 400 350" className="w-full h-full">
          {/* Transit Link */}
          <path 
            d={`M100,150 L300,150`} 
            stroke="currentColor" 
            fill="none" 
            strokeWidth="2"
            strokeDasharray="5,5"
            className="text-slate-700 opacity-30"
          />
          <text x="200" y="140" textAnchor="middle" className="fill-slate-600 text-[7px] uppercase font-bold tracking-widest">Global Transit (Longer Path)</text>

          {/* Local Paths */}
          <Path from={{x: 100, y: 150}} to={{x: 100, y: 270}} state="primary" />
          <Path from={{x: 300, y: 150}} to={{x: 300, y: 270}} state="primary" />

          {/* User Connections */}
          <path d="M100,50 L100,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-cyan-500" />
          <path d="M300,50 L300,150" stroke="currentColor" fill="none" strokeWidth="3" className="text-cyan-500" />

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
          <h4 className="text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Activity size={16} /> Path & Scalability
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc4456" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">Route Reflection (RFC 4456)</a>
              <p className="opacity-80 italic mt-1 text-xs">Eliminates the need for a full iBGP mesh by using reflectors to propagate internal routes.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7911" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGP ADD-PATH (RFC 7911)</a>
              <p className="opacity-80 italic mt-1 text-xs">Allows advertising multiple paths for the same prefix to enable better ECMP and faster convergence.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/draft-ietf-rtgwg-bgp-pic" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGP PIC</a>
              <p className="opacity-80 italic mt-1 text-xs">Prefix Independent Convergence allows millisecond failover by using pre-calculated backup paths.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc5065" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">Confederations (RFC 5065)</a>
              <p className="opacity-80 italic mt-1 text-xs">Dividing a large AS into smaller sub-ASs to simplify management and reduce peering overhead.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4 border-b border-slate-500/10 pb-4 md:border-b-0">
          <h4 className="text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <ShieldCheck size={16} /> Security & Integrity
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc8205" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGPsec (RFC 8205)</a>
              <p className="opacity-80 italic mt-1 text-xs">Full path signing. Rarely deployed due to high CPU load; RPKI is the preferred modern alternative.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7454" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGP OPSEC (RFC 7454)</a>
              <p className="opacity-80 italic mt-1 text-xs">Best practices for securing BGP sessions including TTL security and prefix filtering.</p>
            </li>
            <li>
              <a href="https://blog.cloudflare.com/rpki/" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">RPKI Validation</a>
              <p className="opacity-80 italic mt-1 text-xs">Cryptographic verification that an AS is authorized to originate specific IP prefixes.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4 border-b border-slate-500/10 pb-4 md:border-b-0">
          <h4 className="text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Activity size={16} /> Traffic Engineering & Resiliency
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc5575" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGP FlowSpec (RFC 5575)</a>
              <p className="opacity-80 italic mt-1 text-xs">Propagating firewall-like traffic filtering rules across AS boundaries for DDoS mitigation.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc8402" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">Segment Routing (SR)</a>
              <p className="opacity-80 italic mt-1 text-xs">Steering traffic using source-routing instructions, often distributed via BGP (SR-TE).</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc4724" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">Graceful Restart (RFC 4724)</a>
              <p className="opacity-80 italic mt-1 text-xs">Mechanism to maintain packet forwarding during a BGP control-plane restart.</p>
            </li>
          </ul>
        </div>

        <div className="space-y-4">
          <h4 className="text-cyan-400 text-sm font-bold uppercase tracking-tight mb-1 flex items-center gap-2">
            <Globe size={16} /> Modern Overlays
          </h4>
          <ul className="space-y-3 text-sm text-slate-400">
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7432" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">EVPN (RFC 7432)</a>
              <p className="opacity-80 italic mt-1 text-xs">The industry standard control plane for modern Layer 2 and Layer 3 virtualization.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7752" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BGP Link-State (RFC 7752)</a>
              <p className="opacity-80 italic mt-1 text-xs">Exporting IGP topology information to controllers for centralized traffic engineering.</p>
            </li>
            <li>
              <a href="https://datatracker.ietf.org/doc/html/rfc7854" target="_blank" className="text-cyan-500 hover:text-cyan-300 underline decoration-dotted font-bold">BMP Monitoring (RFC 7854)</a>
              <p className="opacity-80 italic mt-1 text-xs">A protocol to monitor BGP sessions and peer information without impacting forwarding.</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </PanelContainer>
);

export const BGPSecurityExplainer = () => {
  const [hijacked, setHijacked] = useState(false);
  const [filtered, setFiltered] = useState(false);
  
  const [hijackPulses, setHijackPulses] = useState<{id: number, path: string, color: string}[]>([]);
  const [filterPulses, setFilteredPulses] = useState<{id: number, path: string, color: string}[]>([]);

  const fullPathR = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ORIGIN.x},${COORDS.ORIGIN.y} L${COORDS.MID_R.x},${COORDS.MID_R.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);
  const hijackPath = useMemo(() => `M${COORDS.USER.x},${COORDS.USER.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.MALICIOUS.x},${COORDS.MALICIOUS.y} L${COORDS.MID_L.x},${COORDS.MID_L.y} L${COORDS.ENTRY.x},${COORDS.ENTRY.y} L${COORDS.USER.x},${COORDS.USER.y}`, []);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12 pt-12 border-t border-slate-500/10">
      <style>{`
        .shadow-glow-white { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9)); }
        .shadow-glow-cyan { filter: drop-shadow(0 0 6px rgba(0, 243, 255, 0.9)); }
        .shadow-glow-red { filter: drop-shadow(0 0 6px rgba(255, 0, 0, 0.9)); }
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

      {/* Security Panel 1: Route Hijack */}
      <PanelContainer 
        title="1. Route Hijack" 
        description="A hijacker announces a more specific or attractive path to the legitimate Destination, stealing internet traffic."
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

      {/* Security Panel 2: RPKI Filtering */}
      <PanelContainer 
        title="2. RPKI Route Filtering" 
        description="ISPs use RPKI to mathematically prove Route Hijacks are invalid. The malicious path is dropped at the border, protecting the user."
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
              <text x={COORDS.MID_L.x} y={COORDS.MID_L.y - 30} textAnchor="middle" className="fill-emerald-400 text-[10px] font-bold uppercase">Dropped</text>
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

    </div>
  );
};
