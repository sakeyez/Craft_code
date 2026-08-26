### 1. 准确度测试：Position Recorder

你正在一个已经能够正常编译运行的 **Minecraft 1.21.1 + NeoForge 1.21.1 + Java 21** MDK 项目中工作。

你的任务是在当前项目中实现一个完整、可编译、可实际游玩的微型模组。直接修改项目，不要只给我代码示例或教程。

## 固定项目规格

* Minecraft：1.21.1
* Mod Loader：NeoForge 1.21.1
* Java：21
* mod id：`agent_accuracy_test`
* Java 根包名：`com.example.agentaccuracy`
* 模组显示名称：`Agent Accuracy Test`
* 不允许更改 Minecraft 或 NeoForge 版本。
* 不允许添加第三方依赖。
* 不允许使用 Mixin。
* 不允许添加当前任务没有要求的额外玩法。
* 所有实现必须使用适用于 NeoForge 1.21.1 的 API，不要套用旧版 Forge/NeoForge API。

如果当前模板中存在示例 Item、Block 或示例事件代码，可以在必要时删除或替换，最终项目中不要保留与本测试无关的示例内容。

---

# 功能目标

实现一个物品：

`agent_accuracy_test:position_recorder`

英文名：

`Position Recorder`

中文名：

`位置记录器`

最大堆叠数量为 1。

该物品用于记录玩家点击的方块坐标。

---

# 1. 数据结构

必须定义一个自定义数据结构：

`RecordedPosition`

它至少包含以下四个字段：

* `dimension`：字符串，例如 `minecraft:overworld`
* `x`：整数
* `y`：整数
* `z`：整数

必须为它创建并注册一个 **自定义 DataComponentType**。

Data Component 注册名固定为：

`agent_accuracy_test:recorded_position`

必须同时支持：

* 存档持久化
* 网络同步

也就是说退出世界、重新进入后，物品记录的数据仍然存在，并且客户端能够正确读取该数据用于 Tooltip。

**禁止使用 ItemStack 自定义 NBT 作为该功能的数据存储方案。**

不得使用类似以下旧式方案保存位置：

* `ItemStack#getOrCreateTag`
* 给 ItemStack 自己维护 `CompoundTag`
* 自定义 `"x"`、`"y"`、`"z"` NBT Tag

位置数据必须真正存储在注册的 Data Component 中。

---

# 2. 记录坐标

玩家手持 `Position Recorder` 右键点击一个方块时：

只在逻辑服务器执行数据修改。

记录：

* 当前维度 ID
* 被点击方块的 BlockPos X
* BlockPos Y
* BlockPos Z

例如玩家在主世界点击：

`125, 64, -37`

应保存：

* dimension = `minecraft:overworld`
* x = `125`
* y = `64`
* z = `-37`

如果记录器已经保存过位置，则直接覆盖旧位置。

成功记录后，向玩家 Action Bar 显示：

`Recorded: 125, 64, -37`

不消耗物品。

---

# 3. 清除坐标

玩家：

**潜行 + 手持 Position Recorder + 对空气右键**

时清除当前 Data Component。

如果此前存在记录：

清除后 Action Bar 显示：

`Recorded position cleared`

如果没有记录，则什么也不修改。

普通对空气右键不得清除数据。

---

# 4. Tooltip

没有记录位置时，Tooltip 在物品名称下显示：

`No position recorded`

存在记录时显示两行：

`Dimension: minecraft:overworld`

`Position: 125, 64, -37`

数字和维度必须来自物品当前 Data Component，不能使用客户端独立缓存的数据。

至少提供：

* `en_us.json`
* `zh_cn.json`

中文对应文本自行正常翻译，但功能和数值格式必须一致。

---

# 5. 创造模式物品栏

将 Position Recorder 加入：

`CreativeModeTabs.TOOLS_AND_UTILITIES`

不要创建新的 Creative Tab。

---

# 6. 合成配方

添加一个有序合成配方。

配方固定为：

```text
 R
RAR
 R
```

其中：

* `R` = `minecraft:redstone`
* `A` = `minecraft:amethyst_shard`

