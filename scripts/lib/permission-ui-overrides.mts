/** Deterministic browser-bundle overlays for the two pinned DSH permission surfaces. */

const ASK = 'ask-for-approval'
const AUTO = 'approve-for-me'

function replaceOnce(source: string, before: string, after: string, subject: string): string {
  const first = source.indexOf(before)
  if (first === -1) throw new Error(`permission UI compatibility anchor is missing: ${subject}`)
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`permission UI compatibility anchor is ambiguous: ${subject}`)
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`
}

/** Remove build-machine paths and stale source-map trailers from copied DSH artifacts. */
export function stripBundleMetadata(source: string): string {
  const stripped = source
    .replace(/^\s*\/\/#(?:end)?region[^\n]*(?:\n|$)/gm, '')
    .replace(/^\s*\/\/# sourceMappingURL=[^\n]*(?:\n|$)/gm, '')
    .trimEnd()
  return `${stripped}\n`
}

/** Keep root-bundle HMR usable after these auxiliary factories were materialized once. */
function tolerateRegisteredFactory(source: string, id: string): string {
  const duplicate = `client-modules: duplicate factory registration for ${JSON.stringify(id)} (bundle executed twice without invalidate?)`
  return [
    'try {',
    stripBundleMetadata(source).trimEnd(),
    '} catch (error) {',
    `  if (!(error instanceof Error) || error.message !== ${JSON.stringify(duplicate)}) throw error`,
    '}',
    '',
  ].join('\n')
}

/** Add Codex labels, descriptions, and aliases to the pinned Conversation selector bundle. */
export function patchConversationPermissionUi(source: string): string {
  let output = source.replaceAll('\r\n', '\n')
  output = replaceOnce(
    output,
    '\t\t\t"access.preset.workspaceWrite": "工作区内修改",\n\t\t\t"access.preset.fullAccess": "完全权限",',
    '\t\t\t"access.preset.workspaceWrite": "工作区内修改",\n'
      + '\t\t\t"access.preset.askForApproval": "请批准",\n'
      + '\t\t\t"access.preset.approveForMe": "帮我批准",\n'
      + '\t\t\t"access.preset.askForApprovalDescription": "在工作区内修改；使用互联网或访问工作区外内容前需请求批准。",\n'
      + '\t\t\t"access.preset.approveForMeDescription": "自动审核符合条件的权限请求，但不会扩大工作区或网络访问边界。",\n'
      + '\t\t\t"access.preset.fullAccess": "完全权限",',
    'Conversation Chinese permission dictionaries',
  )
  output = replaceOnce(
    output,
    '\t\t\t"access.preset.workspaceWrite": "Workspace Write",\n\t\t\t"access.preset.fullAccess": "Full access",',
    '\t\t\t"access.preset.workspaceWrite": "Workspace Write",\n'
      + '\t\t\t"access.preset.askForApproval": "Ask for approval",\n'
      + '\t\t\t"access.preset.approveForMe": "Approve for me",\n'
      + '\t\t\t"access.preset.askForApprovalDescription": "Work in this workspace and ask before using the internet or accessing files outside it.",\n'
      + '\t\t\t"access.preset.approveForMeDescription": "Automatically review eligible permission requests without expanding workspace or network access.",\n'
      + '\t\t\t"access.preset.fullAccess": "Full access",',
    'Conversation English permission dictionaries',
  )
  output = replaceOnce(
    output,
    '\t\tfunction permissionGlyph(value) {\n\t\t\treturn permissionGlyphs.get(value);\n\t\t}',
    '\t\tfunction permissionGlyph(value) {\n'
      + `\t\t\tconst dshGlyph = value === ${JSON.stringify(ASK)} ? "workspace-write" : value === ${JSON.stringify(AUTO)} ? "read-only" : value;\n`
      + '\t\t\treturn permissionGlyphs.get(dshGlyph);\n\t\t}',
    'Conversation permission glyph resolver',
  )
  output = replaceOnce(
    output,
    '\t\t\t["workspace-write", en["access.preset.workspaceWrite"]],\n\t\t\t[FULL_ACCESS, en["access.preset.fullAccess"]]',
    '\t\t\t["workspace-write", en["access.preset.workspaceWrite"]],\n'
      + `\t\t\t[${JSON.stringify(ASK)}, en["access.preset.askForApproval"]],\n`
      + `\t\t\t[${JSON.stringify(AUTO)}, en["access.preset.approveForMe"]],\n`
      + '\t\t\t[FULL_ACCESS, en["access.preset.fullAccess"]]',
    'Conversation built-in permission names',
  )
  output = replaceOnce(
    output,
    '\t\tfunction permissionLabel(value, name, t) {\n'
      + '\t\t\tconst builtInName = BUILT_IN_PERMISSION_NAMES.get(value);\n'
      + '\t\t\tif (builtInName !== void 0 && (name === value || name === builtInName)) {\n'
      + '\t\t\t\tif (value === "read-only") return t("access.preset.readOnly");\n'
      + '\t\t\t\tif (value === "workspace-write") return t("access.preset.workspaceWrite");\n'
      + '\t\t\t\tif (value === FULL_ACCESS) return t("access.preset.fullAccess");\n'
      + '\t\t\t}\n'
      + '\t\t\treturn displayName(name);\n'
      + '\t\t}',
    '\t\tfunction permissionLabel(value, name, t) {\n'
      + '\t\t\tconst builtInName = BUILT_IN_PERMISSION_NAMES.get(value);\n'
      + '\t\t\tif (builtInName !== void 0 && (name === value || name === builtInName)) {\n'
      + '\t\t\t\tif (value === "read-only") return t("access.preset.readOnly");\n'
      + '\t\t\t\tif (value === "workspace-write") return t("access.preset.workspaceWrite");\n'
      + `\t\t\t\tif (value === ${JSON.stringify(ASK)}) return t("access.preset.askForApproval");\n`
      + `\t\t\t\tif (value === ${JSON.stringify(AUTO)}) return t("access.preset.approveForMe");\n`
      + '\t\t\t\tif (value === FULL_ACCESS) return t("access.preset.fullAccess");\n'
      + '\t\t\t}\n'
      + '\t\t\treturn displayName(name);\n'
      + '\t\t}\n'
      + '\t\tfunction permissionDescription(value, description, t) {\n'
      + `\t\t\tif (value === ${JSON.stringify(ASK)}) return t("access.preset.askForApprovalDescription");\n`
      + `\t\t\tif (value === ${JSON.stringify(AUTO)}) return t("access.preset.approveForMeDescription");\n`
      + '\t\t\treturn description;\n'
      + '\t\t}',
    'Conversation permission label resolver',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\ttitle: current?.description,',
    '\t\t\t\t\ttitle: current === void 0 ? void 0 : permissionDescription(current.value, current.description, t),',
    'Conversation permission description',
  )
  return stripBundleMetadata(output)
}

/** Add the same bilingual labels and details to the `/permission` popup bundle. */
export function patchPermissionPopupUi(source: string): string {
  let output = source.replaceAll('\r\n', '\n')
  output = replaceOnce(
    output,
    '\t\tconst accessZh = {\n'
      + '\t\t\t"preset.readOnly": "仅可查看",\n'
      + '\t\t\t"preset.workspaceWrite": "工作区内修改",\n'
      + '\t\t\t"preset.fullAccess": "完全权限",\n'
      + '\t\t\t"confirm.title": "确认启用完全权限？",',
    '\t\tconst accessZh = {\n'
      + '\t\t\t"preset.readOnly": "仅可查看",\n'
      + '\t\t\t"preset.workspaceWrite": "工作区内修改",\n'
      + '\t\t\t"preset.askForApproval": "请批准",\n'
      + '\t\t\t"preset.approveForMe": "帮我批准",\n'
      + '\t\t\t"preset.askForApprovalDescription": "在工作区内修改；使用互联网或访问工作区外内容前需请求批准。",\n'
      + '\t\t\t"preset.approveForMeDescription": "自动审核符合条件的权限请求，但不会扩大工作区或网络访问边界。",\n'
      + '\t\t\t"preset.fullAccess": "完全权限",\n'
      + '\t\t\t"confirm.title": "确认启用完全权限？",',
    'Permission popup Chinese dictionaries',
  )
  output = replaceOnce(
    output,
    '\t\tconst accessEn = {\n'
      + '\t\t\t"preset.readOnly": "Read Only",\n'
      + '\t\t\t"preset.workspaceWrite": "Workspace Write",\n'
      + '\t\t\t"preset.fullAccess": "Full access",\n'
      + '\t\t\t"confirm.title": "Enable Full access?",',
    '\t\tconst accessEn = {\n'
      + '\t\t\t"preset.readOnly": "Read Only",\n'
      + '\t\t\t"preset.workspaceWrite": "Workspace Write",\n'
      + '\t\t\t"preset.askForApproval": "Ask for approval",\n'
      + '\t\t\t"preset.approveForMe": "Approve for me",\n'
      + '\t\t\t"preset.askForApprovalDescription": "Work in this workspace and ask before using the internet or accessing files outside it.",\n'
      + '\t\t\t"preset.approveForMeDescription": "Automatically review eligible permission requests without expanding workspace or network access.",\n'
      + '\t\t\t"preset.fullAccess": "Full access",\n'
      + '\t\t\t"confirm.title": "Enable Full access?",',
    'Permission popup English dictionaries',
  )
  output = replaceOnce(
    output,
    '\t\t\t["workspace-write", "preset.workspaceWrite"],\n\t\t\t[FULL_ACCESS_PRESET, "preset.fullAccess"]',
    '\t\t\t["workspace-write", "preset.workspaceWrite"],\n'
      + `\t\t\t[${JSON.stringify(ASK)}, "preset.askForApproval"],\n`
      + `\t\t\t[${JSON.stringify(AUTO)}, "preset.approveForMe"],\n`
      + '\t\t\t[FULL_ACCESS_PRESET, "preset.fullAccess"]',
    'Permission popup label map',
  )
  output = replaceOnce(
    output,
    '\t\t\t"preset.readOnly": en["preset.readOnly"],\n\t\t\t"preset.workspaceWrite": en["preset.workspaceWrite"],\n\t\t\t"preset.fullAccess": en["preset.fullAccess"]',
    '\t\t\t"preset.readOnly": accessEn["preset.readOnly"],\n'
      + '\t\t\t"preset.workspaceWrite": accessEn["preset.workspaceWrite"],\n'
      + '\t\t\t"preset.askForApproval": accessEn["preset.askForApproval"],\n'
      + '\t\t\t"preset.approveForMe": accessEn["preset.approveForMe"],\n'
      + '\t\t\t"preset.fullAccess": accessEn["preset.fullAccess"]',
    'Permission popup default labels',
  )
  output = replaceOnce(
    output,
    '\t\tfunction displayPermissionPreset(value, name, t) {\n'
      + '\t\t\tconst key = PRESET_LABEL_KEYS.get(value);\n'
      + '\t\t\tif (key !== void 0 && (name === value || name === DEFAULT_PRESET_LABELS[key])) return t?.(key) ?? DEFAULT_PRESET_LABELS[key];\n'
      + '\t\t\treturn displayPresetName(name);\n'
      + '\t\t}',
    '\t\tfunction displayPermissionPreset(value, name, t) {\n'
      + '\t\t\tconst key = PRESET_LABEL_KEYS.get(value);\n'
      + '\t\t\tif (key !== void 0 && (name === value || name === DEFAULT_PRESET_LABELS[key])) return t?.(key) ?? DEFAULT_PRESET_LABELS[key];\n'
      + '\t\t\treturn displayPresetName(name);\n'
      + '\t\t}\n'
      + '\t\tfunction displayPermissionDetail(value, description, t) {\n'
      + `\t\t\tif (value === ${JSON.stringify(ASK)}) return t("preset.askForApprovalDescription");\n`
      + `\t\t\tif (value === ${JSON.stringify(AUTO)}) return t("preset.approveForMeDescription");\n`
      + '\t\t\treturn description;\n'
      + '\t\t}',
    'Permission popup presentation resolver',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t...option.description !== void 0 ? { detail: option.description } : {},',
    '\t\t\t\t...displayPermissionDetail(option.value, option.description, t) !== void 0\n'
      + '\t\t\t\t\t? { detail: displayPermissionDetail(option.value, option.description, t) } : {},',
    'Permission popup option detail',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t"preset.workspaceWrite": accessZh["preset.workspaceWrite"],\n\t\t\t\t\t"preset.fullAccess": accessZh["preset.fullAccess"],',
    '\t\t\t\t\t"preset.workspaceWrite": accessZh["preset.workspaceWrite"],\n'
      + '\t\t\t\t\t"preset.askForApproval": accessZh["preset.askForApproval"],\n'
      + '\t\t\t\t\t"preset.approveForMe": accessZh["preset.approveForMe"],\n'
      + '\t\t\t\t\t"preset.askForApprovalDescription": accessZh["preset.askForApprovalDescription"],\n'
      + '\t\t\t\t\t"preset.approveForMeDescription": accessZh["preset.approveForMeDescription"],\n'
      + '\t\t\t\t\t"preset.fullAccess": accessZh["preset.fullAccess"],',
    'Permission popup Chinese registration',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t"preset.workspaceWrite": accessEn["preset.workspaceWrite"],\n\t\t\t\t\t"preset.fullAccess": accessEn["preset.fullAccess"],',
    '\t\t\t\t\t"preset.workspaceWrite": accessEn["preset.workspaceWrite"],\n'
      + '\t\t\t\t\t"preset.askForApproval": accessEn["preset.askForApproval"],\n'
      + '\t\t\t\t\t"preset.approveForMe": accessEn["preset.approveForMe"],\n'
      + '\t\t\t\t\t"preset.askForApprovalDescription": accessEn["preset.askForApprovalDescription"],\n'
      + '\t\t\t\t\t"preset.approveForMeDescription": accessEn["preset.approveForMeDescription"],\n'
      + '\t\t\t\t\t"preset.fullAccess": accessEn["preset.fullAccess"],',
    'Permission popup English registration',
  )
  return stripBundleMetadata(output)
}

/** Prepend both patched DSH UI factories to this package's immediate client bundle. */
export function composeEmbeddedClientBundle(
  embeddedClient: string,
  conversationClient: string,
  permissionClient: string,
): string {
  return [
    tolerateRegisteredFactory(
      patchConversationPermissionUi(conversationClient),
      '@deepseek-ai/dsh-client-ui-conversation',
    ),
    tolerateRegisteredFactory(
      patchPermissionPopupUi(permissionClient),
      '@deepseek-ai/dsh-client-ui-permission-presets',
    ),
    stripBundleMetadata(embeddedClient),
  ].join('\n')
}
