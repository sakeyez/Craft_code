# dsh-tool-mc-project

[English](README.md) | 中文

只读的模型可见 Minecraft 项目检测工具。它注册 `detect_mc_project`，通过 `ctx.fs` 检查当前 session workspace，并以结构化 JSON 返回 Gradle 文件、mod metadata、source root、resource root、mixin、datagen 线索与验证命令事实。

该工具提取证据，不求值 Gradle。缺失文件、解析失败、loader 线索冲突和未知字段都会进入 `warnings`；工具仍返回符合 schema 的结果。

## Tool

| Tool | 用途 |
|---|---|
| `detect_mc_project` | 检测 loader、Minecraft 版本、mappings、mod id 候选、Java/Kotlin 使用、source set、resource root、mixin config、datagen 线索、已检查文件、warning 与推荐 Gradle 验证命令。 |

## Config

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxEntries` | `2000` | 发现 source/resource 与 metadata 线索时最多遍历的目录项数量。 |
| `maxFileBytes` | `524288` | 单个候选文本文件最多读取的字节数。更大的文件会跳过并写入 warning。 |

两个字段都必须是正整数。检测器不执行 Gradle task 或 shell 命令。

## Model Experience

### Minecraft Project Detection

#### What the model sees

模型会看到 `detect_mc_project` 工具 schema。该工具没有参数，返回一个 JSON 对象：

```json
{
  "workspace": "string",
  "loader": "fabric|forge|neoforge|quilt|unknown",
  "minecraftVersion": "string|null",
  "mappings": { "type": "string", "version": "string|null", "evidence": ["string"] },
  "modIdCandidates": [{ "id": "string", "source": "string", "confidence": "high|medium|low" }],
  "languages": { "java": "boolean", "kotlin": "boolean" },
  "mainSourceSets": [{ "name": "string", "java": ["string"], "kotlin": ["string"], "resources": ["string"] }],
  "resourceRoots": ["string"],
  "mixinConfigs": [{ "path": "string", "source": "string" }],
  "datagenClues": [{ "kind": "string", "source": "string", "detail": "string" }],
  "recommendedValidationCommands": ["string"],
  "inspected": { "gradleFiles": ["string"], "metadataFiles": ["string"], "sourceRoots": ["string"], "resourceRoots": ["string"] },
  "warnings": ["string"]
}
```

Native render 是同一个对象的格式化 JSON。`presentCall` 把 pending card 标为 `Detect Minecraft project`；`presentResult` 在 generic result card 中展示渲染后的 JSON。

#### Token effect

每个挂载此包的 agent composition 请求都会增加一个工具 schema。工具结果包含当前 workspace 扫描得到的紧凑 JSON 事实和 warning 字符串。

#### KV Cache effect

挂载的 composition 生命周期内前缀稳定。结果内容是每次调用的 workspace 状态，不能作为前缀缓存。

## Known Limitations and Deferred Work

- **不求值 Gradle** — 变量、convention plugin、included build 与生成的 source-set 声明，只有在文本里留下直接线索时才会被识别。
- **证据冲突保持显式** — loader 证据冲突时返回 `loader: "unknown"` 并附 warning，而不是任选一个。
- **验证命令只是建议** — 检测器会命名可能的 Gradle 命令，但不会通过执行 Gradle 来证明 task 存在。
