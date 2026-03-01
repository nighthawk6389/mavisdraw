import React, { useEffect, useRef, useMemo } from 'react';
import { useCollaborationStore, type RemoteCursor } from '../../stores/collaborationStore';

/** Duration in ms over which to interpolate cursor positions */
const INTERPOLATION_DURATION = 100;

interface InterpolatedCursor extends RemoteCursor {
  displayX: number;
  displayY: number;
}

/**
 * Renders remote user cursors with frame-based position interpolation.
 * Uses requestAnimationFrame to smoothly animate between discrete
 * network position updates.
 */
export default function CursorOverlay() {
  const remoteCursors = useCollaborationStore((s) => s.remoteCursors);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorsRef = useRef(remoteCursors);
  const rafRef = useRef<number | null>(null);

  // Keep the ref in sync
  useEffect(() => {
    cursorsRef.current = remoteCursors;
  }, [remoteCursors]);

  // Build initial cursor list (for the non-canvas fallback rendering)
  const cursorList = useMemo(() => {
    const result: InterpolatedCursor[] = [];
    for (const cursor of remoteCursors.values()) {
      result.push({
        ...cursor,
        displayX: cursor.x,
        displayY: cursor.y,
      });
    }
    return result;
  }, [remoteCursors]);

  // Run animation loop via canvas overlay for smooth interpolation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = () => {
      const now = Date.now();
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let hasActive = false;

      for (const cursor of cursorsRef.current.values()) {
        const elapsed = now - cursor.timestamp;
        const t = Math.min(elapsed / INTERPOLATION_DURATION, 1);
        const ease = 1 - Math.pow(1 - t, 3);

        const dx = cursor.prevX + (cursor.x - cursor.prevX) * ease;
        const dy = cursor.prevY + (cursor.y - cursor.prevY) * ease;

        if (t < 1) hasActive = true;

        // Draw cursor arrow
        ctx.save();
        ctx.translate(dx, dy);

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;

        // Arrow path
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 16);
        ctx.lineTo(5, 11.5);
        ctx.lineTo(10, 16);
        ctx.closePath();

        ctx.fillStyle = cursor.userColor;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Name label
        const labelFont = '10px "Segoe UI", system-ui, sans-serif';
        ctx.font = labelFont;
        const label = cursor.userName;
        const metrics = ctx.measureText(label);
        const padX = 4;
        const padY = 2;
        const labelX = 16;
        const labelY = 16;

        ctx.fillStyle = cursor.userColor;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(
          labelX,
          labelY,
          metrics.width + padX * 2,
          12 + padY * 2,
          3,
        );
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, labelX + padX, labelY + 8);

        ctx.restore();
      }

      if (hasActive || cursorsRef.current.size > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    if (remoteCursors.size > 0) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [remoteCursors]);

  if (cursorList.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50"
    />
  );
}
