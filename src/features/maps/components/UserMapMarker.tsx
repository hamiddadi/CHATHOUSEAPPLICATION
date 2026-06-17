import React, { memo, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import MaterialIcons, {
  type MaterialIconsIconName,
} from '@react-native-vector-icons/material-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { FollowerOnMap } from '../../../shared/types/domain';

// ── Geometry ────────────────────────────────────────────────────────────────
const CONTAINER_WIDTH = 72;
const CONTAINER_HEIGHT = 78;
const AVATAR_SIZE = 44;
const AVATAR_RADIUS = AVATAR_SIZE / 2; // 22
// Status badge — small circle pinned to the avatar's bottom-right corner.
// Spec calls for ~16px; we use 18 so a 12px vector glyph fits inside the
// 1.5px white ring without clipping.
const BADGE_SIZE = 18;
const BADGE_ICON_SIZE = 12;
const ONLINE_DOT_SIZE = 10;
// Speaking pulse — scale the avatar group 1.0 → 1.15 on a 800ms loop.
const PULSE_SCALE_PEAK = 1.15;
const PULSE_DURATION_MS = 800;
// After any visual change we keep the marker rasterizing briefly so Android
// repaints the new badge/border, then drop back to tracksViewChanges={false}.
const MARKER_REDRAW_MS = 500;

// ── Palette (mission spec) ───────────────────────────────────────────────────
const GREEN = '#22C55E'; // speaking / online
const RED = '#EF4444'; // muted
const BLUE = '#3B82F6'; // listener
const WHITE = '#FFFFFF';
const USERNAME_BG = 'rgba(0,0,0,0.55)';
const AVATAR_PLACEHOLDER_BG = '#6366F1';

export type MarkerVisualState = 'speaking' | 'muted' | 'listener' | 'online';

/**
 * Resolve the single visual state shown on the marker, by priority:
 * speaking → muted → listener (or in a room) → online. Ghost Mode users never
 * reach this component (they're filtered out of the roster upstream).
 */
export const resolveMarkerState = (u: FollowerOnMap): MarkerVisualState => {
  if (u.isSpeaking) return 'speaking';
  if (u.isMuted) return 'muted';
  if (u.isListener || u.liveRoomId != null) return 'listener';
  return 'online';
};

/** A user counts as "in a room" if any room-audio signal is set. */
export const isUserInRoom = (u: FollowerOnMap): boolean =>
  u.liveRoomId != null || !!u.isListener || !!u.isSpeaking || !!u.isMuted;

const BORDER_COLOR: Record<MarkerVisualState, string> = {
  speaking: GREEN,
  muted: RED,
  listener: BLUE,
  online: WHITE,
};

const BADGE_COLOR: Record<MarkerVisualState, string> = {
  speaking: GREEN,
  muted: RED,
  listener: BLUE,
  online: GREEN,
};

// MaterialIcons glyph per state. `online` renders a plain filled dot instead.
const BADGE_ICON: Record<Exclude<MarkerVisualState, 'online'>, MaterialIconsIconName> = {
  speaking: 'mic',
  muted: 'mic-off',
  listener: 'hearing',
};

const getInitials = (name?: string): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
};

interface UserMapMarkerProps {
  user: FollowerOnMap;
  onPress?: (user: FollowerOnMap) => void;
}

/**
 * Real-time user marker on the OSM map: profile photo as the primary marker
 * with a small status badge pinned bottom-right reflecting their live mic/room
 * state, plus a username chip underneath.
 *
 * Owns the `<Marker>` itself so it can manage `tracksViewChanges` per marker:
 * Android only repaints custom marker content while that flag is true, so we
 * flip it on for a short window after every visual change (mount, mute toggle,
 * role change, avatar swap) and keep it on while a speaker is pulsing, then
 * settle back to false to avoid the continuous-rasterization cost of "live"
 * pins. The content is wrapped in `<View collapsable={false}>` — mandatory on
 * Android for custom markers to render at all.
 */
export const UserMapMarker: React.FC<UserMapMarkerProps> = memo(({ user, onPress }) => {
  const state = resolveMarkerState(user);
  const inRoom = isUserInRoom(user);
  const isSpeaking = state === 'speaking';

  // ── Per-marker rasterization control ──────────────────────────────────────
  // Start true so the custom content paints on first layout. Re-arm the redraw
  // window whenever a visual input changes (state badge, border, or avatar).
  const [tracksTransient, setTracksTransient] = useState(true);
  useEffect(() => {
    setTracksTransient(true);
    const id = setTimeout(() => setTracksTransient(false), MARKER_REDRAW_MS);
    return () => clearTimeout(id);
  }, [state, user.avatarUrl, user.username]);
  // A pulsing speaker is continuously animating, so it must keep tracking;
  // every other marker settles to false once its redraw window elapses.
  const tracksViewChanges = tracksTransient || isSpeaking;

  // ── Speaking pulse (scale 1.0 → 1.15, 800ms loop) ─────────────────────────
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!isSpeaking) {
      cancelAnimation(scale);
      scale.value = 1;
      return;
    }
    scale.value = withRepeat(
      withTiming(PULSE_SCALE_PEAK, {
        duration: PULSE_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [isSpeaking, scale]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const initials = useMemo(
    () => getInitials(user.displayName || user.username),
    [user.displayName, user.username],
  );
  const a11yLabel = `${user.displayName}${inRoom ? ', live' : ''}`;
  const hasPhoto = !!user.avatarUrl;
  const borderColor = BORDER_COLOR[state];
  const badgeColor = BADGE_COLOR[state];

  return (
    <Marker
      coordinate={{ latitude: user.location.latitude, longitude: user.location.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress ? () => onPress(user) : undefined}
      tracksViewChanges={tracksViewChanges}
      accessibilityLabel={a11yLabel}
    >
      {/* collapsable={false} is required on Android for custom marker content. */}
      <View
        collapsable={false}
        style={styles.container}
        accessible
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        <Animated.View style={[styles.avatarGroup, pulseStyle]}>
          <View style={[styles.avatarWrapper, { borderColor }]}>
            {hasPhoto ? (
              <Image
                source={{ uri: user.avatarUrl as string }}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.avatar, styles.placeholder]}>
                <Text style={styles.initials} allowFontScaling={false} numberOfLines={1}>
                  {initials}
                </Text>
              </View>
            )}
          </View>

          {/* Status badge — bottom-right, white-ringed. */}
          <View style={[styles.badge, { backgroundColor: badgeColor }]}>
            {state === 'online' ? (
              <View style={styles.onlineDot} />
            ) : (
              <MaterialIcons name={BADGE_ICON[state]} size={BADGE_ICON_SIZE} color={WHITE} />
            )}
          </View>
        </Animated.View>

        <View style={styles.usernameBadge}>
          <Text style={styles.usernameText} numberOfLines={1}>
            {user.username}
          </Text>
        </View>
      </View>
    </Marker>
  );
});
UserMapMarker.displayName = 'UserMapMarker';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
  },
  avatarGroup: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
    borderWidth: 2.5,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AVATAR_PLACEHOLDER_BG,
  },
  initials: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 1.5,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    width: ONLINE_DOT_SIZE,
    height: ONLINE_DOT_SIZE,
    borderRadius: ONLINE_DOT_SIZE / 2,
    backgroundColor: WHITE,
  },
  usernameBadge: {
    marginTop: 4,
    backgroundColor: USERNAME_BG,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: CONTAINER_WIDTH,
  },
  usernameText: {
    color: WHITE,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
});
