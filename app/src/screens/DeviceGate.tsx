import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { NO_DEVICE_LOCK, readDeviceGate } from '../deviceGate';
import { t } from '../i18n';
import { C, F } from '../theme';
import { s } from '../ui';

const AnimatedBlur = Animated.createAnimatedComponent(BlurView);
const BLUR = 60;

type Phase = 'checking' | 'gated' | 'opening' | 'open' | 'skipped';

/**
 * Two-step unlock, step 1: the phone's own lock (Face ID, Touch ID, fingerprint or passcode)
 * over a blurred unlock screen. Passing it only reveals the app's PIN/pattern screen (step 2);
 * it never opens the vault by itself (SPEC AC-08) and a failure here never spends an attempt.
 */
export function DeviceGate({ children }: { children: ReactNode }) {
  const [phase, setPhaseState] = useState<Phase>(() => (readDeviceGate() ? 'checking' : 'open'));
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(true);
  // Mirrors `phase` for callbacks (AppState, the system prompt) that outlive a render.
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const mounted = useRef(true);
  // The system prompt itself sends the app to inactive (iPhone) or background (Android passcode).
  const authing = useRef(false);
  // Prompt as soon as the app is on screen: at start, and again after the app was left.
  const wantPrompt = useRef(true);
  const reduceMotion = useRef(false);

  const [blur] = useState(() => new Animated.Value(1)); // 1 = fully covered
  const [shackle] = useState(() => new Animated.Value(0)); // 1 = lock open
  const [glow] = useState(() => new Animated.Value(0));

  // The running reveal sequence; stopped when step 1 comes back mid-animation.
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  const cover = useCallback(() => {
    anim.current?.stop();
    anim.current = null;
    blur.stopAnimation();
    shackle.stopAnimation();
    glow.stopAnimation();
    blur.setValue(1);
    shackle.setValue(0);
    glow.setValue(0);
  }, [blur, shackle, glow]);

  const reveal = useCallback(() => {
    setPhase('opening');
    const fast = reduceMotion.current;
    const seq = Animated.sequence([
      Animated.parallel([
        Animated.timing(shackle, { toValue: 1, duration: fast ? 0 : 380, easing: Easing.out(Easing.back(1.6)), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 1, duration: fast ? 0 : 520, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]),
      Animated.delay(fast ? 0 : 220),
      Animated.timing(blur, { toValue: 0, duration: fast ? 150 : 750, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]);
    anim.current = seq;
    seq.start(({ finished }) => {
      if (anim.current !== seq) return;
      anim.current = null;
      if (finished && mounted.current && phaseRef.current === 'opening') setPhase('open');
    });
  }, [blur, shackle, glow, setPhase]);

  // Is there a screen lock on this phone at all? None: skip step 1 and say so.
  // Only the phone's lock level decides this, never an error code from the prompt.
  const check = useCallback(() => {
    setPhase('checking');
    LocalAuthentication.getEnrolledLevelAsync()
      .then((level) => {
        if (!mounted.current || phaseRef.current !== 'checking') return;
        setPhase(level === LocalAuthentication.SecurityLevel.NONE ? 'skipped' : 'gated');
      })
      .catch(() => mounted.current && phaseRef.current === 'checking' && setPhase('gated'));
  }, [setPhase]);

  const prompt = useCallback(async () => {
    if (authing.current || phaseRef.current !== 'gated') return;
    if (AppState.currentState !== 'active') {
      wantPrompt.current = true;
      return;
    }
    wantPrompt.current = false;
    authing.current = true;
    setFailed(false);
    let r: LocalAuthentication.LocalAuthenticationResult;
    try {
      r = await LocalAuthentication.authenticateAsync({ promptMessage: t('gate.prompt'), cancelLabel: t('common.cancel') });
    } catch {
      r = { success: false, error: 'unknown' };
    } finally {
      authing.current = false;
    }
    if (!mounted.current || phaseRef.current !== 'gated') return;
    if (r.success) return reveal();
    // The lock may have been removed meanwhile: look again at the phone's lock level.
    if ((NO_DEVICE_LOCK as readonly string[]).includes(r.error)) return check();
    // Cancelled, failed or interrupted: stay covered; a tap tries again. Nothing is counted.
    setFailed(true);
    // Interrupted by leaving the app (not a plain cancel): ask again when the app is back.
    // A plain user cancel never re-prompts by itself, or a cancelled passcode screen would loop.
    if (r.error === 'system_cancel' || r.error === 'app_cancel') wantPrompt.current = true;
  }, [reveal, check]);

  useEffect(() => {
    mounted.current = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => (reduceMotion.current = v))
      .catch(() => {});
    if (phaseRef.current === 'checking') check();
    return () => {
      mounted.current = false;
      anim.current?.stop();
    };
  }, [check]);

  useEffect(() => {
    if (phase === 'gated' && wantPrompt.current) prompt();
  }, [phase, prompt]);

  // The "no screen lock" notice shows for a few seconds each time step 1 is skipped.
  useEffect(() => {
    if (phase !== 'skipped') return;
    const show = setTimeout(() => setNotice(true), 0);
    const hide = setTimeout(() => setNotice(false), 6000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [phase]);

  // Leaving the app while on the PIN/pattern screen brings step 1 back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !authing.current) {
        if (!readDeviceGate()) return;
        cover();
        setFailed(false);
        wantPrompt.current = true;
        // A passcode may have been added (or removed) while away: check the lock level again.
        check();
        return;
      }
      if (state === 'active' && wantPrompt.current) prompt();
    });
    return () => sub.remove();
  }, [cover, prompt, check]);

  const covered = phase === 'checking' || phase === 'gated' || phase === 'opening';
  const rotate = shackle.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-32deg'] });
  const lift = shackle.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const ringScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const haloScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.6] });
  const haloOpacity = glow.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.35, 0] });
  const ringColor = glow.interpolate({ inputRange: [0, 1], outputRange: [C.brassDim, C.brass] });
  const intensity = blur.interpolate({ inputRange: [0, 1], outputRange: [0, BLUR] });
  const dim = blur.interpolate({ inputRange: [0, 1], outputRange: [0, 0.62] });

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        pointerEvents={covered ? 'none' : 'auto'}
      >
        {children}
      </View>
      {phase === 'skipped' && notice && (
        // Floats over the top of the screen for a few seconds so the keypad keeps its room.
        <View style={st.notice} accessibilityRole="text" pointerEvents="none">
          <Text style={st.noticeText}>{t('gate.noLock')}</Text>
        </View>
      )}
      {covered && (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole={failed ? 'button' : undefined}
          accessibilityLabel={failed ? t('gate.retry') : t('gate.checking')}
          onPress={() => prompt()}
        >
          <AnimatedBlur
            tint="dark"
            intensity={intensity}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, opacity: dim }]} />
          <Animated.View style={[st.center, { opacity: blur }]}>
            <Text style={s.label}>{t('gate.step')}</Text>
            <View style={st.lockWrap}>
              <Animated.View style={[st.halo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]} />
              <Animated.View style={[st.ring, { borderColor: ringColor, transform: [{ scale: ringScale }] }]}>
                <View style={st.lock}>
                  <Animated.View style={[st.shackle, { transform: [{ translateY: lift }, { rotate }] }]} />
                  <View style={st.body} />
                </View>
              </Animated.View>
            </View>
            <Text style={st.title}>{t('gate.checking')}</Text>
            <Text style={[s.small, { textAlign: 'center', color: C.muted }]}>{t('gate.sub')}</Text>
            <Text style={[s.small, { textAlign: 'center', color: failed ? C.brass : 'transparent', marginTop: 6 }]}>{t('gate.retry')}</Text>
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 14 },
  lockWrap: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  halo: { position: 'absolute', width: 104, height: 104, borderRadius: 52, backgroundColor: C.brass },
  ring: { width: 104, height: 104, borderRadius: 52, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,13,18,0.6)' },
  lock: { width: 34, height: 42, alignItems: 'center', justifyContent: 'flex-end' },
  shackle: {
    position: 'absolute',
    top: 0,
    width: 22,
    height: 22,
    borderWidth: 3.5,
    borderBottomWidth: 0,
    borderColor: C.brass,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
    transformOrigin: '0% 100%',
  },
  body: { width: 34, height: 24, borderRadius: 5, backgroundColor: C.brass },
  title: { fontFamily: F.title, fontSize: 26, lineHeight: 32, color: C.ivory, textAlign: 'center' },
  notice: { position: 'absolute', top: 8, left: 24, right: 24, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.outline, backgroundColor: C.surface },
  noticeText: { fontFamily: F.body, fontSize: 12, lineHeight: 18, color: C.muted, textAlign: 'center' },
});
