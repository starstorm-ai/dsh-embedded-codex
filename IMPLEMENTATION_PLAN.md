# dsh-embedded-codex 鐙珛浠撳簱瀹炴柦璁″垝

鐘舵€侊細浠ｇ爜涓庤嚜鍔ㄥ寲闃舵宸插疄鏂斤紱鍘熶粨搴撴竻鐞嗙瓑寰呮樉寮忕‘璁わ紱鐪熷疄 ChatGPT 璐﹀彿 Web 楠岃瘉鐢卞紑鍙戣€呮樉寮忚繍琛�

鐩爣鐩綍锛歚D:\dsh-embedded-codex`

鏍稿績绾︽潫锛氫笉淇敼 DeepSeek Harness 婧愮爜锛涙墍鏈� Agent Runtime 鎵╁睍鑳藉姏鐢卞閮� Bundle 鎻愪緵

DSH 鍥哄畾鍩虹嚎锛歚a66e4702047846cdaa10c66c9d3df3951f5ea70d`锛坄0.1.2-rc.1`锛�

鍒濆 Codex Runtime锛歚@openai/codex@0.149.1`

## 鎽樿

鏈粨搴撳皢 Embedded Codex 浠� DeepSeek Harness 婧愮爜鏍戜腑瀹屽叏杩佸嚭锛屽苟灏嗗浐瀹氱増鏈殑 DeepSeek Harness 浣滀负鍙 Git submodule 鐢ㄤ簬缂栬瘧銆佸吋瀹归獙璇佸拰闆嗘垚娴嬭瘯銆傚彂甯冨寘閫氳繃 DSH 澶栭儴 Bundle 鏈哄埗瀹夎鍒� `web` Profile锛屼笉淇敼 DSH 瀹夎鐩綍锛屼篃涓嶅湪瀹夎闃舵搴旂敤婧愮爜 patch銆�

DSH 褰撳墠鐨� `ctx.agents`銆乣ctx.agentPresets` 鍜� Web Session Controller 涓嶈璇嗘寜 Agent Preset 璺敱鐨勫叾浠� Agent Runtime銆傚閮� Bundle 鍥犳浼氭浛鎹㈣繖涓変釜 Cordis provider锛屽悓鏃朵繚鐣欏叾宸叉湁鍏紑琛屼负銆傛浛鎹㈠悗鐨� `ctx.agents` 缁х画璁╂爣鍑� Preset 浣跨敤鍘熺敓 `agent-loop`锛屼粎璁� `embedded-codex` Preset 浣跨敤 Codex App Server Runtime銆�

鍏煎 provider 鍩轰簬鍥哄畾 submodule 鐨勫師濮嬪疄鐜扮敓鎴愩€備粨搴撳彧缁存姢鍙鏌ョ殑宸紓鍜岀嫭绔嬫墿灞曟ā鍧楋紱鏋勫缓杩囩▼鍦ㄤ复鏃剁敓鎴愮洰褰曚腑澶嶅埗涓婃父婧愮爜骞跺簲鐢ㄥ樊寮傦紝涓嶆敼鍔� submodule銆傚彂甯冧骇鐗╁寘鍚紪璇戝悗鐨勫吋瀹� provider锛屼笉鍖呭惈 submodule銆佷笂娓告簮鐮佹爲銆佹瀯寤虹紦瀛樻垨娴嬭瘯鏁版嵁銆�

瀹炴柦缁撴灉閲囩敤 `dsh-embedded-codex` 浣滀负 npm 鍖呭悕鍜� Cordis 鎻掍欢鍚嶃€傚吋瀹� provider銆佸鎴风鎺ョ嚎銆丆odex Runtime銆佸畼鏂瑰崗璁敓鎴愩€佸浐瀹氱増鏈牎楠屻€佹姇褰辨祴璇曘€丳rofile 缁勫悎娴嬭瘯銆佹墦鍖呭畨瑁呮祴璇曞拰闅旂寮€鍙戝懡浠ゅ潎鐢辨湰浠撳簱缁存姢銆傜湡瀹炶处鍙锋祴璇曞繀椤荤敱寮€鍙戣€呴€氳繃 `pnpm run test:real` 鏄惧紡鍚敤锛屼笉灞炰簬榛樿妫€鏌ャ€�

## 鐩綍

- [鐩爣涓庨潪鐩爣](#鐩爣涓庨潪鐩爣)
- [涓嶅彲鍙樼害鏉焆(#涓嶅彲鍙樼害鏉�)
- [鎬讳綋鏋舵瀯](#鎬讳綋鏋舵瀯)
- [浠撳簱缁撴瀯](#浠撳簱缁撴瀯)
- [澶栭儴 Bundle 缁勫悎](#澶栭儴-bundle-缁勫悎)
- [鍏煎 provider 璁捐](#鍏煎-provider-璁捐)
- [Embedded Codex Runtime 璁捐](#embedded-codex-runtime-璁捐)
- [涓婃父婧愮爜鐗╁寲涓庢瀯寤篯(#涓婃父婧愮爜鐗╁寲涓庢瀯寤�)
- [鐗堟湰涓庡吋瀹圭瓥鐣(#鐗堟湰涓庡吋瀹圭瓥鐣�)
- [娴嬭瘯绛栫暐](#娴嬭瘯绛栫暐)
- [寮€鍙戜笌瀹夎娴佺▼](#寮€鍙戜笌瀹夎娴佺▼)
- [杩佺Щ姝ラ](#杩佺Щ姝ラ)
- [鎻愪氦鎷嗗垎](#鎻愪氦鎷嗗垎)
- [椋庨櫓涓庢帶鍒禲(#椋庨櫓涓庢帶鍒�)
- [瀹屾垚鏉′欢](#瀹屾垚鏉′欢)
- [瀹炴柦缁撴灉](#瀹炴柦缁撴灉)

## 鐩爣涓庨潪鐩爣

### 鐩爣

- `dsh-embedded-codex` 鎴愪负鐙珛銆佸彲鏋勫缓銆佸彲娴嬭瘯銆佸彲鎵撳寘鐨� Git 浠撳簱銆�
- DeepSeek Harness 浠ュ浐瀹� commit 鐨� submodule 褰㈠紡瀛樺湪锛屽崌绾у繀椤绘樉寮忔彁浜� gitlink 鍙樺寲銆�
- DSH 婧愮爜鍜屽畨瑁呯洰褰曚繚鎸佷笉鍙橈紱澶栭儴 Bundle 鍙€氳繃 Profile patch 鏇挎崲 provider 鍜屾彃鍏� Runtime銆�
- 鏍囧噯 DSH Preset 缁х画浣跨敤榛樿 `agent-loop`銆佹櫘閫� LLM provider銆丏SH 宸ュ叿鍜屽師鏈� Session 琛屼负銆�
- `embedded-codex` Preset 浣跨敤瀹樻柟 Codex App Server 鐨� thread銆乼urn銆佸伐鍏枫€乻andbox銆佸鎵瑰拰闅愯棌涓婁笅鏂囥€�
- DSH 鐨� Chat銆乀rajectory銆丼ession 鎸佷箙鍖栥€佹ā鍨嬮€夋嫨銆乼oken 缁熻銆佸彇娑堛€佹仮澶嶅拰 fork 鑳芥秷璐� Codex 鏄犲皠鍚庣殑鏍囧噯浜嬩欢銆�
- 鎻掍欢杩愯涓嶉渶瑕� `DEEPSEEK_API_KEY`锛屼篃涓嶄細鎶� Codex 涓诲璇濆彂閫佺粰 DeepSeek銆�
- 鍙戝竷鍖呭彲浠ラ€氳繃 DSH 瀹樻柟澶栭儴 Bundle 瀹夎鍏ュ彛鍔犲叆 `web` Profile銆�

### 闈炵洰鏍�

- 涓嶅湪 DSH 涓鍔� Codex 鏉′欢鍒嗘敮鎴栦慨鏀逛换浣� DSH 婧愭枃浠躲€�
- 涓嶈 `ctx.llm.stream()` 鎵挎媴 Codex 涓� Agent loop銆�
- 涓嶉€氳繃 `ctx.tools` 閲嶆柊鎵ц Codex 宸茬粡鎵ц杩囩殑宸ュ叿鍔ㄤ綔銆�
- 涓嶆妸 Codex 闅愯棌 rollout銆佸師鐢� prompt 鎴栫鏈夋ā鍨嬭姹備吉瑁呮垚 DSH 鍘熺敓鎺ㄧ悊璁板綍銆�
- 涓嶈縼绉绘垨淇鏃� Embedded Codex Session锛涙柊鐗堟湰浠庢柊 Session 寮€濮嬨€�
- 棣栦釜鐗堟湰涓嶆壙璇烘敮鎸佹病鏈� Agent Preset 鍜� Web Session Controller 鐨� Profile銆�
- 榛樿 CI 涓嶄娇鐢ㄧ湡瀹� ChatGPT 璐﹀彿锛屼笉鎵ц浜х敓璐﹀彿閰嶉娑堣€楃殑娴嬭瘯銆�

## 涓嶅彲鍙樼害鏉�

1. `upstream/deepseek-harness` 鍦ㄦ瀯寤哄拰娴嬭瘯鍓嶅悗蹇呴』淇濇寔 clean銆�
2. 瀹夎鑴氭湰涓嶅緱缂栬緫銆佸鍒惰鐩栨垨鍔ㄦ€� patch 鐢ㄦ埛鐨� DSH 瀹夎鐩綍銆�
3. 澶栭儴 Bundle 蹇呴』閫氳繃 Cordis 閰嶇疆琛屾浛鎹� provider锛涗笉寰椾慨鏀圭幇鏈� service 瀵硅薄鐨勬柟娉曟垨鍘熷瀷銆�
4. 杩愯鏃朵唬鐮佸彧閫氳繃鍏紑鍖呭悕瀵煎叆 DSH 渚濊禆锛涗笉寰椾粠 `upstream/deepseek-harness` 瀵煎叆鏂囦欢銆�
5. 鏍囧噯 Preset 濮嬬粓浣跨敤 `agent-loop` 娉ㄥ唽鐨勯粯璁� Agent factory銆�
6. `embedded-codex` 鏄敮涓€閫夋嫨 Codex Agent factory 鐨� Preset ID銆�
7. Codex 宸ュ叿浜嬩欢鏄娴嬭褰曪紝涓嶆槸 DSH 宸ュ叿鎵ц璇锋眰銆�
8. App Server 蹇呴』鏉ヨ嚜鎻掍欢鍑嗙‘閿佸畾鐨� `@openai/codex` 鍖咃紝涓嶄娇鐢� `PATH` 涓殑鍏朵粬 `codex`銆�
9. Host DSH 鐗堟湰銆乻ubmodule commit銆佸吋瀹� provider 婧愮爜鎽樿鍜� Codex 鍗忚鐗堟湰蹇呴』閫氳繃鑷姩妫€鏌ヤ繚鎸佷竴鑷淬€�
10. 閰嶇疆閿欒銆丠ost 鐗堟湰涓嶅尮閰嶃€佺櫥褰曠被鍨嬩笉绗﹀拰鏈煡 App Server 璇锋眰蹇呴』灏芥棭澶辫触锛屼笉鑳介潤榛樺洖閫€鍒� DeepSeek銆�

## 鎬讳綋鏋舵瀯

```text
DSH web Profile
    鈹�
    鈹溾攢鈹€ base/web 鍐呯疆 Bundle
    鈹�     鈹溾攢鈹€ agent-loop 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹�
    鈹�     鈹溾攢鈹€ LLM providers             鈹� 榛樿 Agent factory
    鈹�     鈹斺攢鈹€ tools                     鈹�
    鈹�                                   鈻�
    鈹斺攢鈹€ dsh-embedded-codex Bundle
          鈹溾攢鈹€ compat/agent-registry 鈹€鈹€ ctx.agents
          鈹�       鈹溾攢鈹€ standard preset 鈫� 榛樿 agent-loop factory
          鈹�       鈹斺攢鈹€ embedded-codex  鈫� EmbeddedCodexRuntime
          鈹溾攢鈹€ compat/agent-presets 鈹€鈹€鈹€ ctx.agentPresets
          鈹溾攢鈹€ compat/session-controller
          鈹斺攢鈹€ runtime
                  鈹溾攢鈹€ ctx.embeddedCodex
                  鈹溾攢鈹€ ctx.llm 涓彧璇� Codex 妯″瀷鐩綍
                  鈹斺攢鈹€ 瀹樻柟 Codex App Server
                           鈹溾攢鈹€ thread/turn
                           鈹溾攢鈹€ native tools
                           鈹溾攢鈹€ sandbox/approval
                           鈹斺攢鈹€ token usage
