// Tâches de nettoyage planifiées (Vercel Cron → GET /api/v1/cron/cleanup, protégé par CRON_SECRET).
// Chaque étape est isolée : l'échec d'une étape n'empêche pas les suivantes.

const DAY = 24 * 3600 * 1000;

export function createCleanupService(ctx) {
  const { db, log } = ctx;

  async function step(name, results, fn) {
    try {
      results[name] = await fn();
    } catch (err) {
      log.error('cleanup_step_failed', { step: name, error: err?.message });
      results[name] = { error: true };
    }
  }

  return {
    async run({ now = new Date() } = {}) {
      const results = {};
      const ago = (days) => new Date(now.getTime() - days * DAY);

      // 1) Envois abandonnés (> 24 h) : transfert annulé, objet supprimé, quota libéré.
      await step('abandonedUploads', results, async () => {
        const stale = await db.fileAsset.findMany({ where: { uploadStatus: 'UPLOADING', createdAt: { lt: ago(1) } }, take: 200 });
        await ctx.files.deleteStored(stale);
        for (const f of stale) {
          await db.$transaction([db.fileAsset.delete({ where: { id: f.id } }), db.user.update({ where: { id: f.ownerId }, data: { usedBytes: { decrement: f.sizeBytes } } })]);
        }
        return { purged: stale.length };
      });

      // 2) Corbeille de plus de 30 jours : suppression définitive.
      await step('trash', results, async () => {
        const folders = await db.folder.findMany({ where: { trashRoot: true, deletedAt: { lt: ago(30) } }, take: 100 });
        for (const f of folders) await ctx.folders.purgeTree(f.id);
        const files = await db.fileAsset.findMany({ where: { trashRoot: true, deletedAt: { lt: ago(30) } }, take: 200 });
        await ctx.files.purgeRows(files);
        return { folders: folders.length, files: files.length };
      });

      await step('shareLinks', results, async () => {
        const r = await db.shareLink.deleteMany({ where: { OR: [{ revokedAt: { lt: ago(30) } }, { expiresAt: { lt: ago(30) } }] } });
        return { deleted: r.count };
      });

      await step('sessions', results, async () => {
        const r = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(1) } }, { revokedAt: { lt: ago(7) } }] } });
        return { deleted: r.count };
      });

      await step('resetTokens', results, async () => {
        const r = await db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(1) } }, { usedAt: { not: null } }] } });
        return { deleted: r.count };
      });

      await step('rateLimits', results, async () => {
        const r = await db.rateLimit.deleteMany({ where: { resetAt: { lt: now } } });
        return { deleted: r.count };
      });

      await step('auditRetention', results, async () => {
        const r = await db.auditLog.deleteMany({ where: { createdAt: { lt: ago(365) } } });
        return { deleted: r.count };
      });

      return results;
    },
  };
}
