// The embedded upstream checkout must not replace the developer's Git hooks.
// Apply before pnpm's automatic dependency check, including `pnpm dev`.
module.exports = {
  hooks: {
    updateConfig(config) {
      process.env.CI = 'true'
      return config
    },
  },
}
