# Agent Note: Web profile 包含 Minecraft Mod host bundle

Status: implemented

[English](2026-08-24-web-mcmod-profile-bundle.md) | 中文

## Problem

Web roster 会展示随包的 `mcmod` preset，但 Web profile 没有加载它所需的 host 侧 bundle。选择该 preset 时，preset 的 LSP 工具找不到 `lsp` 服务，于是失败并回到标准 preset。

## Decision

随包 Web profile 在 base 和 Web bundle 之后加载 `@deepseek-ai/dsh-mcmod-bundle`。其中 Java LSP 服务器是可选的，因此未安装 `jdtls` 时 Web profile 仍可启动，只禁用 Java LSP。启动器只升级完全匹配的旧官方 Web bundle 列表；包含额外 bundle 的 profile 仍视为用户配置，不会被重写。

## Alternatives considered

**从 Web roster 隐藏 `mcmod`。** 否决，因为 Minecraft Mod 是受支持的 Web preset，相关提示词和工具已经随包提供。

**始终覆盖 Web profile manifest。** 否决，因为用户可能添加自定义 bundle，这些条目必须由用户控制。

**只修复当前 profile 目录。** 否决，因为新安装仍会重现同一个不完整的 Web 组合。

## Consequences

新的 Web 安装可以在其必需的 LSP host 行下挂载 Minecraft Mod preset。未改动过的旧 Web profile 会在下次加载时升级。自定义 Web profile 保留原 bundle 列表，也可以自行显式加入 Minecraft bundle。缺少 `jdtls` 时会报告诊断，不再阻止 Web 启动。

## Testing

profile 测试覆盖新的 Web 模板、旧精确列表升级，以及自定义 Web 列表保留。当前 Web profile 另通过本地 API 选择 `mcmod` 验证。
