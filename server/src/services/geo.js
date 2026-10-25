import { DOMParser } from '@xmldom/xmldom';
import { kml as kmlToGeoJson, gpx as gpxToGeoJson } from '@tmcw/togeojson';

// Analyse et assainissement des données vectorielles pour l'aperçu cartographique.
// Principe : on ne calcule et on n'affiche que ce qui a réellement été vérifié.
// Les valeurs d'attributs sont traitées comme NON FIABLES (le client les affiche avec textContent uniquement).

const MAX_FEATURES = 50_000;
const MAX_POSITIONS = 1_000_000;
const MAX_PROP_KEYS = 50;
const MAX_PROP_LEN = 500;
const TOLERANCE = 1e-6;

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

class Invalid extends Error {}

function sanitizeProperties(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= MAX_PROP_KEYS) break;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const key = String(k).slice(0, 100);
    if (typeof v === 'string') out[key] = v.slice(0, MAX_PROP_LEN);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean' || v === null) out[key] = v;
    // objets et tableaux imbriqués : ignorés (réduit la surface d'attaque et la taille)
    else continue;
    n++;
  }
  return out;
}

/** Valide récursivement une géométrie. Met à jour les statistiques. */
function walkGeometry(g, stats, depth = 0) {
  if (g === null) return;
  if (!g || typeof g !== 'object' || !GEOMETRY_TYPES.has(g.type) || depth > 5) throw new Invalid('géométrie invalide');
  if (g.type === 'GeometryCollection') {
    if (!Array.isArray(g.geometries)) throw new Invalid('GeometryCollection sans geometries');
    stats.types.add(g.type);
    for (const sub of g.geometries) walkGeometry(sub, stats, depth + 1);
    return;
  }
  stats.types.add(g.type);
  const c = g.coordinates;
  const position = (p) => {
    if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new Invalid('position invalide');
    }
    stats.positions++;
    if (stats.positions > MAX_POSITIONS) throw new Invalid('trop de positions');
    const [x, y] = p;
    if (x < stats.bbox[0]) stats.bbox[0] = x;
    if (y < stats.bbox[1]) stats.bbox[1] = y;
    if (x > stats.bbox[2]) stats.bbox[2] = x;
    if (y > stats.bbox[3]) stats.bbox[3] = y;
    if (Math.abs(x) > 180 + TOLERANCE || Math.abs(y) > 90 + TOLERANCE) stats.outOfRange = true;
  };
  const line = (l, min) => {
    if (!Array.isArray(l) || l.length < min) throw new Invalid('ligne invalide');
    l.forEach(position);
  };
  switch (g.type) {
    case 'Point':
      position(c);
      break;
    case 'MultiPoint':
      if (!Array.isArray(c)) throw new Invalid('MultiPoint invalide');
      c.forEach(position);
      break;
    case 'LineString':
      line(c, 2);
      break;
    case 'MultiLineString':
      if (!Array.isArray(c)) throw new Invalid('MultiLineString invalide');
      c.forEach((l) => line(l, 2));
      break;
    case 'Polygon':
      if (!Array.isArray(c) || c.length === 0) throw new Invalid('Polygon invalide');
      c.forEach((r) => line(r, 4));
      break;
    case 'MultiPolygon':
      if (!Array.isArray(c)) throw new Invalid('MultiPolygon invalide');
      c.forEach((p) => {
        if (!Array.isArray(p) || p.length === 0) throw new Invalid('MultiPolygon invalide');
        p.forEach((r) => line(r, 4));
      });
      break;
    default:
      throw new Invalid('géométrie inconnue');
  }
}

/**
 * Analyse un objet GeoJSON déjà parsé.
 * @returns {{ok: false, reason: string} | {ok: true, previewable: boolean, reason?: string, featureCollection?: object, meta?: object}}
 */
