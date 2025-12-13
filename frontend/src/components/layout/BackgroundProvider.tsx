'use client';

import { useState, useEffect } from 'react';
import { useBackground } from '@/components/shared/BackgroundSelector';

const BRIGHTNESS_KEY = 'pymc-bg-brightness';

/**
 * Client component that renders the dynamic background image
 * Listens for background-change and brightness-change events
 */
export function BackgroundProvider() {
  const backgroundSrc = useBackground();
const [brightness, setBrightness] = useState(80);

  useEffect(() => {
    // Load initial brightness
    const stored = localStorage.getItem(BRIGHTNESS_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        setBrightness(val);
      }
    }

    // Listen for brightness changes
    const handleBrightnessChange = (e: CustomEvent<number>) => {
      setBrightness(e.detail);
    };

    window.addEventListener('brightness-change', handleBrightnessChange as EventListener);
    return () => {
      window.removeEventListener('brightness-change', handleBrightnessChange as EventListener);
    };
  }, []);

  // Calculate overlay opacity: 0 at 100% brightness, 1 at 0% brightness
  const overlayOpacity = (100 - brightness) / 100;

  return (
    <>
      {/* Background image */}
      <div 
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${backgroundSrc})` }}
      />
      {/* Dark overlay for brightness control */}
      {overlayOpacity > 0 && (
        <div 
          className="fixed inset-0 -z-10 bg-black pointer-events-none transition-opacity duration-150"
          style={{ opacity: overlayOpacity }}
        />
      )}
    </>
  );
}