输出：

`1 x agent_accuracy_test:position_recorder`

---

# 7. 模型与资源

不需要制作 PNG。

物品模型使用：

`minecraft:item/generated`

并直接复用：

`minecraft:item/amethyst_shard`

作为 `layer0` 纹理。

必须保证游戏内不会出现紫黑缺失模型。

---

# 8. 工程要求

合理拆分：

* 主 Mod 类
* Item 注册
* Data Component 注册
* Position Recorder Item 类
* RecordedPosition 数据结构

具体类名允许略有差异，但职责必须清晰。

注册统一使用 NeoForge 1.21.1 推荐的 Registry/DeferredRegister 机制。

客户端专用逻辑如果存在，必须与服务器安全隔离，Dedicated Server 不得因为加载客户端类而崩溃。

---

# 9. 验证要求

实现后必须实际执行项目的 Gradle 编译。

至少运行：

Windows：

`gradlew.bat build`

Linux/macOS：

`./gradlew build`

根据当前环境选择正确命令。

如果编译失败：

1. 阅读错误信息。
2. 修改代码。
3. 再次编译。
4. 重复直到 `build` 成功，或者确认存在无法由代码解决的外部环境问题。

不要在第一次编译失败后就结束任务。

---

# 最终验收标准

最终项目必须同时满足：

1. `gradlew build` 成功。
2. 游戏能够加载 Mod。
3. Position Recorder 能正常获得。
4. 右键方块能够记录正确维度和 BlockPos。
5. 第二次记录能够覆盖第一次记录。
6. Tooltip 能显示正确记录。
7. 退出并重新进入世界后记录仍存在。
8. 潜行对空气右键能够清除记录。
9. 普通对空气右键不会清除记录。
10. 合成配方正确。
11. Dedicated Server 不引用客户端专用类。
12. 不使用 ItemStack 自定义 NBT 保存位置。
13. Data Component 同时具备持久化和网络同步能力。
14. 不存在与本任务无关的额外功能。

完成后不要写长篇教程。

最终回复只需要报告：

请把最终回复分成 `Verified` 和 `Unverified` 两部分。`Verified` 只能列出你实际执行过且成功的命令及结果；没有实际运行的游戏行为、Dedicated Server 或渲染结论必须放入 `Unverified`，不要写“全部通过”。

* 是否完成
* `build` 是否成功
* 主要新增/修改文件
* 如果仍存在问题，明确列出问题

### 2. 速度测试：8 个 Dense Block

你正在一个已经能够正常编译运行的 **Minecraft 1.21.1 + NeoForge 1.21.1 + Java 21** MDK 项目中工作。

这是一个以**开发速度和一次完成率**为主要评价指标的任务。

请直接修改当前项目并完成全部内容。不要给教程，不要只展示代码片段，不要询问需求中已经明确的信息。

## 固定项目规格

* Minecraft：1.21.1
* NeoForge：1.21.1
* Java：21
* mod id：`agent_speed_test`
* Java 根包名：`com.example.agentspeed`
* 模组显示名称：`Agent Speed Test`
* 不允许升级或降级 Minecraft / NeoForge。
* 不添加第三方依赖。
* 不使用 Mixin。
* 不制作任何 PNG。
* 不使用 Data Generation。本任务中的 JSON 资源直接作为静态资源创建。
* 不实现任务之外的玩法。

如果模板存在无关示例内容，可以删除。

---

# 总目标

一次性加入以下 8 个新方块：

1. `dense_coal_block`
2. `dense_iron_block`
3. `dense_gold_block`
4. `dense_copper_block`
5. `dense_redstone_block`
6. `dense_lapis_block`
7. `dense_diamond_block`
8. `dense_emerald_block`

对应压缩对象分别是：

| 新方块                  | 对应 Vanilla 方块            |
| -------------------- | ------------------------ |
| dense_coal_block     | minecraft:coal_block     |
| dense_iron_block     | minecraft:iron_block     |
| dense_gold_block     | minecraft:gold_block     |
| dense_copper_block   | minecraft:copper_block   |
| dense_redstone_block | minecraft:redstone_block |
| dense_lapis_block    | minecraft:lapis_block    |
| dense_diamond_block  | minecraft:diamond_block  |
| dense_emerald_block  | minecraft:emerald_block  |

