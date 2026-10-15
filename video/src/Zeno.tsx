import React, { useLayoutEffect, useRef } from 'react';
// Maskot yang sama dengan aplikasi (renderer/buddy.js mengisi window.createBuddy).
import '../../renderer/buddy.js';
import '../../renderer/buddy.css';
import './zeno.css';

type Buddy = {
  el: SVGSVGElement;
  setMood: (mood: string) => void;
  setCostume: (name: string | null) => void;
  look: (x: number, y: number) => void;
};

declare global {
  interface Window {
    createBuddy: () => Buddy;
  }
}

type Props = {
  mood: string;
  size: number;
  lookX?: number;
  lookY?: number;
  costume?: string | null;
  style?: React.CSSProperties;
};

// Gerak tubuh (lompat, goyang, putar) diatur lewat style dari frame, bukan animasi CSS,
// supaya setiap frame render sama persis.
export const Zeno: React.FC<Props> = ({ mood, size, lookX = 0, lookY = 0, costume = null, style }) => {
  const host = useRef<HTMLDivElement>(null);
  const buddy = useRef<Buddy | null>(null);

  useLayoutEffect(() => {
    if (!host.current) return;
    if (!buddy.current) {
      buddy.current = window.createBuddy();
      host.current.append(buddy.current.el);
    }
    buddy.current.setMood(mood);
    buddy.current.setCostume(costume);
    buddy.current.look(lookX, lookY);
  });

  return <div ref={host} className="zeno-host" style={{ width: size, height: size, ...style }} />;
};
