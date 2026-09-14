# Agent Note: 修复桌面端剪贴板复制控件

Status: implemented

English | [中文](2026-09-14-desktop-clipboard-copy.zh.md)

## Problem

桌面 Shell 拒绝了所有 Electron 权限请求，因此 Chromium 拒绝渲染器调用 `navigator.clipboard.writeText`，所有复制控件看似可点击却没有效果。JSON 树还直接调用浏览器 API，没有复用 UI 的降级路径。

## Decision

桌面会话继续默认拒绝权限，但增加一个窄例外：启动时拥有的同源主框架页面可以请求 Electron 的 `clipboard-sanitized-write` 权限。权限检查和请求处理器使用相同的来源与框架校验。所有 JSON 树复制操作改用共享的 `writeClipboard` 封装，从而与其他复制控件统一异步 API 和 `execCommand` 降级行为。

## Alternatives considered

**放行所有权限请求。** 拒绝，因为桌面 Shell 不应向渲染器内容或跳转后的框架授予无关能力。

**同时放行剪贴板读写。** 拒绝，因为复制控件只需要写入，读取权限会扩大渲染器查看用户剪贴板内容的能力。

**让 JSON 树继续直接使用剪贴板 API。** 拒绝，因为它会绕过降级路径，使该控件的失败行为与 UI 其余部分不一致。

## Consequences

Electron 桌面渲染器中的复制控件恢复可用，同时外部来源、子框架、读取权限和其他无关权限请求仍然默认失败。共享封装在宿主拒绝写入时仍报告失败，不会误报成功，控件可以展示失败状态。

## Testing

桌面窗口策略单元测试覆盖同源主框架权限谓词。UI primitives 的剪贴板、终端、差异和 JSON 树测试一起通过，桌面主进程也成功编译。
