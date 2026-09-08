---
description: "璇存槑 dsh-embedded-codex 鏀寔鐨� DSH/Codex 鐗堟湰涓庡け璐ョ瓥鐣ャ€�"
kind: "reference"
---

# 鍏煎鎬�

## 鏀寔鐭╅樀

| 缁勪欢 | 鏀寔鍊� |
|---|---|
| DeepSeek Harness commit | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` |
| DSH package version | `0.1.2-rc.1` |
| `@openai/codex` | `0.149.1` |
| Node.js | `^22.19.0` 鎴� `>=24.0.0` |
| DSH Profile | `web` |

鏈増鏈槸绮剧‘鍏煎锛屼笉澹版槑 semver 鑼冨洿銆備笁涓� replacement provider 浼氬湪娉ㄥ唽鍓嶈В鏋� `@deepseek-ai/dsh-agent`銆乣@deepseek-ai/dsh-agent-presets` 涓� `@deepseek-ai/dsh-api-session-controller` 鐨� package manifest锛涗换涓€鐗堟湰涓嶅悓閮戒細鏄庣‘澶辫触銆�

寮€鍙戞鏌ヨ繕浼氶獙璇� submodule HEAD銆丏SH package 鐗堟湰銆乥ase/web Profile 琛屻€�51 涓� TypeScript 杈撳叆鎽樿鍜� 10 涓爣鍑嗛璁捐祫浜ф憳瑕併€傚彂甯� tarball 涓嶉渶瑕� Git锛屼絾鍖呭惈 [`compat/upstream-lock.json`](../compat/upstream-lock.json) 浠ヨ褰曟潵婧愩€�

## Profile 鍐茬獊

Bundle 浠ュ師 provider 鍚嶇О浣滀负 Cordis patch guard銆傝嫢鍙︿竴涓洿鏃╃殑 Bundle 鏀瑰啓鎴栫Щ闄や簡 `agent`銆乣agent-presets` 鎴� `session-controller`锛孌SH 浼氳緭鍑� patch warning锛涗富 Runtime 鐨� Loader 妫€鏌ラ殢鍚庢嫆缁濅笉瀹屾暣缁勫悎銆備笉瑕侀€氳繃鏀瑰彉 Bundle 椤哄簭鎺╃洊鍐茬獊锛屽簲鍗囩骇鍏煎 provider 鎴栫Щ闄ゅ啿绐� Bundle銆�

## Session 鍏煎鎬�

鏍囧噯 DSH Session 淇濇寔鏍囧噯 Runtime 鍜屽師鏈夋仮澶嶈涓恒€傜敱鏈彃浠跺垱寤虹殑 Codex Session 浣跨敤鏅€� DSH 浜嬩欢锛屼絾鎭㈠杩橀渶瑕� Assistant source 涓殑鍘熺敓 thread binding銆�

鏃у疄楠屾€у疄鐜般€佸叾浠� Codex adapter 鎴栧叾浠� Agent Runtime 浜х敓鐨勫彲瑙� transcript 涓嶄細鑷姩杞崲銆傝嫢 Session 宸叉湁妯″瀷 turn锛孌SH 浼氶攣瀹� Agent Preset锛涘垱寤烘柊 Session 鎵嶈兘閫夋嫨鍙︿竴涓� Runtime銆�

## 涓嶆敮鎸佺殑闄嶇骇

- Host 鐗堟湰涓嶅悓涓嶄細灏濊瘯 duck typing銆�
- Codex 鏈櫥褰曚笉浼氬洖閫€鍒� DeepSeek銆�
- API-key Codex 鐧诲綍鍦ㄩ粯璁ら厤缃笅涓嶄細鍥為€€涓� ChatGPT 鐧诲綍銆�
- `ctx.llm.stream()` 涓嶄細鎺ョ Codex 瀵硅瘽銆�
- 缂哄皯鍘熺敓 thread binding 涓嶄細鐢ㄥ彲瑙佹秷鎭噸寤洪殣钘忓巻鍙层€�
- 鏈煡 App Server request 涓嶄細琚拷鐣ャ€�
