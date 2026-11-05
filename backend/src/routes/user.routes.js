'use strict';
const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../lib/errors');
const { parse, parseId } = require('../middleware/validate');
const { requireUser, signUserToken } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(128),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).default('ANDROID'),
  fcmToken: z.string().max(4096).nullish(),
  locale: z.string().max(32).nullish(),
  tzOffsetMin: z.number().int().min(-840).max(840).nullish(),
  appVersion: z.string().max(32).nullish(),
});
const profileSchema = deviceSchema.omit({ deviceId: true, platform: true });
const teamSchema = z.object({ name: z.string().min(1).max(120), logo: z.string().max(500).nullish() });
const matchSchema = z.object({
  homeName: z.string().max(120).nullish(),
  awayName: z.string().max(120).nullish(),
  kickoffAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date').nullish(),
});

/**
 * Anonymous, device-based accounts (no sign-up friction, like most score apps).
 * Favourites are stored here so they survive reinstalls; push fan-out itself uses FCM topics.
 */
module.exports = ({ prisma, redis }) => {
  const r = express.Router();

  r.post('/auth/device', rateLimit({ redis, max: 30, prefix: 'rl:auth' }), asyncHandler(async (req, res) => {
    const b = parse(deviceSchema, req.body);
    const user = await prisma.user.upsert({
      where: { deviceId: b.deviceId },
      create: {
        deviceId: b.deviceId, platform: b.platform, fcmToken: b.fcmToken ?? null, locale: b.locale ?? null,
        tzOffsetMin: b.tzOffsetMin ?? null, appVersion: b.appVersion ?? null,
      },
      update: {
        platform: b.platform, fcmToken: b.fcmToken ?? undefined, locale: b.locale ?? undefined,
        tzOffsetMin: b.tzOffsetMin ?? undefined, appVersion: b.appVersion ?? undefined, lastSeenAt: new Date(),
      },
    });
    res.json({ token: signUserToken(user), user: { id: user.id } });
  }));

  r.use('/me', requireUser);

  r.put('/me', asyncHandler(async (req, res) => {
    const b = parse(profileSchema, req.body);
    await prisma.user.update({
      where: { id: req.auth.id },
      data: { fcmToken: b.fcmToken ?? undefined, locale: b.locale ?? undefined, tzOffsetMin: b.tzOffsetMin ?? undefined, appVersion: b.appVersion ?? undefined },
    });
    res.status(204).end();
  }));

  r.get('/me/favorites', asyncHandler(async (req, res) => {
    const [teams, matches] = await Promise.all([
      prisma.favoriteTeam.findMany({ where: { userId: req.auth.id }, orderBy: { createdAt: 'asc' } }),
      prisma.savedMatch.findMany({ where: { userId: req.auth.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({ teams, matches });
  }));

  r.put('/me/favorites/teams/:teamId', asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.teamId, 'teamId');
    const b = parse(teamSchema, req.body);
    const userId = req.auth.id;
    const row = await prisma.favoriteTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId, name: b.name, logo: b.logo ?? null },
      update: { name: b.name, logo: b.logo ?? null },
    });
    res.json(row);
  }));

  r.delete('/me/favorites/teams/:teamId', asyncHandler(async (req, res) => {
    await prisma.favoriteTeam.deleteMany({ where: { userId: req.auth.id, teamId: parseId(req.params.teamId, 'teamId') } });
    res.status(204).end();
  }));

  r.put('/me/favorites/matches/:fixtureId', asyncHandler(async (req, res) => {
    const fixtureId = parseId(req.params.fixtureId, 'fixtureId');
    const b = parse(matchSchema, req.body);
    const userId = req.auth.id;
    const kickoffAt = b.kickoffAt ? new Date(b.kickoffAt) : null;
    const row = await prisma.savedMatch.upsert({
      where: { userId_fixtureId: { userId, fixtureId } },
      create: { userId, fixtureId, homeName: b.homeName ?? null, awayName: b.awayName ?? null, kickoffAt },
      update: { homeName: b.homeName ?? null, awayName: b.awayName ?? null, kickoffAt },
    });
    res.json(row);
  }));

  r.delete('/me/favorites/matches/:fixtureId', asyncHandler(async (req, res) => {
    await prisma.savedMatch.deleteMany({ where: { userId: req.auth.id, fixtureId: parseId(req.params.fixtureId, 'fixtureId') } });
    res.status(204).end();
  }));

  return r;
};
