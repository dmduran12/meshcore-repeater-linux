'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Radio, 
  Settings, 
  FileText,
  Wifi,
  Users,
  BarChart3,
  Cpu,
  Gauge,
  Clock,
  Menu,
  X,
  Send,
  Play,
  Pause,
  ChevronDown,
  Sliders
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/lib/stores/useStore';
import { usePolling } from '@/lib/hooks/usePolling';
import { formatUptime } from '@/lib/format';
import { POLLING_INTERVALS } from '@/lib/constants';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Packets', href: '/packets', icon: Radio },
  { name: 'Neighbors', href: '/neighbors', icon: Users },
  { name: 'Statistics', href: '/statistics', icon: BarChart3 },
  { name: 'System', href: '/system', icon: Cpu },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { stats, fetchStats, setMode, setDutyCycle, sendAdvert } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [sending, setSending] = useState(false);

  usePolling(fetchStats, POLLING_INTERVALS.stats);

  // Close drawer on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const noiseFloor = stats?.noise_floor_dbm;
  const dutyCycleUsed = stats?.duty_cycle_percent ?? 0;
  const dutyCycleMax = stats?.config?.duty_cycle?.max_airtime_percent ?? 10;

  // Read mode and duty cycle from config (where backend stores them)
  const currentMode = stats?.config?.repeater?.mode ?? 'forward';
  const dutyCycleEnabled = stats?.config?.duty_cycle?.enforcement_enabled ?? false;

  // Control handlers
  const handleSendAdvert = async () => {
    setSending(true);
    await sendAdvert();
    setTimeout(() => setSending(false), 1000);
  };

  const handleModeToggle = () => {
    const newMode = currentMode === 'forward' ? 'monitor' : 'forward';
    setMode(newMode);
  };

  const handleDutyCycleToggle = () => {
    setDutyCycle(!dutyCycleEnabled);
  };

  // Navigation items
  const NavItems = () => (
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {navigation.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={() => setIsOpen(false)}
            className={clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150',
              isActive
                ? 'bg-accent-primary/15 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'
            )}
          >
            <item.icon className={clsx('w-5 h-5 flex-shrink-0', isActive && 'text-accent-primary')} />
            <span className="type-body-sm font-medium">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );

  // Skeuomorphic Control Panel
  const ControlPanel = ({ compact = false }: { compact?: boolean }) => (
    <div className="px-3 py-3">
      {/* Panel Header - collapsible */}
      <button
        onClick={() => setControlsExpanded(!controlsExpanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 mb-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-accent-primary" />
          <span className="type-data-xs text-text-muted uppercase tracking-wide">Controls</span>
        </div>
        <ChevronDown className={clsx(
          'w-4 h-4 text-text-muted transition-transform duration-200',
          controlsExpanded ? 'rotate-0' : '-rotate-90'
        )} />
      </button>

      {/* Control Panel Body - Skeuomorphic */}
      <div className={clsx(
        'overflow-hidden transition-all duration-300 ease-out',
        controlsExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
      )}>
        <div className="control-panel-skeuo">
          {/* Send Advert Button */}
          <button
            onClick={handleSendAdvert}
            disabled={sending}
            className={clsx(
              'control-btn control-btn-primary w-full',
              sending && 'opacity-70'
            )}
          >
            <Send className={clsx('w-4 h-4', sending && 'animate-pulse')} />
            <span>{sending ? 'Sending...' : 'Send Advert'}</span>
          </button>

          {/* Mode Toggle */}
          <div className="control-toggle-group">
            <div className="control-toggle-label">
              <span>Mode</span>
              <span className={clsx(
                'control-toggle-status',
                currentMode === 'forward' ? 'text-accent-success' : 'text-accent-secondary'
              )}>
                {currentMode === 'forward' ? 'FWD' : 'MON'}
              </span>
            </div>
            <button
              onClick={handleModeToggle}
              className={clsx(
                'control-btn w-full',
                currentMode === 'forward' ? 'control-btn-success' : 'control-btn-warning'
              )}
            >
              {currentMode === 'forward' ? (
                <><Play className="w-4 h-4" /><span>Forward</span></>
              ) : (
                <><Pause className="w-4 h-4" /><span>Monitor</span></>
              )}
            </button>
          </div>

          {/* Duty Cycle Toggle */}
          <div className="control-toggle-group">
            <div className="control-toggle-label">
              <span>Duty Cycle</span>
              <span className={clsx(
                'control-toggle-status',
                dutyCycleEnabled ? 'text-accent-success' : 'text-text-muted'
              )}>
                {dutyCycleEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
            <button
              onClick={handleDutyCycleToggle}
              className={clsx(
                'control-btn w-full',
                dutyCycleEnabled ? 'control-btn-success' : 'control-btn-neutral'
              )}
            >
              <Gauge className="w-4 h-4" />
              <span>{dutyCycleEnabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Status panel (bottom of sidebar)
  const StatusPanel = () => (
    <div className="mt-auto border-t border-white/5">
      {/* Live status & version */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-success" />
          </span>
          <span className="type-data-xs text-text-muted uppercase tracking-wide">Live</span>
        </div>
        {stats?.version && (
          <span className="type-data-xs text-text-muted">v{stats.version}</span>
        )}
      </div>

      {/* Uptime */}
      {stats?.uptime_seconds !== undefined && (
        <div className="px-4 pb-3 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-text-muted" />
          <span className="type-data-xs text-text-secondary tabular-nums">
            {formatUptime(stats.uptime_seconds)} uptime
          </span>
        </div>
      )}

      {/* RF Noise Floor */}
      <div className="px-3 pb-3">
        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-accent-primary" />
              <span className="type-data-xs text-text-muted">Noise Floor</span>
            </div>
            <span className="type-data text-text-primary tabular-nums">
              {noiseFloor !== null && noiseFloor !== undefined ? `${noiseFloor.toFixed(0)} dBm` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Duty Cycle Display */}
      <div className="px-3 pb-4">
        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-accent-secondary" />
              <span className="type-data-xs text-text-muted">Airtime</span>
            </div>
            <span className="type-data-xs text-text-primary tabular-nums">
              {dutyCycleUsed.toFixed(1)}%
            </span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent-secondary rounded-full transition-all duration-500"
              style={{ width: `${Math.min((dutyCycleUsed / dutyCycleMax) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          MOBILE/TABLET: Fixed header bar with hamburger
          Visible below lg (< 1024px)
          ═══════════════════════════════════════════════════════════════════ */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-50 h-14 bg-bg-body/70 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between h-full px-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center">
              <Wifi className="w-4.5 h-4.5 text-accent-primary" />
            </div>
            <span className="type-body-sm font-semibold text-text-primary">pyMC Repeater</span>
          </div>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
            aria-label={isOpen ? 'Close menu' : 'Open menu'}
          >
            {isOpen ? (
              <X className="w-5 h-5 text-text-primary" />
            ) : (
              <Menu className="w-5 h-5 text-text-primary" />
            )}
          </button>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════
          MOBILE/TABLET: Slide-out drawer
          ═══════════════════════════════════════════════════════════════════ */}
      
      {/* Backdrop */}
      <div
        className={clsx(
          'lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={clsx(
          'lg:hidden fixed top-0 left-0 z-50 w-72 max-w-[85vw] h-full',
          'bg-bg-surface/80 backdrop-blur-2xl border-r border-white/10',
          'flex flex-col',
          'transform transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl bg-accent-primary/20 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-accent-primary" />
          </div>
          <div>
            <h1 className="type-body-sm font-semibold text-text-primary">pyMC Repeater</h1>
            <p className="type-data-xs text-text-muted">LoRa Mesh Dashboard</p>
          </div>
        </div>

        <NavItems />
        <ControlPanel compact />
        <StatusPanel />
      </aside>

      {/* ═══════════════════════════════════════════════════════════════════
          DESKTOP: Static sidebar in document flow
          Visible at lg+ (≥ 1024px)
          ═══════════════════════════════════════════════════════════════════ */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 h-screen sticky top-0 bg-bg-surface/70 backdrop-blur-2xl border-r border-white/10">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-6 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl bg-accent-primary/15 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-accent-primary" />
          </div>
          <div>
            <h1 className="type-body font-semibold text-text-primary">pyMC Repeater</h1>
            <p className="type-data-xs text-text-muted">LoRa Mesh Dashboard</p>
          </div>
        </div>

        <NavItems />
        <ControlPanel />
        <StatusPanel />
      </aside>
    </>
  );
}
