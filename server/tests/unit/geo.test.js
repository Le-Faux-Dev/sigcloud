import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGeoJson, analyzeGeoJsonText, analyzeKmlText } from '../../src/services/geo.js';

const point = (c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });

test('GeoJSON : emprise et types calculés ; Feature seule et géométrie seule acceptées', () => {
  const r = analyzeGeoJson({ type: 'FeatureCollection', features: [point([1, 2]), point([3, -4])] });
  assert.equal(r.previewable, true);
  assert.deepEqual(r.meta.bbox, [1, -4, 3, 2]);
  assert.equal(analyzeGeoJson(point([1, 2])).previewable, true);
  assert.equal(analyzeGeoJson({ type: 'Point', coordinates: [1, 2] }).previewable, true);
});

test('GeoJSON : structures invalides refusées', () => {
  for (const bad of [null, [], 'x', 3, {}, { type: 'FeatureCollection' }, { type: 'FeatureCollection', features: 'non' }, { type: 'Chose' },
    { type: 'FeatureCollection', features: [{ type: 'Pas-une-feature' }] },
    { type: 'FeatureCollection', features: [point('1,2')] },
    { type: 'FeatureCollection', features: [point([1])] },
    { type: 'FeatureCollection', features: [point([1, 'a'])] },
    { type: 'FeatureCollection', features: [point([1, NaN])] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0]] } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Chose', coordinates: [] } }] }]) {
    assert.equal(analyzeGeoJson(bad).ok, false, JSON.stringify(bad)?.slice(0, 60));
  }
});

test('GeoJSON : coordonnées hors WGS84 et CRS non WGS84 : stockés mais non prévisualisables', () => {
  assert.equal(analyzeGeoJson({ type: 'FeatureCollection', features: [point([500000, 4000000])] }).reason, 'COORDINATES_NOT_WGS84');
  assert.equal(analyzeGeoJson({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32630' } }, features: [point([1, 1])] }).reason, 'CRS_NOT_WGS84');
  assert.equal(analyzeGeoJson({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: [point([1, 1])] }).previewable, true);
});

test('GeoJSON : propriétés assainies (prototype, imbriqué, longueur, nombre de clés)', () => {
  const props = JSON.parse('{"__proto__":{"x":1},"constructor":"c","a":"' + 'z'.repeat(2000) + '","n":1,"o":{"k":1},"t":[1],"b":true,"nul":null}');
  const r = analyzeGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: props }] });
  const out = r.featureCollection.features[0].properties;
  assert.equal(out.a.length, 500);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'n', 'nul']);
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
  const r2 = analyzeGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: many }] });
  assert.equal(Object.keys(r2.featureCollection.features[0].properties).length, 50);
});

test('GeoJSON : trop d\'éléments → non prévisualisable ; imbrication excessive refusée', () => {
  const features = Array.from({ length: 50_001 }, () => point([0, 0]));
  assert.equal(analyzeGeoJson({ type: 'FeatureCollection', features }).reason, 'TOO_MANY_FEATURES');
  let g = { type: 'Point', coordinates: [0, 0] };
  for (let i = 0; i < 10; i++) g = { type: 'GeometryCollection', geometries: [g] };
  assert.equal(analyzeGeoJson({ type: 'Feature', properties: {}, geometry: g }).ok, false);
});

test('JSON texte : strict (.geojson) ou souple (.json)', () => {
  assert.equal(analyzeGeoJsonText('{"a":1}', { strict: true }).ok, false);
  assert.equal(analyzeGeoJsonText('{"a":1}', { strict: false }).previewable, false);
  assert.equal(analyzeGeoJsonText('pas du json', { strict: false }).reason, 'INVALID_JSON');
});

test('KML : placemarks convertis ; DOCTYPE/ENTITY refusés ; XML cassé refusé ; racine non-KML refusée', () => {
  const kml = '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A</name><Point><coordinates>1,2,0</coordinates></Point></Placemark><Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark></Document></kml>';
  const r = analyzeKmlText(kml);
  assert.equal(r.previewable, true);
  assert.equal(r.meta.featureCount, 2);
  assert.equal(analyzeKmlText('<!DOCTYPE x [<!ENTITY a "b">]><kml/>').reason, 'XML_DTD_FORBIDDEN');
  assert.equal(analyzeKmlText('<!doctype kml><kml/>').reason, 'XML_DTD_FORBIDDEN');
  assert.equal(analyzeKmlText('<kml><Document>').ok, false);
  assert.equal(analyzeKmlText('<html><body/></html>').ok, false);
  assert.equal(analyzeKmlText('pas du xml').ok, false);
});
