import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { fileDto, folderDto, publicFileDto } from '../lib/dto.js';

const MAX_ACTIVE_LINKS = 200;

export function createSharesService(ctx) {
  const { db, config } = ctx;

  async function ownedTarget(user, { fileId, folderId }) {
    if (fileId) {
      const f = await db.fileAsset.findUnique({ where: { id: fileId } });
      if (!f || f.ownerId !== user.id || f.deletedAt || f.uploadStatus !== 'READY') throw notFound();
      return { kind: 'file', row: f };
    }
    const d = await db.folder.findUnique({ where: { id: folderId } });
    if (!d || d.ownerId !== user.id || d.deletedAt) throw notFound();
    return { kind: 'folder', row: d };
  }

  const linkDto = (l) => ({
    id: l.id,
    fileId: l.fileId,
    folderId: l.folderId,
    canDownload: l.canDownload,
    expiresAt: l.expiresAt,
    revokedAt: l.revokedAt,
    createdAt: l.createdAt,
    status: l.revokedAt ? 'revoked' : l.expiresAt && l.expiresAt <= new Date() ? 'expired' : 'active',
  });

  return {
    /** Crée un lien. Le jeton n'est renvoyé QU'UNE FOIS : seul son hash est conservé. Privé par défaut tant qu'aucun lien n'existe. */
    async createLink(user, { fileId, folderId, canDownload, expiresInDays }) {
      const target = await ownedTarget(user, { fileId, folderId });
      const active = await db.shareLink.count({ where: { createdById: user.id, revokedAt: null } });
      if (active >= MAX_ACTIVE_LINKS) throw unprocessable('TOO_MANY_LINKS', 'Trop de liens actifs. Révoque des liens inutiles.');
      const token = randomToken(32);
      const link = await db.shareLink.create({
        data: {
          tokenHash: sha256Hex(token),
          fileId: target.kind === 'file' ? target.row.id : null,
          folderId: target.kind === 'folder' ? target.row.id : null,
          createdById: user.id,
          canDownload,
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400 * 1000) : null,
        },
      });
      // Le jeton est placé dans le fragment (#) de l'URL : jamais envoyé au serveur, ni dans un en-tête Referer, ni dans les logs.
      return { link: linkDto(link), token, url: `${config.appOrigin}/share.html#${token}` };
    },

    async createGrant(user, { fileId, folderId, email, canDownload }) {
      const target = await ownedTarget(user, { fileId, folderId });
      if (email === user.email) throw badRequest('CANNOT_SHARE_WITH_SELF', 'Tu ne peux pas partager avec toi-même.');
      const grantee = await db.user.findUnique({ where: { email } });
      // Réponse identique que le compte existe ou non (anti-énumération). Limite : la liste des partages du propriétaire.
      if (!grantee || grantee.disabledAt) return { accepted: true };
      const where = target.kind === 'file' ? { granteeId_fileId: { granteeId: grantee.id, fileId: target.row.id } } : { granteeId_folderId: { granteeId: grantee.id, folderId: target.row.id } };
      const existing = await db.shareGrant.findUnique({ where });
      if (existing) await db.shareGrant.update({ where: { id: existing.id }, data: { canDownload } });
      else {
        await db.shareGrant.create({
          data: { ownerId: user.id, granteeId: grantee.id, canDownload, fileId: target.kind === 'file' ? target.row.id : null, folderId: target.kind === 'folder' ? target.row.id : null },
        });
      }
      return { accepted: true };
    },

    /** Partages actifs d'une ressource (propriétaire uniquement). */
    async listForResource(user, { fileId, folderId }) {
      const target = await ownedTarget(user, { fileId, folderId });
      const key = target.kind === 'file' ? { fileId: target.row.id } : { folderId: target.row.id };
      const [links, grants] = await Promise.all([
        db.shareLink.findMany({ where: { ...key, revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
        db.shareGrant.findMany({ where: key, include: { grantee: { select: { email: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ]);
      return {
        links: links.map(linkDto),
        grants: grants.map((g) => ({ id: g.id, email: g.grantee.email, displayName: g.grantee.displayName, canDownload: g.canDownload, createdAt: g.createdAt })),
      };
    },

    async revokeLink(user, id) {
      const res = await db.shareLink.updateMany({ where: { id, createdById: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count === 0) throw notFound();
    },

    /** Révoquer un accès : le propriétaire le retire, ou le destinataire quitte le partage. */
    async revokeGrant(user, id) {
      const res = await db.shareGrant.deleteMany({ where: { id, OR: [{ ownerId: user.id }, { granteeId: user.id }] } });
      if (res.count === 0) throw notFound();
    },

    async sharedWithMe(user) {
      const grants = await db.shareGrant.findMany({
        where: { granteeId: user.id },
        include: { file: true, folder: true, owner: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const items = [];
      for (const g of grants) {
        const file = g.file && !g.file.deletedAt && g.file.uploadStatus === 'READY' ? g.file : null;
        const folder = g.folder && !g.folder.deletedAt ? g.folder : null;
        if (!file && !folder) continue;
        items.push({
          grantId: g.id,
          kind: file ? 'file' : 'folder',
          file: file ? fileDto({ ...file, folderId: null, description: null, tags: [], sha256: null }) : null,
          folder: folder ? { id: folder.id, name: folder.name } : null,
          ownerName: g.owner.displayName,
          canDownload: g.canDownload,
          sharedAt: g.createdAt,
        });
      }
      return { items };
    },

    async sharedByMe(user) {
      const [links, grants] = await Promise.all([
        db.shareLink.findMany({ where: { createdById: user.id, revokedAt: null }, include: { file: true, folder: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
        db.shareGrant.findMany({ where: { ownerId: user.id }, include: { file: true, folder: true, grantee: { select: { email: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
      ]);
      const name = (x) => (x.file ?? x.folder)?.name ?? '(supprimé)';
      return {
        links: links.filter((l) => !(l.file ?? l.folder)?.deletedAt).map((l) => ({ ...linkDto(l), targetName: name(l), targetKind: l.fileId ? 'file' : 'folder' })),
        grants: grants.filter((g) => !(g.file ?? g.folder)?.deletedAt).map((g) => ({
          id: g.id,
          targetId: g.fileId ?? g.folderId,
          targetName: name(g),
          targetKind: g.fileId ? 'file' : 'folder',
          email: g.grantee.email,
          displayName: g.grantee.displayName,
          canDownload: g.canDownload,
          createdAt: g.createdAt,
        })),
      };
    },

    // ---------- Accès anonyme par lien (jeton dans l'en-tête X-Share-Token) ----------

    /** Racine du lien : métadonnées minimales (ni propriétaire, ni chemin, ni identifiants parents). */
    async publicRoot(link) {
      if (link.file) return { kind: 'file', canDownload: link.canDownload, expiresAt: link.expiresAt, file: publicFileDto(link.file) };
      return { kind: 'folder', canDownload: link.canDownload, expiresAt: link.expiresAt, ...(await this.publicFolder(link, link.folderId)) };
    },

    async publicFolder(link, folderId) {
      if (!(await ctx.access.linkCoversFolder(link, folderId))) throw notFound();
      const folder = await db.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.deletedAt) throw notFound();
      const [folders, files] = await Promise.all([
        db.folder.findMany({ where: { parentId: folderId, deletedAt: null }, orderBy: { name: 'asc' }, take: 1000 }),
        db.fileAsset.findMany({ where: { folderId, deletedAt: null, uploadStatus: 'READY' }, orderBy: { name: 'asc' }, take: 1000 }),
      ]);
      return {
        folder: { id: folder.id, name: folder.name, isRoot: folder.id === link.folderId },
        folders: folders.map((f) => ({ id: f.id, name: f.name })),
        files: files.map(publicFileDto),
      };
    },

    async publicFile(link, fileId) {
      const file = await db.fileAsset.findUnique({ where: { id: fileId } });
      if (!file || !(await ctx.access.linkCoversFile(link, file))) throw notFound();
      return file;
    },

    folderDto,
  };
}
