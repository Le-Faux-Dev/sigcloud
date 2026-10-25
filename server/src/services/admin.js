import { badRequest, notFound } from '../lib/errors.js';
import { num } from '../lib/dto.js';

export function createAdminService(ctx) {
  const { db } = ctx;

  return {
    async listUsers({ limit, offset }) {
      const [rows, total] = await Promise.all([
        db.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: { id: true, email: true, displayName: true, role: true, quotaBytes: true, usedBytes: true, disabledAt: true, createdAt: true, _count: { select: { files: true } } },
        }),
        db.user.count(),
      ]);
      return {
        total,
        items: rows.map((u) => ({ ...u, quotaBytes: num(u.quotaBytes), usedBytes: num(u.usedBytes), fileCount: u._count.files, _count: undefined })),
      };
    },

    async updateUser(actor, id, { quotaBytes, disabled }) {
      const user = await db.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      if (disabled === true && user.id === actor.id) throw badRequest('CANNOT_DISABLE_SELF', 'Tu ne peux pas désactiver ton propre compte.');
      if (quotaBytes !== undefined && BigInt(quotaBytes) < user.usedBytes) {
        throw badRequest('QUOTA_BELOW_USAGE', "Le quota ne peut pas être inférieur à l'espace déjà utilisé.", { usedBytes: Number(user.usedBytes) });
      }
      const data = {};
      if (quotaBytes !== undefined) data.quotaBytes = BigInt(quotaBytes);
      if (disabled !== undefined) data.disabledAt = disabled ? new Date() : null;
      const ops = [db.user.update({ where: { id }, data })];
      // Un compte désactivé perd immédiatement toutes ses sessions.
      if (disabled === true) ops.push(db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }));
      await db.$transaction(ops);
      return { id, quotaBytes: quotaBytes ?? num(user.quotaBytes), disabled: disabled ?? Boolean(user.disabledAt) };
    },

    /** Statistiques réelles (comptées en base). */
    async stats() {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const [users, files, pending, usage, events24h, rejected24h] = await Promise.all([
        db.user.count(),
        db.fileAsset.count({ where: { uploadStatus: 'READY' } }),
        db.fileAsset.count({ where: { uploadStatus: 'UPLOADING' } }),
        db.user.aggregate({ _sum: { usedBytes: true } }),
        db.auditLog.count({ where: { createdAt: { gte: since } } }),
        db.auditLog.count({ where: { action: 'upload.rejected', createdAt: { gte: since } } }),
      ]);
      return { users, files, pendingUploads: pending, totalUsedBytes: num(usage._sum.usedBytes ?? 0n), auditEvents24h: events24h, rejectedUploads24h: rejected24h };
    },

    async auditList({ limit, offset }) {
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        db.auditLog.count(),
      ]);
      return {
        total,
        items: rows.map((a) => ({ id: Number(a.id), userId: a.userId, action: a.action, targetType: a.targetType, targetId: a.targetId, meta: a.meta, createdAt: a.createdAt })),
      };
    },
  };
}
