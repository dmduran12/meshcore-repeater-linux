'use client';

import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';

const BACKGROUNDS = [
  { id: 'default', src: '/images/bg.jpg', theme: null },
  { id: 'amber', src: '/images/bg-amber.jpg', theme: 'amber' },
  { id: 'grey', src: '/images/bg-grey.jpg', theme: 'grey' },
  { id: 'black', src: '/images/bg-black.jpg', theme: 'black' },
  { id: 'flora', src: '/images/bg-flora.jpg', theme: 'flora' },
] as const;

type BackgroundId = typeof BACKGROUNDS[number]['id'];

const STORAGE_KEY = 'pymc-background';
const BRIGHTNESS_KEY = 'pymc-bg-brightness';

/**
 * Background selector with square thumbnail chips
 * Visual-only selection (no text labels)
 */
export function BackgroundSelector() {
  const [selected, setSelected] = useState<BackgroundId>('default');
const [brightness, setBrightness] = useState(80); // 0-100, default 80%
  const [showSlider, setShowSlider] = useState(false);
  const [mounted, setMounted] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Load preference from localStorage on mount
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY) as BackgroundId | null;
    const storedBrightness = localStorage.getItem(BRIGHTNESS_KEY);
    
    if (storedBrightness) {
      const val = parseInt(storedBrightness, 10);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        setBrightness(val);
      }
    }
    
    if (stored && BACKGROUNDS.some(bg => bg.id === stored)) {
      setSelected(stored);
      // Apply theme on initial load
      const bg = BACKGROUNDS.find(b => b.id === stored);
      if (bg?.theme) {
        document.documentElement.setAttribute('data-theme', bg.theme);
      }
    }
  }, []);

  // Apply background and theme change
  const handleSelect = (id: BackgroundId) => {
    setSelected(id);
    localStorage.setItem(STORAGE_KEY, id);
    
    // Apply theme to document
    const bg = BACKGROUNDS.find(b => b.id === id);
    if (bg?.theme) {
      document.documentElement.setAttribute('data-theme', bg.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    
    // Dispatch custom event so layout can update background image
    window.dispatchEvent(new CustomEvent('background-change', { detail: id }));
  };

  // Handle brightness change
  const handleBrightnessChange = (value: number) => {
    setBrightness(value);
    localStorage.setItem(BRIGHTNESS_KEY, String(value));
    window.dispatchEvent(new CustomEvent('brightness-change', { detail: value }));
  };

  // Handle slider drag
  const handleSliderInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (!sliderRef.current) return;
    
    const rect = sliderRef.current.getBoundingClientRect();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const y = clientY - rect.top;
    const height = rect.height;
    // Invert: top = 100 (bright), bottom = 0 (dark)
    const value = Math.round(Math.max(0, Math.min(100, (1 - y / height) * 100)));
    handleBrightnessChange(value);
  };

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex gap-2" />;
  }

  return (
    <div className="flex gap-2 items-center flex-shrink-0">
      {BACKGROUNDS.map((bg) => (
        <div
          key={bg.id}
          className="relative"
          onMouseEnter={() => selected === bg.id && setShowSlider(true)}
          onMouseLeave={() => setShowSlider(false)}
        >
          <button
            onClick={() => handleSelect(bg.id)}
            className={clsx(
              'w-10 h-10 rounded-md overflow-hidden transition-all duration-200',
              'bg-cover bg-center flex-shrink-0',
              'ring-offset-1 ring-offset-bg-body',
              selected === bg.id
                ? 'ring-2 ring-accent-primary scale-105'
                : 'ring-1 ring-white/20 hover:ring-white/40 opacity-70 hover:opacity-100'
            )}
            style={{ backgroundImage: `url(${bg.src})` }}
            aria-label={`Select ${bg.id} background`}
          />
          
          {/* Brightness slider - shows on hover over selected */}
          {selected === bg.id && showSlider && (
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div
                ref={sliderRef}
                className="w-6 h-24 bg-bg-surface/90 backdrop-blur-sm rounded-lg border border-white/20 cursor-pointer relative overflow-hidden"
                onClick={handleSliderInteraction}
                onMouseDown={(e) => {
                  handleSliderInteraction(e);
                  const onMove = (ev: MouseEvent) => {
                    const rect = sliderRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const y = ev.clientY - rect.top;
                    const value = Math.round(Math.max(0, Math.min(100, (1 - y / rect.height) * 100)));
                    handleBrightnessChange(value);
                  };
                  const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              >
                {/* Gradient background */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-black/80" />
                
                {/* Current value indicator */}
                <div
                  className="absolute left-0 right-0 h-1 bg-accent-primary rounded-full shadow-lg"
                  style={{ top: `${100 - brightness}%`, transform: 'translateY(-50%)' }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Hook to get current background URL
 * Used by layout to apply the selected background
 */
export function useBackground() {
  const [backgroundSrc, setBackgroundSrc] = useState('/images/bg.jpg');

  useEffect(() => {
    // Load initial value
    const stored = localStorage.getItem(STORAGE_KEY) as BackgroundId | null;
    const bg = BACKGROUNDS.find(b => b.id === stored) || BACKGROUNDS[0];
    setBackgroundSrc(bg.src);

    // Listen for changes
    const handleChange = (e: CustomEvent<BackgroundId>) => {
      const bg = BACKGROUNDS.find(b => b.id === e.detail) || BACKGROUNDS[0];
      setBackgroundSrc(bg.src);
    };

    window.addEventListener('background-change', handleChange as EventListener);
    return () => {
      window.removeEventListener('background-change', handleChange as EventListener);
    };
  }, []);

  return backgroundSrc;
}
