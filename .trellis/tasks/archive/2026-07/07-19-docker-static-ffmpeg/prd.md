# Docker 改用官方静态 FFmpeg

## Goal

用 **BtbN linux64 GPL 静态 FFmpeg** 替换 `apt install ffmpeg`，显著缩小镜像；保留 Erovoice `libmp3lame` 转码。

## Decisions

| # | 决策 | 结论 |
|---|---|---|
| D1 | 构建源 | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) `linux64-gpl` **静态**包（非 shared、非 lgpl） |
| D2 | 原因 | `transcodeToMp3` 使用 `-acodec libmp3lame` → 必须 GPL |
| D3 | 安装位置 | `/usr/local/bin/ffmpeg`；可选 `FFMPEG_PATH` 同路径 |
| D4 | runtime apt | 仅 `ca-certificates`（HTTPS）；**不再** apt 装 ffmpeg |
| D5 | 版本钉扎 | Dockerfile `ARG FFMPEG_URL` 默认可指向 `latest` release 资产；可构建时覆盖 |

## Requirements

- R1：镜像内 `ffmpeg -version` 可用，`ffmpeg -encoders` 含 `libmp3lame`
- R2：无 `apt-get install ffmpeg` 依赖闭包
- R3：业务 `ensureFfmpeg` / Erovoice 路径不变
- R4：README 说明 Docker 内置静态 ffmpeg

## Acceptance Criteria

- [ ] AC1：Dockerfile 无 `apt ... ffmpeg`
- [ ] AC2：runtime 含 `/usr/local/bin/ffmpeg`（静态 gpl）
- [ ] AC3：文档与 `FFMPEG_PATH` 说明一致
- [ ] AC4：typecheck 无回归（业务代码可不改）

## Out of Scope

- 换 alpine 基镜像
- 本地 Windows 开发机强制装 BtbN（仍可用本机 ffmpeg / FFMPEG_PATH）
