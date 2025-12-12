'use client';

import { useStore } from '@/lib/stores/useStore';
import { Settings, Radio, Gauge, Antenna, MapPin } from 'lucide-react';
import { formatFrequency, formatBandwidth } from '@/lib/format';
import { HashBadge } from '@/components/ui/HashBadge';
import clsx from 'clsx';

export default function SettingsPage() {
  const { stats, setMode, setDutyCycle } = useStore();

  const radioConfig = stats?.config?.radio;
  const repeaterConfig = stats?.config?.repeater;
  const dutyCycleConfig = stats?.config?.duty_cycle;

  // Match homepage node name resolution
  const nodeName = stats?.node_name || stats?.config?.node_name || 'Unknown Node';

  // Read current values from config (where backend stores them)
  const currentMode = repeaterConfig?.mode ?? 'forward';
  const dutyCycleEnabled = dutyCycleConfig?.enforcement_enabled ?? false;

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex items-center">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <Settings className="w-6 h-6 text-accent-primary flex-shrink-0" />
          Settings
        </h1>
      </div>

      <div className="grid-12">
        {/* Operating Mode - 12 cols mobile, 6 cols md */}
        <div className="col-span-full md:col-span-6 glass-card card-padding">
          <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <Radio className="w-5 h-5 text-accent-primary" />
            Operating Mode
          </h2>
          <p className="text-sm text-text-muted mb-4">
            Control how the repeater handles incoming packets.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setMode('forward')}
              className={clsx(
                'w-full p-4 rounded-lg border text-left transition-all duration-200',
                currentMode === 'forward'
                  ? 'bg-accent-success/20 border-accent-success/50 text-accent-success'
                  : 'bg-bg-subtle border-border-subtle text-text-secondary hover:bg-bg-elevated'
              )}
            >
              <div className="font-medium">Forward Mode</div>
              <div className="text-sm opacity-70 mt-1">
                Receive packets and retransmit them to extend network coverage
              </div>
            </button>
            <button
              onClick={() => setMode('monitor')}
              className={clsx(
                'w-full p-4 rounded-lg border text-left transition-all duration-200',
                currentMode === 'monitor'
                  ? 'bg-accent-secondary/20 border-accent-secondary/50 text-accent-secondary'
                  : 'bg-bg-subtle border-border-subtle text-text-secondary hover:bg-bg-elevated'
              )}
            >
              <div className="font-medium">Monitor Mode</div>
              <div className="text-sm opacity-70 mt-1">
                Receive and log packets without retransmitting
              </div>
            </button>
          </div>
        </div>

        {/* Duty Cycle - 12 cols mobile, 6 cols md */}
        <div className="col-span-full md:col-span-6 glass-card card-padding">
          <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-accent-primary" />
            Duty Cycle Enforcement
          </h2>
          <p className="text-sm text-text-muted mb-4">
            Limit airtime to comply with regulations.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setDutyCycle(true)}
              className={clsx(
                'w-full p-4 rounded-lg border text-left transition-all duration-200',
                dutyCycleEnabled
                  ? 'bg-accent-success/20 border-accent-success/50 text-accent-success'
                  : 'bg-bg-subtle border-border-subtle text-text-secondary hover:bg-bg-elevated'
              )}
            >
              <div className="font-medium">Enabled</div>
              <div className="text-sm opacity-70 mt-1">
                Enforce airtime limits to comply with regional regulations
              </div>
            </button>
            <button
              onClick={() => setDutyCycle(false)}
              className={clsx(
                'w-full p-4 rounded-lg border text-left transition-all duration-200',
                !dutyCycleEnabled
                  ? 'bg-accent-secondary/20 border-accent-secondary/50 text-accent-secondary'
                  : 'bg-bg-subtle border-border-subtle text-text-secondary hover:bg-bg-elevated'
              )}
            >
              <div className="font-medium">Disabled</div>
              <div className="text-sm opacity-70 mt-1">
                No airtime limiting (use with caution)
              </div>
            </button>
          </div>
        </div>

        {/* Radio Configuration - 12 cols mobile, 6 cols md */}
        <div className="col-span-full md:col-span-6 glass-card card-padding">
          <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <Antenna className="w-5 h-5 text-accent-primary" />
            Radio Configuration
          </h2>
          {radioConfig ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-text-muted">Frequency</label>
                <p className="text-text-primary font-medium mt-1">
                  {formatFrequency(radioConfig.frequency)}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">TX Power</label>
                <p className="text-text-primary font-medium mt-1">
                  {radioConfig.tx_power} dBm
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Bandwidth</label>
                <p className="text-text-primary font-medium mt-1">
                  {formatBandwidth(radioConfig.bandwidth)}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Spreading Factor</label>
                <p className="text-text-primary font-medium mt-1">
                  SF{radioConfig.spreading_factor}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Coding Rate</label>
                <p className="text-text-primary font-medium mt-1">
                  4/{radioConfig.coding_rate}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Preamble Length</label>
                <p className="text-text-primary font-medium mt-1">
                  {radioConfig.preamble_length} symbols
                </p>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">Loading radio configuration...</p>
          )}
        </div>

        {/* Location - 12 cols mobile, 6 cols md */}
        <div className="col-span-full md:col-span-6 glass-card card-padding">
          <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-accent-primary" />
            Location
          </h2>
          {repeaterConfig ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-text-muted">Latitude</label>
                <p className="text-text-primary font-medium mt-1">
                  {repeaterConfig.latitude !== 0 ? repeaterConfig.latitude.toFixed(6) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Longitude</label>
                <p className="text-text-primary font-medium mt-1">
                  {repeaterConfig.longitude !== 0 ? repeaterConfig.longitude.toFixed(6) : 'Not set'}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Advert Interval</label>
                <p className="text-text-primary font-medium mt-1">
                  {repeaterConfig.send_advert_interval_hours > 0 
                    ? `${repeaterConfig.send_advert_interval_hours}h` 
                    : 'Disabled'}
                </p>
              </div>
              <div>
                <label className="text-sm text-text-muted">Score-based TX</label>
                <p className="text-text-primary font-medium mt-1">
                  {repeaterConfig.use_score_for_tx ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">Loading location settings...</p>
          )}
        </div>

        {/* Node Information - full width (copied from homepage) */}
        <div className="col-span-full glass-card card-padding">
          <h2 className="type-subheading text-text-primary mb-4 flex items-center gap-2">
            <Radio className="w-5 h-5 text-accent-primary" />
            Node Information
          </h2>
          {stats ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <span className="type-label text-text-muted">Node Name</span>
                  <p className="type-body text-text-primary mt-1">{nodeName}</p>
                </div>
                <div>
                  <span className="type-label text-text-muted">Version</span>
                  <p className="type-data text-text-primary mt-1">v{stats.version}</p>
                </div>
                <div>
                  <span className="type-label text-text-muted">Core Version</span>
                  <p className="type-data text-text-primary mt-1">v{stats.core_version}</p>
                </div>
                <div>
                  <span className="type-label text-text-muted">Local Hash</span>
                  <div className="mt-1">
                    {stats.local_hash ? (
                      <HashBadge hash={stats.local_hash} size="sm" />
                    ) : (
                      <span className="type-data-sm text-text-muted">N/A</span>
                    )}
                  </div>
                </div>
              </div>
              {stats.public_key && (
                <div className="mt-4 pt-4 border-t border-border-subtle">
                  <span className="type-label text-text-muted">Public Key</span>
                  <div className="mt-1">
                    <HashBadge hash={stats.public_key} prefixLength={12} suffixLength={8} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-text-muted">Loading node information...</p>
          )}
        </div>
      </div>
    </div>
  );
}
