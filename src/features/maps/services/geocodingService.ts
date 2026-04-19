/**
 * OSM Migration — free geocoding + routing alternatives to Google APIs.
 *
 * | Google API                 | This service replaces with                 |
 * | -------------------------- | ------------------------------------------ |
 * | Geocoding API              | Nominatim     /search?q=...                |
 * | Reverse Geocoding          | Nominatim     /reverse?lat=...&lon=...     |
 * | Places Autocomplete API    | Photon        /api?q=...                   |
 * | Directions / Routes API    | OSRM          /route/v1/driving/...        |
 *
 * Rate limits (public endpoints) :
 * - Nominatim : 1 req/s, custom User-Agent REQUIRED.
 * - Photon    : ~1 req/s (soft cap).
 * - OSRM      : routing on demo server is unmetered but not for production.
 *
 * For production, self-host or use a paid provider.
 */

import type { GeoPoint } from '../../../shared/types/domain';
import { config } from '../../../shared/constants/config';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const PHOTON_BASE = 'https://photon.komoot.io/api';
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

const USER_AGENT_HEADER = {
  'User-Agent': `${config.appName}/0.1 (${config.supportEmail})`,
  'Accept-Language': 'en,fr',
};

/* ============================================================
 * Normalized shapes — match what the rest of the app expects.
 * ========================================================== */
export interface GeocodeResult {
  displayName: string;
  point: GeoPoint;
  osmType?: 'node' | 'way' | 'relation';
  osmId?: number;
  /** ISO-3166-1 alpha-2, when available. */
  countryCode?: string;
}

export interface AutocompleteSuggestion {
  id: string;
  displayName: string;
  point: GeoPoint;
  category?: string;
}

export interface RouteResult {
  /** Total distance in meters. */
  distance: number;
  /** Total duration in seconds. */
  duration: number;
  /** GeoJSON LineString coordinates as `[lon, lat][]` (matches OSRM default). */
  geometry: [number, number][];
}

/* ============================================================
 * Raw response types (Nominatim / Photon / OSRM) — kept private.
 * ========================================================== */
interface NominatimPlace {
  place_id: number;
  osm_type?: 'node' | 'way' | 'relation';
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: { country_code?: string };
}

interface PhotonFeature {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    osm_id: number;
    name?: string;
    city?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

interface OsrmResponse {
  code: string;
  routes: OsrmRoute[];
}

/* ============================================================
 * Service helpers
 * ========================================================== */

const now = (): string => new Date().toISOString();

const toGeoPoint = (latitude: number, longitude: number): GeoPoint => ({
  latitude,
  longitude,
  updatedAt: now(),
});

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: { ...USER_AGENT_HEADER, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
};

/* ============================================================
 * Public API
 * ========================================================== */
export const geocodingService = {
  /** Forward geocoding — free-text address → best GeoPoint match. */
  async geocode(query: string, limit = 5): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=${limit}&addressdetails=1`;
    const raw = await fetchJson<NominatimPlace[]>(url);
    return raw.map(p => ({
      displayName: p.display_name,
      point: toGeoPoint(parseFloat(p.lat), parseFloat(p.lon)),
      osmType: p.osm_type,
      osmId: p.osm_id,
      countryCode: p.address?.country_code,
    }));
  },

  /** Reverse geocoding — GeoPoint → closest address. */
  async reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    const url = `${NOMINATIM_BASE}/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
    const raw = await fetchJson<NominatimPlace>(url);
    if (!raw.lat) return null;
    return {
      displayName: raw.display_name,
      point: toGeoPoint(parseFloat(raw.lat), parseFloat(raw.lon)),
      osmType: raw.osm_type,
      osmId: raw.osm_id,
      countryCode: raw.address?.country_code,
    };
  },

  /** Type-ahead autocomplete — faster than geocode(), backed by Photon. */
  async autocomplete(query: string, lang = 'en'): Promise<AutocompleteSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const url = `${PHOTON_BASE}?q=${encodeURIComponent(trimmed)}&lang=${lang}`;
    const raw = await fetchJson<PhotonResponse>(url);
    return raw.features.map(f => {
      const [lon, lat] = f.geometry.coordinates;
      const nameParts = [f.properties.name, f.properties.city, f.properties.country].filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      );
      return {
        id: String(f.properties.osm_id),
        displayName: nameParts.join(', ') || 'Unknown',
        point: toGeoPoint(lat, lon),
        category: f.properties.osm_value,
      };
    });
  },

  /** Driving route between two points via OSRM public demo. */
  async route(from: GeoPoint, to: GeoPoint): Promise<RouteResult | null> {
    const url = `${OSRM_BASE}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const raw = await fetchJson<OsrmResponse>(url);
    if (raw.code !== 'Ok' || raw.routes.length === 0) return null;
    const [r] = raw.routes;
    if (!r) return null;
    return {
      distance: r.distance,
      duration: r.duration,
      geometry: r.geometry.coordinates,
    };
  },
};
