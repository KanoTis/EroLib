# Fix koekoe description and trip author identity

## Goal

修正 Koe-koe 详情解析：简介只保留投稿正文；同名作者用 trip / ナンネット ID 区分。

## Background

样例：`https://koe-koe.com/detail.php?n=763027`

真实 HTML 结构（`div.desc.detail`）：

```html
<p>
  <a href="search.php?word=…"><span class="user_name">ちひろ</span></a>◆TfWM43xdFw
  : 吸うやつでオナニーしました<br>
  イク時だけ声大きくてめちゃくちゃ恥ずかしい…
</p>
<p class="meta detail">…分类/时间…</p>
<p class="b_btn">…书签…</p>
```

现状问题：

1. **简介过宽**：`pickDescription` 对整个 `div.desc.detail` 做 `stripTags`，混入作者名、trip、分类、书签文案；且把 `<br>` 压成空格。
2. **同名无法区分**：只取 `.user_name` / `search.php?word=` 的昵称作 `authorName`/`authorId`，丢弃 `◆trip` 与 `◇ID_xxxxx`。官方 trip 用于证明同人、防冒充。

## Requirements

### R1. 简介仅投稿正文

- 从 `div.desc.detail`（或 class 含 `desc`+`detail`）内**第一个非 meta/b_btn 的 `<p>`** 提取。
- 去掉作者链、trip/ID、以及分隔用的 `:` 前缀。
- 保留正文换行（`<br>` → 换行）；不要把 meta / 书签 / 标签区并入 description。
- 样例 763027 期望：
  ```
  吸うやつでオナニーしました
  イク時だけ声大きくてめちゃくちゃ恥ずかしい…
  ```
- 无正文时 `description` 为 `undefined`/`null`（勿回退成站点 slogan 或整页文本）。

### R2. 作者身份含 trip / ナンネット ID

- `authorName` 展示完整身份，与站内一致：
  - 有 trip：`名前◆TripCode`（例 `ちひろ◆TfWM43xdFw`）
  - 有 ナンネット ID：`名前◇ID_xxxxx`（例 `なつです◇ID_76293`）
  - 仅昵称：`名前`
- `authorId` 使用同一完整身份字符串（路径 sanitize 已允许 `◆`/`◇`），用于目录与同名区分。
- trip / nanId 可写入 `extra`（`trip` / `nanId`）便于调试，非必须 UI 字段。
- 无 trip/ID 时行为与现网兼容（仅昵称）。

### R3. 回归

- 既有 title / cover=null / audioUrl / sourceUrl 行为不回退。
- 单测覆盖：带 trip 的真实结构、仅昵称、含 meta/b_btn 的 desc 块。

## Acceptance Criteria
- [x] `parseDetail` 对 763027 类 HTML：`description` 仅为投稿两行正文，不含 `ちひろ` / trip / エロ声 / ブックマーク
- [x] 同页：`authorName` 与 `authorId` 为 `ちひろ◆TfWM43xdFw`
- [x] `◇ID_xxxxx` 形式同样并入 `authorName`/`authorId`
- [x] 无 trip 的旧 fixture 仍解析出正确 title/description/author
- [x] `pnpm test` 中 koekoe 解析相关用例通过

## Out of Scope

- 迁移已落盘的错误 author 目录 / 错误 description（可用「刷新元数据」后续补；本任务不写迁移脚本）
- 搜索 API / UI 按 trip 筛选
- 改共享 schema 字段（继续用 `authorId`/`authorName`/`description`）

## Notes

- 轻量 bugfix：PRD-only。
- 相关：`apps/server/src/providers/koekoe.ts`、`apps/server/test/koekoe-parse.test.ts`、`docs/koe-koe-reverse-engineering.md`
