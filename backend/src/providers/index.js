'use strict';
const { ApiFootballProvider } = require('./apiFootball.provider');
const { MockProvider } = require('./mock.provider');
const { createBudget } = require('../lib/budget');

// Register new vendors here (e.g. sportmonks: (ctx) => new SportMonksProvider(...)).
const registry = {
  apifootball: ({ env, redis, logger }) =>
    new ApiFootballProvider({
      apiKey: env.API_FOOTBALL_KEY,
      baseUrl: env.API_FOOTBALL_BASE_URL,
      redis,
      logger,
      budget: createBudget({ redis, name: 'apifootball', limit: env.DAILY_REQUEST_BUDGET }),
    }),
  mock: ({ logger }) => {
    logger.warn('Using the MOCK football provider. Set FOOTBALL_PROVIDER=apifootball for real data.');
    return new MockProvider();
  },
};

function createProvider(ctx) {
  const build = registry[ctx.env.FOOTBALL_PROVIDER];
  if (!build) throw new Error(`Unknown FOOTBALL_PROVIDER "${ctx.env.FOOTBALL_PROVIDER}"`);
  return build(ctx);
}

module.exports = { createProvider };
