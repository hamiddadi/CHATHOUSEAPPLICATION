/**
 * Tile provider presets compatible with `<UrlTile>` from react-native-maps.
 *
 * UrlTile does NOT support the `{s}` subdomain placeholder — use a fixed
 * subdomain (e.g. `a.`) or a CDN without sharding.
 */

export interface TileProvider {
  /** Template URL — placeholders: `{x}`, `{y}`, `{z}`. */
  urlTemplate: string;
  /** Max zoom level supported by the provider. */
  maximumZ: number;
  /** Human-readable attribution shown on the map. */
  attribution: string;
  /** Tile size in pixels (OSM raster = 256). */
  tileSize: number;
}

/** Standard OSM cartography (light). Good default, no key, ODbL attribution required. */
export const OSM_STANDARD: TileProvider = {
  urlTemplate: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
  maximumZ: 19,
  attribution: '© OpenStreetMap contributors',
  tileSize: 256,
};

/** CARTO Dark Matter — free-tier dark basemap (alternative). */
export const CARTO_DARK_MATTER: TileProvider = {
  urlTemplate: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  maximumZ: 20,
  attribution: '© OpenStreetMap contributors · © CARTO',
  tileSize: 256,
};

/**
 * Google Maps color style — CARTO Voyager preset.
 * Free, no API key, close visual clone of Google Maps default basemap:
 *   - light gray land, white roads, orange highways
 *   - pastel green parks, aqua water, soft gray buildings
 */
export const CARTO_VOYAGER: TileProvider = {
  urlTemplate: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  maximumZ: 20,
  attribution: '© OpenStreetMap contributors · © CARTO',
  tileSize: 256,
};

/** Pick this in `MapsScreen`. Google Maps color style → CARTO Voyager. */
export const ACTIVE_TILE_PROVIDER = CARTO_VOYAGER; // Google Maps color style
