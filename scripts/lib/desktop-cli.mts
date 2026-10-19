/** Development-only carrier for managing an isolated reserved Desktop profile. */

// Use the compiled launcher: the source imports Cordis `const enum` values that exist only
// at type-check time, whereas DSH's official build correctly inlines them in `lib/bin.js`.
import { runCli } from '../../upstream/deepseek-harness/apps/cli/lib/bin.js'

await runCli({ manageDesktopProfile: true })