每一个新方块都必须有对应 BlockItem。

---

# 方块属性

每个 Dense Block 的基础方块属性应尽可能复制其对应的 Vanilla 方块，包括：

* hardness
* resistance
* sound
* map color 等合理基础属性

不要创建 8 个没有必要的自定义 Block 子类。

如果普通 `Block` 已足够实现，就使用普通 Block 注册。

---

# 创造模式

将全部 8 个 Dense Block 加入：

`CreativeModeTabs.BUILDING_BLOCKS`

顺序严格按照本需求中列出的 8 个方块顺序。

不要创建新的 Creative Tab。

---

# 合成规则

每一种 Dense Block 必须有两个配方。

## 压缩配方

使用 9 个对应 Vanilla 方块：

```text
XXX
XXX
XXX
```

合成：

`1 x dense_xxx_block`

例如：

9 个 `minecraft:diamond_block`

合成：

1 个 `agent_speed_test:dense_diamond_block`

---

## 解压配方

使用 1 个对应 Dense Block，通过 shapeless recipe 得到：

`9 x 对应 Vanilla 方块`

例如：

1 个 `agent_speed_test:dense_diamond_block`

得到：

9 个 `minecraft:diamond_block`

因此总共应存在：

* 8 个压缩配方
* 8 个解压配方

共 16 个 Recipe。

Recipe ID 使用清晰、确定的命名，例如：

* `dense_coal_block`
* `unpack_dense_coal_block`

其余材料使用同样规则。

---

# Loot Table

每个 Dense Block 被正常挖掘时掉落自身一个。

必须为全部 8 个方块提供正确的 Block Loot Table。

不要通过 Java 事件硬编码掉落。

---

# Mining Tags

全部 8 个方块都必须加入：

`minecraft:mineable/pickaxe`

以下三个加入：

`minecraft:needs_stone_tool`

* dense_coal_block
* dense_copper_block
* dense_iron_block

以下五个加入：

`minecraft:needs_iron_tool`

* dense_gold_block
* dense_redstone_block
* dense_lapis_block
* dense_diamond_block
* dense_emerald_block

不要自行改变这个分类。

---

# Blockstate 和 Model

每个 Dense Block 都使用普通完整立方体模型。

模型：

`minecraft:block/cube_all`

纹理直接复用对应 Vanilla Block 的纹理。

对应关系固定：

* dense_coal_block → `minecraft:block/coal_block`
* dense_iron_block → `minecraft:block/iron_block`
* dense_gold_block → `minecraft:block/gold_block`
* dense_copper_block → `minecraft:block/copper_block`
* dense_redstone_block → `minecraft:block/redstone_block`
* dense_lapis_block → `minecraft:block/lapis_block`
* dense_diamond_block → `minecraft:block/diamond_block`
* dense_emerald_block → `minecraft:block/emerald_block`

每个 BlockItem 的 item model 直接继承自己对应的 block model。

不创建 PNG。

最终游戏内所有方块和物品都不得出现 missing model / missing texture。

---

# Language

必须提供：

* `en_us.json`
* `zh_cn.json`

英文名称严格为：

* Dense Coal Block
* Dense Iron Block
* Dense Gold Block
* Dense Copper Block
* Dense Redstone Block
* Dense Lapis Block
* Dense Diamond Block
* Dense Emerald Block

中文名称严格为：

* 致密煤炭块
* 致密铁块
* 致密金块
* 致密铜块
* 致密红石块
* 致密青金石块
* 致密钻石块
* 致密绿宝石块

---

# 文件完整性

最终至少应覆盖以下类型的内容：

* Java Block 注册
* Java BlockItem 注册
* Creative Tab 添加
* 8 个 blockstate
* 8 个 block model
* 8 个 item model
* 8 个 block loot table
* 16 个 recipes
* pickaxe mining tag
* stone tool tag
* iron tool tag
* en_us
* zh_cn

允许合理复用 Java 注册逻辑，但不能遗漏任何一个资源。

---

# 禁止事项

不要：

* 为每个方块复制一个功能完全相同的 Java Block 子类。
* 使用自定义渲染器。
* 制作 PNG。
* 添加世界生成。
* 添加矿石。
* 添加自定义 Creative Tab。
* 添加配置文件。
* 添加网络包。
* 添加 BlockEntity。
* 添加 Data Generator。
* 添加任务未要求的物品。
* 修改 Vanilla 配方。

目标就是快速、准确地完成这批标准内容。

---

# 编译验证

全部实现完成后，立即执行：

Windows：

`gradlew.bat build`

Linux/macOS：

`./gradlew build`

如果 build 失败，直接根据错误修复并重新执行。

持续修复直到：

`BUILD SUCCESSFUL`

或者确定存在与代码无关的外部环境故障。

不要因为第一次 build 失败而停止。

---

# 最终验收

最终必须满足：

1. `gradlew build` 成功。
2. 恰好存在要求的 8 个 Dense Block。
3. 恰好存在对应的 8 个 BlockItem。
4. 8 个方块均出现在 Building Blocks Tab。
5. 8 个方块均有正确 Blockstate。
6. 8 个方块均有正确 Block Model。
7. 8 个 BlockItem 均有正确 Item Model。
8. 所有纹理均复用指定 Vanilla 纹理。
9. 8 个方块均正常掉落自身。
10. 总共存在 16 个指定配方。
11. 所有 Mining Tag 内容完全符合要求。
12. 中英文名称完全符合要求。
13. 游戏内不存在 Missing Model 或 Missing Texture。
14. 没有任务范围外的额外功能。

完成后不要解释 Minecraft Mod 开发原理。

最终只报告：

请把最终回复分成 `Verified` 和 `Unverified` 两部分，并列出实际执行的命令及结果。没有实际运行的游戏行为、Dedicated Server 或渲染结论必须标记为 `Unverified`，不要把静态代码检查描述成运行时验证。

* 完成状态
* build 状态
* 新增/修改文件数量
* 主要文件路径
* 如有未完成项，明确指出

### 3. 复杂能力测试：Resonance Processor

你正在一个已经能够正常编译运行的 **Minecraft 1.21.1 + NeoForge 1.21.1 + Java 21** MDK 项目中。

这是一个完整的跨系统 Minecraft Mod 开发任务。

请直接修改项目并真正完成实现，不要给教程或伪代码。

## 固定环境

* Minecraft：1.21.1
* NeoForge：1.21.1
* Java：21
* mod id：`agent_complex_test`
* Java 根包名：`com.example.agentcomplex`
* 模组显示名称：`Agent Complex Test`

禁止：

* 修改 Minecraft 或 NeoForge 版本
* 添加第三方依赖
* 使用 Mixin
* 使用其他 Mod 提供的 API
* 用命令代替正常玩法逻辑
* 为了绕开要求而硬编码客户端结果

所有游戏状态必须以逻辑服务器为权威。

---

# 总目标

实现一个完整机器方块：

`agent_complex_test:resonance_processor`

英文名：

`Resonance Processor`

中文名：

`共振处理器`

它拥有：

* Block
* BlockItem
* BlockEntity
* 3 个机器物品槽
* Menu
* Screen
* 自定义 RecipeType
* 自定义 RecipeSerializer
* 自定义 RecipeInput
* 自定义 C2S Payload
* NeoForge ItemHandler Block Capability
* Inventory / Progress / Enabled 状态持久化
* GUI 数据同步

不需要任何自定义 PNG。

---

# 一、机器 Inventory

Resonance Processor 有且只有 3 个机器槽位。

固定定义：

* Slot 0：Input A
* Slot 1：Input B
* Slot 2：Output

Slot 2 禁止玩家手动放入物品。

玩家能够正常从 Slot 2 取出结果。

Menu 中还必须包含：

* 玩家主背包 27 格
* Hotbar 9 格

必须实现正常的 Shift+Click，即 `quickMoveStack`。

预期行为：

机器输入槽 Shift+Click → 玩家背包。

机器输出槽 Shift+Click → 玩家背包。

玩家背包中的物品 Shift+Click 时：

优先尝试进入机器 Input A / Input B。

不得进入 Output。

如果不能进入机器输入槽，则在玩家主背包和 Hotbar 之间按 Vanilla 常规方式移动。

不得复制或吞掉物品。

---

# 二、自定义机器 Recipe

注册自定义 RecipeType：

`agent_complex_test:resonance_processing`

注册对应 RecipeSerializer：

`agent_complex_test:resonance_processing`

创建一个两输入的 RecipeInput。

Slot 对应关系固定：

* Input A = Slot 0
* Input B = Slot 1

顺序固定，不需要支持交换输入。

Recipe 数据至少包含：

* `ingredient_a`
* `ingredient_b`
* `result`
* `processing_time`

其中：

* ingredient_a：Ingredient
* ingredient_b：Ingredient
* result：ItemStack
* processing_time：正整数 tick

RecipeSerializer 必须按照 Minecraft 1.21.1 / NeoForge 1.21.1 正确实现：

* JSON Codec / MapCodec
* Network StreamCodec

不要使用旧版已经不适用于 1.21.1 的 RecipeSerializer 实现方式。

---

# 三、固定测试 Recipe

添加：

`agent_complex_test:resonating_echo_shard`

类型：

`agent_complex_test:resonance_processing`

内容固定：

Input A：

`minecraft:amethyst_shard`

Input B：

`minecraft:redstone`

Result：

`1 x minecraft:echo_shard`

Processing Time：

`100 ticks`

也就是说：

1 个紫水晶碎片 + 1 个红石粉

在机器中工作 100 tick 后：

生成 1 个 Echo Shard。

---

# 四、机器工作逻辑

所有加工逻辑只能在逻辑服务器运行。

机器拥有：

`progress`

和：

`enabled`

两个状态。

默认：

* progress = 0
* enabled = true

每个 Server Tick：

只有同时满足以下所有条件才允许 progress + 1：

1. enabled == true
2. Input A 和 Input B 匹配某个 `resonance_processing` Recipe
3. Output 能完整容纳 Recipe Result

如果任何一个条件不满足：

`progress` 立即重置为 0。

不能继续保留之前的半成品进度。

当：

`progress >= processing_time`

时：

1. 从 Slot 0 消耗 1 个匹配物品。
2. 从 Slot 1 消耗 1 个匹配物品。
3. 将 Recipe Result 完整加入 Slot 2。
4. progress 重置为 0。
5. 正确调用需要的 dirty/change 标记。

不得在客户端复制一次加工逻辑。

不得因为 GUI 开启与否影响机器加工。

关闭 GUI 后机器仍应正常工作。

---

# 五、Output 判断

开始加工前必须确认完整 Recipe Result 能放入 Output。

例如：

如果 Recipe Result 是 1 个 Echo Shard：

Output：

* 空 → 可以工作
* 已有 63 个 Echo Shard → 可以工作
* 已有 64 个 Echo Shard → 不可以工作
* 放着其他物品 → 不可以工作

不得在加工完成后才发现结果放不进去并丢失物品。

---

# 六、持久化

BlockEntity 必须保存并恢复：

* 三个槽位的 ItemStack
* progress
* enabled

退出世界并重新进入后必须保持状态。

BlockEntity 自己的数据可以使用适用于 1.21.1 的 BlockEntity NBT 持久化机制。

数据发生改变时要正确调用 `setChanged()` 或等价的必要逻辑。

---

# 七、右键打开 GUI

玩家空手或手持普通物品右键 Resonance Processor：

打开机器 GUI。

服务器负责打开 Menu。

Menu 必须满足 NeoForge 1.21.1 的正确客户端/服务器构造流程。

`stillValid` 必须确保玩家距离机器不超过 Vanilla 容器正常交互距离。

如果方块已经不存在，Menu 不应继续被认为有效。

