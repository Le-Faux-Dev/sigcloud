# Formats de fichiers

Source de vérité : `server/src/config/policy.js`. Limite : **50 Mo** par fichier (`MAX_FILE_BYTES`). Quota par défaut : 1 Go par compte.

La liste blanche porte sur l'extension **et** sur le contenu : à la fin de l'envoi, le serveur lit le début du fichier et vérifie qu'il correspond au format annoncé (« signature »). Un décalage = fichier refusé et supprimé.

| Extension | Format | Catégorie | Contrôle du contenu | Aperçu |
|---|---|---|---|---|
| geojson, json | GeoJSON | Vecteur | JSON valide ; GeoJSON validé et assaini | **Carte** (WGS84, ≤ 10 Mo, nombre d'entités limité) |
| kml | KML | Vecteur | XML, DTD/ENTITY refusés | **Carte** (converti en GeoJSON) |
| gpx | GPX (traces GPS) | Vecteur | XML, DTD/ENTITY refusés | **Carte** (traces, itinéraires, points) |
| shp, shx, sbn, sbx | Shapefile et index | Vecteur | « file code » 9994 en tête | Stocké seulement |
| dbf | Attributs Shapefile | Vecteur | octet de version dBase | Stocké seulement |
| prj, cpg | Projection, encodage | Vecteur | texte | Stocké seulement |
| qmd | Métadonnées QGIS | Vecteur | XML | Stocké seulement |
| lock | Fichier de verrou | Vecteur | aucun contrôle fiable → « non analysé en profondeur » | Stocké seulement |
| kmz, gml, gpkg | KMZ, GML, GeoPackage | Vecteur | zip / xml / sqlite | Stocké seulement |
| dxf | DXF (version texte) | Vecteur | texte (le DXF binaire est refusé) | Stocké seulement |
| gdb | File Geodatabase | Vecteur | zip : le dossier .gdb doit être **compressé** | Stocké seulement |
| tif, tiff, jp2 | GeoTIFF, JPEG 2000 | Raster | en-tête | Stocké seulement |
| img | ERDAS IMAGINE | Raster | « EHFA_HEADER_TAG » | Stocké seulement |
| sid | MrSID | Raster | « msid » | Stocké seulement |
| vrt, asc | Raster virtuel, ASCII Grid | Raster | xml / texte | Stocké seulement |
| ecw, bil | ECW, BIL | Raster | aucun contrôle fiable → « non analysé en profondeur » | Stocké seulement |
| jpg, jpeg, png, webp | Images | Image | signature | **Image** |
| csv, txt | Texte | Document | texte | **Texte** (début du fichier) |
| pdf | PDF | Document | signature | **PDF** (lecteur du navigateur) |
| xml, xlsx | XML, Excel | Document | xml / zip | Stocké seulement |
| zip | Archive | Archive | signature zip | Stocké seulement, **jamais extrait** |
| qgz, qgs, aprx, ppkx | Projets QGIS / ArcGIS | Projet SIG | zip / xml / aucun | Stocké seulement, avec un avertissement (couches externes) |

Un fichier `.vrt` ou un projet SIG référence souvent d'autres fichiers par chemin : SIG-Cloud ne les résout pas et ne les ouvre jamais.

## Shapefile

Un Shapefile est un ensemble de fichiers (`.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `.sbn`, `.sbx`, `.qmd`, `.lock`). On peut les envoyer **un par un** ou **dans un ZIP** (recommandé : un seul fichier, rien ne se perd). Chaque fichier est vérifié séparément ; SIG-Cloud ne vérifie pas que l'ensemble est complet ni cohérent. Pas d'aperçu au MVP.

## Raisons d'absence d'aperçu

`TOO_LARGE`, `COORDINATES_NOT_WGS84`, `TOO_MANY_FEATURES`, `NOT_GEOJSON`, ou format sans visionneuse : l'interface l'explique et propose le téléchargement.

## Ajouter un format

1. Une ligne dans `FORMATS` (avec le type de signature) ; 2. si c'est un nouveau type de signature, l'ajouter dans `checkSignature` avec un test dans `server/tests/unit/policy.test.js`.