```

澶栭儴 Bundle 鏇挎崲 provider锛屼笉鏇挎崲 service 鍚嶇О銆傜幇鏈� DSH 娑堣垂鏂逛粛鐒惰闂� `ctx.agents`銆乣ctx.agentPresets` 鍜� Session Controller锛屽洜姝� Web銆丼DK 绫诲瀷鍥惧拰瀹㈡埛绔笉闇€瑕� Codex 涓撶敤 API銆�

## 浠撳簱缁撴瀯

```text
D:\dsh-embedded-codex\
鈹溾攢 .gitmodules
鈹溾攢 .github\workflows\ci.yml
鈹溾攢 upstream\deepseek-harness\              # 鍙 Git submodule
鈹溾攢 src\
鈹�  鈹溾攢 index.ts                              # Runtime 榛樿瀵煎嚭涓庡叕鍏� API
鈹�  鈹溾攢 agent.ts                              # Inbox銆乼urn/step銆佸彇娑堝拰鎭㈠
鈹�  鈹溾攢 catalog.ts                            # 鍙敤浜庢ā鍨嬮€夋嫨鐨� ctx.llm adapter
鈹�  鈹溾攢 app-server.ts                         # JSON-RPC銆佸叡浜繘绋嬨€佽姹備笌閫氱煡璺敱
鈹�  鈹斺攢 compat\
鈹�     鈹溾攢 host-version.ts                     # Host 绮剧‘鐗堟湰妫€鏌�
鈹�     鈹斺攢 providers\                          # 涓変釜鍏煎 provider 鏋勫缓鍏ュ彛
鈹溾攢 compat\
鈹�  鈹溾攢 upstream-lock.json                    # DSH commit銆佺増鏈€佹簮鏂囦欢鎽樿
鈹�  鈹溾攢 patches\
鈹�  鈹�  鈹溾攢 agent-registry.patch
鈹�  鈹�  鈹溾攢 agent-presets.patch
鈹�  鈹�  鈹斺攢 session-controller.patch
鈹�  鈹斺攢 generated\                            # gitignored锛涙瀯寤烘椂鐗╁寲
鈹溾攢 protocol\
鈹�  鈹溾攢 UPSTREAM.json                         # Codex 鐗堟湰鍜岀敓鎴愪俊鎭�
鈹�  鈹斺攢 ...                                   # 瀹樻柟 generate-ts 杈撳嚭
鈹溾攢 presets\embedded-codex\
鈹�  鈹溾攢 preset.yml
鈹�  鈹斺攢 agent.cordis.yml
鈹溾攢 tests\
鈹�  鈹溾攢 runtime.spec.ts
鈹�  鈹溾攢 compatibility.spec.ts
鈹�  鈹溾攢 loader-composition.spec.ts
鈹�  鈹溾攢 profile-composition.spec.ts
鈹�  鈹溾攢 projection.spec.ts
鈹�  鈹溾攢 fixtures\
鈹�  鈹斺攢 support\
鈹溾攢 scripts\
鈹�  鈹溾攢 materialize-compat.mts
鈹�  鈹溾攢 verify-upstream.mts
鈹�  鈹溾攢 generate-protocol.mts
鈹�  鈹溾攢 packed-smoke.mts
鈹�  鈹斺攢 dev-profile.mts
鈹溾攢 docs\
鈹�  鈹溾攢 architecture.md
鈹�  鈹溾攢 compatibility.md
鈹�  鈹溾攢 testing.md
鈹�  鈹斺攢 upgrading.md
鈹溾攢 cordis.patch.yml
鈹溾攢 package.json
鈹溾攢 pnpm-lock.yaml
鈹溾攢 tsconfig.json
鈹溾攢 tsconfig.protocol.json
鈹溾攢 tsdown.config.ts
鈹溾攢 vitest.config.ts
鈹溾攢 LICENSE
鈹溾攢 THIRD_PARTY_NOTICES.md
鈹斺攢 README.md
```

浠撳簱鏍圭洰褰曞悓鏃舵槸鍙戝竷鍖呮牴鐩綍锛屼笉鍒涘缓鍙湁涓€涓垚鍛樼殑 `packages/` 灞傘€俙compat/generated`銆乣lib`銆乣coverage`銆乣.tmp`銆乣node_modules` 鍜� TypeScript build info 涓嶈繘鍏� Git銆�

## 澶栭儴 Bundle 缁勫悎

棣栦釜鐗堟湰鏄庣‘鏀寔 `web` Profile銆俙cordis.patch.yml` 鍦ㄥ唴缃� base/web Bundle 涔嬪悗搴旂敤浠ヤ笅鍙樻洿锛�

```yaml
# `name` 鏄洰鏍囪鏍￠獙鏉′欢锛涘厛绂佺敤涓変釜鍐呯疆 provider銆�
- id: agent
  name: '@deepseek-ai/dsh-agent'
  disabled: true

- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  disabled: true

- id: session-controller
  name: '@deepseek-ai/dsh-api-session-controller'
  disabled: true

# 鎻掑叆鍏煎 provider 鍜� Codex Runtime锛沘gent-loop 涓庢櫘閫� LLM provider 淇濇寔鍚敤銆�
- insert:
    - id: embedded-codex-agent-registry
      name: 'dsh-embedded-codex/compat/agent-registry'
    - id: embedded-codex-agent-presets
      name: 'dsh-embedded-codex/compat/agent-presets'
      config:
        default: standard
    - id: embedded-codex-session-controller
      name: 'dsh-embedded-codex/compat/session-controller'
    - id: embedded-codex
      name: 'dsh-embedded-codex'
```

Cordis patch 鐨� `name` 瀛楁鐢ㄤ簬鏍￠獙鐩爣琛岃€屼笉鏄鐩栧叾鎻掍欢鍚嶏紝鍥犳 Bundle 鍏堟寜 ID 鍜屽師鎻掍欢鍚嶇鐢ㄥ唴缃� provider锛屽啀鎻掑叆鏂扮殑鍞竴 ID銆傚吋瀹� `agent-presets` 琛屽繀椤婚噸杩� `default: standard`銆傛瀯寤烘祴璇曚粠鍥哄畾 submodule 璇诲彇鐩爣琛屽苟楠岃瘉琛� ID銆佸師 provider 鍜岄厤缃粛绗﹀悎鍏煎鍋囪銆傜洰鏍囪缂哄け鎴栧凡琚叾浠� Bundle 鏇挎崲鏃讹紝Loader 缁勫悎楠岃瘉浼氬け璐ワ紝涓嶈兘閮ㄥ垎鍚敤 Runtime銆�

鍖呭悕鍦ㄥ垵濮嬪寲鏃剁‘瀹氥€傚叕寮€鍙戝竷浼樺厛浣跨敤鎷ユ湁鏉冮檺鐨� npm scope锛屼緥濡� `@owner/dsh-embedded-codex`锛涗笉寰椾娇鐢ㄦ棤鍙戝竷鏉冮檺鐨� `@deepseek-ai` scope銆備互涓嬫爣璇嗕繚鎸佺ǔ瀹氾細

- Cordis Service锛歚ctx.embeddedCodex`
- Agent Preset ID锛歚embedded-codex`
- LLM 鐩綍 provider锛歚codex`
- Codex 榛樿妯″瀷鍒悕锛歚default`
- 瑙傛祴宸ュ叿鍚嶏細`codex.*`

## 鍏煎 provider 璁捐

### 涓轰粈涔堝繀椤绘浛鎹笁涓� provider

鐩搁偦鎻掍欢鍙互鎻愪緵鏂扮殑 service锛屼絾鐜版湁 DSH 娑堣垂鏂逛笉浼氳嚜鍔ㄨ皟鐢ㄥ畠銆侫gent factory 璺敱灞炰簬 `ctx.agents`锛汸reset 鍙戠幇鍜岄€夋嫨灞炰簬 `ctx.agentPresets`锛汼ession 鍒涘缓銆佹仮澶嶃€乫ork銆佹ā鍨嬪垏鎹㈠拰绌� Session Agent 鏇挎崲灞炰簬 Web Session Controller銆傞浂婧愮爜淇敼鏂规蹇呴』鏇挎崲杩欎笁涓涓烘墍鏈夎€呫€�

### Agent Registry provider

鍏煎 Agent Registry 鎻愪緵涓庡浐瀹� DSH 鐗堟湰鐩稿悓鐨� `ctx.agents` API锛屽苟澧炲姞浠ヤ笅琛屼负锛�

- `setFactory(factory)` 缁х画娉ㄥ唽榛樿 factory锛屼緵 `agent-loop` 浣跨敤銆�
- `setPresetFactory(presetId, factory, defaultOptions)` 娉ㄥ唽鍏峰悕 Runtime factory銆�
- `create()` 鏍规嵁 `CreateAgentOptions.meta.agentPreset` 閫夋嫨 factory銆�
- `resume()` 鏍规嵁鎸佷箙 Agent Preset 閫夋嫨 factory銆�
- 姣忎釜 live Agent 璁板綍鍏跺疄闄� factory锛屼緵鍒囨崲銆佹ā鍨嬪噯鍏ュ拰娓呯悊浣跨敤銆�
- 榛樿 factory 鎷掔粷鍏峰悕 Runtime 淇濈暀鐨勬ā鍨� provider锛涘叿鍚� factory 鍙帴鍙楀叾澹版槑鐨� provider銆�
- 鎵€鏈夋敞鍐屻€丄gent 鍏宠仈鍜� disposer 閫氳繃 Cordis effect 鐢熷懡鍛ㄦ湡绠＄悊銆�

璇� provider 涓嶅寘鍚� Codex 鍒嗘敮銆備换浣曞閮� Runtime 閮藉彲浠ユ敞鍐屼竴涓� Preset factory銆�

### Agent Presets provider

鍏煎 Agent Presets provider 淇濈暀鍥哄畾 DSH 鐗堟湰鐨勫彂鐜般€佺粍鍚堛€佽缃拰鎶曞奖琛屼负锛屽苟澧炲姞锛�

- effect-scoped 鐨勫彧璇荤郴缁� Preset root 娉ㄥ唽銆�
- 鍥哄畾浼樺厛绾э細DSH 闅忛檮 root 鈫� 澶栭儴 Runtime root 鈫掗儴缃� root 鈫� 鐢ㄦ埛 root銆�
- 鍦� Session 宸叉湁 turn銆佸瓨鍦ㄩ槦鍒楁秷鎭垨 Agent 闈� idle 鏃舵嫆缁� Runtime 鍒囨崲銆�
- 鍚屼竴 factory 鍐呭垏鎹� Preset鏃剁户缁娇鐢ㄥ師鏈� Cordis 閲嶇粍銆�
- 涓嶅悓 factory 闂村垏鎹㈡椂璋冪敤鍞竴鐨� Host Runtime switcher銆�
- Runtime 鏇挎崲鎴愬姛鍚庡啀鎸佷箙鍖� `agent-preset/selected`銆�

### Session Controller provider

鍏煎 Session Controller 淇濈暀鍥哄畾 DSH Web API銆乀ypert RPC銆丼ession journal 鍜� Client 鍗忚锛屽苟澧炲姞锛�

- 鍒涘缓 Session 鍓嶈В鏋� Preset锛屽苟浣跨敤鐩爣 Runtime 鐨勯粯璁ゆā鍨嬨€�
- 鎭㈠ Session 鏃朵粠鎸佷箙鎶曞奖璇诲彇 Preset锛屽啀閫夋嫨 factory銆�
- fork 鏃剁户鎵跨埗 Session 鐨� Preset銆乫actory 鍜屾ā鍨嬭鍒欍€�
- 绌� Session 鍦ㄤ笉鍚� factory 闂村垏鎹㈡椂閲囩敤鍑嗗銆佹彁浜ゃ€佸彂甯冪殑浜嬪姟椤哄簭銆�
- 鏂� Agent 瀹屽叏鍙敤鍚庢墠鍙戝竷 `removed/added` 鐢熷懡鍛ㄦ湡锛涘け璐ユ椂淇濈暀鏃� Agent銆�
- Session 瀹㈡埛绔湪鍚屼竴 Session ID 鏀跺埌 `added` 鍚庢竻闄ゆ殏鏃剁殑 removed 鐘舵€併€�
- 妯″瀷閫夋嫨璇锋眰蹇呴』鍚屾椂閫氳繃 LLM 鐩綍瀛樺湪鎬у拰褰撳墠 Agent factory provider 鍑嗗叆妫€鏌ャ€�
- 鍏峰悕 Runtime 鐨勬ā鍨嬮€夋嫨涓嶅緱淇濆瓨涓烘爣鍑� DSH 鐨勫叏灞€榛樿妯″瀷銆�

### 绂佹 monkey-patch

瀹炵幇涓嶅緱缁欑幇鏈� service 瀹炰緥鎴栧師鍨嬪姩鎬佽祴鍊硷紝渚嬪瑕嗙洊 `ctx.agents.create`銆傝繖绉嶆柟寮忕粫杩� Cordis provider 鎵€鏈夋潈銆佷緷璧栧埛鏂般€乼race context 鍜� effect 娓呯悊锛屼篃鏃犳硶鍙潬澶勭悊 provider 閲嶈浇銆侭undle 鍙兘鏇挎崲閰嶇疆琛屾寚鍚戠殑 provider銆�

## Embedded Codex Runtime 璁捐

### Runtime 鎵€鏈夋潈

`EmbeddedCodexRuntime` 瀹炵幇鍏煎 Agent Registry 鐨� factory 鎺ュ彛銆傚畠鎷ユ湁鍏变韩 App Server Host銆丆odex 妯″瀷鐩綍銆佹寜 Session 鍒涘缓鐨� Agent銆佽繙绔� thread 缁戝畾鍜� Runtime 绾у叧闂祦绋嬨€�

Runtime 娉ㄥ唽浠ヤ笅鑳藉姏锛�

- `embedded-codex` Preset factory銆�
- 鍖呭唴鍙 Preset root銆�
- `ctx.llm` 涓殑 Codex 妯″瀷鐩綍 adapter銆�
- `ctx.embeddedCodex` 绠＄悊 service銆�

Runtime 涓嶆敞鍐岄粯璁� Agent factory锛屼笉绂佺敤 `agent-loop`锛屼篃涓嶆浛鎹㈡櫘閫� LLM provider銆�

### App Server

App Server Host 浣跨敤鍖呭唴鍑嗙‘鐗堟湰鐨� `@openai/codex` wrapper 鍚姩 `app-server --stdio`銆侶ost 瀹屾垚鍒濆鍖栥€丆hatGPT 鐧诲綍绫诲瀷楠岃瘉銆佸垎椤垫ā鍨嬭鍙栥€佺嚎绋嬭矾鐢便€佽姹傚鐞嗐€乻tderr 涓婇檺鍜岃繘绋嬫爲鍏抽棴銆�

姣忎釜 DSH Session 瀵瑰簲涓€鏉￠潪涓存椂 Codex thread銆傚悓涓€杩涚▼浠ｉ檯涓紝涓€鏉¤繙绔� thread 鍙兘闄勭潃鍒颁竴涓� live DSH Agent銆傛仮澶嶄娇鐢� `thread/resume`锛汥SH fork 浣跨敤鎸佷箙鐨勮繙绔� turn ID 璋冪敤 `thread/fork`銆�

### 妯″瀷鐩綍

Codex adapter 鍙负 DSH 閫氱敤妯″瀷閫夋嫨鍣ㄦ彁渚� provider 鍜� model/list銆俙ctx.llm.stream()` 瀵� Codex route 杩斿洖鏄庣‘鐨� Runtime-only 閿欒锛涗富瀵硅瘽鍙兘閫氳繃 `ctx.agents` 鍒拌揪 App Server銆�

妯″瀷閫夋嫨瑙勫垯锛�

- `codex/default` 琛ㄧず浣跨敤 Codex 璐︽埛鍜� Runtime 閫夋嫨鐨勯粯璁ゆā鍨嬨€�
- 鍏朵粬 model ID 鍘熸牱鍙戦€佺粰 App Server銆�
- reasoning effort 鍙帴鍙� model/list 澹版槑鐨勫€笺€�
- `maxTokens` 鍦� App Server 娌℃湁绛変环鐨勭ǔ瀹氶€� turn 璁剧疆鏃舵槑纭嫆缁濄€�
- ChatGPT 閰嶉鍜岄噸缃獥鍙ｄ笉浼鎴� token usage 鎴� API 璐圭敤銆�

### 鏍囧噯浜嬩欢鏄犲皠

Runtime 鍙啓鐜版湁 DSH Session 浜嬩欢銆備竴涓師鐢� Codex turn 瀵瑰簲涓€涓� DSH turn锛屽苟鍙寘鍚涓彲瑙傚療 compatibility step銆�

```text
user/message
step/start
assistant/message(reasoning + tool-call blocks)
tool/call + tool/result observations
step/end
step/start
assistant/message(final text)
step/end
turn/end
```

`tool-call` block銆乣tool/call` 鍜� `tool/result` 浣跨敤鐩稿悓 call ID銆傝繃绋� Assistant 璁╅€氱敤 Chat 鍜� Trajectory 鎶婂伐鍏峰叧鑱斿埌姝ｇ‘ turn/step锛涙渶缁� Assistant 涓嶅惈 tool-call锛屼繚鎸侀€氱敤鏈€缁堢瓟妗堥€夋嫨瑙勫垯銆侰odex 宸ュ叿涓嶄細閫氳繃 `ctx.tools` 鍒嗗彂銆�

Token 鏄犲皠淇濈暀 uncached input銆乧ache read銆乧ache write銆乷utput銆乺easoning 鍜� total銆傛渶缁堟垚鍔熸垨涓柇鐨� Assistant message 鍦� `source.replayState.embeddedCodex` 涓繚瀛� binding version銆乼hread ID 鍜屾渶鍚庡畬鎴愮殑杩滅 turn ID銆�

## 涓婃父婧愮爜鐗╁寲涓庢瀯寤�

### 鍙 submodule

`upstream/deepseek-harness` 鍥哄畾鍒扮粡杩囬獙璇佺殑瀹樻柟 commit銆備粨搴撲笉璁剧疆璺熻釜 branch锛屼篃涓嶅湪甯歌鏋勫缓涓皟鐢� `git submodule update --remote`銆�

鍒濆瀹炵幇灏嗛獙璇佸€欓€� commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d` 鏄惁瀵瑰簲鎵€鏈� `0.1.2-rc.1` Host 鍖呭拰棰勬湡 Profile 琛屻€傞獙璇佸け璐ユ椂鍋滄鍒濆鍖栧苟閲嶆柊閫夋嫨鍑嗙‘鍩虹嚎銆�

### 鍏煎婧愮爜鐗╁寲

`scripts/materialize-compat.mts` 鎵ц浠ヤ笅鎿嶄綔锛�

1. 楠岃瘉 submodule HEAD銆佺増鏈拰 clean 鐘舵€併€�
2. 鍒犻櫎骞堕噸鏂板垱寤轰粨搴撹嚜宸辩殑 `compat/generated`銆�
3. 浠� submodule 澶嶅埗 Agent Registry銆丄gent Presets 鍜� Session Controller 鐨勫噯纭簮鐮侀泦鍚堛€�
4. 瀵圭敓鎴愬壇鏈簲鐢� `compat/patches/*.patch`銆�
5. 楠岃瘉 patch 鍙慨鏀� `upstream-lock.json` 鍏佽鐨勬枃浠躲€�
6. 楠岃瘉鐢熸垚婧愮爜涓嶅紩鐢� submodule 缁濆璺緞銆�
7. 杈撳嚭渚� TypeScript 鍜� tsdown 浣跨敤鐨勫吋瀹� provider 鍏ュ彛銆�

鑴氭湰涓嶅緱瀵� submodule 杩愯鍐欐搷浣溿€侾atch 鍙簲鐢ㄥ埌 `compat/generated`銆傛瀯寤虹粨鏉熷悗鍐嶆妫€鏌� submodule clean銆�

鏂板鐨勯€氱敤璺敱鐘舵€佸拰浜嬪姟杈呭姪浠ｇ爜鏀惧湪 `src/compat`锛岃€屼笉鏄鍏ュぇ娈� patch銆備笂娓� patch 鍙礋璐ｆ妸鍥哄畾鐗堟湰 provider 鎺ュ埌杩欎簺杈呭姪妯″潡锛屼粠鑰屼繚鎸佷笅娓稿樊寮傞泦涓笖鍙鏌ャ€�

### 鏋勫缓椤哄簭

璁″垝涓殑鏋勫缓鍛戒护鎸変互涓嬮『搴忔墽琛岋細

1. `verify:upstream`
2. `materialize:compat`
3. 缂栬瘧 `protocol/`
4. 缂栬瘧鎵嬪啓婧愮爜鍜岀敓鎴愮殑鍏煎 provider 绫诲瀷
5. 涓烘彃浠跺叆鍙ｅ拰涓変釜鍏煎 provider 鍏ュ彛鐢熸垚 Node ESM bundle
6. 鎵ц package export 鍜屾枃浠舵竻鍗曟鏌�
7. 鎵ц `pnpm pack --dry-run`
8. 鍐嶆楠岃瘉 submodule clean

鍙戝竷 exports 鑷冲皯鍖呭惈锛�

```json
{
  ".": "./lib/index.js",
  "./compat/agent-registry": "./lib/compat/agent-registry.js",
  "./compat/agent-presets": "./lib/compat/agent-presets.js",
  "./compat/session-controller": "./lib/compat/session-controller.js",
  "./cordis.patch.yml": "./cordis.patch.yml",
  "./package.json": "./package.json"
}
```

姝ｅ紡鍖呬笉瀵煎嚭 `./src/*`锛屼笉鍖呭惈 `compat/generated`锛屼篃涓嶈姹傚畨瑁呰€呮嫢鏈� submodule銆�

## 鐗堟湰涓庡吋瀹圭瓥鐣�

### 涓婃父閿佹枃浠�

`compat/upstream-lock.json` 璁板綍锛�

- DSH Git commit銆�
- DSH Host package version銆�
- 璇诲彇鍜� patch 鐨勪笂娓歌矾寰勩€�
- 姣忎釜杈撳叆鏂囦欢鐨勫唴瀹规憳瑕併€�
- 闇€瑕佸瓨鍦ㄧ殑 Cordis Profile 琛屽拰鍘� provider銆�
- 鍏煎 provider 杈撳嚭鍏ュ彛銆�
- Codex npm 鐗堟湰銆�
- 鍗忚鐢熸垚鍣ㄧ増鏈拰鍛戒护銆�

Git submodule 鐨� gitlink 鏄紑鍙戝熀绾跨殑鐪熷疄 commit锛涢攣鏂囦欢浣垮彂甯� tarball 浠嶈兘璇存槑鍏煎鏉ユ簮銆俙verify-upstream.mts` 蹇呴』楠岃瘉涓よ€呬竴鑷达紝涓嶈兘鎶婇攣鏂囦欢褰撴垚鐙珛鍙墜宸ユ紓绉荤殑鐗堟湰鏉ユ簮銆�

### Host 鐗堟湰妫€鏌�

鎻掍欢鍚姩鏃惰В鏋愬叧閿� DSH package manifest锛屽苟涓庡彂甯冨寘澹版槑鐨勫噯纭吋瀹圭増鏈瘮杈冦€傞鍙戝竷闃舵涓嶄娇鐢ㄥ鏉剧殑 `^` 鑼冨洿銆侶ost 鐗堟湰涓嶅尮閰嶆椂锛屾彃浠跺湪娉ㄥ唽 replacement provider 鍓嶅け璐ワ紝骞舵姤鍛婃湡鏈涚増鏈€佸疄闄呯増鏈拰鍗囩骇鏂囨。銆�

杩愯鏃跺彧妫€鏌ュ寘鐗堟湰鍜屽繀闇€鍏紑琛屼负锛涘紑鍙戝拰 CI 鍙﹀妫€鏌ュ噯纭� commit 鍜屾簮鐮佹憳瑕併€傝繖鏍峰彂甯冨寘涓嶉渶瑕佽闂� Git锛屼絾浠撳簱鍗囩骇浠嶇劧缁戝畾鍑嗙‘涓婃父鐘舵€併€�

### Codex 鍗忚鍗囩骇

鍗囩骇 `@openai/codex` 蹇呴』鏄嫭绔嬪彉鏇达細

1. 淇敼鍑嗙‘ npm 鐗堟湰銆�
2. 浣跨敤鍖呭唴 Codex wrapper 閲嶆柊鐢熸垚 `protocol/`銆�
3. 鏇存柊 `protocol/UPSTREAM.json`銆�
4. 瀹℃煡鍏ㄩ儴鐢熸垚 diff銆�
5. 鏇存柊杩涚▼瀛楁楠岃瘉鍜屾槧灏勬祴璇曘€�
6. 杩愯 fake App Server銆佹墦鍖呭拰鎵嬪姩鐪熷疄鐧诲綍娴嬭瘯銆�

渚濊禆鏇存柊宸ュ叿鍙互鍒涘缓鍗囩骇 PR锛屼絾涓嶅緱鑷姩鍚堝苟 Codex 鎴� DSH 鐗堟湰鍙樺寲銆�

## 娴嬭瘯绛栫暐

### 鍗曞厓娴嬭瘯

鍗曞厓娴嬭瘯浣跨敤鍐呭瓨 Session 鍜岀‘瀹氭€� fake App Server锛岃鐩栵細

- initialize/initialized銆乤ccount/read 鍜屽垎椤� model/list銆�
- ChatGPT 鐧诲綍瑕佹眰鍜岄敊璇矾寰勩€�
- thread start/resume/fork銆�
- turn start銆乻teer銆乮nterrupt 鍜屽紓甯搁€€鍑恒€�
- command銆乫ile銆丮CP銆乨ynamic tool銆乧ollaboration銆亀eb 鍜� image item 鏄犲皠銆�
- 澶氬伐鍏� phase銆佸涓� compatibility step 鍜岀函鏈€缁堢瓟妗堛€�
- approval銆乺equest-user-input 鍜屼笉鏀寔鐨� elicitation銆�
- disjoint token usage 涓� replay binding銆�
- cancel銆乨ispose銆佽繘绋嬫爲鍏抽棴鍜屽苟鍙� thread 璺敱銆�

娴嬭瘯蹇呴』璇佹槑 `ctx.tools` 娌℃湁鏀跺埌 Codex 鍘熺敓宸ュ叿鎵ц璇锋眰銆�

### 涓婃父琛屼负绛変环娴嬭瘯

鍏煎 provider 蹇呴』杩愯鍥哄畾 DSH 瀵瑰簲 package 鐨勮涓烘祴璇曪紝骞堕€氳繃娴嬭瘯 alias 鎶� provider 鍏ュ彛鏇挎崲涓虹敓鎴愮殑鍏煎瀹炵幇銆傝鐩栬寖鍥村寘鎷細

- Agent Registry 鐨勯粯璁� factory銆乮nitiator銆乪nter/announce銆乨ispose 鍜屽瓙 Agent 鍏崇郴銆�
- Agent Presets 鐨勫彂鐜般€佷紭鍏堢骇銆佽缃€佺粍鍚堛€侀攣瀹氬拰閿欒銆�
- Session Controller 鐨勫垱寤恒€佹仮澶嶃€乫ork銆侀槦鍒椼€佹ā鍨嬮€夋嫨鍜� Client 鐢熷懡鍛ㄦ湡銆�

鏂板 Runtime 璺敱娴嬭瘯涓庝笂娓歌涓烘祴璇曞垎寮€锛岄伩鍏嶅彧璇佹槑 Codex 璺緞鑰岀牬鍧忔爣鍑� DSH 璺緞銆�

### Profile 缁勫悎娴嬭瘯

缁勫悎娴嬭瘯浠� submodule 鐨勭湡瀹� base/web Bundle 寮€濮嬶紝鍐嶅簲鐢ㄥ彂甯冨寘鐨� `cordis.patch.yml`锛屾柇瑷€锛�

- 涓変釜鐩爣琛岀敱鍏煎 provider 鎻愪緵銆�
- `agent-loop` 浠嶇劧瀛樺湪骞舵敞鍐岄粯璁� factory銆�
- DeepSeek 鍜屽叾浠栨櫘閫� LLM provider 浠嶇劧瀛樺湪銆�
- `standard` 绛夊師 Preset 淇濇寔鍙銆�
- `embedded-codex` 鐢卞寘鍐呭彧璇� root 鎻愪緵銆�
- `codex/default` 鍙睘浜� Embedded Codex Runtime銆�
- 涓嶅吋瀹硅銆侀噸澶� provider 鎴栫己澶变緷璧栦細闃绘鍚姩銆�

### Chat 涓� Trajectory 鎶曞奖娴嬭瘯

鎻掍欢娴嬭瘯鐢熸垚瀹屾暣 DSH Session 浜嬩欢锛屽啀浣跨敤鍥哄畾 submodule 鐨勯€氱敤 Chat 鍜� Trajectory 鎶曞奖浠ｇ爜楠岃瘉浠ヤ笅椤哄簭锛�

```text
Initial System Prompt
User
Process Assistant
Tool 1
Tool 2
Tool 3
Final Assistant
```

璇ユ祴璇曞睘浜庢彃浠朵粨搴擄紝涓嶄慨鏀� DSH 瀹㈡埛绔祴璇曟垨娓叉煋浠ｇ爜銆傚畠鍚屾椂楠岃瘉宸ュ叿 call ID 鍏宠仈銆乻tep 浣嶇疆銆丆hat 宸ュ叿鎶樺彔鍜屾渶缁堢瓟妗堣瘑鍒€�

### 鎵撳寘娴嬭瘯

`packed-smoke.mts` 浣跨敤鐪熷疄 tarball锛岃€屼笉鏄簮鐮� link锛�

1. 鏋勫缓骞� pack 鎻掍欢銆�
2. 鍒涘缓浠撳簱鍐呴殧绂� `DSH_HOME`銆�
3. 閫氳繃 submodule 鐨勬寮� `dsh plugin --profile web add <tarball>` 瀹夎銆�
4. 妫€鏌� Profile manifest 鑷姩鍔犲叆 Bundle銆�
5. dump 鏈€缁堥厤缃苟楠岃瘉 provider 琛屻€�
6. 鍚姩涓嶈繛鎺ョ湡瀹炶处鍙风殑 Loader smoke銆�
7. 绉婚櫎 Bundle锛屽苟楠岃瘉 Profile 鎭㈠鍘熺粍鍚堛€�

### 鎵嬪姩鐪熷疄娴嬭瘯

`test:real` 浣跨敤寮€鍙戣€呭凡鏈夌殑 Codex ChatGPT 鐧诲綍锛岃嚦灏戦獙璇侊細

- 鏃� `DEEPSEEK_API_KEY` 鏃� Codex Session 鍙互瀹屾垚瀵硅瘽銆�
- 鏍囧噯 Preset 浠嶆寜 DSH 鍘熼厤缃伐浣溿€�
- 妯″瀷鍒楄〃鍜� reasoning effort 鍙€夋嫨銆�
- 宸ュ叿銆丆hat銆乀rajectory 鍜� token 鏄剧ず姝ｇ‘銆�
- Session 閲嶅惎鍚� resume 姝ｇ‘銆�
- fork銆乧ancel銆乤pproval 鍜� request-user-input 姝ｇ‘銆�

鐪熷疄璐﹀彿娴嬭瘯涓嶈繘鍏ラ粯璁� CI锛屼篃涓嶈鍙栨垨鎵撳嵃璁よ瘉鏂囦欢銆�

## 寮€鍙戜笌瀹夎娴佺▼

### 鍒濆鍖栧紑鍙戠幆澧�

璁″垝鎻愪緵浠ヤ笅鍏ュ彛锛�

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
pnpm install --frozen-lockfile
pnpm run bootstrap
pnpm run check
```

杩欎簺鍛戒护鍦ㄥ疄鏂藉畬鎴愬苟缁忚繃瀹為檯鎵ц楠岃瘉鍚庢墠鑳借繘鍏� README銆俙bootstrap` 鍙噯澶� root 渚濊禆銆佸浐瀹� submodule 鐨勪緷璧栧拰鍏煎鐢熸垚鐩綍锛屼笉鏇存柊 submodule commit銆�

### 闅旂寮€鍙� Profile

寮€鍙戣剼鏈娇鐢細

```text
D:\dsh-embedded-codex\.tmp\dsh-home
```

浣滀负涓撶敤 `DSH_HOME`锛屼笉寰椾慨鏀圭敤鎴风湡瀹炵殑 `~/.dsh`銆俙dev-profile.mts` 浣跨敤 submodule 鐨勬寮� `dsh` CLI 鍜� Profile锛屼笉澧炲姞鏂扮殑搴旂敤鍚姩鍏ュ彛銆�

璁″垝涓殑寮€鍙戝懡浠わ細

- `pnpm run dev:install`锛氭瀯寤� tarball骞跺畨瑁呭埌闅旂 Web Profile銆�
- `pnpm run dev:web`锛氶€氳繃 submodule 鐨� `dsh web` 鍚姩闅旂 Profile銆�
- `pnpm run dev:remove`锛氫粠闅旂 Profile 绉婚櫎 Bundle銆�
- `pnpm run test:real`锛氭樉寮忚繍琛岀湡瀹炶处鍙� smoke銆�

Bundle 鎴愬憳鍙樺寲闇€瑕侀噸鍚� Profile锛涜剼鏈繀椤绘槑纭仠姝㈡棫杩涚▼锛屼笉渚濊禆鐑噸杞芥浛鎹� provider銆�

### 鐢ㄦ埛瀹夎

鍙戝竷鍚庣殑棰勬湡鍏ュ彛鏄細

```powershell
dsh plugin --profile web add <package-name>
dsh web
```

鏈湴寮€鍙戝畨瑁呬娇鐢ㄦ墦鍖呭悗鐨� tarball鎴栨槑纭殑鏈湴璺緞銆傛渶缁� README 鍙繚鐣欏疄闄呮墽琛岄€氳繃鐨勫畨瑁呭舰寮忓拰杈撳嚭銆�

## 杩佺Щ姝ラ

### 闃舵 1锛氬喕缁撳綋鍓嶈緭鍏�

1. 璁板綍褰撳墠 DSH HEAD銆乨irty diff 鍜� Embedded Codex 鏂囦欢娓呭崟銆�
2. 鎶� DSH 閫氱敤 Runtime 鏀瑰姩鎷嗗垎鎴愪笁涓� provider 宸紓闆嗗悎銆�
3. 纭褰撳墠 Session 鎺掑簭淇宸插寘鍚湪杩佺Щ婧愪腑銆�
4. 涓嶅垹闄ゆ垨閲嶇疆褰撳墠 DSH 宸ヤ綔鍖恒€�

### 闃舵 2锛氬垵濮嬪寲鐙珛浠撳簱

1. 鍦� `D:\dsh-embedded-codex` 鍒濆鍖� Git銆�
2. 娣诲姞鍩虹 ignore銆乴icense銆乸ackage metadata 鍜屽伐鍏风増鏈€�
3. 鎶婂畼鏂� DeepSeek Harness 娣诲姞涓� `upstream/deepseek-harness` submodule銆�
4. 鍥哄畾骞堕獙璇佸噯纭� commit銆�
5. 鎻愪氦浠撳簱楠ㄦ灦鍜� gitlink銆�

### 闃舵 3锛氳縼绉� Runtime

1. 杩佺Щ `src`銆乣protocol`銆乣presets`銆佹祴璇曞拰 Bundle patch銆�
2. 鎺掗櫎 `lib`銆乣node_modules`銆乥uild info 鍜� DSH 鐢熸垚鏂囨。銆�
3. 灏嗗ぇ鏂囦欢鎸� App Server銆乸rojection銆丄gent 鍜� Runtime 鑱岃矗鎷嗗垎銆�
4. 鏇存柊妯″潡鍚嶃€乺epository URL銆乸ackage exports 鍜屽畨瑁呭寘鍚嶃€�
5. 灏嗗師 Agent Note 涓暱鏈熸湁鏁堢殑鍐崇瓥鏁寸悊鍒� `docs/architecture.md`銆�

### 闃舵 4锛氬缓绔嬪吋瀹� provider

1. 鐢熸垚涓変唤涓婃父婧愮爜鍩虹嚎鎽樿銆�
2. 浠庡綋鍓� DSH diff 鍒朵綔鏈€灏� patch銆�
3. 鎶婇€氱敤璺敱杈呭姪閫昏緫杩佸叆 `src/compat`銆�
4. 瀹炵幇 materialize 鍜� verify 鑴氭湰銆�
5. 鏋勫缓涓変釜 replacement provider 鍏ュ彛銆�
6. 纭鐢熸垚鍜屾瀯寤轰笉浼氫慨鏀� submodule銆�

### 闃舵 5锛氬畬鎴� Bundle 缁勫悎

1. 鐢ㄥ疄闄呭寘鍚嶆洿鏂� patch銆�
2. 鎸夊師 provider 鍚嶆牎楠屽苟绂佺敤 `agent`銆乣agent-presets` 鍜� `session-controller` 琛岋紝鍐嶆彃鍏ヤ笁涓吋瀹� provider銆�
3. 鎻掑叆 Embedded Codex Runtime銆�
4. 淇濈暀 `agent-loop` 鍜屾櫘閫� LLM provider銆�
5. 澧炲姞 Profile 缁勫悎娴嬭瘯鍜岄敊璇祴璇曘€�

### 闃舵 6锛氶獙璇佸姛鑳�

1. 杩愯鍗曞厓娴嬭瘯鍜屼笂娓哥瓑浠锋祴璇曘€�
2. 杩愯 TypeScript銆乴int銆佹枃妗ｅ拰 package export 妫€鏌ャ€�
3. 杩愯 Chat/Trajectory 鎶曞奖娴嬭瘯銆�
4. 杩愯 tarball 瀹夎鍜屽嵏杞� smoke銆�
5. 鐢卞紑鍙戣€呮樉寮忎娇鐢ㄩ殧绂� `DSH_HOME` 杩愯鐪熷疄 Web 娴嬭瘯銆�
6. 璁板綍浠嶉渶浜哄伐楠岃瘉鐨勮处鍙风浉鍏宠涓恒€�

### 闃舵 7锛氭竻鐞嗗師浠撳簱

鍙湁鐙珛浠撳簱閫氳繃瀹屾垚鏉′欢鍚庢墠鎵ц锛�

1. 浠� DSH 宸ヤ綔鍖虹Щ闄ゆ爲鍐� Embedded Codex package銆�
2. 鎭㈠ DSH 涓墍鏈夐€氱敤 Runtime 鎵╁睍婧愮爜鏀瑰姩銆�
3. 鎭㈠ `apps/cli` 瀵� Embedded Codex 鐨勭洿鎺ヤ緷璧栥€�
4. 鎭㈠鐢辨爲鍐� package 浜х敓鐨勭洰褰曘€佹枃妗ｅ拰鐢熸垚閰嶇疆鍙樺寲銆�
5. 淇濈暀涓庢湰浠诲姟鏃犲叧鐨勭敤鎴锋敼鍔ㄣ€�
6. 浣跨敤鐙珛 tarball閲嶆柊瀹夎骞堕噸澶嶆渶缁� Web smoke銆�

娓呯悊鍓嶄繚鐣欏彲鎭㈠鐨勬彁浜ゆ垨鍒嗘敮锛屼笉瀵瑰綋鍓� DSH 宸ヤ綔鍖鸿繍琛岀牬鍧忔€� reset銆�

## 鎻愪氦鎷嗗垎

濡傚悗缁渶瑕佹彁浜わ紝寤鸿浣跨敤浠ヤ笅鎻愪氦椤哄簭锛涙湰娆″疄鏂芥寜鐢ㄦ埛瑕佹眰涓嶅垱寤烘彁浜わ細

1. `chore: initialize standalone repository and pin dsh submodule`
2. `feat: migrate embedded codex app-server runtime`
3. `feat: materialize version-locked dsh compatibility providers`
4. `feat: add web profile bundle composition`
5. `test: cover runtime routing and dsh projections`
6. `build: add packed installation and compatibility checks`
7. `docs: document architecture installation and upgrades`

姣忎釜鎻愪氦淇濇寔鍙瀯寤烘垨鏄庣‘鏍囪涓哄彧瀹屾垚浠撳簱楠ㄦ灦锛涗笉鎶� submodule鍗囩骇涓� Codex 鍗忚鍗囩骇娣峰湪鍚屼竴涓彁浜ゃ€�

## 椋庨櫓涓庢帶鍒�

### DSH provider 婕傜Щ

椋庨櫓锛氬浐瀹氱増鏈崌绾у悗锛屾浛鎹� provider 鍙兘閬楁紡涓婃父琛屼负銆�

鎺у埗锛氬噯纭� gitlink銆佽緭鍏ユ憳瑕併€乸atch apply check銆佷笂娓歌涓虹瓑浠锋祴璇曞拰鐙珛鍗囩骇鎻愪氦銆�

### Profile 琛屽彉鍖�

椋庨櫓锛欴SH 鏀瑰悕銆佺Щ鍔ㄦ垨閲嶉厤 `agent`銆乣agent-presets`銆乣session-controller`銆�

鎺у埗锛氭瀯寤轰粠 submodule 楠岃瘉琛� ID銆佸師 provider 鍜屽畬鏁撮厤缃紱涓嶅尮閰嶆椂鎷掔粷鎵撳寘銆�

### Service 绫诲瀷鎴栧疄渚嬭韩浠�

椋庨櫓锛氬叾浠� DSH 鍖呬緷璧栧師 provider class 鐨勫疄渚嬭韩浠芥垨鏈叕寮€绉佹湁琛屼负銆�

鎺у埗锛氬湪鍥哄畾 submodule 涓悳绱� nominal checks锛岃繍琛屽畬鏁� owning-package tests锛屽苟鐢ㄧ湡瀹� base/web 缁勫悎鍚姩銆傚彂鐜� nominal dependency 鏃跺仠姝㈠崌绾э紝涓嶇敤 duck-typing fallback 鎺╃洊銆�

### Replacement provider 鐢熷懡鍛ㄦ湡

椋庨櫓锛歊untime 鍒囨崲鏈熼棿鍚屼竴 Session 琚案涔呮爣璁� removed锛屾垨鏃� Agent 鏈噴鏀俱€�

鎺у埗锛歋ession Controller 浣跨敤鍑嗗銆佹彁浜ゃ€佸彂甯冧簨鍔★紱娴嬭瘯 added-after-removed銆佸け璐ュ洖婊氥€侀槦鍒楃珵浜夈€佸彇娑堝拰閲嶅 dispose銆�

### Codex 宸ュ叿閲嶅鎵ц

椋庨櫓锛氭妸鍘熺敓宸ュ叿 item 璇綋鎴� DSH 宸ュ叿璇锋眰銆�

鎺у埗锛氬伐鍏锋槧灏勪粎杩藉姞鏍囧噯瑙傛祴浜嬩欢锛涙祴璇曟柇瑷€ `ctx.tools` 鏈敹鍒拌皟鐢ㄣ€�

### 鍙戝竷鍖呮硠婕忓紑鍙戝唴瀹�

椋庨櫓锛歴ubmodule銆佽璇佹枃浠躲€佹棩蹇椼€丼ession銆佺敓鎴愮紦瀛樻垨缁濆璺緞杩涘叆 tarball銆�

鎺у埗锛氫弗鏍� `files` allowlist銆乸ack 娓呭崟蹇収銆佹晱鎰熻矾寰勬壂鎻忓拰涓存椂鐩綍瀹夎娴嬭瘯銆�

### Windows 杩涚▼涓庢枃浠惰涓�

椋庨櫓锛欰pp Server 瀛愯繘绋嬨€丳owerShell銆佽矾寰勩€佽繘绋嬫爲鍏抽棴鍜� symlink 鏉冮檺涓� CI 涓嶅悓銆�

鎺у埗锛歐indows 鏄繀闇€ CI 骞冲彴锛涘紑鍙戝畨瑁呬娇鐢� tarball 鑰屼笉鏄� symlink锛涙祴璇曠瓑寰呭畬鏁磋繘绋嬮€€鍑哄苟浣跨敤鐙珛涓存椂鐩綍銆�

### 涓婃父璁稿彲璇�

椋庨櫓锛氱敓鎴� Codex DTO 鍜岀墿鍖栫殑 DSH provider 浠ｇ爜缂哄皯鏉ユ簮涓庤鍙瘉璇存槑銆�

鎺у埗锛氫繚鐣欑敓鎴愭爣璁帮紝鎻愪緵 `THIRD_PARTY_NOTICES.md`锛岃褰� DSH 涓� `@openai/codex` 鏉ユ簮銆佺増鏈拰璁稿彲璇侊紝骞跺湪鍙戝竷娓呭崟涓寘鍚繀瑕佹枃浠躲€�

## 瀹屾垚鏉′欢

鍙湁鍏ㄩ儴鏉′欢婊¤冻鎵嶈涓鸿縼绉诲畬鎴愶細

- `D:\dsh-embedded-codex` 鏄嫭绔� Git 浠撳簱銆�
- 鍏ㄦ柊 clone 鍔� `--recurse-submodules` 鍙互澶嶇幇鏋勫缓銆�
- submodule 鍥哄畾鍑嗙‘ commit锛屽父瑙勫懡浠や笉浼氳嚜鍔ㄥ崌绾у畠銆�
- 鏋勫缓鍜屾祴璇曞墠鍚� submodule `git status --porcelain` 涓虹┖銆�
- DSH 婧愮爜涓嶅寘鍚湰鎻掍欢涓哄疄鐜� Runtime 璺敱鑰屼骇鐢熺殑淇敼銆�
- 鎻掍欢鍙戝竷鍖呬笉鍖呭惈 submodule銆佷笂娓告簮鐮併€佺紦瀛樸€丼ession銆佹棩蹇楁垨璁よ瘉淇℃伅銆�
- 澶栭儴 Bundle 鍙€氳繃 Profile patch 鏇挎崲涓変釜 provider 骞舵彃鍏� Runtime銆�
- `agent-loop` 鍦� Web Profile 涓繚鎸佸惎鐢紝骞剁户缁湇鍔℃爣鍑� Preset銆�
- 鏍囧噯 Preset 鐨勫垱寤恒€佸璇濄€佹ā鍨嬮€夋嫨銆佸伐鍏枫€佹仮澶嶅拰 fork 娴嬭瘯閫氳繃銆�
- `embedded-codex` Preset 涓嶉渶瑕� DeepSeek API key锛屼笖涓诲璇濅笉浼氳繘鍏ラ粯璁� LLM loop銆�
- Codex 妯″瀷銆乺easoning effort銆丆hat銆乀rajectory銆佸伐鍏枫€乼oken銆乤pproval銆乺equest-user-input銆乧ancel銆乺esume 鍜� fork 楠岃瘉閫氳繃銆�
- 杩炵画澶氫釜宸ュ叿璋冪敤鎸夋纭� turn/step 鏄剧ず锛屾渶缁堢瓟妗堜粛琚� Chat 璇嗗埆銆�
- Host DSH 鐗堟湰涓嶅尮閰嶆椂鍚姩鏄庣‘澶辫触銆�
- tarball 瀹夎銆佸惎鍔ㄣ€佸嵏杞藉拰閲嶆柊鍚姩楠岃瘉閫氳繃銆�
- 鍒犻櫎鎴栫鐢ㄥ閮� Bundle 鍚庯紝鍥哄畾鐗堟湰 DSH 鎭㈠鍘熷琛屼负銆�
- README 涓殑姣忔潯瀹夎鍜屽紑鍙戝懡浠ら兘宸插湪骞插噣鐜瀹為檯鎵ц銆�

## 瀹炴柦缁撴灉

浠撳簱宸插畬鎴愰樁娈� 1 鑷抽樁娈� 6 鐨勪唬鐮佷笌鑷姩鍖栬祫浜э紝涓旇仛鍚堟鏌ュ凡缁忛€氳繃銆傚師 DSH tracked diff 宸蹭繚瀛樹负鏈湴蹇界暐鐨勫彲鎭㈠ patch `migration/original-dsh-embedded-codex.patch`锛涢樁娈� 7 娑夊強鍥為€€鐜版湁 dirty worktree锛岄』鍦ㄦ槑纭‘璁ゅ叾鍏ㄩ儴褰掑睘鏈杩佺Щ鍚庢墽琛岋紝涓嶄娇鐢ㄧ牬鍧忔€� reset銆傜湡瀹� ChatGPT 璐﹀彿楠岃瘉淇濈暀涓烘樉寮忓懡浠わ紝鍥犱负瀹冮渶瑕佸紑鍙戣€呯幇鏈夌櫥褰曞苟鍙兘娑堣€楄处鍙烽搴︺€�
