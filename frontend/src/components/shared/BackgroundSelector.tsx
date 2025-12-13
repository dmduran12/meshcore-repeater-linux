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
    setShowSlider(true); // Show slider immediately on selection
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

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex gap-2" />;
  }

  return (
    <div className="flex gap-2 items-center flex-shrink-0">
      {BACKGROUNDS.map((bg) => {
        const isSelected = selected === bg.id;
        const isSliderActive = isSelected && showSlider;
        
        return (
          <div
            key={bg.id}
            ref={isSelected ? sliderRef : undefined}
            className={clsx(
              'relative rounded-md overflow-hidden transition-all duration-300 ease-out',
              'ring-offset-1 ring-offset-bg-body cursor-pointer',
              isSelected
                ? 'ring-2 ring-accent-primary scale-105 w-10 h-10'
                : 'ring-1 ring-white/20 hover:ring-white/40 opacity-70 hover:opacity-100 w-10 h-10'
            )}
            onMouseEnter={() => isSelected && setShowSlider(true)}
            onMouseLeave={() => setShowSlider(false)}
            onClick={() => !isSelected && handleSelect(bg.id)}
            onMouseDown={(e) => {
              if (!isSliderActive) return;
              e.preventDefault();
              
              const updateFromEvent = (ev: MouseEvent | React.MouseEvent) => {
                const rect = sliderRef.current?.getBoundingClientRect();
                if (!rect) return;
                const y = ev.clientY - rect.top;
                const value = Math.round(Math.max(0, Math.min(100, (1 - y / rect.height) * 100)));
                handleBrightnessChange(value);
              };
              
              updateFromEvent(e);
              
              const onMove = (ev: MouseEvent) => updateFromEvent(ev);
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          >
            {/* Background image - always visible */}
            <div 
              className="absolute inset-0 bg-cover bg-center transition-opacity duration-300"
              style={{ 
                backgroundImage: `url(${bg.src})`,
                opacity: isSliderActive ? 0.3 : 1 
              }}
            />
            
            {/* Slider overlay - fades in on hover for selected */}
            {isSelected && (
              <div 
                className={clsx(
                  'absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-200',
                  isSliderActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
              >
                {/* Gradient track */}
                <div className="absolute inset-x-1 inset-y-1 rounded bg-gradient-to-b from-white/40 via-white/10 to-black/90" />
                
                {/* Fill showing current brightness */}
                <div 
                  className="absolute inset-x-1 bottom-1 rounded-b bg-black/60 transition-all duration-150 ease-out"
                  style={{ height: `${100 - brightness}%` }}
                />
                
                {/* Handle indicator */}
                <div
                  className="absolute left-1 right-1 h-0.5 bg-accent-primary rounded-full shadow-glow transition-all duration-150 ease-out"
                  style={{ top: `${100 - brightness}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
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
