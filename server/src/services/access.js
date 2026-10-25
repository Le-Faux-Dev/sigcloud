import { sha256Hex } from '../lib/crypto.js';
import { gone, notFound } from '../lib/errors.js';
import { ancestorIds } from './tree.js';

// Point UNIQUE de décision d'accès (anti-IDOR/BOLA). Toute route qui touche un fichier ou un dossier passe ici.
// Règle : une ressource inaccessible répond « introuvable » (404), jamais « interdit » :
// on ne révèle pas qu'un identifiant existe chez quelqu'un d'autre.

export function createAccess(ctx) {
  const { db } = ctx;

  /** Droits d'un utilisateur connecté sur un dossier (propriétaire ou destinataire d'un partage). */
  async function folderAccess(user, folderId) {
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) throw notFound();
    if (folder.ownerId === user.id) return { folder, level: 'owner', canDownload: true, rootFolderId: null };

    const chain = await ancestorIds(db, folder.id);
    const grants = await db.shareGrant.findMany({ where: { granteeId: user.id, folderId: { in: chain } } });
    if (!grants.length) throw notFound();
    // Racine du partage = le dossier partagé le plus haut dans la chaîne (sert à borner le fil d'Ariane).
    const top = grants.reduce((best, g) => (chain.indexOf(g.folderId) > chain.indexOf(best.folderId) ? g : best));
    return { folder, level: 'grant', canDownload: grants.some((g) => g.canDownload), rootFolderId: top.folderId };
  }

  /** Droits d'un utilisateur connecté sur un fichier prêt (UPLOAD terminé). */
  async function fileAccess(user, fileId, { allowTrashed = false, allowPending = false } = {}) {
    const file = await db.fileAsset.findUnique({ where: { id: fileId } });
    if (!file) throw notFound();
    if (file.ownerId === user.id) {
      if (file.deletedAt && !allowTrashed) throw notFound();
      if (file.uploadStatus !== 'READY' && !allowPending) throw notFound();
      return { file, level: 'owner', canDownload: true, rootFolderId: null };
    }
    if (file.deletedAt || file.uploadStatus !== 'READY') throw notFound();

    const direct = await db.shareGrant.findUnique({ where: { granteeId_fileId: { granteeId: user.id, fileId: file.id } } });
    const chain = file.folderId ? await ancestorIds(db, file.folderId) : [];
    const viaFolder = chain.length ? await db.shareGrant.findMany({ where: { granteeId: user.id, folderId: { in: chain } } }) : [];
    if (!direct && !viaFolder.length) throw notFound();
    const canDownload = Boolean(direct?.canDownload) || viaFolder.some((g) => g.canDownload);
    const top = viaFolder.length
      ? viaFolder.reduce((best, g) => (chain.indexOf(g.folderId) > chain.indexOf(best.folderId) ? g : best))
      : null;
    return { file, level: 'grant', canDownload, rootFolderId: top?.folderId ?? null };
  }

  /**
   * Résout un lien de partage anonyme. Le jeton n'est jamais stocké en clair : on compare des hashes.
   * Inconnu → 404 ; révoqué ou expiré → 410 (le jeton à 256 bits n'est pas devinable).
   */
  async function resolveLink(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw notFound();
    const link = await db.shareLink.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { file: true, folder: true, createdBy: { select: { disabledAt: true } } },
    });
    if (!link || link.createdBy.disabledAt) throw notFound();
    if (link.revokedAt) throw gone('LINK_REVOKED', 'Ce lien de partage a été révoqué.');
    if (link.expiresAt && link.expiresAt <= new Date()) throw gone('LINK_EXPIRED', 'Ce lien de partage a expiré.');
    const target = link.file ?? link.folder;
    if (!target || target.deletedAt || (link.file && link.file.uploadStatus !== 'READY')) throw notFound();
    return link;
  }

  /** Le fichier est-il couvert par ce lien (le fichier lui-même, ou un fichier sous le dossier partagé) ? */
  async function linkCoversFile(link, file) {
    if (file.deletedAt || file.uploadStatus !== 'READY') return false;
    if (link.fileId) return link.fileId === file.id;
    if (!file.folderId) return false;
    return (await ancestorIds(db, file.folderId)).includes(link.folderId);
  }

  async function linkCoversFolder(link, folderId) {
    if (!link.folderId) return false;
    return (await ancestorIds(db, folderId)).includes(link.folderId);
  }

  return { folderAccess, fileAccess, resolveLink, linkCoversFile, linkCoversFolder };
}
