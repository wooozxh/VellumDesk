/**
 * 第 58 批（docs/43 §2.8）：任务标识 —— 网盘里搜得到、卡片上对得上。
 *
 * 为什么需要它：备份包传到网盘后，过两个月再找，光靠「任务名」找不回来
 * （同名任务一堆，网盘搜索只认文件名）。给每个包一个**稳定且唯一**的短标识，
 * 打进文件名前缀（`<标识>-<任务名>-backup.zip`），用户在软件里看到哪个标识，
 * 去网盘就搜哪个 —— 两边永远是同一个字符串。
 *
 * 规则（用户拍板）：
 *   · 有工单 → 工单号（唯一键，就是表格里那一张单，P0001 这种）
 *   · 自建任务 → `T` + `packs.id` 补零 4 位（如 T0023）
 *
 * 为什么自建任务用 `packs.id`：它是自增主键，删掉的任务号**永不复用**
 * （不会出现"删了 T0023、新建又拿到 T0023"这种指向漂移）。
 *
 * ⚠️ 打包（main/backupPack.ts）与卡片显示（renderer）**共用这一份**——
 * 两处各写一遍必然算岔，那样标识就对不上了，等于白做。
 */

/**
 * 算一个任务的标识。
 * @param pack 至少要有 `id`；有 `ticketNo`（非空串）时优先用工单号。
 */
export function taskCode(pack: { id: number; ticketNo?: string | null }): string {
  const no = pack.ticketNo
  if (no !== null && no !== undefined && no !== '') return no
  return `T${String(pack.id).padStart(4, '0')}`
}
