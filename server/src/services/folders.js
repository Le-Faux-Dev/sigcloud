import { randomHex } from '../lib/crypto.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { fileDto, folderDto } from '../lib/dto.js';
import { sanitizeName } from '../config/policy.js';
import { ancestorIds, descendantFolderIds, folderDepth, subtreeHeight, MAX_DEPTH } from './tree.js';

export function createFoldersService(ctx) {
  const { db } = ctx;

  async function ownerFolder(user, id, { trashed = false } = {}) {
    const folder = await db.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== user.id) throw notFound('Dossier introuvable.');
    if (trashed ? !folder.deletedAt : folder.deletedAt) throw notFound('Dossier introuvable.');
    return folder;
  }

  const cleanName = (raw) => {
    const name = sanitizeName(raw);
    if (!name) throw unprocessable('INVALID_NAME', 'Nom invalide.');
    return name;
  };

  return {
    async create(user, { name, parentId }) {
      const parent = parentId ? await ownerFolder(user, parentId) : null;
      if (parent && (await folderDepth(db, parent.id)) >= MAX_DEPTH) {
        throw unprocessable('MAX_DEPTH', `Profondeur maximale de ${MAX_DEPTH} niveaux atteinte.`);
      }
      return folderDto(await db.folder.create({ data: { ownerId: user.id, parentId: parent?.id ?? null, name: cleanName(name) } }));
    },

    /** Renommer et/ou déplacer (avec protection contre les cycles et la profondeur excessive). */
    async update(user, id, patch) {
      const folder = await ownerFolder(user, id);
      const data = {};
      if (patch.name !== undefined) data.name = cleanName(patch.name);
      if (patch.parentId !== undefined) {
        if (patch.parentId !== null) {
          const target = await ownerFolder(user, patch.parentId);
          const subtree = await descendantFolderIds(db, folder.id);
          if (subtree.includes(target.id)) throw unprocessable('FOLDER_CYCLE', 'Impossible de déplacer un dossier dans lui-même ou dans un de ses sous-dossiers.');
          const depth = (await folderDepth(db, target.id)) + (await subtreeHeight(db, folder.id));
          if (depth > MAX_DEPTH) throw unprocessable('MAX_DEPTH', `Profondeur maximale de ${MAX_DEPTH} niveaux dépassée.`);
        }
        data.parentId = patch.parentId;
      }
      return folderDto(await db.folder.update({ where: { id: folder.id }, data }));
    },

    /** Contenu d'un dossier pour son propriétaire OU un destinataire de partage ('root' = racine du propriétaire). */
    async contents(user, idOrRoot) {
      if (idOrRoot === 'root') {
        const [folders, files] = await Promise.all([
          db.folder.findMany({ where: { ownerId: user.id, parentId: null, deletedAt: null }, orderBy: { name: 'asc' }, take: 1000 }),
          db.fileAsset.findMany({ where: { ownerId: user.id, folderId: null, deletedAt: null, uploadStatus: 'READY' }, orderBy: { name: 'asc' }, take: 1000 }),
        ]);
        return { folder: null, breadcrumb: [], level: 'owner', canDownload: true, folders: folders.map(folderDto), files: files.map(fileDto) };
      }
      const access = await ctx.access.folderAccess(user, idOrRoot);
      const ownerId = access.folder.ownerId;
      const [folders, files, chain] = await Promise.all([
        db.folder.findMany({ where: { ownerId, parentId: access.folder.id, deletedAt: null }, orderBy: { name: 'asc' }, take: 1000 }),
        db.fileAsset.findMany({ where: { ownerId, folderId: access.folder.id, deletedAt: null, uploadStatus: 'READY' }, orderBy: { name: 'asc' }, take: 1000 }),
        ancestorIds(db, access.folder.id),
      ]);
      // Fil d'Ariane : un destinataire ne voit jamais les dossiers situés AU-DESSUS du dossier partagé.
      let ids = chain.slice().reverse();
      if (access.level === 'grant') ids = ids.slice(ids.indexOf(access.rootFolderId));
      const named = await db.folder.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      const byId = new Map(named.map((f) => [f.id, f.name]));
      return {
        folder: folderDto(access.folder),
        breadcrumb: ids.map((fid) => ({ id: fid, name: byId.get(fid) })),
        level: access.level,
        canDownload: access.canDownload,
        folders: folders.map(folderDto),
        files: files.map(fileDto),
      };
    },

    /** Corbeille : le dossier et tout son contenu partent ensemble (même lot, restaurables ensemble). */
    async trash(user, id) {
      const folder = await ownerFolder(user, id);
      const batch = randomHex(8);
      const ids = await descendantFolderIds(db, folder.id);
      const now = new Date();
      await db.$transaction([
        db.folder.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now, trashBatchId: batch } }),
        db.folder.update({ where: { id: folder.id }, data: { trashRoot: true } }),
        db.fileAsset.updateMany({ where: { folderId: { in: ids }, deletedAt: null }, data: { deletedAt: now, trashBatchId: batch } }),
      ]);
    },

    async restore(user, id) {
      const folder = await ownerFolder(user, id, { trashed: true });
      if (!folder.trashRoot) throw notFound('Dossier introuvable.');
      let parentId = folder.parentId;
      if (parentId) {
        const parent = await db.folder.findUnique({ where: { id: parentId } });
        if (!parent || parent.deletedAt) parentId = null;
      }
      const batch = folder.trashBatchId;
      await db.$transaction([
        db.folder.updateMany({ where: { ownerId: user.id, trashBatchId: batch }, data: { deletedAt: null, trashBatchId: null, trashRoot: false } }),
        db.fileAsset.updateMany({ where: { ownerId: user.id, trashBatchId: batch }, data: { deletedAt: null, trashBatchId: null, trashRoot: false } }),
        db.folder.update({ where: { id: folder.id }, data: { parentId } }),
      ]);
      return folderDto(await db.folder.findUnique({ where: { id: folder.id } }));
    },

    /** Suppression définitive : objets de stockage d'abord, puis la base (cascade), puis le quota. */
    async purge(user, id) {
      const folder = await ownerFolder(user, id, { trashed: true });
      if (!folder.trashRoot) throw notFound('Dossier introuvable.');
      await this.purgeTree(folder.id);
    },

    async purgeTree(folderId) {
      const ids = await descendantFolderIds(db, folderId);
      const files = await db.fileAsset.findMany({ where: { folderId: { in: ids } } });
      await ctx.files.purgeRows(files);
      await db.folder.delete({ where: { id: folderId } });
    },

    async listTrash(user) {
      const [folders, files] = await Promise.all([
        db.folder.findMany({ where: { ownerId: user.id, deletedAt: { not: null }, trashRoot: true }, orderBy: { deletedAt: 'desc' }, take: 500 }),
        db.fileAsset.findMany({ where: { ownerId: user.id, deletedAt: { not: null }, trashRoot: true }, orderBy: { deletedAt: 'desc' }, take: 500 }),
      ]);
      return {
        folders: folders.map((f) => ({ ...folderDto(f), deletedAt: f.deletedAt })),
        files: files.map((f) => ({ ...fileDto(f), deletedAt: f.deletedAt })),
      };
    },

    async emptyTrash(user) {
      const roots = await db.folder.findMany({ where: { ownerId: user.id, deletedAt: { not: null }, trashRoot: true } });
      for (const f of roots) await this.purgeTree(f.id);
      const files = await db.fileAsset.findMany({ where: { ownerId: user.id, deletedAt: { not: null }, trashRoot: true } });
      await ctx.files.purgeRows(files);
      return { purgedFolders: roots.length, purgedFiles: files.length };
    },

    ownerFolder,
  };
}