export function analyzeGeoJson(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'INVALID_GEOJSON' };

    let features;
    if (value.type === 'FeatureCollection') {
      if (!Array.isArray(value.features)) return { ok: false, reason: 'INVALID_GEOJSON' };
      features = value.features;
    } else if (value.type === 'Feature') {
      features = [value];
    } else if (GEOMETRY_TYPES.has(value.type)) {
      features = [{ type: 'Feature', geometry: value, properties: {} }];
    } else {
      return { ok: false, reason: 'INVALID_GEOJSON' };
    }
    if (features.length > MAX_FEATURES) return { ok: true, previewable: false, reason: 'TOO_MANY_FEATURES' };

    // Ancien membre « crs » (retiré de la norme RFC 7946) : on n'affiche que du WGS84.
    if (value.crs !== undefined) {
      const name = String(value.crs?.properties?.name ?? '');
      if (!/(CRS84|EPSG::?4326)/i.test(name)) return { ok: true, previewable: false, reason: 'CRS_NOT_WGS84' };
    }

    const stats = { types: new Set(), positions: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], outOfRange: false };
    const cleaned = [];
    for (const f of features) {
      if (!f || typeof f !== 'object' || f.type !== 'Feature') throw new Invalid('élément non Feature');
      walkGeometry(f.geometry ?? null, stats);
      cleaned.push({ type: 'Feature', geometry: f.geometry ?? null, properties: sanitizeProperties(f.properties) });
    }
    if (stats.outOfRange) return { ok: true, previewable: false, reason: 'COORDINATES_NOT_WGS84' };

    const hasBbox = Number.isFinite(stats.bbox[0]);
    return {
      ok: true,
      previewable: true,
      featureCollection: { type: 'FeatureCollection', features: cleaned },
      meta: {
        featureCount: cleaned.length,
        geometryTypes: [...stats.types].sort(),
        bbox: hasBbox ? stats.bbox.map((n) => Math.round(n * 1e6) / 1e6) : null,
        crs: 'EPSG:4326',
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, reason: 'INVALID_GEOJSON' };
    throw err;
  }
}

/** Analyse du texte JSON. `.geojson` doit être du GeoJSON ; `.json` peut être un JSON quelconque. */
export function analyzeGeoJsonText(text, { strict }) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }
  const result = analyzeGeoJson(value);
  if (!result.ok && !strict) return { ok: true, previewable: false, reason: 'NOT_GEOJSON' };
  return result;
}

/** KML : un DOCTYPE/ENTITY n'a aucune raison d'être dans un KML (XXE, « billion laughs ») → refusé. */
export function analyzeKmlText(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { ok: false, reason: 'XML_DTD_FORBIDDEN' };
  let fc;
  try {
    const errors = [];
    const doc = new DOMParser({ onError: (level, msg) => errors.push({ level, msg }) }).parseFromString(text, 'text/xml');
    if (errors.some((e) => e.level === 'fatalError' || e.level === 'error') || !doc?.documentElement) {
      return { ok: false, reason: 'INVALID_KML' };
    }
    if (doc.documentElement.nodeName.toLowerCase() !== 'kml') return { ok: false, reason: 'INVALID_KML' };
    fc = kmlToGeoJson(doc);
  } catch {
    return { ok: false, reason: 'INVALID_KML' };
  }
  const result = analyzeGeoJson(fc);
  if (!result.ok) return { ok: false, reason: 'INVALID_KML' };
  return result;
}

/** GPX : mêmes protections que le KML (pas de DTD), conversion en GeoJSON (traces, itinéraires, points). */
export function analyzeGpxText(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { ok: false, reason: 'XML_DTD_FORBIDDEN' };
  let fc;
  try {
    const errors = [];
    const doc = new DOMParser({ onError: (level, msg) => errors.push({ level, msg }) }).parseFromString(text, 'text/xml');
    if (errors.some((e) => e.level === 'fatalError' || e.level === 'error') || !doc?.documentElement) return { ok: false, reason: 'INVALID_GPX' };
    if (doc.documentElement.nodeName.toLowerCase() !== 'gpx') return { ok: false, reason: 'INVALID_GPX' };
    fc = gpxToGeoJson(doc);
  } catch {
    return { ok: false, reason: 'INVALID_GPX' };
  }
  const result = analyzeGeoJson(fc);
  if (!result.ok) return { ok: false, reason: 'INVALID_GPX' };
  return result;
}
