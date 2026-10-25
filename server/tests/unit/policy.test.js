import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, checkSignature, inspectName, sanitizeName } from '../../src/config/policy.js';

test('inspectName : extensions autorisées, refusées, absentes, 7z différé', () => {
  assert.equal(inspectName('carte.GeoJSON').ext, 'geojson');
  assert.equal(inspectName('archive.tar.zip').ext, 'zip');
  assert.equal(inspectName('script.php').code, 'FORMAT_NOT_ALLOWED');
  assert.equal(inspectName('run.exe').code, 'FORMAT_NOT_ALLOWED');
  assert.equal(inspectName('page.html').code, 'FORMAT_NOT_ALLOWED');
  assert.equal(inspectName('image.svg').code, 'FORMAT_NOT_ALLOWED', 'SVG refusé : peut contenir du script');
  assert.equal(inspectName('.htaccess').code, 'NO_EXTENSION');
  assert.equal(inspectName('fin.').code, 'NO_EXTENSION');
  assert.equal(inspectName('a.7z').code, 'FORMAT_DEFERRED');
  assert.equal(inspectName('double.png.exe').code, 'FORMAT_NOT_ALLOWED');
});

test('aucun format actif dans la liste (html, svg, js, exécutables)', () => {
  for (const bad of ['html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'bat', 'sh', 'php', 'jsp', 'xhtml', 'swf']) assert.equal(bad in FORMATS, false, bad);
});

test('signatures : octets réels', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(checkSignature('png', png).ok, true);
  assert.equal(checkSignature('png', Buffer.from('MZ\x90\x00')).ok, false);
  assert.equal(checkSignature('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])).ok, true);
  assert.equal(checkSignature('pdf', Buffer.from('%PDF-1.7')).ok, true);
  assert.equal(checkSignature('pdf', Buffer.from('<html>')).ok, false);
  assert.equal(checkSignature('zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])).ok, true);
  assert.equal(checkSignature('zip', Buffer.from([0x50, 0x4b, 0x05, 0x06])).ok, false, 'archive vide refusée');
  assert.equal(checkSignature('sqlite', Buffer.from('SQLite format 3\0')).ok, true);
  assert.equal(checkSignature('tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00])).ok, true);
  assert.equal(checkSignature('webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).ok, true);
  assert.equal(checkSignature('webp', Buffer.from('RIFF\0\0\0\0WAVEfmt ')).ok, false);
  assert.equal(checkSignature('text', Buffer.from('a,b\n1,2\n')).ok, true);
  assert.equal(checkSignature('text', Buffer.from([0x4d, 0x5a, 0x00, 0x01])).ok, false, 'octet nul : pas du texte');
  assert.equal(checkSignature('json', Buffer.from('  {"a":1}')).ok, true);
  assert.equal(checkSignature('json', Buffer.from('MZ')).ok, false);
  assert.equal(checkSignature('xml', Buffer.from('﻿<?xml version="1.0"?>')).ok, true);
  assert.equal(checkSignature('xml', Buffer.from('bonjour')).ok, false);
  assert.equal(checkSignature('none', Buffer.from('n importe quoi')).deep, false, 'aucun contrôle fiable → jamais « vérifié »');
});

test('sanitizeName : traversée de chemin, caractères de contrôle, bidi, longueur', () => {
  assert.equal(sanitizeName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeName('..\\..\\win.ini'), '.._.._win.ini');
  assert.equal(sanitizeName('a\u0000b\u0007c.txt'), 'abc.txt');
  assert.equal(sanitizeName('fdp‮gnp.txt'), 'fdpgnp.txt');
  assert.equal(sanitizeName('..'), '');
  assert.equal(sanitizeName('  espaces.txt  '), 'espaces.txt');
  assert.equal(sanitizeName('x'.repeat(400)).length, 255);
  assert.equal(sanitizeName(null), '');
});

test('nouvelles signatures : shp/shx, dbf, hfa (.img), sid', () => {
  const shp = Buffer.alloc(100);
  shp.writeInt32BE(9994, 0);
  assert.equal(checkSignature('shp', shp).ok, true);
  assert.equal(checkSignature('shp', Buffer.from('hello world')).ok, false);
  const dbf = Buffer.alloc(64);
  dbf[0] = 0x03;
  assert.equal(checkSignature('dbf', dbf).ok, true);
  dbf[0] = 0x4d;
  assert.equal(checkSignature('dbf', dbf).ok, false);
  assert.equal(checkSignature('hfa', Buffer.from('EHFA_HEADER_TAG....')).ok, true);
  assert.equal(checkSignature('sid', Buffer.from('msid\0\0')).ok, true);
  assert.equal(checkSignature('sid', Buffer.from('MZ')).ok, false);
  for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg', 'qmd', 'sbn', 'sbx', 'lock', 'gpx', 'dxf', 'gdb', 'img', 'vrt', 'asc', 'sid', 'bil']) assert.ok(FORMATS[ext], ext);
});
