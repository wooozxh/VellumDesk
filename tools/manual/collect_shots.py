# -*- coding: utf-8 -*-
"""把要进手册的截图归集到 D:\\proj_media\\docs\\manual\\images\\ 并改成可读名字。"""
import os, shutil, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SRC = r"D:\proj_media"
DST = r"D:\proj_media\docs\manual\images"
os.makedirs(DST, exist_ok=True)

MAP = [
    ("01-任务视图总览.png", "shot-m-01-packs.png"),
    ("02-文件视图.png", "shot-m-03-files.png"),
    ("03-文件视图-按标签筛选.png", "shot-m-02-files-tag.png"),
    ("04-文件视图-选中与认领条.png", "shot-m-04-files-claimbar.png"),
    ("05-批量打标签.png", "shot-m-05-tagpicker.png"),
    ("06-标签管理.png", "shot-m-13-tagmanager.png"),
    ("07-任务详情.png", "shot-m-06-packdetail.png"),
    ("08-任务详情-移动文件.png", "shot-m-07-packdetail-move.png"),
    ("09-新建版本.png", "shot-m-08-version-new.png"),
    ("10-打包交付-上半.png", "shot-m-09-export-top.png"),
    ("11-打包交付-下半.png", "shot-m-10-export-bottom.png"),
    ("12-编辑任务信息.png", "shot-m-11-editpack.png"),
    ("13-新建任务.png", "shot-m-12-newpack.png"),
    ("14-新建项目.png", "shot-m-14-project-new.png"),
    ("15-删除项目.png", "shot-m-15-project-del.png"),
    ("16-项目行悬浮按钮.png", "shot-proj-5-hover.png"),
    ("17-工单队列-我的.png", "shot-b13-1-mine.png"),
    ("18-工单队列-全部.png", "shot-b13-2-all.png"),
    ("19-工单详情.png", "shot-b13-4-detail.png"),
    ("20-工单同步设置.png", "shot-b17-1-settings-switch.png"),
    ("21-工单指派.png", "shot-b17-2-assign.png"),
    ("22-导出报表.png", "shot-b19-1-export-modal.png"),
    ("23-企业微信连接.png", "shot-b21-1-wecom-auth.png"),
    ("24-自动同步设置.png", "shot-b26-1-autosync-settings.png"),
    ("25-配置引导-欢迎.png", "shot-b54-1-wizard-welcome.png"),
    ("26-配置引导-工作区.png", "shot-b54-2-wizard-workspace.png"),
    ("27-配置引导-企业微信.png", "shot-b54-3-wizard-wecom.png"),
    ("28-配置引导-工单表.png", "shot-b54-4-wizard-ticket-settings.png"),
    ("29-配置引导-报表表.png", "shot-b54-5-wizard-report.png"),
    ("30-配置引导-完成.png", "shot-b54-6-wizard-summary.png"),
    ("31-文件已丢失.png", "shot-b8-2-missing-list.png"),
    ("32-批量重新定位.png", "shot-b8-3-missing-relocate.png"),
    ("33-未归属卡片.png", "shot-b25-1-unassigned-card.png"),
    ("34-未归属-认领条.png", "shot-b25-3-claim-bar.png"),
    ("35-已解绑项目.png", "shot-b7-3-lifecycle-unbound.png"),
    ("36-多工作区.png", "shot-b5-3-wslist.png"),
    ("37-工作区连不上.png", "shot-b5-1-banner.png"),
    ("38-多人协作指派.png", "shot-b18-2-submit.png"),
    ("39-任务卡片版本徽标.png", "shot-b9-1-pack-card-version.png"),
    ("40-已忽略的丢失.png", "shot-b47-2-ignored-list.png"),
    # 第 62 批（docs/45 / 46）：PS 插件联动 + 通用素材库（随 manual 场景一并拍出）
    ("41-快捷方式按钮.png", "shot-m-06-packdetail.png"),
    ("42-通用库视图.png", "shot-m-16-brandlib.png"),
    ("43-插件联动设置.png", "shot-m-17-plugin-modal.png"),
    # 第 67 批（docs/50）：卡片 / 列表双视图 + PSD 模板库
    ("44-模板库视图.png", "shot-b66-2-tpllib-scanned.png"),
    ("45-模板库-列表视图.png", "shot-b67-2-tpl-list.png"),
    ("46-通用库-列表视图.png", "shot-b67-1-brand-list.png"),
    ("47-任务-列表视图.png", "shot-b67-3-pack-list.png"),
    ("48-移动到分组.png", "shot-b67-4-brand-move.png"),
    ("49-批量条.png", "shot-b68-1-brand-bulk-bar.png"),
    # 第 79 批：设置收口成 5 页，手册 5.7 用这两张
    ("51-设置-通用.png", "shot-b74-1-settings-general.png"),
    ("52-设置-插件联动.png", "shot-b74-2-settings-plugin.png"),
]

# 有的图在手册里只占半栏（fig2 并排），整窗截图缩下去弹窗只有 250px 宽、字看不清 ——
# 这里给出「只留弹窗」的裁切框（原图像素，截图是 2x DPI）。键是目标文件名。
# 弹窗底边实测到 y=1058（底栏「关闭」那一行贴底），左右各带一点边框
CROP = {
    "51-设置-通用.png": (509, 363, 2024, 1058),
    "52-设置-插件联动.png": (509, 363, 2024, 1058),
}

ok, miss = 0, []
for dst, src in MAP:
    sp = os.path.join(SRC, src)
    if os.path.isfile(sp):
        out = os.path.join(DST, dst)
        shutil.copyfile(sp, out)
        if dst in CROP:
            from PIL import Image
            l, t, r, b = CROP[dst]
            im = Image.open(out)
            im.crop((l, t, r + 1, b + 1)).save(out, optimize=True)
        # 截图是 2x DPI（2534 宽）。手册里最宽也就 860 px，原样内联进单文件版要 19 MB；
        # 统一压到 1280 宽 —— 手册里最大显示 860 宽，还剩 1.5 倍像素密度，肉眼无损。
        from PIL import Image as _Img
        im2 = _Img.open(out)
        if im2.width > 1280:
            im2 = im2.resize((1280, round(im2.height * 1280 / im2.width)), _Img.LANCZOS)
            im2.save(out, optimize=True)
        ok += 1
    else:
        miss.append(src)
print("copied:", ok, "->", DST)
if miss:
    print("MISSING:")
    for m in miss:
        print("  -", m)
