/**
 * Google Maps color style — palette reused across markers, polylines,
 * callouts, overlays and the map background fill.
 *
 * Sourced from the default Google Maps light basemap. Use this instead of
 * hard-coded hex literals to keep the map feature-wide visual consistent.
 */
export const GOOGLE_MAPS_COLORS = {
  /** Neutral land fill / landscape.natural — very light gray. */
  land: '#E8E8E8',
  /** Alternate land shade (labels backgrounds, off-map gutters). */
  landSoft: '#F5F5F5',
  /** Local / residential roads. */
  road: '#FFFFFF',
  /** Secondary arterial roads. */
  secondaryRoad: '#FFF2AF',
  /** Secondary arterial deep (legacy fallback). */
  secondaryRoadDeep: '#F6CF65',
  /** Highway / motorway fill. */
  highway: '#F18D00',
  /** Highway stroke (darker outline). */
  highwayStroke: '#E5A020',
  /** Water bodies (sea, lakes, rivers). */
  water: '#AADAFF',
  /** Parks / vegetation / natural green. */
  park: '#C3ECB2',
  /** Park fill alt (POIs with nature label). */
  parkDeep: '#BBDAA4',
  /** Buildings. */
  building: '#D5D8DB',
  /** Map text labels. */
  text: '#555555',
  /** Text stroke (halo) for readability on varying tiles. */
  textStroke: '#FFFFFF',
  /** Points of interest — Google Maps vivid blue. */
  poi: '#4A80F5',
  /** POI secondary tint. */
  poiSecondary: '#9BBFF4',
  /** POI tertiary tint. */
  poiTertiary: '#A7CDF2',
} as const;

export type GoogleMapsColorKey = keyof typeof GOOGLE_MAPS_COLORS;
