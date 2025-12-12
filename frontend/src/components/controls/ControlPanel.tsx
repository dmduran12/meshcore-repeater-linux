'use client';

import { useState, useEffect } from 'react';
import { useStore, useFlashAdvert } from '@/lib/stores/useStore';
import { 
  Settings, 
  Send, 
  Play, 
  Pause, 
  Gauge,
  Radio
} from 'lucide-react';
import clsx from 'clsx';

export function ControlPanel() {
  const { stats, setMode, setDutyCycle, sendAdvert, liveMode, setLiveMode } = useStore();
  const flashAdvert = useFlashAdvert();
  const [sending, setSending] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);

  const handleSendAdvert = async () => {
    setSending(true);
    await sendAdvert();
    setTimeout(() => setSending(false), 1000);
  };
  
  // Flash effect when advert is sent (confirmed by backend)
  useEffect(() => {
    if (flashAdvert > 0) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      const raf = requestAnimationFrame(() => setIsFlashing(true));
      const timer = setTimeout(() => setIsFlashing(false), 600);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [flashAdvert]);

  const currentMode = stats?.config?.repeater?.mode ?? 'forward';
  const dutyCycleEnabled = stats?.config?.duty_cycle?.enforcement_enabled ?? false;

  const handleModeToggle = () => {
    if (stats) {
      setMode(currentMode === 'forward' ? 'monitor' : 'forward');
    }
  };

  const handleDutyCycleToggle = () => {
    if (stats) {
      setDutyCycle(!dutyCycleEnabled);
    }
  };

  return (
    <div className="chart-container h-full">
      <div className="chart-header">
        <div className="chart-title">
          <Settings className="chart-title-icon" />
          Controls
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Send Advert - Primary action */}
        <button
          onClick={handleSendAdvert}
          disabled={sending}
          className={clsx(
            'btn-skeuo btn-skeuo-primary w-full relative overflow-hidden',
            sending && 'opacity-60'
          )}
        >
          {isFlashing && <div className="flash-overlay" />}
          <Send className={clsx('btn-skeuo-icon', sending && 'animate-pulse')} />
          {sending ? 'Sending...' : 'Send Advertisement'}
        </button>

        {/* Mode Toggle */}
        <div className="control-card">
          <div className="control-card-header">
            <span className="control-card-label">Operating Mode</span>
            <span className={clsx(
              'control-card-value',
              currentMode === 'forward' ? 'control-card-value-active' : 'control-card-value-inactive'
            )}>
              {currentMode}
            </span>
          </div>
          <button
            onClick={handleModeToggle}
            className={clsx(
              'btn-skeuo w-full',
              currentMode === 'forward' ? 'btn-skeuo-success' : 'btn-skeuo-warning'
            )}
          >
            {currentMode === 'forward' ? (
              <>
                <Play className="btn-skeuo-icon" />
                Forwarding Active
              </>
            ) : (
              <>
                <Pause className="btn-skeuo-icon" />
                Monitor Only
              </>
            )}
          </button>
        </div>

        {/* Duty Cycle Toggle */}
        <div className="control-card">
          <div className="control-card-header">
            <span className="control-card-label">Duty Cycle</span>
            <span className={clsx(
              'control-card-value',
              dutyCycleEnabled ? 'control-card-value-active' : 'control-card-value-inactive'
            )}>
              {dutyCycleEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <button
            onClick={handleDutyCycleToggle}
            className={clsx(
              'btn-skeuo w-full',
              dutyCycleEnabled ? 'btn-skeuo-success' : 'btn-skeuo-neutral'
            )}
          >
            <Gauge className="btn-skeuo-icon" />
            {dutyCycleEnabled ? 'Duty Cycle On' : 'Duty Cycle Off'}
          </button>
        </div>

        {/* Live Mode Toggle */}
        <div className="control-card">
          <div className="control-card-header">
            <span className="control-card-label">Live Updates</span>
            <span className={clsx(
              'control-card-value',
              liveMode ? 'control-card-value-active' : 'control-card-value-inactive'
            )}>
              {liveMode ? 'Active' : 'Paused'}
            </span>
          </div>
          <button
            onClick={() => setLiveMode(!liveMode)}
            className={clsx(
              'btn-skeuo w-full',
              liveMode ? 'btn-skeuo-success' : 'btn-skeuo-neutral'
            )}
          >
            <Radio className="btn-skeuo-icon" />
            {liveMode ? 'Live Mode On' : 'Live Mode Off'}
          </button>
        </div>
      </div>
    </div>
  );
}