---

# 八、GUI

创建：

`ResonanceProcessorScreen`

使用 `AbstractContainerScreen`。

不制作 GUI PNG。

背景可以直接使用 `GuiGraphics` 绘制矩形。

GUI 至少清楚显示：

* Resonance Processor 标题
* Input A 槽
* Input B 槽
* Output 槽
* 玩家 Inventory
* Progress
* Enable / Disable Button

进度文字固定格式：

`Progress: current/max`

例如：

`Progress: 37/100`

没有有效 Recipe 时：

`Progress: 0/0`

或者：

`Progress: 0/100`

二选一后保持实现一致。

优先使用 `0/0` 表示当前没有有效 Recipe。

---

# 九、GUI 数据同步

GUI 必须从服务器同步至少：

* 当前 progress
* 当前 Recipe processing_time
* enabled 状态

不能让客户端自己根据 Tick 猜 progress。

可以使用适用于 Menu 的标准 ContainerData/DataSlot 等机制。

打开 GUI 后，应能观察到进度随服务器加工实时变化。

---

# 十、Enable / Disable Button

GUI 中添加一个按钮。

enabled == true 时显示：

`Enabled: ON`

enabled == false 时显示：

`Enabled: OFF`

点击按钮后必须向服务器发送一个自定义 C2S Payload。

Payload ID 使用：

`agent_complex_test:toggle_processor`

Payload 至少包含：

`BlockPos`

不得让客户端直接修改 BlockEntity 的 enabled 字段。

---

# 十一、网络安全验证

服务器接收到 `toggle_processor` Payload 后必须验证：

1. 发送者是有效 ServerPlayer。
2. 玩家当前打开的是 Resonance Processor 对应 Menu。
3. Menu 对应的机器位置与 Payload 中 BlockPos 相同。
4. 该位置仍然存在 Resonance Processor BlockEntity。
5. 玩家距离机器不超过 8 blocks。

只有全部验证通过才执行：

`enabled = !enabled`

修改后：

* 调用必要的 changed/dirty 逻辑。
* GUI 最终同步新的 enabled 状态给客户端。

恶意客户端不能仅发送任意 BlockPos 就远程切换其他机器。

网络包必须使用适用于 NeoForge 1.21.1 的 Payload 注册机制。

---

# 十二、Item Handler Capability

为 Resonance Processor 注册：

NeoForge Block ItemHandler Capability。

使用 NeoForge 1.21.1 的 Capability 注册机制。

Capability 行为固定如下。

## Direction.UP

暴露 Input A 和 Input B：

* 可以 Insert
* 不允许 Extract

不得暴露 Output。

## Direction.DOWN

只暴露 Output：

* 不允许 Insert
* 可以 Extract

不得暴露 Input A / Input B。

## 四个水平方向

不暴露 ItemHandler。

即：

* NORTH → null / unavailable
* SOUTH → null / unavailable
* EAST → null / unavailable
* WEST → null / unavailable

因此预期：

顶部 Hopper 可以向机器输入材料。

底部 Hopper 可以抽走成品。

侧面 Hopper 无法与机器 Inventory 交互。

Capability 不得绕过 Output 禁止插入的规则。

---

# 十三、方块资源

Resonance Processor 是普通完整立方体。

不制作 PNG。

Block Model 使用：

`minecraft:block/cube_all`

纹理直接复用：

`minecraft:block/crying_obsidian`

BlockItem Model 继承该 Block Model。

必须有正确 Blockstate。

方块正常破坏时掉落自身。

---

# 十四、创造模式

将 Resonance Processor 加入：

`CreativeModeTabs.FUNCTIONAL_BLOCKS`

不要创建自定义 Creative Tab。

---

# 十五、机器合成配方

额外提供一个普通 Vanilla Shaped Recipe 用于制作机器本身。

固定配方：

```text
RAR
ACA
RAR
```

其中：

* R = `minecraft:redstone`
* A = `minecraft:amethyst_shard`
* C = `minecraft:crafting_table`

输出：

`1 x agent_complex_test:resonance_processor`

不要与机器内部的 `resonance_processing` 自定义 Recipe 混淆。

---

# 十六、语言

至少提供：

`en_us.json`

`zh_cn.json`

必须覆盖：

* Resonance Processor
* GUI 标题
* Enabled: ON
* Enabled: OFF
* Progress

英文和中文都要能够正常显示。

---

# 十七、客户端隔离

以下客户端专用代码必须安全隔离：

* Screen
* Screen 注册
* 其他仅客户端可用类

Dedicated Server 不得因为尝试加载 `Minecraft`、Screen 或其他客户端类而崩溃。

---

# 十八、推荐代码职责划分

最终代码应至少在逻辑上包含：

* Mod 主类
* Block 注册
* Item 注册
* BlockEntityType 注册
* MenuType 注册
* RecipeType 注册
* RecipeSerializer 注册
* ResonanceProcessorBlock
* ResonanceProcessorBlockEntity
* ResonanceProcessorMenu
* ResonanceProcessorScreen
* ResonanceProcessingRecipe
* ResonanceProcessingRecipeInput
* ResonanceProcessingRecipeSerializer
* ToggleProcessorPayload
* 网络注册/处理
* Capability 注册

允许合理合并纯注册类，但不要把全部实现塞进一个 Java 文件。

---

# 十九、实现原则

如果发现某个 API 名称与你记忆中的旧版本不同：

优先检查当前 NeoForge 1.21.1 项目实际依赖/API，而不是强行使用旧版写法。

禁止为了让编译通过而：

* 删除指定功能
* 注释掉关键代码
* 把 Recipe 改成硬编码 if
* 删除 Capability
* 删除网络包
* 让按钮只在客户端生效
* 删除 GUI
* 用 Vanilla Furnace 直接替代本机器
* 用 Crafting Recipe 冒充自定义机器 Recipe

---

# 二十、编译和修复

实现完成后必须执行：

Windows：

`gradlew.bat build`

Linux/macOS：

`./gradlew build`

如果失败：

读取真正的 compiler / resource 错误并修复。

重新执行。

持续迭代，直到：

`BUILD SUCCESSFUL`

或者确定存在无法由项目代码修复的外部环境问题。

第一次编译失败绝对不能直接停止。

---

# 最终功能验收

必须逐项满足：

1. 项目 build 成功。
2. Resonance Processor 可以放置。
3. 右键可以打开 GUI。
4. GUI 有 3 个机器槽和完整玩家背包。
5. Amethyst + Redstone 能被 RecipeManager 识别为指定自定义 Recipe。
6. 加工时间严格为 100 Server Tick。
7. 100 Tick 后消耗两个输入并生成一个 Echo Shard。
8. Output 满时不加工。
9. 输入错误时 progress 重置为 0。
10. disabled 时 progress 重置为 0 并停止加工。
11. 关闭 GUI 后机器继续工作。
12. Inventory 能保存到世界存档。
13. progress 能保存。
14. enabled 能保存。
15. GUI 显示服务器同步的 progress。
16. GUI 按钮通过 C2S Payload 控制服务器。
17. 服务器对 Payload 做位置、Menu 和距离验证。
18. 顶部 ItemHandler 只能输入 Input。
19. 底部 ItemHandler 只能抽取 Output。
20. 水平方向无 ItemHandler。
21. Shift+Click 不复制、不吞物品。
22. Block 掉落自身。
23. 普通机器合成配方正确。
24. 自定义 Recipe JSON 能正常加载。
25. Dedicated Server 不加载客户端 Screen 类。
26. 没有 Missing Model / Missing Texture。
27. 没有通过删减需求来换取编译成功。

完成后不要写教程。

最终回复只需要：

请把最终回复分成 `Verified` 和 `Unverified` 两部分，并列出实际执行的命令及结果。没有实际运行的游戏行为、Dedicated Server 或 GUI 结论必须标记为 `Unverified`，不要声称全部功能已验证。

* 完成状态
* build 状态
* 已实现的主要系统
* 主要修改文件
* 如果存在未通过项目，逐条列出
