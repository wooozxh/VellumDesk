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
]

ok, miss = 0, []
for dst, src in MAP:
    sp = os.path.join(SRC, src)
    if os.path.isfile(sp):
        shutil.copyfile(sp, os.path.join(DST, dst))
        ok += 1
    else:
        miss.append(src)
print("copied:", ok, "->", DST)
if miss:
    print("MISSING:")
    for m in miss:
        print("  -", m)
