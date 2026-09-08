---
description: "瀹夊叏鍗囩骇鍥哄畾 DSH submodule銆佸吋瀹� provider 鍜� Codex App Server 鍗忚銆�"
kind: "guide"
---

# 鍗囩骇

DSH 涓� Codex 鍗囩骇搴斿垎鍒繘琛屻€備袱绫诲崌绾ч兘浼氭敼鍙樿繘绋嬫垨 provider 鎺ュ彛锛屼笉鑳戒緷璧栬嚜鍔ㄤ緷璧栨洿鏂扮洿鎺ュ悎骞躲€�

## 鍗囩骇 DeepSeek Harness

1. 鍦� `upstream/deepseek-harness` checkout 鐩爣瀹樻柟 commit銆�
2. 纭 `agent`銆乣agent-presets` 涓� `session-controller` 鐨� Profile id銆乸rovider 鍚嶇О鍜岃亴璐ｄ粛鐒跺瓨鍦ㄣ€�
3. 灏嗙洰鏍� DSH 鐗堟湰鍐欏叆 `compat/upstream-lock.json` 鍜� `src/compat/host-version.ts`銆�
4. 閲嶆柊浠庢柊鍩虹嚎鍒朵綔 `compat/patches/*.patch`锛涗笉瑕佹妸鏃� patch 寮哄埗濂楃敤鍒拌涓哄凡缁忓彉鍖栫殑 provider銆�
5. 杩愯 `pnpm run lock:update` 璁板綍鏂扮殑 TypeScript 涓庢爣鍑嗛璁捐祫浜ф憳瑕併€�
6. 杩愯 `pnpm run bootstrap` 鍜� `pnpm run check`銆�
7. 杩愯鐪熷疄璐﹀彿楠岃瘉锛屽苟閲嶇偣妫€鏌ョ┖鐧� Session Runtime 鍒囨崲銆佹仮澶嶃€乫ork 鍜� Web `removed 鈫� added`銆�

`lock:update` 鏄樉寮忕淮鎶ゅ懡浠わ紝涓嶅睘浜庢櫘閫� build銆傚畠鍙褰曞綋鍓� gitlink 鍐呭锛屼笉鑳芥浛浠ｄ唬鐮佸鏌ャ€�

## 鍗囩骇 Codex

1. 灏� `package.json` 鐨� `@openai/codex` 鏀规垚鍑嗙‘鐗堟湰銆�
2. 鍚屾淇敼 `compat/upstream-lock.json` 鐨� `codexVersion`銆�
3. 杩愯 `pnpm install` 鏇存柊 lockfile銆�
4. 杩愯 `pnpm run protocol:update`锛岃鍖呭唴 wrapper 鍦ㄤ复鏃剁洰褰曠敓鎴� DTO锛屽啀鍘熷瓙鏇挎崲 `protocol/`銆�
5. 瀹℃煡鍏ㄩ儴鍗忚 diff锛屾洿鏂� App Server 瀛楁楠岃瘉銆侀€氱煡鏄犲皠銆佽姹傛槧灏勫拰 fake server fixture銆�
6. 杩愯 `pnpm run check` 涓庢樉寮忕湡瀹炶处鍙烽獙璇併€�

鍗忚鐢熸垚鑴氭湰楠岃瘉宸插畨瑁呭寘鐗堟湰涓庡吋瀹归攣涓€鑷达紝涓嶄娇鐢� `PATH` 涓殑 Codex銆傜敓鎴愭垚鍔熷墠涓嶄細鍒犻櫎褰撳墠 `protocol/`銆�

## 鍙戝竷妫€鏌�

鍙戝竷鍓嶈嚦灏戠‘璁わ細

- submodule tracked status 涓虹┖锛�
- `pnpm run check` 閫氳繃锛�
- `pnpm pack --dry-run` 涓嶅寘鍚� `upstream/`銆乣compat/generated/`銆乣.tmp/`銆佽璇佹枃浠舵垨鏃ュ織锛�
- Host 鐗堟湰閿欒鑳界粰鍑烘湡鏈涘€煎拰瀹為檯鍊硷紱
- 鏍囧噯棰勮浠嶇敱 `agent-loop` 鍒涘缓锛�
- `embedded-codex` 涓嶉渶瑕� `DEEPSEEK_API_KEY`锛�
- 鐪熷疄 Codex Session 瀹屾垚宸ュ叿銆佸鎵广€佹仮澶嶄笌 fork 娴嬭瘯銆�

涓嶈鍦� DSH 瀹夎鐩綍搴旂敤 patch锛屼篃涓嶈鎶婄敓鎴愮殑鍏煎婧愮爜鎻愪氦鍒版湰浠撳簱銆傚彂甯冧骇鐗╂潵鑷彲閲嶅缓鐨勫浐瀹氳緭鍏ャ€乸atch 鍜� bundle銆�
