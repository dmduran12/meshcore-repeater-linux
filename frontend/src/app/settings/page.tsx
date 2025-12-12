'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/stores/useStore';
import { Settings, Radio, Gauge, Antenna, MapPin, Save, Check, AlertCircle } from 'lucide-react';
import { formatFrequency, formatBandwidth } from '@/lib/format';
import { HashBadge } from '@/components/ui/HashBadge';
import { getRadioPresets, updateRadioConfig, RadioPreset } from '@/lib/api';
import clsx from 'clsx';

// MeshCore standard values
const BANDWIDTHS = [
  { value: 62.5, label: '62.5 kHz' },
  { value: 125, label: '125 kHz' },
  { value: 250, label: '250 kHz' },
  { value: 500, label: '500 kHz' },
];

const SPREADING_FACTORS = [7, 8, 9, 10, 11, 12];
const CODING_RATES = [
  { value: 5, label: '4/5' },
  { value: 6, label: '4/6' },
  { value: 7, label: '4/7' },
  { value: 8, label: '4/8' },
];

export default function SettingsPage() {
  const { stats, setMode, setDutyCycle, fetchStats } = useStore();

  const radioConfig = stats?.config?.radio;
  const repeaterConfig = stats?.config?.repeater;
  const dutyCycleConfig = stats?.config?.duty_cycle;

  // Match homepage node name resolution
  const nodeName = stats?.node_name || stats?.config?.node_name || 'Unknown Node';

  // Read current values from config (where backend stores them)
  const currentMode = repeaterConfig?.mode ?? 'forward';
  const dutyCycleEnabled = dutyCycleConfig?.enforcement_enabled ?? false;

  // Radio config form state
  const [presets, setPresets] = useState<RadioPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [formFrequency, setFormFrequency] = useState<string>('');
  const [formBandwidth, setFormBandwidth] = useState<number>(62.5);
  const [formSF, setFormSF] = useState<number>(7);
  const [formCR, setFormCR] = useState<number>(5);
  const [formTxPower, setFormTxPower] = useState<string>('');
  const [formNodeName, setFormNodeName] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load presets on mount
  useEffect(() => {
    getRadioPresets().then((res) => {
      if (res.success && res.data) {
        setPresets(res.data);
      }
    }).catch(console.error);
  }, []);

  // Initialize form from current config
  useEffect(() => {
    if (radioConfig) {
      setFormFrequency((radioConfig.frequency / 1_000_000).toFixed(3));
      setFormBandwidth(radioConfig.bandwidth / 1000);
      setFormSF(radioConfig.spreading_factor);
      setFormCR(radioConfig.coding_rate);
      setFormTxPower(String(radioConfig.tx_power));
    }
    if (stats?.config?.node_name) {
      setFormNodeName(stats.config.node_name);
    }
  }, [radioConfig, repeaterConfig]);

  // Handle preset selection
  const handlePresetChange = (presetTitle: string) => {
    setSelectedPreset(presetTitle);
    const preset = presets.find(p => p.title === presetTitle);
    if (preset) {
      setFormFrequency(preset.frequency);
      setFormBandwidth(parseFloat(preset.bandwidth));
      setFormSF(parseInt(preset.spreading_factor));
      setFormCR(parseInt(preset.coding_rate));
    }
  };

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);

    try {
      const config: Record<string, number | string> = {};
      
      // Only include changed values
      const newFreqMhz = parseFloat(formFrequency);
      const currentFreqMhz = radioConfig ? radioConfig.frequency / 1_000_000 : 0;
      if (Math.abs(newFreqMhz - currentFreqMhz) > 0.0001) {
        config.frequency_mhz = newFreqMhz;
      }

      const currentBwKhz = radioConfig ? radioConfig.bandwidth / 1000 : 0;
      if (formBandwidth !== currentBwKhz) {
        config.bandwidth_khz = formBandwidth;
      }

      if (formSF !== radioConfig?.spreading_factor) {
        config.spreading_factor = formSF;
      }

      if (formCR !== radioConfig?.coding_rate) {
        config.coding_rate = formCR;
      }

      const newTxPower = parseInt(formTxPower);
      if (newTxPower !== radioConfig?.tx_power) {
        config.tx_power = newTxPower;
      }

      if (formNodeName !== stats?.config?.node_name) {
        config.node_name = formNodeName;
      }

      if (Object.keys(config).length === 0) {
        setSaveResult({ success: true, message: 'No changes to save' });
        setIsSaving(false);
        return;
      }

      const result = await updateRadioConfig(config);
      
      if (result.success && result.data) {
        const applied = result.data.applied.join(', ');
        const liveNote = result.data.live_update ? ' (applied live)' : ' (restart required)';
        setSaveResult({ 
          success: true, 
          message: `Updated: ${applied}${liveNote}` 
        });
        // Refresh stats to show new values
        fetchStats();
      } else {
        setSaveResult({ success: false, message: result.error || 'Failed to save' });
      }
    } catch (err) {
      setSaveResult({ success: false, message: String(err) });
    } finally {
      setIsSaving(false);
      // Clear result after 5 seconds
      setTimeout(() => setSaveResult(null), 5000);
    }
  };

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

        {/* Radio Configuration - Full width for form */}
        <div className="col-span-full glass-card card-padding">
          <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <Antenna className="w-5 h-5 text-accent-primary" />
            Radio Configuration
          </h2>
          <p className="text-sm text-text-muted mb-4">
            Adjust radio parameters. Changes are applied live without restart.
          </p>
          
          {radioConfig ? (
            <div className="space-y-4">
              {/* Preset Selector */}
              <div>
                <label className="text-sm text-text-muted block mb-1">Community Preset</label>
                <select
                  value=""
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                >
                  <option value="">-- Select a preset --</option>
                  {presets.map((preset) => (
                    <option key={preset.title} value={preset.title}>
                      {preset.title} ({preset.frequency} MHz, SF{preset.spreading_factor})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* Node Name */}
                <div className="col-span-2 md:col-span-3">
                  <label className="text-sm text-text-muted block mb-1">Node Name</label>
                  <input
                    type="text"
                    value={formNodeName}
                    onChange={(e) => setFormNodeName(e.target.value)}
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                    placeholder="Repeater node name"
                  />
                </div>

                {/* Frequency */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">Frequency (MHz)</label>
                  <input
                    type="number"
                    value={formFrequency}
                    onChange={(e) => setFormFrequency(e.target.value)}
                    step="0.001"
                    min="400"
                    max="930"
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                </div>

                {/* Bandwidth */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">Bandwidth</label>
                  <select
                    value={formBandwidth}
                    onChange={(e) => setFormBandwidth(parseFloat(e.target.value))}
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  >
                    {BANDWIDTHS.map((bw) => (
                      <option key={bw.value} value={bw.value}>
                        {bw.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Spreading Factor */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">Spreading Factor</label>
                  <select
                    value={formSF}
                    onChange={(e) => setFormSF(parseInt(e.target.value))}
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  >
                    {SPREADING_FACTORS.map((sf) => (
                      <option key={sf} value={sf}>
                        SF{sf}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Coding Rate */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">Coding Rate</label>
                  <select
                    value={formCR}
                    onChange={(e) => setFormCR(parseInt(e.target.value))}
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  >
                    {CODING_RATES.map((cr) => (
                      <option key={cr.value} value={cr.value}>
                        {cr.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* TX Power */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">TX Power (dBm)</label>
                  <input
                    type="number"
                    value={formTxPower}
                    onChange={(e) => setFormTxPower(e.target.value)}
                    min="-9"
                    max="22"
                    className="w-full bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                </div>

                {/* Preamble Length (read-only info) */}
                <div>
                  <label className="text-sm text-text-muted block mb-1">Preamble</label>
                  <p className="text-text-primary font-medium py-2">
                    {radioConfig.preamble_length} symbols
                  </p>
                </div>
              </div>

              {/* Save Button & Status */}
              <div className="flex items-center gap-4 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className={clsx(
                    'px-6 py-2 rounded-lg font-medium transition-all duration-200',
                    isSaving
                      ? 'bg-bg-subtle text-text-muted cursor-not-allowed'
                      : 'bg-accent-primary text-white hover:bg-accent-primary/90'
                  )}
                >
                  {isSaving ? 'Saving...' : 'Apply Changes'}
                </button>
                {saveResult && (
                  <span className={clsx(
                    'text-sm',
                    saveResult.success ? 'text-accent-success' : 'text-accent-error'
                  )}>
                    {saveResult.message}
                  </span>
                )}
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
