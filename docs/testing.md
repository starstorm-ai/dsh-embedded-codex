---
description: "dsh-embedded-codex 鐨勭‘瀹氭€ф祴璇曘€佹墦鍖呭啋鐑熷拰鐪熷疄璐﹀彿楠岃瘉鍏ュ彛銆�"
kind: "guide"
---

# 娴嬭瘯

## 榛樿妫€鏌�

```powershell
pnpm run check
```

璇ュ懡浠や緷娆¤繍琛� `bootstrap`銆乣build`銆佸叏閮� Vitest銆乴int銆佹枃妗ｆ鏌ャ€乣pnpm pack --dry-run` 涓� tarball 瀹夎鍐掔儫銆傞粯璁ゆ鏌ヤ笉璇诲彇 ChatGPT 璁よ瘉鏂囦欢锛屼笉鍚姩鐪熷疄 Codex turn锛屼篃涓嶆秷鑰楄处鎴烽厤棰濄€�

## 鍒嗗眰鍛戒护

| 鍛戒护 | 瑕嗙洊鑼冨洿 |
|---|---|
| `pnpm run verify:upstream` | gitlink銆乼racked clean銆佺増鏈€丳rofile 琛屻€佹簮鐮佸拰璧勪骇鎽樿 |
| `pnpm run typecheck` | Codex DTO銆丷untime銆佷笁涓� Host provider 涓� Web client face |
| `pnpm run test:runtime` | fake App Server銆佹ā鍨嬬洰褰曘€佷簨浠躲€佸伐鍏枫€乼oken銆乫ork銆佸彇娑堛€佸鎵瑰拰鐢ㄦ埛闂 |
| `pnpm run test:composition` | Loader 瀹為檯鍚姩涓� base/web/鎻掍欢 patch 缁勫悎 |
| `pnpm run test:projection` | 鍥哄畾 DSH Chat 涓� Trajectory builder 鐨勬秷鎭�/宸ュ叿椤哄簭 |
| `pnpm run test:compat` | 鍏峰悕 factory 璺敱銆佹ā鍨� provider 鍑嗗叆鍜� Session revive |
| `pnpm run test:packed` | 鐪� tarball 鐨勯殧绂诲畨瑁呫€乨ump config 涓庡嵏杞� |
| `pnpm run lint` | 鎵嬪啓婧愮爜銆佽剼鏈拰娴嬭瘯 |
| `pnpm run docs:check` | Markdown 閾炬帴銆乫ence銆佺┖鐧戒笌缁撳熬鎹㈣ |

Runtime fixture 浣跨敤鍐呭瓨 Session 涓� JSON-RPC stream锛屼笉缁戝畾绔彛銆佹椂閽熸垨鐪熷疄瀛愯繘绋嬨€傛祴璇曚細鏄庣‘鏂█涓変釜鍘熺敓 command item 鍙骇鐢熻娴嬩簨浠讹紝`ctx.tools.execute()` 浠庢湭琚皟鐢ㄣ€�

鎶曞奖娴嬭瘯鐩存帴浣跨敤鍥哄畾 submodule 鐨� Chat 鍜� Trajectory Definitions/builder銆傛祴璇曡緭鍏ラ伒寰� Runtime 鐨勭湡瀹� turn/step 椤哄簭锛屽苟鏂█绯荤粺鎻愮ず鍜岀敤鎴锋秷鎭湪宸ュ叿涔嬪墠銆佷笁涓伐鍏峰叧鑱斿埌绗竴涓� step銆佹渶缁堢瓟妗堜綅浜庣浜屼釜 step銆�

Packed smoke 鍦� `.tmp/packed-smoke-home` 璁剧疆鐙珛 `DSH_HOME`锛屼娇鐢� submodule 鏋勫缓鍚庣殑姝ｅ紡 `dsh plugin --profile web add <tarball>` 瀹夎銆備緷璧栬В鏋愪娇鐢ㄥ綋鍓� `pnpm install` 宸插噯澶囩殑 store 浠ラ伩鍏嶆祴璇曟湡闂磋闂敞鍐岃〃锛涙祴璇曢獙璇� Bundle 娓呭崟鍜屾渶缁堥厤缃悗鍗歌浇锛屽苟鍦� `finally` 涓竻鐞嗘祴璇� home銆�

## 鐪熷疄璐﹀彿楠岃瘉

鐪熷疄楠岃瘉蹇呴』鐢卞紑鍙戣€呮樉寮忕‘璁わ細

```powershell
$env:DSH_EMBEDDED_CODEX_REAL = '1'
pnpm run test:real
```

璇ュ懡浠ゆ瀯寤哄苟瀹夎 tarball锛屽啀浣跨敤 `.tmp/dsh-home` 鍚姩 Web銆傚紑鍙戣€呭簲楠岃瘉 Codex 妯″瀷鍒楄〃銆乺easoning effort銆佹枃鏈笌鍥剧墖銆佸伐鍏枫€佸鎵广€乺equest-user-input銆乼oken銆佸彇娑堛€侀噸鍚仮澶嶅拰 fork锛屽苟鍒囧洖鏍囧噯棰勮纭鏅€� DSH 璺緞涓嶅彈褰卞搷銆�

涓嶈鍦ㄥ叡浜� CI銆佹棤浜哄€煎畧鐜鎴栨病鏈夋槑纭厤棰濇巿鏉冩椂璁剧疆璇ョ幆澧冨彉閲忋€�
