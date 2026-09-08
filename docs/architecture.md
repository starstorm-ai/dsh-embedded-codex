---
description: "dsh-embedded-codex 鐨� Bundle 缁勫悎銆丷untime 璺敱銆丄pp Server 鐢熷懡鍛ㄦ湡涓� DSH 浜嬩欢鏄犲皠銆�"
kind: "architecture"
---

# 鏋舵瀯

## 鐩爣

鏈粨搴撻€氳繃涓€涓閮� DSH Bundle 鎻愪緵 Codex Agent Runtime锛屼笉淇敼 DeepSeek Harness 婧愮爜鎴栧畨瑁呯洰褰曘€俙embedded-codex` Agent 棰勮閫夋嫨 Codex App Server锛涘叾浠栭璁剧户缁€夋嫨 DSH `agent-loop`銆�

## Profile 缁勫悎

Cordis 鐨� patch 涓嶅厑璁搁€氳繃鐩爣琛岀殑 `name` 瀛楁鏇挎崲鎻掍欢鍚嶏紱`name` 鍙敤浜庢牎楠岀洰鏍囪韩浠姐€傚洜姝� [`cordis.patch.yml`](../cordis.patch.yml) 鍏堜互 `id + name` 绂佺敤涓変釜鍘� provider锛屽啀鎻掑叆涓変釜鏂� id 鐨勫吋瀹� provider鍜屼富 Runtime锛�

| 鍘熸潯鐩� | 鎿嶄綔 | 鏇夸唬鏉＄洰 |
|---|---|---|
| `agent` | 鏍￠獙 `@deepseek-ai/dsh-agent` 鍚庣鐢� | `embedded-codex-agent-registry` |
| `agent-presets` | 鏍￠獙 `@deepseek-ai/dsh-agent-presets` 鍚庣鐢� | `embedded-codex-agent-presets` |
| `session-controller` | 鏍￠獙 `@deepseek-ai/dsh-api-session-controller` 鍚庣鐢� | `embedded-codex-session-controller` |

`agent-loop`銆乣llm-deepseek`銆佸伐鍏枫€佹寔涔呭寲鍜� UI 鏉＄洰涓嶄細琚鐢ㄣ€備富 Runtime 鍚姩鏃惰鍙� Loader 鏉＄洰骞跺啀娆￠獙璇佷笂杩颁竷涓潯鐩殑 provider 鍚嶇О涓庡惎鐢ㄧ姸鎬侊紱缂哄け銆侀噸澶嶆垨琚叾浠� Bundle 鏀瑰啓鏃剁珛鍗冲け璐ャ€�

## 鍏煎 provider

鍏煎 provider 涓嶆槸杩愯鏃� monkey patch銆傛瀯寤鸿剼鏈粠鍥哄畾 DSH submodule 澶嶅埗涓変釜 provider 鐨勫畬鏁� TypeScript 杈撳叆锛屽湪浠撳簱鑷繁鐨� `compat/generated` 涓簲鐢ㄥ彲瀹℃煡 patch锛屽啀鐢熸垚鐙珛鍙戝竷 bundle銆傚畨瑁呴樁娈典笉鍖呭惈涔熶笉鎵ц婧愮爜 patch銆�

Agent Registry 淇濈暀榛樿 `AgentFactory`锛屽苟澧炲姞鎸� Agent Preset id 娉ㄥ唽鐨勫叿鍚� factory銆傚垱寤鸿鍙� `CreateAgentOptions.meta.agentPreset`锛屾仮澶嶈鍙� `ResumeAgentOptions.agentPreset`銆俁egistry 璁板綍姣忎釜 live Agent 鐨勫疄闄� factory锛屼粠鑰岄樆姝㈡爣鍑� Runtime 閫夋嫨 `codex` provider锛屼篃闃绘 Codex Runtime 閫夋嫨鏅€� LLM provider銆�

Agent Presets 淇濈暀 DSH 闅忛檮銆侀儴缃插拰鐢ㄦ埛 root锛屽苟鍦ㄩ殢闄� root 涔嬪悗鍔犲叆 effect-scoped 绯荤粺 root銆傛渶缁堜紭鍏堢骇鏄� DSH 闅忛檮 root銆佸閮� Runtime root銆侀儴缃� root銆佺敤鎴� root銆傚彧鏈� idle銆佹棤鎺掗槦杈撳叆涓斾粠鏈紑濮� turn 鐨� Session 鍙互璺� Runtime 鍒囨崲銆�

Session Controller 鍦ㄥ垱寤恒€佹仮澶嶄笌 fork 鍓嶈В鏋� Agent Preset锛屽苟灏嗗叿鍚� factory 鐨勬ā鍨嬮粯璁ゅ€间紶缁� Agent Registry銆傝法 Runtime 鍒囨崲浼氬厛閲婃斁绌虹櫧 Session 鐨勬棫 Agent锛屽啀鎭㈠鐩爣 Agent锛涚洰鏍囨仮澶嶅け璐ユ椂灏濊瘯鎭㈠鏃� Runtime銆侶ost 鍙湪鏂� Agent 宸插彂甯冨悗瀹屾垚閫夋嫨璇锋眰銆�

Web 瀹㈡埛绔繚鐣欏悓涓€ Session id 鐨� resident 瀵硅薄銆俙api-session/removed` 鏆傛椂灏嗗畠鏍囪涓� removed锛涚揣闅忓叾鍚庣殑 `api-session/added` 娓呴櫎姝ょ姸鎬佸苟缁х画浣跨敤宸叉湁 event window 涓� projection store锛屽洜姝ゆā鍨嬮€夋嫨鍣ㄥ拰鑱婂ぉ杈撳叆涓嶄細姘镐箙绂佺敤銆�

## Runtime 璺敱

```text
Session create/resume/fork
  -> resolve Agent Preset
  -> ctx.agents
     -> no named factory: agent-loop
     -> embedded-codex: EmbeddedCodexRuntime
        -> CodexAppServerHost
        -> CodexRemoteThread
        -> EmbeddedCodexAgent
```

`ctx.embeddedCodex` 鏄� App Server銆佹ā鍨嬬洰褰曚笌 Codex Agent factory 鐨勭敓鍛藉懆鏈熸墍鏈夎€呫€傚畠鍚� `ctx.llm` 娉ㄥ唽涓€涓粎渚涙ā鍨嬬洰褰曚娇鐢ㄧ殑 adapter锛屽苟鍚� `ctx.agentPresets` 娉ㄥ唽鍖呭唴鍙棰勮 root銆�

`codex/default` 琛ㄧず涓嶅湪 `turn/start` 鎸囧畾鍘熺敓妯″瀷锛岃 Codex 浣跨敤璐︽埛鍜� Runtime 榛樿鍊笺€傚叾浠栨ā鍨� id 鍘熸牱浼犵粰 App Server銆俁easoning effort 鏉ヨ嚜 `model/list`銆俙ctx.llm.stream()` 涓嶆墽琛� Codex 瀵硅瘽锛屽苟杩斿洖 `CODEX_RUNTIME_ONLY`銆�

## App Server 鐢熷懡鍛ㄦ湡

Runtime 閫氳繃 `@openai/codex` package manifest 瑙ｆ瀽鍑嗙‘鐨勫寘鍐� wrapper锛屼互 Node 鍚姩 `app-server --stdio`銆俙ctx.subprocess` 鎷ユ湁杩涚▼鏍戙€乻tdin/stdout銆乻tderr 涓婇檺鍜岀粓姝㈠闄愩€�

Host 寤惰繜鍒涘缓涓€涓叡浜� App Server 杩涚▼锛屽畬鎴� `initialize`銆乣initialized`銆乣account/read` 涓庡垎椤� `model/list`銆傞粯璁ら厤缃彧鎺ュ彈 ChatGPT 鐧诲綍銆備竴涓繛鎺ュ唴锛屽師鐢� thread id 鏈€澶氱粦瀹氫竴涓� live DSH Agent锛涢€氱煡鍜岃姹傛寜 thread id 璺敱銆�

姣忎釜 DSH Session 瀵瑰簲涓€涓寔涔� Codex thread銆傛柊 Session 璋冪敤 `thread/start`锛屾仮澶嶈皟鐢� `thread/resume`锛孌SH fork 浣跨敤缁ф壙杈圭晫涓繚瀛樼殑鍘熺敓 turn id 璋冪敤 `thread/fork`銆傛垚鍔熸垨涓柇鐨� Assistant message 鍦� `source.replayState.embeddedCodex` 淇濆瓨 binding version銆乼hread id 涓� turn id銆�

鍙 DSH transcript 涓嶅寘鍚� Codex 闅愯棌鍘嗗彶锛屽洜姝ゅ惈妯″瀷瀵硅瘽浣嗘病鏈夋湁鏁堢粦瀹氱殑 seeded Session 浼氬け璐ワ紝涓嶄細闄嶇骇涓烘湁鎹熷洖鏀俱€�

## 浜嬩欢鏄犲皠涓庨『搴�

Runtime 鍙啓鍥哄畾 DSH 鐗堟湰宸茬粡瀹氫箟鐨� Session 浜嬩欢锛屼笉澧炲姞鎸佷箙鏍煎紡銆備竴涓� Codex turn 瀵瑰簲涓€涓� DSH turn锛屽苟鍦ㄥ伐鍏烽樁娈典笌鏈€缁堢瓟妗堥樁娈典箣闂村姞鍏ュ吋瀹� step锛�

```text
turn/start
step/start (1)
user/message
request/header
assistant/chunk(reasoning/tool-call)
tool/call + tool/result
assistant/message(process)
step/end (1)
step/start (2)
assistant/chunk(final text/usage)
assistant/message(final)
step/end (2)
turn/end
```

宸ュ叿鐨� `tool-call` block銆乣tool/call` 涓� `tool/result` 鍏变韩 `codex:<native-item-id>`銆傝繃绋� Assistant 鍖呭惈 reasoning 涓� tool-call block锛涙渶缁� Assistant 鍙寘鍚瓟妗堛€侱SH Chat 鍥犺€屼緷娆℃姇褰辩郴缁熸彁绀恒€佺敤鎴枫€佽繃绋嬨€佸伐鍏蜂笌鏈€缁堢瓟妗堬紝Trajectory 涔熸寜鐩稿悓 turn/step 鍏宠仈宸ュ叿銆傚師鐢熷伐鍏蜂簨浠舵槸瑙傛祴锛屼笉浼氳皟鐢� `ctx.tools.execute()`銆�

鍛戒护鍜屾枃浠跺鎵规槧灏勫埌 `ctx.approval`锛屾潈闄愬鎵瑰彧杩斿洖 App Server 璇锋眰鐨� network/fileSystem 瀛楁锛宺equest-user-input 鏄犲皠鍒� `ctx.userQuestions`銆傜己灏戜氦浜� provider 鏃跺畨鍏ㄦ嫆缁濄€傚綋鍓� DSH 娌℃湁缁撴瀯鍖� MCP elicitation 鍥炵瓟鏈嶅姟锛屽洜姝よ璇锋眰杩斿洖 decline銆傛湭鐭� App Server 璇锋眰浼氬け璐ュ綋鍓� turn銆�

## Token 鏄犲皠

App Server 鐨� `inputTokens` 鍚屾椂鍖呭惈 cache read 涓� cache write銆侱SH `inputTokens` 璁板綍 `input - cacheRead - cacheWrite`锛屽苟鍒嗗埆淇濆瓨 `cacheReadTokens`銆乣cacheWriteTokens`銆乣outputTokens`銆乣reasoningTokens` 涓庡師鐢� `totalTokens`銆侰hatGPT 閰嶉銆侀噸缃椂闂村拰璐圭敤涓嶅睘浜� turn token usage锛屼笉杩涘叆璇ユ槧灏勩€�

## 鍙戝竷杈圭晫

鍙戝竷鍖呭彧鍖呭惈缂栬瘧鍏ュ彛銆佺被鍨嬨€佹爣鍑嗛璁捐祫浜с€丒mbedded Codex 棰勮銆丅undle patch銆佷笂娓搁攣涓庤鍙瘉璇存槑銆俙upstream/`銆乣compat/generated/`銆佹祴璇曘€佺紦瀛樸€丼ession銆佹棩蹇椾笌璁よ瘉鏂囦欢鍧囦笉鍦� npm `files` 娓呭崟涓€傝繍琛屾椂浠ｇ爜娌℃湁 submodule 璺緞渚濊禆銆�
