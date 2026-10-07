# plan-limits

一个 Claude Code mod：在输入框上方用天气图标显示上下文窗口的占用，以及订阅的 5 小时和每周额度（已用百分比、重置时间，用本机时间），还有本会话按 API 价格算的费用。

```
☁  Ctx 34%   ☁  5h 43% ↻ 22:13   ☁  Week 34% ↻ Thu 11:00   $15.98
```

| 已用 | 显示 |
| --- | --- |
| ≤25% | ☀ Clear |
| ≤50% | ☁ Cloudy |
| ≤75% | ☂ Showers |
| ≤90% | ☇ Storm |
| 90% 以上 | ↯ Limit soon（红色）；上下文显示为 Compact soon，表示快要自动压缩 |

- 5 小时额度的重置时间在今天时只显示时间（`22:13`），跨过午夜会带上星期（`Thu 01:30`）；每周额度总是带星期。
- 和 [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) 一起装时，两者并排在同一行。终端宽度不够时自动减少细节：先去掉进度条和天气文字，再去掉重置时间。
- 终端够宽时，上下文还会显示进度条和 `340k/1M` 这样的用量。
- 额度数据只在订阅账号登录、且会话收到过第一次回复后才有。

## 安装

需要 Claude Code 2.1.287 及以上。这个仓库本身就是一个插件市场：

```bash
claude plugin marketplace add fs666666/plan-limits
claude plugin install plan-limits@plan-limits
```

仓库是私有的，设备上的 git 需要能访问它（比如已经 `gh auth login`）。装好后在会话里运行 `/reload-plugins`，或者重启 Claude Code。

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
