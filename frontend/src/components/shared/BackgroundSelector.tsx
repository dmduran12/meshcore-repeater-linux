'use client';

import { useState, useEffect } from 'react';
import clsx from 'clsx';

const BACKGROUNDS = [
  { id: 'default', src: '/images/bg.jpg' },
  { id: 'amber', src: '/images/bg-amber.jpg' },
  { id: 'grey', src: '/images/bg-grey.jpg' },
  { id: 'black', src: '/images/bg-black.jpg' },
] as const;

type BackgroundId = typeof BACKGROUNDS[number]['id'];

const STORAGE_KEY = 'pymc-background';

/**
 * Background selector with square thumbnail chips
 * Visual-only selection (no text labels)
 */
export function BackgroundSelector() {
  const [selected, setSelected] = useState<BackgroundId>('default');
  const [mounted, setMounted] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY) as BackgroundId | null;
    if (stored && BACKGROUNDS.some(bg => bg.id === stored)) {
      setSelected(stored);
    }
  }, []);

  // Apply background change
  const handleSelect = (id: BackgroundId) => {
    setSelected(id);
    localStorage.setItem(STORAGE_KEY, id);
    
    // Dispatch custom event so layout can update
    window.dispatchEvent(new CustomEvent('background-change', { detail: id }));
  };

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex gap-2" />;
  }

  return (
    <div className="flex gap-2 items-center">
      {BACKGROUNDS.map((bg) => (
        <button
          key={bg.id}
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
          title={bg.id === 'default' ? 'Default background' : 'Red background'}
          aria-label={`Select ${bg.id} background`}
        />
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
