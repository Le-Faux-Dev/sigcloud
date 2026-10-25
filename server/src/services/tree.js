// Parcours de l'arborescence des dossiers (requêtes récursives paramétrées : aucune concaténation SQL).

export const MAX_DEPTH = 20;

/** Identifiants du dossier et de tous ses ancêtres, du plus proche (le dossier) vers la racine. */
export async function ancestorIds(db, folderId) {
  if (!folderId) return [];
  const rows = await db.$queryRaw`
    WITH RECURSIVE anc AS (
      SELECT "id", "parentId", 1 AS depth FROM folders WHERE "id" = ${folderId}
      UNION ALL
      SELECT f."id", f."parentId", a.depth + 1 FROM folders f JOIN anc a ON f."id" = a."parentId" WHERE a.depth < 100
    )
    SELECT "id" FROM anc ORDER BY depth`;
  return rows.map((r) => r.id);
}

/** Identifiants du dossier et de tous ses descendants. */
export async function descendantFolderIds(db, folderId) {
  const rows = await db.$queryRaw`
    WITH RECURSIVE d AS (
      SELECT "id", 1 AS depth FROM folders WHERE "id" = ${folderId}
      UNION ALL
      SELECT f."id", d.depth + 1 FROM folders f JOIN d ON f."parentId" = d."id" WHERE d.depth < 100
    )
    SELECT "id" FROM d`;
  return rows.map((r) => r.id);
}

/** Profondeur du dossier (la racine = 0). */
export async function folderDepth(db, folderId) {
  if (!folderId) return 0;
  return (await ancestorIds(db, folderId)).length;
}

/** Hauteur du sous-arbre sous un dossier (le dossier seul = 1). */
export async function subtreeHeight(db, folderId) {
  const rows = await db.$queryRaw`
    WITH RECURSIVE d AS (
      SELECT "id", 1 AS depth FROM folders WHERE "id" = ${folderId}
      UNION ALL
      SELECT f."id", d.depth + 1 FROM folders f JOIN d ON f."parentId" = d."id" WHERE d.depth < 100
    )
    SELECT COALESCE(MAX(depth), 1)::int AS h FROM d`;
  return rows[0].h;
}
