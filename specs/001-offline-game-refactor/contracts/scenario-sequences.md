# 对局场景时序图

这十张图按[功能规格](../spec.md)、[四层边界](layer-boundaries.md)和[业务交互契约](business-interactions.md)描述重构后的业务时序。数字编号对应场景，消息上的 M、A 编号对应契约。

- 启动器、前端、AI 玩家适配器和观战端属于玩家端与观战端层。图中前端、AI 玩家适配器与对局之间的玩家协议消息均经玩家协议桥。对局层涵盖会话、统一接口、核心、视图投影和历史记录。
- 实线表示命令、查询或层内调用，虚线表示原请求的返回，开放箭头表示已发生的事件。玩家操作和层内步骤直接写业务含义。图中仅展示经过的参与者。
- M02 携带命令 ID 与期望修订号，决策应答另带决策 ID。对局层先查同席位回执，再核验新命令。同 ID 同内容重试返回原回执，同 ID 不同内容返回冲突。合法决策只消费一次。
- 图中的「确认」表示候选状态的权威快照、历史和命令回执已在同一事务提交。事务成功后才返回正式回执和发布 M04。事务失败保留上次确认进度。各连接接收自己的有序可见事件，发现序号缺口时可用 M03 重取快照。
- 卡牌效果、换牌限制、终焉阈值和阶段裁定顺序由开局锁定的规则版本与卡池快照决定。

## 1. 玩家从前端启动真人对 AI 对局

玩家在宿主启动器选官方 2D 或 3D、双方牌表和发行版。启动器预备 AI，随后请求对局层建立会话。各席位就绪后取得自己的初始视图。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant L as 宿主启动器
    participant F as 2D／3D 前端
    participant G as 对局层
    participant D as 构筑与卡池层
    participant A as AI 玩家适配器
    participant M as AI 决策层

    P->>L: 选择前端、双方牌表、AI 模型与发行版
    L->>A: 准备 AI 席位适配器
    A->>M: Query · A01 查询模型可用性与版本
    M-->>A: 返回可用性和版本
    opt 模型可用
        A->>M: Command · A02 准备模型席位
        M-->>A: 返回模型准备结果
    end
    A-->>L: 返回 AI 席位准备结果
    alt 模型不可用或准备失败
        L-->>P: 显示失败原因
    else AI 已准备
        L->>F: 启动所选前端
        L->>G: Command · M01 创建 PVE，附 AI 准备结果
        G->>D: Query · M05 校验双方牌表并取得发行快照
        D-->>G: 返回诊断和可用的只读快照
        alt 校验或会话初始化失败
            G-->>L: 返回失败席位或准备原因
            L->>L: 释放预备资源
            L-->>P: 显示失败原因
        else 会话初始化成功
            G->>G: 核验并绑定席位，固定卡池快照及规则版本
            G-->>L: 返回已就绪会话引用
            G-)F: Event · M04 玩家席位已就绪
            G-)A: Event · M04 AI 席位已就绪
            F->>G: Query · M03 读取玩家席位初始视图
            G-->>F: 返回先手、公开战场与本席起手牌
            A->>G: Query · M03 读取 AI 席位初始视图
            G-->>A: 返回本席初始视图
            F-->>P: 展示战场和起手牌
        end
    end
```

## 2. 玩家重换起手牌

核心校验换牌资格并处理随机结果。成功后，本席收到新的起手牌，对手仅收到其可见变化。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 请求重换起手牌
    F->>G: Command · M02 重换起手牌
    G->>G: 查询同席位命令回执
    alt 同命令 ID 且内容相同
        G-->>F: 返回原回执
    else 同命令 ID 但内容不同
        G-->>F: 返回命令冲突
    else 新命令
        G->>G: 核验修订号、行动权与换牌条件
        alt 换牌有效且确认成功
            G->>G: 按固定规则处理随机结果并确认换牌
            G-->>F: 返回换牌回执
            G-)F: Event · M04 起手牌已更新，附本席可见结果
            opt 有 AI 席位可见的变化
                G-)A: Event · M04 AI 席位可见状态已更新
            end
        else 校验或提交失败
            G-->>F: 返回失败原因
        end
    end
    F-->>P: 展示本席状态或相应反馈
```

## 3. 玩家从手牌打出一张牌

以一张可直接结算的手牌为例。核心按规则裁定出牌，对局接口向双方提供各自可见的结算结果。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 选择手牌并确认打出
    F->>G: Command · M02 打出选定手牌
    G->>G: 核验席位、行动权和出牌条件
    alt 动作合法且确认成功
        G->>G: 按固定版本结算并确认
        G-->>F: 返回出牌回执
        G-)F: Event · M04 出牌已结算，附玩家席位可见更新
        G-)A: Event · M04 出牌已结算，附 AI 席位可见更新
        F-->>P: 展示出牌结果
    else 校验或提交失败
        G-->>F: 返回失败原因
        opt 前端需要同步到最新可见状态
            F->>G: Query · M03 读取当前玩家席位视图
            G-->>F: 返回快照与本连接序号
        end
        F-->>P: 展示失败反馈及最新可用状态
    end
