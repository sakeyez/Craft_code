# Agent Note: CraftCode 原生菜单与模组命令

Status: implemented

[English](2026-08-28-craftcode-native-menus.md) | 中文

## Problem

桌面壳需要原生项目和版本控制操作，但不能替换现有 Web 客户端，也不能把文件系统和进程权限交给 renderer。项目配置、Gradle 构建和 Git 诊断还需要可恢复的结果面板，而不是让 Electron 级错误直接崩溃。

## Decision

Electron 提供四个中文顶层菜单，并通过沙箱 preload 桥接发送封闭的动作词表。Windows 和 Linux 使用无边框窗口，并渲染 40px 高、采用紧凑 14px 标签、10px 横向按钮内边距和 36px 菜单按钮高度且感知主题的 Web 菜单栏；右侧放置 32px 的最小化、最大化/还原和关闭按钮。顶栏是可拖拽的标题栏区域，控制按钮不会触发拖拽，同时保留 Electron 原生子菜单；桥接只接受四个固定菜单 id 和相对内容区的整数坐标，主进程会先校验发送者与窗口边界，再打开其中一个菜单。macOS 保留原生窗口边框和系统应用菜单。每个平台都会安装完整 Electron 应用菜单，以提供原生角色和快捷键。

打包后的 Windows 构建会在 Electron ready 之前设置 `ai.deepseek.craftcode`，使安装器快捷方式与任务栏分组使用同一标识。开发运行不设置 AppUserModelID，因为此时没有已安装快捷方式持有该标识，因此窗口 ICO 可以直接提供任务栏按钮图标，而不会触发 Shell 的通用图标回退。

主进程校验项目路径，直接运行 Git，并限制命令输出长度。在 Windows 上，JAR 导出与 Minecraft 启动只把固定的 `gradlew.bat` 或 `gradle` 命令及固定参数交给 `ComSpec`；其他平台直接启动可用的 Gradle wrapper 或全局命令。项目设置保存在 `.dsh/project.yaml`；实现写入可被 JSON 读取的 YAML 子集，因此无需额外解析器。构建完成后，JAR 导出使用原生对话框选择并复制产物。

项目菜单启动或停止当前模组项目的开发客户端。Electron 解析完整且有界的 `tasks --all --console=plain` 输出，只接受唯一且未限定的 `runClient` 或 `runGame` 任务；`run_mc_check` 也使用同一个纯解析器与候选选择器。每个规范化项目路径最多持有一个客户端进程。主进程让菜单标签与当前项目保持同步，为失败退出保留有界输出，在五秒优雅期限后终止完整的 Gradle/Java 进程树，并在应用关闭时停止全部所属客户端。

renderer 保留现有聊天、插件、API、工作区和会话组合。`ui-desktop-menu` 客户端插件只为 Web 呈现的桌面菜单占用 frame 的单一 `shell.topbar` slot，并在 Electron preload 桥接存在时占用可追加 `shell.overlay` slot。它把原生菜单与游戏退出事件转换成由 renderer 绑定的 observable，通过注入回调调用 workspace/session 服务，并使用共享主题组件呈现受控的项目、搜索、Git 和命令结果弹窗。普通命令完成只通过 invoke promise 返回；长期运行的 Minecraft 进程通过专用事件报告稍后的自行退出或失败。创建 agent 时，agent-loop 在组装 prompt 时读取项目本地设置，并加入系统提示词和前置路径作为受限参考指引；它不会扫描这些路径。

帮助动作使用固定 HTTPS 占位地址，发布前再替换正式链接。

## Alternatives considered

**用第二套 Electron 客户端替换 Web UI。** 不采用，因为这会复制已经由 Web profile 提供的聊天、插件、API 和工作区行为。

**向 renderer 暴露 Node 或不受限的 IPC 命令执行器。** 不采用，因为项目和进程权限应由主进程持有，桥接需要小而可审计的白名单。

**在 Web 内容中渲染完整菜单树。** 不采用，因为原生子菜单无需在 renderer 重复实现键盘和焦点机制，就能保留操作系统菜单行为、编辑角色和快捷键。

**把设置保存在全局用户文件。** 不采用，因为项目提示词和前置引用需要随模组项目保存，并一致地应用于从该目录打开的会话。

**打开已安装的 Minecraft 启动器。** 不采用，因为它不会携带当前模组项目的源码、mappings、运行配置或开发 classpath；已声明的 Gradle 客户端任务才是项目持有的启动约定。

## Consequences

桌面动作只在 Electron 壳托管的 Web 页面中可用，普通浏览器标签页不变。Windows 和 Linux 获得与主题一致的顶层入口，原生子菜单行、macOS 菜单、目录对话框和 JAR 保存对话框则保留操作系统样式。桌面图标使用由 Web 端统一 favicon 生成并提交的多尺寸 ICO 资源。命令输出有界且可见，取消和缺少项目等错误保持可恢复。游戏启动会拒绝缺失、有限定、存在歧义或被截断的任务证据，而不是猜测 Gradle 目标。设置格式有意限制在本里程碑负责的字段内，发布打包、签名、更新和安装器仍是独立工作。
