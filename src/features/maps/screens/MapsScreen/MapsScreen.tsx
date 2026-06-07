import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, UrlTile } from 'react-native-maps'; // OSM Migration — replace PROVIDER_DEFAULT import with UrlTile
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { layout, spacing } from '../../../../shared/constants/theme';
import type { FollowerOnMap } from '../../../../shared/types/domain';
import type { RootStackParamList } from '../../../../core/navigation/types';
import { DEFAULT_MAP_CENTER } from '../../../../shared/mocks/followersOnMap.mock';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { useNearbyOnMap } from '../../hooks/useNearbyOnMap';
import { useLocationBroadcast } from '../../hooks/useLocationBroadcast';
import { GOOGLE_MAPS_COLORS } from '../../constants/mapColors'; // Google Maps color style
import { ACTIVE_TILE_PROVIDER } from '../../constants/tileProviders'; // OSM Migration — Voyager tiles mimic Google Maps
import { FollowerMiniCard } from '../../components/FollowerMiniCard';
import { FollowerPin } from '../../components/FollowerPin';
import { GhostModeToggle } from '../../components/GhostModeToggle';
import { MapSearchBar } from '../../components/MapSearchBar';
import { MapTopAppBar } from '../../components/MapTopAppBar';
import { MyLocationButton } from '../../components/MyLocationButton';
import { UserLocationPulse } from '../../components/UserLocationPulse';

const HEADER_HEIGHT = 64;
const SEARCH_BAR_TOP_OFFSET = HEADER_HEIGHT + 8;
const MINI_CARD_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xxxl;
// Extra lift applied to the floating controls when the mini-card is visible,
// so they sit above the card instead of being covered by it.
const MINI_CARD_LIFT = 120;
// Settle window during which markers keep tracking view changes so their
// custom content rasterizes, before we stop continuous re-rasterization.
const MARKER_TRACK_SETTLE_MS = 1500;
// Default map zoom level used for auto-center / pin-press / recenter regions.
const ZOOM_DELTA = 0.01;

const regionFor = (
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } => ({
  latitude,
  longitude,
  latitudeDelta: ZOOM_DELTA,
  longitudeDelta: ZOOM_DELTA,
});

const matches = (follower: FollowerOnMap, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    follower.displayName.toLowerCase().includes(q) || follower.username.toLowerCase().includes(q)
  );
};

