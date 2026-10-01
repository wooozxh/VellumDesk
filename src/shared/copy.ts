/**
 * 软件全部界面文案 —— 改文案只改这个文件，不用动组件代码。
 *
 * 用法：
 *   import { COPY, fmt } from '../../shared/copy'
 *   COPY.top.searchPack                  →  搜索框的占位文字
 *   fmt(COPY.verModal.created, { seq: 3 })  →  把 {seq} 换成实际值
 *
 * 三条规矩：
 *   1. {xxx} 是变量占位符，改文字时**别删掉它**
 *   2. 这里只放文案，不放任何逻辑
 *   3. 磁盘目录名（01-成品 / _回收站 / _已解绑的项目 …）、数据库里的状态值（成品 / 未归属 …）
 *      **不在这份字典里**，它们不是文案，改了软件会找不到文件
 *
 * 编号只增不改：以后加文案往对应分组后面加，已经发出去的编号永远不动。
 */

/**
 * 占位符替换。
 *   fmt('已建第 {seq} 稿', { seq: 3 })  →  '已建第 3 稿'
 * 字典里找不到的占位符原样留着，便于暴露拼写错误。
 */
export function fmt(tpl: string, vars?: Record<string, unknown>): string {
  if (!vars) return tpl
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export const COPY = {
  // ==================== 应用级 ====================
  app: {
    /** 窗口标题 / 顶栏 logo */
    name: '营销中心-素材库',
    /** 顶栏版本号旁的悬停说明 */
    versionTip: '软件版本号（出处：package.json 的 version）'
  },

  // ==================== 通用按钮 / 状态词 ====================
  common: {
    cancel: '取消',
    save: '保存',
    saving: '保存中…',
    create: '创建',
    close: '关闭',
    openFolder: '打开文件夹',
    loading: '加载中…',
    know: '知道了',
    current: '当前',
    fileCount: '{n} 个文件',
    confirmDelete: '确认删除'
  },

  // ==================== 标签维度默认名 ====================
  dim: {
    category: '物料类别',
    categoryHint: '此标签为多选类',
    channel: '使用场景',
    channelHint: '此标签为多选类'
  },

  // ==================== 刷新扫描：阶段进度（第 14 批） ====================
  scan: {
    /** 阶段名（扫描阶段拿不到细粒度，只报阶段名） */
    progressScan: '扫描文件',
    progressThumbs: '生成缩略图',
    progressMetaImage: '读取图片信息',
    progressMetaVideo: '读取视频信息',
    progressMetaPsd: '读取 PSD 信息',
    progressMetaPdf: '读取 PDF 页数',
    /** 顶栏进度文字：{label} = 阶段名，{done}/{total} = 已处理 / 总数 */
    progressText: '{label} {done}/{total}',
    /** 按钮内百分比 */
    progressPct: '{pct}%'
  },

  // ==================== 顶栏 ====================
  top: {
    searchPack: '搜索任务…',
    searchFile: '搜索文件…',
    viewPacks: '任务视图',
    viewFiles: '文件视图',
    rescan: '刷新/扫描',
    rescanning: '处理中...',
    rescanTip: '重新扫描素材工作区',
    newPack: '新建任务'
  },

  // ==================== 左栏 ====================
  side: {
    projects: '项目',
    newProjectTip: '新建项目',
    filterAll: '全部',
    filterTitle: '筛选',
    moveUp: '上移一位',
    moveDown: '下移一位',
    editProjectTip: '编辑名称 / 颜色',
    unbindProjectTip: '解绑项目',
    delProjectTip: '删除项目',
    loose: '待归类',
    looseTip: '这些任务的文件夹直接躺在工作区根目录，还没选项目 —— 点任务卡片右上角的入库按钮就能归位',
    unbound: '已解绑',
    unboundTip: '结项留底的项目：软件里不显示，本地文件全在 _已解绑的项目 里，可一键还原',
    unboundCount: '个项目',
    unassigned: '未归属',
    missing: '文件已丢失',
    missingTip:
      '这些素材的原文件被删除或挪走了。软件不会因此删掉记录 —— 点行尾的定位按钮指到文件的新位置就能找回来',
    allFiles: '全部文件',
    workspace: '工作区',
    wsSwitchTip: '{root}\n点一下切到这个工作区',
    wsRemoveTip: '从列表移除（只去掉记录，磁盘上的文件一个字节都不动）',
    moveWs: '搬移位置',
    addWs: '添加工作区',
    addWsTip: '选一个文件夹作为工作区：空的就新建，有素材库的直接接进来',
    resizeTip: '拖动调整左栏宽度，双击恢复默认',
    packDiskPath: '磁盘位置：{root}\\{folder}'
  },

  // ==================== 顶部提示条 ====================
  banner: {
    wsOfflineA: '工作区「',
    wsUnknown: '未知',
    wsOfflineB: '」连不上，里面的东西一件没动',
    retry: '重试',
    changeLoc: '更改位置',
    layoutUpgraded: '目录结构已升级：工作区 / 项目 / 任务',
    layoutMoved: '{n} 个任务已归入各自的项目文件夹，文件一个没动',
    layoutLoc: ' —— 位置：{root}'
  },

  // ==================== 空状态 ====================
  empty: {
    noPacks: '还没有任何任务',
    noPacksInProject: '「{name}」下还没有任务',
    createFirstA: '点右上角「＋ 新建任务」建第一个任务，',
    createFirstB: '软件会自动在工作区建好文件夹和三个子文件夹。',
    unassigned: '未归属池是空的',
    noMissing: '没有文件丢失，全都在',
    noMatch: '没找到匹配的文件',
    noAssets: '还没有登记任何文件',
    dropHint: '往工作区里的任务文件夹丢文件，然后点右上角「刷新扫描」。'
  },

  // ==================== 认领条（文件视图选中后） ====================
  claim: {
    selected: '已选中 {n} 个文件',
    into: '认领进',
    pickPack: '— 选择任务 —',
    needTarget: '请先选择目标任务',
    moveInto: '把文件搬进目标任务',
    confirm: '确定认领',
    tagBtn: '打标签',
    tagTip: '给选中的文件批量打标签'
  },

  // ==================== 统计行 ====================
  stat: {
    selectAll: '全选（双击文件名可直接打开文件）',
    currentOnly: '只看当前稿',
    currentOnlyTip: '只显示各任务「当前版本」那一稿的文件；未分版本的老文件也会被过滤掉',
    relocateBtn: '批量重新定位',
    relocateTip: '一批文件被整体挪走了？选它现在所在的文件夹，软件按原目录结构替你先配一遍，你确认后才改',
    missingCount: '（共 {n} 条丢失）',
    packsCount: '共 {n} 个任务',
    assetsCount: '共 {n} 条素材',
    missingPart: '其中 {n} 条文件已丢失',
    suffixUnassigned: '（未归属）',
    suffixMissing: '（文件已丢失）',
    suffixCurrent: '（只看当前稿）',
    selectedShort: '已选中 {n}',
    unassignedPart: '未归属 {n} 个待整理',
    currentProject: '当前：'
  },

  // ==================== 操作反馈（提示条 / 弹窗里的 toast） ====================
  toast: {
    // ---- 文件定位 ----
    locateFailed: '没能定位到文件',
    located: '已找回：{path}',

    // ---- 工作区 ----
    wsStillOffline: '还是连不上，检查一下磁盘或移动硬盘',
    wsRestored: '工作区已恢复',
    wsOffline: '素材工作区当前连不上，先点上方提示条里的「重试」或「更改位置」',
    wsSwitchFailed: '没能切换工作区',
    wsSwitchError: '切换工作区失败：',
    wsSwitched: '工作区已切到：{root}',
    wsSwitchFailedPlain: '切换工作区失败',
    wsActivated: '已切到工作区「{name}」',
    wsAddFailed: '添加工作区失败',
    wsAddError: '添加工作区失败：',
    wsAddRewritten: '已切过去，并把 {n} 条记录的位置改好了',
    wsAdded: '工作区已添加：{root}',
    wsMissingFiles: '另有 {n} 个文件在磁盘上找不到（只影响预览）',
    wsRemoveConfirmA: '把工作区「{name}」从列表里去掉？\n\n',
    wsRemoveConfirmB: '只是从软件列表里去掉，磁盘上的文件夹和素材一个字节都不会动：\n{root}\n\n',
    wsRemoveConfirmC: '以后想用回来，点「＋ 添加工作区」选它就行。',
    wsRemoveFailed: '移除失败',
    wsRemoveError: '移除失败：',
    wsRemoved: '已从列表移除（磁盘上的文件没动）',
    wsMoveConfirmA: '把工作区「{name}」搬到别的位置？\n\n',
    wsMoveConfirmB: '当前：{root}\n\n',
    wsMoveConfirmC: '下一步让你选一个目标文件夹，软件会把整个工作区搬过去。\n',
    wsMoveConfirmD: '同一个磁盘内是瞬间完成的（不是重新复制）。\n\n',
    wsMoveConfirmE: '搬完后原位置不再保留副本。',
    wsMoveFailed: '搬移失败',
    wsMoved: '已搬到：{to}',

    // ---- 扫描 ----
    scanFailed: '扫描失败：',
    scanDone: '扫描完成：{packs} 个任务 · {files} 个文件',
    scanNewFiles: ' · 新增 {n} 条',
    scanThumbs: ' · 生成 {n} 张缩略图',
    scanCleaned: '已清理 {n} 条失效的任务记录（文件本来就不在了，清单留存在 _system/backup）',
    scanNewVersions: '认出了 {n} 个新的版本文件夹（V1/V2 这种名字）',

    // ---- 包 ----
    packCreateFailed: '创建失败',
    packCreateError: '创建失败：',
    packCreated: '任务「{name}」已创建，文件夹已建好',
    packSavedMoved: '已保存，文件夹也跟着改名 / 搬家了（文件一个没动）',
    packSavedOnly: '已保存（只改了信息，磁盘上的文件夹没动）',
    noEditingPack: '没有待编辑的任务',
    packOpenFailed: '打开失败',
    reorderFailed: '调整顺序失败',
    claimed: '已认领 {n} 个文件到目标任务',
    claimPartial: '认领 {n} 个，{e} 个失败',
    tagFailed: '打标签失败',
    tagged: '已给 {a} 个文件贴上 {b} 个标签',

    // ---- 项目 ----
    noDeletingProject: '没有待删除的项目',
    projectRenamed: '项目已改名，工作区里的文件夹也跟着改了（文件都还在）',
    projectSaved: '项目「{name}」已保存',
    projectCreated: '项目「{name}」已创建，工作区里建好了同名文件夹',
    projectTrashed:
      '项目「{name}」已删进回收站：软件里不再显示，{n} 个任务的文件夹原封不动躺在 _回收站 里',
    projectDeletedMove: '项目「{name}」已删除，{n} 个任务已转移',
    projectDeletedLoose: '项目「{name}」已删除，{n} 个任务已变为待归类',
    projectDeleted: '项目「{name}」已删除',
    projectUnbindConfirmA: '解绑项目「{name}」？\n\n',
    projectUnbindConfirmB: '· 软件里（包括任务视图、文件视图、统计）不再显示它\n',
    projectUnbindConfirmC: '· 项目文件夹会搬到工作区的「_已解绑的项目」里，文件一个不少\n',
    projectUnbindConfirmD: '· 想回来时在左栏「已解绑」入口点一下就能还原\n\n',
    projectUnbindConfirmE: '确认解绑？',
    projectUnbindFailed: '解绑失败',
    projectUnbindError: '解绑失败：',
    projectUnbound: '项目「{name}」已解绑，{n} 个任务跟着搬进 _已解绑的项目（文件都在）',
    projectRestored: '项目「{name}」已还原，文件都还在'
  },

  // ==================== 包卡片 ====================
  card: {
    relocateTip: '归位到某个项目',
    editTip: '编辑任务信息（名称 / 类别 / 项目）',
    noProject: '未指定项目',
    noProjectTip: '这个任务没有指定项目',
    missingTip: '这个任务里有 {n} 个文件已丢失（原文件被删除或挪走了，记录还在，可重新定位）',
    verTip: '这个任务有 {n} 稿；卡片上的文件数和容量算的是全部（历史稿也占硬盘）',
    fileSize: '{n} 个文件 · {size}',
    currentVer: 'V{n} 当前',
    hasVer: '有版本',
    verCount: '{n} 稿',
    pending: '待整理'
  },

  // ==================== 文件行 ====================
  file: {
    pages: '{n} 页',
    extFallback: '文件',
    missingTip: '文件已丢失（{at} 发现）：{path}\n原文件被删除或移走了。点「重新定位」把它找回来。',
    openTip: '双击/单击打开文件',
    currentVerTip: '当前版本 V{n}（在任务详情里能切换看别的稿）',
    historyVerTip: '历史版本 V{n}',
    removeTagTip: '摘掉这个标签',
    relocateTip: '重新定位：文件被删掉或挪走了，指到它的新位置',
    openFileTip: '打开文件',
    revealTip: '打开所在文件夹'
  },

  // ==================== 包详情弹窗 ====================
  pdm: {
    fileTip: '{name}\n{path}\n双击打开 · 右键定位',
    setFailed: '设置失败',
    setCurrent: '已把 V{n} 设为当前版本（文件夹一个都没动）',
    unbound: '已解绑 V{n}：文件夹和文件都没动，只是软件不再把它当一稿',
    moved: '已移动 {n} 个文件到「{target}」',
    movePartial: '移动完成 {n} 个，{e} 个失败：{first}',
    projectLabel: '所属项目：',
    categoryLabel: '类别：',
    fileCount: '共 {n} 个文件 ·',
    createdAt: '· 创建于',
    moveTo: '移动到',
    moving: '移动中…',
    confirmMove: '确定移动',
    deselect: '取消选择',
    groupDone: '成品',
    groupMaterial: '素材',
    groupProject: '工程文件',
    groupUnassigned: '未归属的文件',
    unassignedHint: '丢在任务根目录、没进子文件夹的文件，可选中后移动进对应组',
    deselectAll: '取消全选',
    selectAllGroup: '全选本组',
    empty: '暂无文件'
  },

  // ==================== 新建 / 编辑包弹窗 ====================
  editPack: {
    saveFailed: '保存失败',
    titleLoose: '归位到项目',
    title: '编辑任务信息',
    nameLabel: '任务名称',
    nameHint: '名称改了 → 工作区里的任务文件夹会一起改名（里面的文件一个不动）',
    projectLabel: '所属项目',
    noProject: '— 不指定项目（待归类）—',
    looseHint: '这个任务现在没有项目：文件夹直接躺在工作区根目录。选一个项目就能归位。',
    moveInto: '任务文件夹会搬进「{name}」的项目文件夹',
    moveBack: '任务文件夹会搬回工作区根目录（待归类）',
    categoryHint:
      '跟左栏筛选里的「物料类别」是同一套清单（左栏「管理」里增删，这里跟着变；改名 / 删除会连带改到已有任务）',
    currentFolder: '当前文件夹：',
    saveHintMove: '保存后文件夹会立刻改名 / 搬家（本地磁盘上的操作，不复制、不删除）。',
    saveHintCategory: '只改类别，磁盘上的文件夹一个字节都不动。',
    noChange: '还没有改动。'
  },

  // ==================== 新建包弹窗 ====================
  newPack: {
    namePlaceholder: '例：海南招生海报-2026秋季',
    nameHint: '留空也可以，软件会自动取名',
    projectHint: '项目在左栏「所属项目 → ＋ 新建项目」里维护（可自己新增）',
    noCategory:
      '左栏「物料类别」里还没有标签 —— 去左栏那个维度的「管理」里加一个，这里马上就能选。 现在建任务先记成「未分类」，以后在任务详情里随时能改。',
    categoryHint: '跟左栏筛选里的「物料类别」是同一套清单（左栏「管理」里增删，这里跟着变）',
    folderHint: '创建后软件会在素材工作区自动建好这个任务的文件夹，并<b>自带第 1 稿 V1</b>：',
    folderPath: '<path>任务名\\V1\\01-成品　02-素材　03-工程</path>',
    folderHint2: 'V1 自动成为当前版本，之后把文件丢进对应的子文件夹就行，软件会自动归位。',
    creating: '创建中…'
  },

  // ==================== 删除项目弹窗 ====================
  delProj: {
    confirmAskA: '确定删除项目',
    confirmAskB: '吗？',
    packCount: '该项目下有 <b>{n}</b> 个任务。任务和里面的文件都不会被删除， 但请先选一个去处：',
    noPacks: '该项目下没有任务。删除后不影响任何文件，要重名再用可以随时新建。',
    moveToProject: '转移到其他项目',
    existingCount: '{name}（现有 {n} 个任务）',
    noProject: '不指定项目（变成待归类）',
    keep: '这 {n} 个任务还留在硬盘上、文件一个不少， 只是不再挂在任何项目下，之后可以再指定',
    trash: '删进回收站（项目连同任务一起隐去）',
    // 注意 <path> 标记内外的空格位置是照源码写的（空格在<span>里面），
    // 改了位置虽然肉眼一样，但会让「字典值 == 界面实际渲染的字符串」这条自检失真。
    trashKeep:
      '整个项目文件夹会搬到工作区的<path> _回收站 </path>里，<b>文件一个都不会消失</b>，只是从软件里不再显示。',
    trashNote: '真要彻底清掉，自己去 `_回收站` 里删 —— 那才是"不要了"的正确姿势。',
    processing: '处理中…',
    trashBtn: '删进回收站'
  },

  // ==================== 项目弹窗 ====================
  projModal: {
    failed: '操作失败',
    titleEdit: '编辑项目',
    nameLabel: '项目名称',
    namePlaceholder: '例：抖音短视频运营',
    renameHint: '改名会连带把工作区里的项目文件夹一起改名 —— 里面的任务和文件跟着走，不会丢',
    createHint: '公司开了新业务、内部孵化了新项目，就在这里加一个',
    colorLabel: '标签颜色',
    colorHint: '任务卡片和左栏的项目标签用这个色，一排任务摆出来能一眼看出哪些同属一个项目',
    noteLabel: '备注（可选）',
    notePlaceholder: '这个项目是干什么的',
    notePresets: '参考：'
  },

  // ==================== 已解绑项目弹窗 ====================
  unbound: {
    failed: '还原失败',
    title: '已解绑的项目（{n}）',
    empty: '没有已解绑的项目',
    // 前后两个空格在源码里是写在 <span> 内的（表达式自带），所以标记贴着文字
    hint: '这些项目已经结项留底，软件里不显示，但本地文件一个都没动 —— 都在<path>{path}</path>里。点「还原」就搬回工作区、重新显示在左栏。',
    meta: '{packs} 个任务 · {files} 个文件 · {size}',
    restoring: '还原中…',
    restore: '还原'
  },

  // ==================== 标签选择弹窗 ====================
  tagPick: {
    title: '给 {n} 个文件打标签',
    hint: '同一维度内点多个 = 一次贴多个；同一个标签维度内每张素材保留最后选中的（批量整理更顺手）。',
    suggest: '按文件名猜出 {n} 个可能的标签',
    selectAll: '全部选中',
    single: '单选',
    multi: '多选',
    empty: '暂无标签',
    suggestTip: '{name}（文件名可能匹配）',
    suggestTitle: '自动建议',
    replaceNote: '注意：已选维度上的旧标签会被这批新标签替换掉',
    picked: '已选 {n} 个标签',
    busy: '正在打标签…',
    confirm: '贴到 {n} 个文件'
  },

  // ==================== 标签管理弹窗 ====================
  tagMgr: {
    addFailed: '新建失败',
    added: '标签「{name}」已加到「{dim}」',
    deleted: '标签「{name}」已删除',
    deletedAssets: '，{n} 条素材的该标签已摘掉',
    deletedPacks: '，{n} 个任务的类别已归到「未分类」',
    title: '标签管理',
    singleNote: ' · 该维度每张素材只能有一个标签',
    addPlaceholder: '给「{dim}」加一个新标签…',
    addBtn: '添加',
    empty: '这个维度还没有标签',
    countTip: '使用该标签的素材数（当前范围：{scope}）',
    scopeAllLib: '全库',
    colorTip: '改颜色',
    renameTip: '改名',
    delTip: '删除标签',
    delConfirm: '确定删除标签「<b>{name}</b>」？',
    delUsage:
      '全库共 {n} 条素材在用这个标签（含已解绑项目里的），删除后这些素材会失去这个标签（素材文件本身不会被删）。',
    delNoUsage: '全库还没有任何素材用过这个标签。',
    delPackCount: '目前有 <b>{n}</b> 个任务正在使用这个类别，删除后这些任务的类别也会一并去掉（归为「未分类」）。'
  },

  // ==================== 标签面板（左栏） ====================
  tagPanel: {
    title: '筛选标签',
    clearTip: '清除全部已选标签',
    clear: '清除 {n}',
    scopeIn: '「{name}」范围内',
    dimCount: '这个维度下有 {n} 个标签',
    emptyEditable: '还没有标签，点「管理」加一个',
    empty: '暂无',
    usageNone: '{name} · {scope}暂时没有贴这个标签的素材',
    usage: '{name} · {scope}有 {n} 条素材',
    manage: '管理'
  },

  // ==================== 版本条（包详情顶部） ====================
  verBar: {
    goneTip: '这个文件夹已经不在磁盘上了（被改名或删了）',
    gone: '文件夹不在',
    noNote: '（没写这一稿改了什么）',
    setCurrentTip: '把这一稿设为当前版本（回滚）——只改指针，不删任何文件',
    setCurrent: '设为当前',
    unbindTip: '解除管理关系：文件夹和文件一个都不动',
    unbind: '解绑',
    unassignedTip: '还没归到任何一稿里的文件（不在 V1/V2 这些文件夹里）',
    unassigned: '未分版本',
    unassignedNote: '不在任何一稿的文件夹里',
    newTip: '在任务文件夹里建一个新版本文件夹（V1 / V2 / V3…）',
    newVer: '新建版本',
    bindTip: '你自己在资源管理器里建好了文件夹？在这儿绑定一下就能纳入管理',
    bind: '绑定文件夹'
  },

  // ==================== 版本弹窗 ====================
  verModal: {
    newFailed: '新建版本失败',
    collected: '收编了 {n} 个文件',
    copied: '复制了 V{n} 的内容',
    created: '已建第 {seq} 稿',
    bindFailed: '绑定失败',
    bound: '已把「{name}」绑成 V{seq}',
    titleNew: '新建版本 V{n}',
    titleBind: '绑定已有文件夹',
    // <code> 里的前后空格也是照源码（空格在标签内）
    newHint:
      '软件会在<b>这个任务的文件夹</b>里建一个 <code>V{n}</code> 文件夹，里面自动长好<code> 01-成品 / 02-素材 / 03-工程 </code>三个空文件夹 —— 资源管理器里立刻能看到，往里丢东西就行。',
    noteLabel: '这一稿改了什么（版本说明）',
    notePlaceholder: '例：客户反馈——主标题太小，整体调亮',
    collectHint: '把任务里现在这 {n} 个文件收进第 1 稿<em>（只搬已经躺在 01-成品 / 02-素材 / 03-工程 里的；直接丢在任务根目录的不动）</em>',
    copyHint: '把 V{n} 的文件复制一份进来',
    copyHintNote: '（改稿时省事，但会多占一份硬盘空间——默认不勾）',
    bindHintA: '你自己在资源管理器里建好的文件夹（名字随便叫），在这儿绑定一下就归软件管了。 编号由软件按你说的算，',
    bindHintBold: '文件夹名和里面的文件一个都不动',
    bindHintB: '。',
    scanningFolders: '正在看任务里有啥文件夹…',
    noFolders: '这个任务文件夹里没有可绑定的文件夹了（都已认领，或者你还没建）',
    seqLabel: '算第几稿',
    noteLabel2: '这一稿改了什么（可留空）',
    notePlaceholder2: '例：第二稿——按客户意见改了配色',
    building: '正在建…',
    buildBtn: '建 V{n}',
    binding: '正在绑…',
    bindBtn: '绑成 V{n}'
  },

  // ==================== 批量重新定位弹窗 ====================
  relocate: {
    nonePicked: '一条都没勾上',
    partial: '找回 {n} 条，{e} 条没成：{first}',
    done: '找回 {n} 条文件',
    hint:
      '文件被整批挪走时用这个：选它们<b>现在所在的文件夹</b>，软件按原来的目录结构一层层试配。<b>你先看结果、勾选之后才会动记录。</b>',
    pickFolder: '选择文件夹',
    searching: '正在这个文件夹里找…',
    matched: '配上 {n} 条',
    unmatched: '　·　没配上 {n} 条',
    none: '当前没有「文件已丢失」的素材，不需要重新定位。',
    unmatchedTag: '没配上',
    restore: '找回勾选的 {n} 条'
  },

  // ==================== 系统对话框（选文件夹 / 跨盘提示） ====================
  ipc: {
    // 搬过来的素材库
    movedLibTitle: '这个目录里有一个搬过来的素材库',
    movedLibMsg: '库里的记录还指向原来的位置',
    movedLibOld: '记录指向：{old}\n',
    movedLibNew: '要改成：{root}\n\n',
    movedLibNoteA: '点「改成现在的位置」后，软件会先把数据库备份一份，再把记录里的路径改过来。',
    movedLibNoteB: '磁盘上的素材文件一个都不会动。',
    relocateBtn: '改成现在的位置',
    rewriteFailed: '改写库里的路径失败',

    // 选文件夹
    pathEmpty: '路径不能为空',
    switchFailed: '切换失败',
    pickWsTitle: '选择素材工作区位置',
    useHere: '用这里',
    addWsTitle: '添加素材工作区 —— 选一个文件夹',
    useThisFolder: '用这个文件夹',
    moveWsTitle: '把工作区搬到哪个磁盘 / 文件夹',
    moveHere: '搬到这里',

    // 跨盘提示
    crossDiskTitle: '目标在另一个磁盘',
    crossDiskMsg: '软件不搬跨盘',
    crossDiskNoteA: '跨盘搬几百 GB 要很久，中途断了还容易出问题，所以这一步交给更可靠的工具做。\n\n',
    crossDiskNote1: '1. 用资源管理器把整个「{folder}」文件夹复制到新盘（先别删原来那份）\n',
    crossDiskNote2: '2. 回到软件，点「＋ 添加工作区」，选新盘里那个文件夹\n',
    crossDiskNote3: '3. 软件会自动把库里的路径改成新位置\n\n',
    crossDiskNote4: '确认新位置没问题之后，再删原来那份。',

    // 重新定位（选文件）
    wsDirMissing: '工作区目录不存在',
    fileMissingColon: '文件不存在：',
    fileMissing: '文件不存在',
    pathMissing: '路径不存在',
    findFileTitle: '指出这个文件现在在哪里',
    thisOne: '就是它',
    findFilesTitle: '这些文件被搬到哪个文件夹了（选它们上一层或更上面）',
    searchHere: '就在这里找'
  },

  // ==================== 图片 / 视频元信息 ====================
  meta: {
    bitmap: '位图',
    grayscale: '灰度',
    indexed: '索引',
    multichannel: '多通道',
    duotone: '双色调'
  },

  // ==================== 标签操作错误与反馈 ====================
  tagErr: {
    dimNotFound: '维度不存在：',
    nameEmpty: '标签名不能为空',
    dupInDim: '「{dim}」下已有同名标签',
    dupSameDim: '同维度下已有同名标签',
    notFound: '标签不存在',
    renameFailed: '改名失败',
    renamed: '标签已改名',
    colorFailed: '改色失败',
    deleteFailed: '删除失败'
  },

  // ==================== 数据库默认数据（只影响以后新装的机器） ====================
  seed: {
    // ---- 预制项目（第 14 批：换成营销中心实际在用的 6 个项目） ----
    projCampName: '海南升学集训营',
    projCampNote: '海南升学集训营相关物料',
    projPrepName: '精英升学先修营',
    projPrepNote: '精英升学先修营相关物料',
    projFillName: '精英志愿填报中心',
    projFillNote: '精英志愿填报中心相关物料',
    projOneName: '一对一项目部',
    projOneNote: '一对一项目相关物料',
    projIslandName: '精英岛',
    projIslandNote: '精英岛相关物料',
    projHqName: '总部',
    projHqNote: '总部相关物料',

    // ---- 预制标签 · 物料类别（11 项，第 14 批：照实际清单） ----
    catBanner: '横幅',
    catFolded: '折页',
    catSingle: '单页',
    catBooklet: '册子',
    catStandee: '展架',
    catBook: '书籍',
    catPoster: '海报',
    catEcomLong: '电商长图',
    catKvDigital: 'KV-电子展示',
    catKvPrint: 'KV-喷绘印刷',
    catFestival: '节日海报-朋友圈',

    // ---- 预制标签 · 使用场景（7 项） ----
    chLecture: '线下讲座',
    chHandout: '对外派发',
    chConsult: '咨询展示',
    chGift: '赠送',
    chMoments: '朋友圈',
    chGroup: '社群',
    chNewMedia: '新媒体（直播、短视频）'
  },

  // ==================== 工作区（后端） ====================
  wsErr: {
    badLocationNote: '该位置当前不可用（磁盘未挂载 / 移动硬盘未连接 / 没有写入权限）',
    noWritableNote: '既定位置与「文档」目录都无法创建，请点「更改位置」手动指定一个可写目录',
    projectMissingForPack: '指定的项目不存在，无法建任务',
    noProjectYet: '还没有任何项目，请先新建一个项目',
    folderTaken: '任务里有个文件夹叫「{name}」，但第 {seq} 稿已经绑给「{taken}」了',
    fileNotExist: '这个文件不存在',
    outsideWorkspace: '这个文件在工作区外面 —— 请指到工作区里的文件（外面的文件软件管不着）',
    nameMismatch: '文件名对不上：这条记录是「{record}」，选中的是「{picked}」',
    unreadable: '读不到这个文件（可能被占用或没权限）',
    unreadablePlain: '读不到这个文件',
    sizeMismatch: '大小对不上：记录里是 {record} 字节，选中这个文件是 {picked} 字节（多半不是同一个文件）',
    assetGone: '这条素材记录不存在了（可能刚被清理过）',
    writeFailed: '写入失败：',
    unknown: '未知错误',
    targetPackMissing: '目标任务不存在',
    badSubFolder: '目标分组不合法',
    targetVerMissing: '目标版本不存在',
    fileGone: '{name}：文件已不存在',
    scanPackGoneNote:
      '扫描时发现任务文件夹已不在磁盘上，任务记录与任务内素材记录已一并摘除（磁盘文件本来就没有了）',
    multiRoot: '库里的素材路径指向 {n} 个不同位置，数据异常，已拒绝自动改动',
    inconsistent: '库里有 {skipped}/{total} 条记录的路径自相矛盾，已拒绝自动改动',
    multiPackRoot: '任务目录分布在 {n} 个不同位置，数据异常，已拒绝自动改动',
    backupFailedMigrate: '备份数据库失败，已中止迁移（磁盘与库都未改动）',
    moveRollback: '搬移「{name}」失败，已全部回滚：{msg}',
    writeDbRollback: '写库失败，已回滚文件夹：{msg}',
    backupFailedRewrite: '备份失败，已中止重写：{msg}',
    rewriteRollback: '重写失败（库已回滚，备份在 {path}）：{msg}',
    readDbFailed: '读库失败：{msg}',
    notWritable: '这个位置不能写入，请换一个目录',
    libBroken: '这个目录里的素材库看起来有问题，已中止',
    noWorkspace: '还没有配置任何工作区',
    wsMissing: '工作区不存在',
    wsOffline: '「{name}」当前位置连不上（磁盘未挂载 / 移动硬盘未连接 / 没有写入权限）',
    keepOneWs: '至少要保留一个工作区',
    curWsDirMissing: '当前工作区目录不存在',
    targetMissing: '目标位置不存在',
    moveIntoItself: '不能把工作区搬到它自己里面',
    targetExists: '目标位置已经有一个「{name}」了，换个位置或先改名',
    moveFailed: '搬移失败：{msg}',
    movedButDbFailed: '文件夹搬好了，但库里的路径没改成，请看备份'
  },

  // ==================== 工作区（默认值与说明） ====================
  ws: {
    untitledTask: '未命名任务-{y}{mo}{d}-{h}{mi}',
    untitledName: '未命名',
    untitledProject: '未命名项目',
    fallbackProjectFolder: '项目{id}',
    reasonFullMatch: '按完整目录结构命中',
    reasonDropMatch: '去掉前 {n} 层目录后命中',
    reasonNotFound: '这个目录下没找到它'
  },

  // ==================== 项目（后端） ====================
  projErr: {
    nameEmpty: '项目名称不能为空',
    namePrefix: '项目名不能以下划线或点开头（会跟软件自己的目录冲突）',
    dup: '已存在同名项目「{name}」',
    folderCreateFailed: '建项目文件夹失败：{msg}',
    notFound: '项目不存在',
    folderExists: '磁盘上已经有一个「{name}」文件夹，换个名字',
    renameFailed: '文件夹改名失败：{msg}',
    renameRollback: '改名失败，已尽量回滚：{msg}',
    archivedNoSort: '已归档的项目不参与排序',
    keepAtLeastOne: '至少要保留一个项目，无法删除最后一个',
    moveToSelf: '不能转移到自己',
    targetMissing: '目标项目不存在',
    movePackFailed: '搬移任务文件夹失败：{msg}',
    deleteRollback: '删除项目失败，已尽量回滚：{msg}',
    deletedToTrash: '删除项目「{name}」：记录已删，文件夹已移入 {dir}',
    trashFailed: '搬进回收站失败，什么都没动：{msg}',
    archivedNoPack: '目标项目已解绑，不能往里放任务',
    alreadyUnbound: '该项目已经解绑过了',
    keepAtLeastOneUnbind: '至少要保留一个项目，无法解绑最后一个',
    moveFailed: '搬移项目文件夹失败，什么都没动：{msg}',
    unbindRollback: '解绑失败，已尽量回滚：{msg}',
    restoreFolderExists: '工作区里已经有一个「{name}」文件夹了，先把它改名或挪走再还原',
    restoreMoveFailed: '搬回项目文件夹失败，什么都没动：{msg}',
    restoreRollback: '还原失败，已尽量回滚：{msg}'
  },

  // ==================== 包（后端） ====================
  packErr: {
    notFound: '任务不存在',
    nameEmpty: '任务名称不能为空',
    moveFailed: '搬移任务文件夹失败，什么都没动：{msg}',
    editRollback: '改任务信息失败，已尽量回滚：{msg}',
    folderGone: '任务文件夹不在磁盘上了，先刷新扫描',
    folderExists: '「{name}」文件夹已经存在了，用「绑定文件夹」把它纳入管理',
    createVerFolderFailed: '建版本文件夹失败：{msg}',
    moveFileRollback: '搬文件失败，已尽量还原：{msg}',
    writeDbRollback: '写库失败，已尽量还原：{msg}'
  },

  // ==================== 版本（后端） ====================
  verErr: {
    folderNameEmpty: '文件夹名为空',
    onlyInPack: '只能绑定任务文件夹里的文件夹',
    folderNotInPack: '任务里没有「{name}」这个文件夹',
    seqInvalid: '编号必须是大于 0 的整数',
    alreadyBound: '「{name}」已经绑定过了',
    seqTaken: '第 {seq} 稿已经绑给「{taken}」了',
    bindFailed: '绑定失败：{msg}',
    notFound: '这一稿不存在'
  },

  // ==================== 工单模块（第 13 批；docs/15） ====================
  ticket: {
    /** 顶栏分段控件第三格 */
    viewTab: '工单',
    /** 同步按钮 */
    syncBtn: '同步工单',
    syncing: '同步中…',
    /** 筛选标签 */
    filterMine: '我的',
    filterAll: '全部',
    filterUnassigned: '未指派',
    filterHistory: '历史单',
    filterReassigned: '已改派',
    filterPending: '待确认',
    filterAbnormal: '异常',
    /** 类型徽标 */
    typePrint: '印刷',
    typeDigital: '电子',
    /** 关联任务列 */
    linkedTask: '任务：{name}',
    noTaskMine: '未指派给我',
    noTaskOther: '不是我的单',
    noTaskState: '未通过审批',
    noTaskHistory: '历史单',
    noTaskPending: '待确认',
    /** 建任务 / 补建 */
    createTask: '建任务',
    createTaskOk: '任务已创建：{name}',
    confirmBatch: '确认这批新单',
    /** 列表空态 / 加载 */
    emptyList: '该分类下暂无工单',
    /** 「异常」筛选的说明（悬停提示 + 选中时列表上方一行） */
    abnormalHint:
      '异常 = ① 编号在表里出现了两行（撞号，请去表里修正）；② 业务归属填了但软件里没有同名项目（项目名对齐后，下轮同步会自动补建任务）',
    /** 审批链接无效时的按钮悬停提示 */
    linkInvalidTitle: '审批链接无效：表格里该列存的不是网址（重新同步一次可修复）',
    /** 详情弹窗 */
    detailTitle: '工单详情',
    openApproval: '打开审批（含附件）',
    basicSection: '基本信息',
    printSection: '印刷信息',
    digitalSection: '电子物料信息',
    taskSection: '关联任务',
    /** 设置弹窗 */
    settingsTitle: '工单同步设置',
    settingsDocid: '智能表格链接',
    settingsDocidOk: '已识别表格：{docid}',
    settingsSheets: '启用的子表',
    settingsIdentity: '本机使用者',
    settingsIdentityHint: '读自企业微信授权，换人请重新授权 CLI',
    settingsFirstSyncWarn: '首次同步会把当前表里所有工单标记为历史单，不建任何任务',
    settingsFirstSyncDone: '首次同步已完成（{n} 张已标历史）',
    /** 状态提示（同步结果 toast） */
    syncDone: '同步完成：新增 {inserted} · 更新 {updated} · 建任务 {tasks}',
    syncDoneMore: '待确认 {pending} · 改派 {reassigned} · 表中删除 {gone} · 警告 {warns}',
    /** 降级 / 异常 */
    notConfigured: '工单功能未配置：点这里粘贴智能表格链接',
    cliMissing: '本机未配置企微同步（未安装 wecom-cli 或未授权），其余功能不受影响',
    authExpired: '企微授权已过期，请在企业微信里重新授权后重试',
    syncFailed: '同步失败：{msg}',
    /** 引擎警告（进同步结果，不是界面常驻文案） */
    warnMissingSheet: '配置的子表「{title}」在表格里找不到了，本次跳过——请检查是否重新拉过表',
    warnStructureChanged: '检测到子表已重建：新出现的工单已标「待确认」，不会自动建任务',
    warnEmptyNo: '{n} 条记录没有审批单编号，已跳过（record_id：{ids}）',
    warnDupNo: '审批单编号 {no} 出现了 {n} 次：两份都已保留，请去表里修正',
    warnProjectMismatch: '工单 {no} 的业务归属「{project}」在软件里没有同名项目，暂不建任务——项目名对齐后会自动补建',
    warnCreateFailed: '工单 {no} 建任务失败：{msg}',
    reassignedTo: '已改派给 {name}',
    rowGoneLabel: '已不在表中',
    dupWarnLabel: '编号重复',
    pendingLabel: '待确认',
    projectMismatchLabel: '项目未匹配'
  }
} as const
