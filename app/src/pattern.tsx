import { File, Paths } from 'expo-file-system';
import { ComponentRef, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

import { C } from './theme';

export type LockMethod = 'pin' | 'pattern';

// Only the kind of lock is stored here, never the PIN or the pattern itself.
const methodFile = () => new File(Paths.document, 'lock-method');

/** The saved lock kind, or null when the file is missing or unreadable (never guessed). */
export function readLockMethod(): LockMethod | null {
  try {
    const f = methodFile();
    if (!f.exists) return null;
    const v = f.textSync().trim();
    return v === 'pin' || v === 'pattern' ? v : null;
  } catch {
    return null;
  }
}

export function saveLockMethod(m: LockMethod) {
  try {
    const f = methodFile();
    if (!f.exists) f.create();
    f.write(m);
  } catch {}
}

export function clearLockMethod() {
  try {
    const f = methodFile();
    if (f.exists) f.delete();
  } catch {}
}

// "Hide pattern trail" setting; a plain on/off flag next to the lock kind.
const trailFile = () => new File(Paths.document, 'hide-trail');

export function readHideTrail(): boolean {
  try {
    const f = trailFile();
    return f.exists && f.textSync().trim() === '1';
  } catch {
    return false;
  }
}

export function saveHideTrail(on: boolean) {
  try {
    const f = trailFile();
    if (!f.exists) f.create();
    f.write(on ? '1' : '0');
  } catch {}
}

export const MIN_PATTERN_DOTS = 4;

/**
 * The vault core takes a digit string, so each dot (1-9) becomes two digits ("01".."09").
 * That keeps a pattern clear of the PIN rules for repeated and sequential digits.
 */
export const patternToSecret = (dots: number[]) => dots.map((d) => `0${d}`).join('');

const GRID = 3;

export function PatternPad({ onDone, disabled, hidePath }: { onDone: (dots: number[]) => void; disabled?: boolean; hidePath?: boolean }) {
  const [size, setSize] = useState(0);
  const [dots, setDots] = useState<number[]>([]);
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  // Window position of the grid; null until measured, and moves are ignored until then.
  const origin = useRef<{ x: number; y: number } | null>(null);
  const view = useRef<ComponentRef<typeof View>>(null);
  const state = useRef({ dots: [] as number[], size: 0, disabled: false, onDone });
  state.current = { dots, size, disabled: !!disabled, onDone };

  const cell = size / GRID;
  const centerOf = (d: number) => ({ x: ((d - 1) % GRID) * cell + cell / 2, y: Math.floor((d - 1) / GRID) * cell + cell / 2 });

  const hit = (x: number, y: number) => {
    const sz = state.current.size;
    const c = sz / GRID;
    const col = Math.floor(x / c);
    const row = Math.floor(y / c);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return null;
    // Count a dot only near its centre so diagonal swipes do not catch neighbours.
    const cx = col * c + c / 2;
    const cy = row * c + c / 2;
    return Math.hypot(x - cx, y - cy) < c * 0.38 ? row * GRID + col + 1 : null;
  };

  const measure = () => view.current?.measureInWindow((x, y) => (origin.current = { x, y }));

  const track = (pageX: number, pageY: number) => {
    if (!origin.current) return;
    const x = pageX - origin.current.x;
    const y = pageY - origin.current.y;
    setFinger({ x, y });
    const d = hit(x, y);
    if (d !== null && !state.current.dots.includes(d)) {
      const next = [...state.current.dots, d];
      state.current.dots = next;
      setDots(next);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !state.current.disabled,
      onMoveShouldSetPanResponder: () => !state.current.disabled,
      onPanResponderGrant: (e) => {
        state.current.dots = [];
        setDots([]);
        track(e.nativeEvent.pageX, e.nativeEvent.pageY);
        measure();
      },
      onPanResponderMove: (e) => track(e.nativeEvent.pageX, e.nativeEvent.pageY),
      onPanResponderRelease: () => {
        const done = state.current.dots;
        setFinger(null);
        setDots([]);
        state.current.dots = [];
        if (done.length > 0) state.current.onDone(done);
      },
      onPanResponderTerminate: () => {
        setFinger(null);
        setDots([]);
        state.current.dots = [];
      },
    }),
  ).current;

  const segments: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  if (!hidePath && size > 0) {
    for (let i = 1; i < dots.length; i++) segments.push({ a: centerOf(dots[i - 1]), b: centerOf(dots[i]) });
    if (finger && dots.length > 0) segments.push({ a: centerOf(dots[dots.length - 1]), b: finger });
  }

  return (
    <View
      ref={view}
      onLayout={(e) => {
        setSize(Math.min(e.nativeEvent.layout.width, 320));
        measure();
      }}
      style={{ width: '100%', maxWidth: 320, aspectRatio: 1, alignSelf: 'center', opacity: disabled ? 0.4 : 1 }}
      {...responder.panHandlers}
    >
      {segments.map(({ a, b }, i) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (a.x + b.x) / 2 - len / 2,
              top: (a.y + b.y) / 2 - 2,
              width: len,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.brass,
              opacity: 0.7,
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
      {size > 0 &&
        Array.from({ length: GRID * GRID }, (_, i) => i + 1).map((d) => {
          const { x, y } = centerOf(d);
          const on = !hidePath && dots.includes(d);
          return (
            <View
              key={d}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: x - 28,
                top: y - 28,
                width: 56,
                height: 56,
                borderRadius: 28,
                borderWidth: 1,
                borderColor: on ? C.brass : C.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: on ? C.brass : C.muted }} />
            </View>
          );
        })}
    </View>
  );
}