export const MapsScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { permission, coords, requestAgain, ready } = useCurrentLocation();
  useLocationBroadcast(coords);
  // Nearby people on the map: everyone visible + online + recently located
  // around the viewer (not just the people they follow).
  const followers = useNearbyOnMap();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FollowerOnMap | null>(null);
  // Marker pins must track view changes briefly so their custom content
  // rasterizes, then stop — otherwise "live" pins re-rasterize continuously,
  // which is expensive on Android. We flip this to false shortly after mount.
  const [tracksMarkers, setTracksMarkers] = useState(true);
  const mapRef = useRef<MapView>(null);
  const didAutoCenterRef = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setTracksMarkers(false), MARKER_TRACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, []);

  // Auto-center the map on the user's first GPS fix, one-shot. Subsequent
  // coord updates don't re-center (the user may have panned away deliberately).
  useEffect(() => {
    if (didAutoCenterRef.current || !coords) return;
    didAutoCenterRef.current = true;
    mapRef.current?.animateToRegion(regionFor(coords.latitude, coords.longitude), 1000);
  }, [coords]);

  const filteredFollowers = useMemo(
    // Ghost Mode + offline users are already dropped upstream (backend roster +
    // the maps:user-offline socket event), so the roster only ever holds
    // online/recently-active nearby people — we just apply the search filter here.
    () => followers.filter(f => matches(f, search)),
    [followers, search],
  );

  const handlePinPress = useCallback((follower: FollowerOnMap) => {
    setSelected(follower);
    mapRef.current?.animateToRegion(
      regionFor(follower.location.latitude, follower.location.longitude),
      400,
    );
  }, []);

  const handleCloseCard = useCallback(() => setSelected(null), []);

  // Recenter on the user — reuses the live coords already tracked by useCurrentLocation.
  const handleRecenter = useCallback(async () => {
    if (!coords) {
      await requestAgain();
      return;
    }
    mapRef.current?.animateToRegion(regionFor(coords.latitude, coords.longitude), 800);
  }, [coords, requestAgain]);

  const handleJoinRoom = useCallback(
    (roomId: string) => {
      setSelected(null);
      navigation.navigate('Main', {
        screen: 'RoomsTab',
        params: { screen: 'Room', params: { roomId } },
      });
    },
    [navigation],
  );

  const handleSendMessage = useCallback(
    (userId: string) => {
      setSelected(null);
      // The DM service keys conversations by the peer's userId (conversationId
      // === peerId), so open the thread directly with this follower.
      navigation.navigate('Main', {
        screen: 'MessagesTab',
        params: { screen: 'ChatDetail', params: { conversationId: userId } },
      });
    },
    [navigation],
  );

  const initialRegion = useMemo(
    () => (coords ? regionFor(coords.latitude, coords.longitude) : DEFAULT_MAP_CENTER),
    [coords],
  );

  if (permission === 'denied') {
    return (
      <EmptyState
        title={t('explorer.maps.permissionTitle', 'Location permission needed')}
        description=""
      >
        <Pressable
          onPress={requestAgain}
          accessibilityRole="button"
          accessibilityLabel={t(
            'explorer.maps.permissionRetryA11y',
            'Try requesting location again',
          )}
          className="bg-primary rounded-pill px-xxl py-md mt-md"
        >
          <Text className="text-sm font-display text-primary-on-container">
            {t('explorer.maps.permissionBtn', 'Grant access')}
          </Text>
        </Pressable>
      </EmptyState>
    );
  }

  if (permission === 'disabled') {
    return (
      <EmptyState
        title={t('explorer.maps.locationDisabledTitle', 'Turn on location services')}
        description={t(
          'explorer.maps.locationDisabledBody',
          'Enable GPS in your device settings to see friends on the map.',
        )}
      />
    );
  }

  // Auto-center on mount — block the map render until we have a first GPS fix
  // so the user never sees a default (Dakar) centroid before their real position.
  // Once the initial fix attempt has finished (or timed out) we render anyway and
  // fall back to DEFAULT_MAP_CENTER, so a device without a GPS fix is never stuck
  // on the loader indefinitely.
  if (!coords && !ready) {
    return (
      <Loader fullscreen accessibilityLabel={t('explorer.maps.locatingA11y', 'Locating you')} />
    );
  }

  return (
    <View style={styles.rootContainer}>
      <MapView
        ref={mapRef}
        provider={undefined} // OSM Migration — use the native provider (Apple Maps iOS / Google-compatible Android shell, overlaid by OSM tiles)
        mapType={Platform.OS === 'android' ? 'none' : 'standard'} // OSM Migration — hide native base layer on Android so UrlTile is the only visible layer
        rotateEnabled={false} // OSM Migration — avoids raster-tile rotation artefacts
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* OSM Migration — OpenStreetMap tiles via UrlTile. shouldReplaceMapContent=true overlays OSM on iOS MapKit. */}
        <UrlTile
          urlTemplate={ACTIVE_TILE_PROVIDER.urlTemplate}
          maximumZ={ACTIVE_TILE_PROVIDER.maximumZ}
          tileSize={ACTIVE_TILE_PROVIDER.tileSize}
          shouldReplaceMapContent
          flipY={false}
        />
        {coords && (
          <Marker
            coordinate={{ latitude: coords.latitude, longitude: coords.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksMarkers}
            accessibilityLabel={t('explorer.maps.yourLocationA11y', 'Your location')}
          >
            <UserLocationPulse />
          </Marker>
        )}
        {filteredFollowers.map(f => (
          <Marker
            key={f.id}
            coordinate={{
              latitude: f.location.latitude,
              longitude: f.location.longitude,
            }}
            onPress={() => handlePinPress(f)}
            tracksViewChanges={tracksMarkers}
            anchor={{ x: 0.5, y: 0.5 }}
            accessibilityLabel={`${f.displayName}${f.liveRoomId ? ', live' : ''}`}
          >
            <FollowerPin follower={f} />
          </Marker>
        ))}
      </MapView>

      {/* Attribution hide overlay — covers any native platform watermark strip at the screen bottom. */}
      <View style={styles.attributionOverlay} pointerEvents="none" />

      <View
        pointerEvents="box-none"
        style={[styles.searchAnchor, { top: insets.top + SEARCH_BAR_TOP_OFFSET }]}
      >
        <View style={styles.searchPill}>
          <MapSearchBar value={search} onChangeText={setSearch} />
        </View>
      </View>

      {/* Right-edge floating controls — recenter on top, See/Unsee right below. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.floatingButtons,
          { bottom: insets.bottom + MINI_CARD_BOTTOM_OFFSET + (selected ? MINI_CARD_LIFT : 0) },
        ]}
      >
        <MyLocationButton onPress={handleRecenter} disabled={!coords} />
        <GhostModeToggle />
      </View>

      {selected && (
        <View
          pointerEvents="box-none"
          style={[styles.miniCardAnchor, { bottom: insets.bottom + MINI_CARD_BOTTOM_OFFSET }]}
        >
          <View style={styles.miniCardInner}>
            <FollowerMiniCard
              follower={selected}
              onJoinRoom={handleJoinRoom}
              onSendMessage={handleSendMessage}
              onClose={handleCloseCard}
            />
          </View>
        </View>
      )}

      <View style={[styles.headerAnchor, { paddingTop: insets.top }]} pointerEvents="box-none">
        <MapTopAppBar />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Google Maps color style — land fill shown during tile loading gaps
  rootContainer: {
    flex: 1,
    backgroundColor: GOOGLE_MAPS_COLORS.landSoft,
  },
  searchAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  searchPill: {
    width: '90%',
    maxWidth: 420,
  },
  floatingButtons: {
    position: 'absolute',
    right: spacing.xxl,
    alignItems: 'center',
    gap: 10,
  },
  miniCardAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  miniCardInner: {
    width: '100%',
    maxWidth: 420,
  },
  headerAnchor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  // Attribution hide overlay — covers native platform watermark strip at the screen bottom.
  attributionOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.select({ ios: 18, android: 22, default: 20 }),
    backgroundColor: GOOGLE_MAPS_COLORS.landSoft, // Google Maps color style — blends with Voyager light tiles
    zIndex: 999,
  },
});