```

## 4. 玩家使用「炽羽」并选择弃牌

出牌和弃牌确认分别提交。核心确认暂停进度后，选择候选只交付有权应答的席位。结算后，对手看见公开弃牌与抽牌数量，玩家看见自己抽到的牌。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 打出「炽羽」
    F->>G: Command · M02 打出「炽羽」
    G->>G: 核验出牌条件，尝试推进到待选牌状态
    alt 出牌合法且暂停状态已确认
        G-->>F: 返回出牌回执
        G-)F: Event · M04 弃牌决策已生成，附本席候选与限制
        opt 此时有对手可见的变化
            G-)A: Event · M04 AI 席位可见状态已更新
        end
        F-->>P: 展示可弃手牌
        P->>F: 确认弃牌选择
        F->>G: Command · M02 提交决策 ID 及弃牌选择
        G->>G: 核验应答席位、决策状态和选择限制
        alt 应答合法且确认成功
            G->>G: 恢复结算，确认弃牌、抽牌和条件效果
            G-->>F: 返回应答回执
            G-)F: Event · M04 效果已结算，附公开弃牌和本席新抽牌
            G-)A: Event · M04 效果已结算，附公开弃牌和抽牌数量
            F-->>P: 更新手牌并展示结果
        else 应答校验或提交失败
            G-->>F: 返回失败原因
            F-->>P: 展示失败反馈
        end
    else 出牌校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    end
```

已确认的待弃牌状态可在重启后恢复。若弃牌与抽牌已确认但回执未送达，重新授权的席位以同 ID、同内容重试可取得原回执。[恢复验收](../spec.md#success-criteria-mandatory)

## 5. 玩家指挥单位攻击

玩家选择单位和目标。核心裁定攻击。此图展示直接结算路径，需要等对手响应的路径见场景 6。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 选择攻击单位和目标
    F->>G: Command · M02 提交攻击
    G->>G: 核验行动权、攻击单位和目标
    alt 攻击有效、无需响应且确认成功
        G->>G: 按固定规则完成并确认攻击结算
        G-->>F: 返回攻击回执
        G-)F: Event · M04 攻击已结算，附玩家席位可见更新
        G-)A: Event · M04 攻击已结算，附 AI 席位可见更新
        F-->>P: 展示攻击结果
    else 校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    end
```

## 6. 玩家在对手回合翻开回响

以 AI 的合法攻击触发响应窗口为例。玩家选择翻开回响或放弃响应，核心验证选择之后继续处理原攻击。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    A->>G: Command · M02 以 AI 席位提交攻击
    G->>G: 确认响应窗口与暂停位置
    G-->>A: 返回攻击回执
    G-)F: Event · M04 响应窗口已开启，附本席选项和限制
    G-)A: Event · M04 攻击进入等待响应，附 AI 席位可见更新
    F-->>P: 展示可翻开的回响和放弃选项
    P->>F: 选择翻开回响或放弃
    F->>G: Command · M02 提交决策 ID 及响应选择
    G->>G: 核验应答席位、窗口状态和选项
    alt 响应合法且确认成功
        alt 翻开回响
            G->>G: 按规则处理回响及后续攻击
        else 放弃响应
            G->>G: 继续结算攻击
        end
        G->>G: 确认本次响应的结算结果
        G-->>F: 返回应答回执
        G-)F: Event · M04 攻击已结算，附玩家席位可见更新
        G-)A: Event · M04 攻击已结算，附 AI 席位可见更新
        F-->>P: 展示结算结果
    else 应答校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    end
```

## 7. 玩家让单位进化或发动技能

核心使用指定版本裁定进化和技能条件。动作可以直接确认，也可以先确认待决策状态，再等待玩家补充选择。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 发起进化或单位技能
    F->>G: Command · M02 提交进化或技能意图
    G->>G: 核验行动权、相关单位与发动条件
    alt 无需选择且结算确认成功
        G->>G: 确认进化或技能结算
        G-->>F: 返回动作回执
        G-)F: Event · M04 效果已结算，附玩家席位可见更新
        G-)A: Event · M04 效果已结算，附 AI 席位可见更新
    else 需要选择且暂停状态已确认
        G-->>F: 返回动作回执
        G-)F: Event · M04 选择已就绪，附本席候选及限制
        F-->>P: 展示候选
        P->>F: 确认选择
        F->>G: Command · M02 提交决策 ID 及选择
        G->>G: 校验应答并尝试恢复结算
        alt 应答合法且确认成功
            G-->>F: 返回应答回执
            G-)F: Event · M04 效果已结算，附玩家席位可见更新
            G-)A: Event · M04 效果已结算，附 AI 席位可见更新
        else 校验或提交失败
            G-->>F: 返回失败原因
        end
    else 动作校验或提交失败
        G-->>F: 返回失败原因
    end
    F-->>P: 展示本席可见结果或失败反馈
