# plan-limits

一个 Claude Code mod：在输入框上方用天气图标显示上下文窗口**占用了多少**、订阅的 5 小时和每周额度**还剩多少**，以及额度的重置时间（本机时间）、本会话按 API 价格算的费用和上一次回复的输出速度。

```
☁  Ctx 34% used   ☁  5h 57% left ↻ 22:13   ☁  Week 66% left ↻ Thu 11:00   Session $15.98   ⚡ 68 tps
```

每个数字都标明了含义：上下文是容量，显示占用量（`used`），进度条越满越接近自动压缩；额度是预算，显示剩余量（`left`），进度条像电池，满格表示还剩很多。上下文越满、额度剩得越少，天气越差：

| 上下文占用 | 额度剩余 | 显示 |
| --- | --- | --- |
| 25% 以下 | 75% 以上 | ☀ Clear |
| 25%–50% | 50%–75% | ☁ Cloudy |
| 50%–75% | 25%–50% | ☂ Showers |
| 75%–90% | 10%–25% | ☇ Storm |
| 90% 以上 | 10% 以下 | ↯ 红色：上下文显示 Compact soon（快要自动压缩），额度显示 Limit soon |

- 5 小时额度的重置时间在今天时只显示时间（`22:13`），跨过午夜会带上星期（`Thu 01:30`）；每周额度总是带星期。
- 和 [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) 一起装时，两者并排在同一行。终端宽度不够时自动减少细节：先把进度条和天气文字换成一个进度圆环（越满数值越大，样式见下），再去掉重置时间。
- 终端够宽时，上下文还会显示进度条和 `340k/1M` 这样的用量。
- `Session $15.98` 是本会话按 API 价格折算的费用，和 `/cost` 显示的一样。订阅用户不会真的被扣这笔钱，只是参考值。
- 额度数据只在订阅账号登录、且会话收到过第一次回复后才有。
- `⚡ 68 tps` 是主对话上一次模型回复的输出速度：API 报告的输出 token 数除以从第一个流式分片到结束的时间，不含等待首字的延迟，也不含服务端工具（如 advisor）运行的时间；终端里看不到的思考 token 也算在内。子代理的回复和不到 0.3 秒的短回复不计入，这时保留上一次的数值。每次回复结束时更新为准确值，会话收到第一次回复前不显示。
- 回复生成过程中显示实时估算值，带 `~` 并变暗，例如 `⚡ ~70 tps`：回复开始 1 秒后出现，每 0.5 秒刷新，结束时换成准确值。估算按已收到的文字换算 token（中日韩文字约 1 字 1 token，其他约 4 字符 1 token），再用之前几次回复的实际 token 数校正比例，所以前几次回复偏差较大，之后会越来越接近。

### 显示哪些项

五项都可以在 `/config` 里单独关掉，默认全部显示：

| 选项 | 控制的项 |
| --- | --- |
| `Show context` | `Ctx` 上下文占用 |
| `Show 5-hour limit` | `5h` 5 小时额度 |
| `Show weekly limit` | `Week` 每周额度 |
| `Show session cost` | `Session` 本会话费用 |
| `Show output speed` | `⚡` 输出速度 |

全部关掉时这一行不显示。

### 进度圆环样式

窄屏时代替进度条的圆环有三种样式，在 `/config` 里改 `Ring style`：

| 值 | 图标 | 档位 | 跟随天气颜色 |
| --- | --- | --- | --- |
| `moon`（默认） | 🌑 🌒 🌓 🌔 🌕 | 5 档 | 否，emoji 自带颜色 |
| `nerd` | Nerd Font 圆形分片 | 9 档 | 是，需要终端字体是 Nerd Font，否则显示成方框 |
| `circle` | ○ ◔ ◑ ◕ ● | 5 档 | 是，但在多数字体里个头偏小 |
| `none` | 不显示圆环 | — | — |

### 状态栏

mod 还自带一个输入框下方的状态栏，显示当前目录、模型和 effort，配色取自 Catppuccin Mocha：

```
/home/wds  Opus 5.5 · xhigh
```

effort 按强度从冷到暖着色：`low` 绿、`medium` 黄、`high` 橙、`xhigh` / `max` 红。

- 不会改动你的 `settings.json`：mod 只在你**没有**配置 `statusLine` 时，把自带的脚本（`statusline/statusline.sh`）借给合并后的设置。你已经有自己的状态栏的话，保留你的。卸载或停用 mod 后状态栏也随之消失。
- 需要 `bash`（Windows 上 Claude Code 本来就依赖 Git Bash）。装了 `jq` 时用它解析会话信息，没装也能用。
- 不想要的话在 `/config` 里关掉 `Status line`。

## 安装

需要 Claude Code 2.1.287 及以上。这个仓库本身就是一个插件市场：

```bash
claude plugin marketplace add fs666666/plan-limits
claude plugin install plan-limits@plan-limits
```

装好后在会话里运行 `/reload-plugins`，或者重启 Claude Code。

## 更新

改完代码后，把 `.claude-plugin/plugin.json` 里的 `version` 加一，提交并推送。各台设备运行：

```bash
claude plugin marketplace update plan-limits      # 拉取市场的最新清单
claude plugin update plan-limits@plan-limits      # 把已安装的插件升级到新版本
```

只运行第一条不会升级已安装的插件。升级后重启 Claude Code，或者在会话里运行 `/reload-plugins`。

## 开发

```bash
claude plugin validate .   # 检查清单和 mod 代码
claude plugin test .       # 运行 plan-limits.test.ts
```

本地调试时可以不安装，直接加载这个目录：`claude --plugin-dir ~/plan-limits`。
