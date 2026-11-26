# 四层架构与交互图

箭头标记采用「语义 · ID 业务含义」。返回沿原命令或查询返回。跨层交互的请求和状态归属见[业务契约](business-interactions.md)和[数据模型](../data-model.md)。

## 层级总图

```mermaid
flowchart LR
  C["玩家端与观战端层"]
  M["对局层"]
  A["AI 决策层"]
  D["构筑与卡池层"]
  C -->|"Command · M01 创建对局"| M
  C -->|"Command · M02 提交动作或决策"| M
  C -->|"Query · M03 读取可见视图"| M
  M -->|"Event · M04 通知可见更新"| C
  M -->|"Query · M05 校验牌表并取得快照"| D
  A -->|"Query · M06 取得授权试算种子"| M
  C -->|"Query · A01 查询模型可用性"| A
  C -->|"Command · A02 准备模型或请求行动"| A
  A -->|"Event · A03 通知行动已生成"| C
  C -->|"Query · D01 查看或预检构筑及卡池"| D
  C -->|"Command · D02 保存卡组或编辑发布"| D
  D -->|"Event · D03 通知新版已发行"| C
  D -->|"Query · D04 查询规则能力"| M
```

## 玩家端与观战端层

```mermaid
flowchart LR
  B["层边界"]
  subgraph C["玩家端与观战端层"]
    L["启动器及管理界面｜安装与文件操作"]
    F["前端运行器｜运行实例与视图副本"]
    P["玩家协议桥｜连接和消息端口"]
    I["AI 玩家适配器｜席位上下文及待提交决定"]
    L -->|"Command · 启动所选前端"| F
    L -->|"Command · 准备 AI 席位适配器"| I
    F -->|"Command · 提交玩家动作"| P
    F -->|"Query · 读初始或当前投影"| P
    P -->|"Event · 更新可见结果"| F
    I -->|"Command · 提交模型行动"| P
    P -->|"Event · 更新 AI 席位上下文"| I
  end
  L -->|"Command · M01 创建对局"| B
  P -->|"Command · M02 提交动作或决策"| B
  P -->|"Query · M03 读取可见视图"| B
  B -->|"Event · M04 通知可见更新"| P
  I -->|"Query · A01 查询模型可用性"| B
  I -->|"Command · A02 准备模型或请求行动"| B
  B -->|"Event · A03 通知行动已生成"| I
  L -->|"Query · D01 查看或预检构筑及卡池"| B
  L -->|"Command · D02 保存卡组或编辑发布"| B
  B -->|"Event · D03 通知新版已发行"| L
```

## 对局层

```mermaid
flowchart LR
  B["层边界"]
  subgraph M["对局层"]
    S["本地会话｜席位绑定与就绪"]
    P["对局接口｜授权、回执与投影序列"]
    C["核心｜状态、规则裁定、随机及待决策"]
    R["回放与恢复模块｜动作、确认点、随机记录及回执"]
    S -->|"Command · 安装快照并初始化"| C
    S -->|"Command · 按会话绑定授权连接"| P
    P -->|"Query · 读权威状态用于投影和试算"| C
    P -->|"Command · 验证并应用动作"| C
    C -->|"Event · 产生结算变化"| P
    C -->|"Command · 原子确认状态、日志及回执"| R
    S -->|"Query · 读取最近确认状态用于续局"| R
  end
  B -->|"Command · M01 创建对局"| S
  B -->|"Command · M02 提交动作或决策"| P
  B -->|"Query · M03 读取可见视图"| P
  P -->|"Event · M04 通知可见更新"| B
  S -->|"Query · M05 校验牌表并取得快照"| B
  B -->|"Query · M06 取得授权试算种子"| P
  B -->|"Query · D04 查询规则能力"| C
```

## AI 决策层

```mermaid
flowchart LR
  B["层边界"]
  subgraph A["AI 决策层"]
    M["模型接口及任务队列｜模型上下文与结果"]
    V["席位可见模型和试算适配器｜隔离副本"]
    M -->|"Command · 运行选定模型"| V
    V -->|"Event · 提供计算完成结果"| M
  end
  B -->|"Query · A01 查询模型可用性"| M
  B -->|"Command · A02 准备模型或请求行动"| M
  M -->|"Event · A03 通知行动已生成"| B
  V -->|"Query · M06 取得授权试算种子"| B
```

## 构筑与卡池层

```mermaid
flowchart LR
  B["层边界"]
  subgraph D["构筑与卡池层"]
    E["构筑和编辑器服务｜编辑、预检与草稿"]
    U["用户卡组存储｜正式卡组"]
    C["卡牌目录｜发行版只读查询"]
    R["发布模块｜SQLite 事务与不可变发行"]
    E -->|"Query · 读取牌表和发行版"| C
    E -->|"Query · 读取已保存卡组"| U
    E -->|"Command · 保存已校验卡组"| U
    E -->|"Command · 提交草稿发布"| R
    E -->|"Query · 预检指定规则能力"| R
    C -->|"Query · 读取已提交发行数据"| R
  end
  B -->|"Query · M05 校验牌表并取得快照"| C
  B -->|"Query · D01 查看或预检构筑及卡池"| E
  B -->|"Command · D02 保存卡组或编辑发布"| E
  R -->|"Event · D03 通知新版已发行"| B
  R -->|"Query · D04 查询规则能力"| B
```

关键路径为 M01 → M05 → M04 的对局准备，M02 → M04 → M02 的暂停恢复，M04 → A02 → A03 → M02 的 AI 行动，以及 D02 → D04 → D03 的发布。AI 预检与双席准备通过 A01 和 A02 完成。观战接入读取 M03 的公开投影，后续接收 M04。

云端调试前端在测试构建中以自定义前端身份接入玩家端的前端运行器与协议桥，沿 M02、M03 和 M04 交互。四层业务入口及云端正反用例见[云端验收契约](cloud-testing.md)。
