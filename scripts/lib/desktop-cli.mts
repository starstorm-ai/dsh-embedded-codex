/** Development-only carrier for managing an isolated reserved Desktop profile. */

// Use the compiled launcher: the source imports Cordis `const enum` values that exist only
// at type-check time, whereas DSH's official build correctly inlines them in `lib/bin.js`.
import { desktopCli } from './desktop-source.mts'
const { runCli } = await desktopCli()

await runCli({ manageDesktopProfile: true })
