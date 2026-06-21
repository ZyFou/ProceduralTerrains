import { useCallback, useEffect, useRef } from 'react';

const RADIUS = 52;
const DEAD = 0.12;

function clampKnob(dx, dy, max) {
  const len = Math.hypot(dx, dy);
  if (len <= max) return { x: dx, y: dy };
  const s = max / len;
  return { x: dx * s, y: dy * s };
}

function norm(dx, dy, max) {
  const nx = dx / max;
  const ny = dy / max;
  const len = Math.hypot(nx, ny);
  if (len < DEAD) return { x: 0, y: 0 };
  const s = Math.min(1, len);
  return { x: (nx / len) * s, y: (ny / len) * s };
}

function useJoystick(onChange) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const activeRef = useRef(null);

  const reset = useCallback(() => {
    activeRef.current = null;
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(-50%, -50%)';
    }
    onChange(0, 0);
  }, [onChange]);

  const updateFromPointer = useCallback((e) => {
    if (!baseRef.current || !knobRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const raw = clampKnob(e.clientX - cx, e.clientY - cy, RADIUS);
    const n = norm(raw.x, raw.y, RADIUS);
    knobRef.current.style.transform = `translate(calc(-50% + ${raw.x}px), calc(-50% + ${raw.y}px))`;
    onChange(n.x, n.y);
  }, [onChange]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    activeRef.current = e.pointerId;
    baseRef.current?.setPointerCapture(e.pointerId);
    updateFromPointer(e);
  }, [updateFromPointer]);

  const onPointerMove = useCallback((e) => {
    if (activeRef.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    updateFromPointer(e);
  }, [updateFromPointer]);

  const onPointerUp = useCallback((e) => {
    if (activeRef.current !== e.pointerId) return;
    if (baseRef.current?.hasPointerCapture(e.pointerId)) {
      baseRef.current.releasePointerCapture(e.pointerId);
    }
    reset();
  }, [reset]);

  useEffect(() => () => reset(), [reset]);

  return { baseRef, knobRef, onPointerDown, onPointerMove, onPointerUp };
}

export default function TouchControls({ onInput }) {
  const stateRef = useRef({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 });

  const sync = useCallback(() => {
    onInput?.({ ...stateRef.current });
  }, [onInput]);

  const onMove = useCallback((x, y) => {
    stateRef.current.moveX = x;
    stateRef.current.moveY = -y;
    sync();
  }, [sync]);

  const onLook = useCallback((x, y) => {
    stateRef.current.lookX = x;
    stateRef.current.lookY = y;
    sync();
  }, [sync]);

  const move = useJoystick(onMove);
  const look = useJoystick(onLook);

  useEffect(() => () => onInput?.({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 }), [onInput]);

  return (
    <div className="touch-controls">
      <div
        ref={move.baseRef}
        className="touch-joystick touch-joystick-move"
        onPointerDown={move.onPointerDown}
        onPointerMove={move.onPointerMove}
        onPointerUp={move.onPointerUp}
        onPointerCancel={move.onPointerUp}
      >
        <div ref={move.knobRef} className="touch-joystick-knob" />
        <span className="touch-joystick-label">Move</span>
      </div>
      <div
        ref={look.baseRef}
        className="touch-joystick touch-joystick-look"
        onPointerDown={look.onPointerDown}
        onPointerMove={look.onPointerMove}
        onPointerUp={look.onPointerUp}
        onPointerCancel={look.onPointerUp}
      >
        <div ref={look.knobRef} className="touch-joystick-knob" />
        <span className="touch-joystick-label">Look</span>
      </div>
    </div>
  );
}