```

## 8. 玩家结束回合，AI 接手

核心确认回合交接。AI 适配器按本席观察请求决定，丢弃失效决定，再把有效动作提交给对局层复核。模型试算只使用授权资料和隔离副本。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器
    participant M as AI 决策层

    P->>F: 点击结束回合
    F->>G: Command · M02 结束回合
    G->>G: 核验行动权与结算状态，尝试确认回合收尾
    alt 校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    else 回合推进已确认
        G-->>F: 返回结束回合回执
        G-)F: Event · M04 回合状态已更新，附玩家席位可见结果
        opt AI 席位取得行动权
            G-)A: Event · M04 AI 已取得行动权，附本席可见状态
            A->>M: Command · A02 请求生成行动，附请求 ID 与本席上下文
            M-->>A: 返回生成受理
            opt 模型需要试算
                M->>G: Query · M06 读取获准的本席试算种子与同版解算器能力
                G-->>M: 返回授权只读资料
                M->>M: 在隔离副本上试算
            end
            M-)A: Event · A03 行动已生成，回带请求 ID 与状态基准
            alt 请求或状态基准已失效
                A->>A: 丢弃迟到决定
            else 决定仍适用
                A->>G: Command · M02 以 AI 席位提交动作
                G->>G: 再次校验修订号、行动权及适用的决策 ID
                alt 动作有效且确认成功
                    G-->>A: 返回动作回执
                    G-)F: Event · M04 玩家席位可见状态已更新
                    G-)A: Event · M04 AI 席位可见状态已更新
                else 校验或提交失败
                    G-->>A: 返回失败原因
                end
            end
        end
    end
```

## 9. 对局进入终焉或分出胜负

一次合法动作的结算可能改变对局阶段或产生终局。核心按开局规则裁定并确认状态，观战连接读取公开投影。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器
    participant O as 观战端

    P->>F: 发起当前对局动作
    F->>G: Command · M02 提交席位动作
    G->>G: 核验动作并按固定规则裁定阶段或终局
    alt 结算确认成功
        G-->>F: 返回动作回执
        G-)F: Event · M04 玩家席位可见状态已更新
        G-)A: Event · M04 AI 席位可见状态已更新
        F-->>P: 展示适用的阶段或胜负结果
        opt 已订阅的观战端可见公开变化
            G-)O: Event · M04 公开战场、阶段或终局已更新
        end
        opt 观战端接入或需要刷新
            O->>G: Query · M03 读取当前公开视图
            G-->>O: 返回公开快照及本连接序号
        end
    else 校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    end
```

## 10. 玩家使用百川冰泉

以一次需要随机产生候选并等待玩家选牌的冰泉效果为例。核心先确认随机候选与待决策状态，再按合法应答确认牌的去向和效果结果。

```mermaid
sequenceDiagram
    actor P as 玩家
    participant F as 2D／3D 前端
    participant G as 对局层
    participant A as AI 玩家适配器

    P->>F: 发起使用冰泉的动作
    F->>G: Command · M02 提交冰泉相关动作
    G->>G: 核验席位和发动条件，生成随机候选并尝试确认暂停状态
    alt 动作合法且暂停状态已确认
        G-->>F: 返回动作回执
        G-)F: Event · M04 选牌决策已生成，附本席可见候选和限制
        opt 已产生 AI 席位可见的变化
            G-)A: Event · M04 AI 席位可见状态已更新
        end
        F-->>P: 展示候选牌
        P->>F: 确认选择
        F->>G: Command · M02 提交决策 ID 及选牌结果
        G->>G: 核验应答，恢复结算并尝试确认牌的去向与效果结果
        alt 应答合法且确认成功
            G-->>F: 返回应答回执
            G-)F: Event · M04 冰泉效果已结算，附本席可见更新
            G-)A: Event · M04 冰泉效果已结算，附 AI 席位可见更新
            F-->>P: 展示结算结果
        else 校验或提交失败
            G-->>F: 返回失败原因
            F-->>P: 展示失败反馈
        end
    else 动作校验或提交失败
        G-->>F: 返回失败原因
        F-->>P: 展示失败反馈
    end
```
