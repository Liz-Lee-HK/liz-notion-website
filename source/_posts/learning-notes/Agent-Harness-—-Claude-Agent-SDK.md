---
title: "Agent Harness — Claude Agent SDK"
date: "2026-07-01T01:50:00.000Z"
updated: "2026-07-15T09:35:00.000Z"
categories: ["Study"]
tags: ["Notion", "学习笔记", "Agent", "Claude Agent SDK"]
layout: "post"
notion_sync: true
notion_mapping: "agent-harness-claude-agent-sdk"
notion_id: "390aeaf1-8f61-80e6-8c31-da4a4597ee56"
---

![Notion asset](/img/notion/39daeaf18f618080a4b8ffe8f9b64dc3.png)

## 核心概念

> “If you’re not the model, you’re the harness.”

- LLM：大语言模型，基于对话的计算模型，agent的大脑。
- Harness：给予agent实际执行能力的一套设计机制，拓展agent的能力，确定他的边界，加上一些校验和审核，保证agent稳定运行减少出错保证安全输出我们想要的结果。大语言模型的操作系统
- Agent：包括LLM、Skills、agent主程序、工具函数的一整套智能实体，本质上是以LLM为大脑，工具为手脚的智能体。

DeepAgents 和OpenAI Agents SDK以及Claude Agents SDK已经是成品的agent harness也就是操作系统了，只是说可以自定义修改一些配置，所以被理解为开发工具，但其实他们并不是让你自由开发的零散组件。

DeepAgents、OpenAI Agents SDK、Claude Agent SDK 是已经封装好的 harness。它们已经替你做好了很多运行时能力，你主要是在里面配置模型、工具、prompt、middleware、hooks、guardrails。

自己开发 harness 则是你自己决定所有边界。相当于自己开发一个操作系统。

> Agent = LLM大脑 + Harness运行调度层 + 工具/技能集 + 记忆与上下文管理

经典的AI就是网页或软件聊天那种，能生成一定的东西，但难以执行任务。Agent就是能做到执行层面，但易出错，准确性不足。Harness就是专门研究如何控制Agent的能力与边界的工程，提到任务执行的质量。

## 生产级 Harness 的组件

### 1. Agent Loop

agent执行任务的核心模块/逻辑，本质是 思考→调用外部工具 / 环境→接收结果→再思考」的循环。有几种不同的实现办法，ReAct和Plan-and-Execute

- ReAct：全称叫Reasoning & Acting, 即思考→执行→看看结果（组装prompt、调用模型、解析输出、执行tool call、把结果塞进上下文、继续下一轮），迭代循环。是绝大多数 Agent 框架（LangChain、OpenAI Agents SDK、Claude Agent）底层默认的循环逻辑。
- Plan-and-Execute：先计划完整流程，再分步执行。

### 2. 上下文管理

大模型本身没有记忆，每次对话都要带上之前的上下文，但上下文太长而上下文窗口有限的时候就要进行上下文管理，上下文中会有（系统提示词、用户指令、工具返回结果、AI思考过程等信息），对话轮数多了就需要压缩上下文，通过压缩历史内容或丢掉一部分。

- 压缩历史上下文：当快达到上下文窗口极限时，压缩之前的内容为摘要。缺点是会丢失信息，agent反复犯错也是因为这个。
- observation masking：mask掉旧的tool output，只保留关键信息
- 即时检索：靠轻量索引和局部读取，避免传入一整份大文件
- 多agent协作：主agent负责分任务，子agent负责一部分的工作，只用返回结果。上下文被分散到每一个子agent中，避免上下文爆炸。

### 3. 记忆系统

分为短期记忆（当前回话历史）+长期记忆（跨对话保留。在项目文件，数据库session，本地持久层，结构化store中）

短期记忆由 harness 在每一轮调用 LLM 前自动组装进 prompt/messages 里。

可以理解成：

```plain text
用户当前输入
+ 最近几轮对话
+ 当前任务状态
+ 已执行 tool call / tool result
+ 当前 scratchpad / todo / plan
+ 当前打开的文件或工作区状态摘要
= 短期记忆
```

每次 LLM 被调用前，harness 会做一次上下文组装：

```plain text
Conversation State
  ↓
裁剪/压缩/筛选
  ↓
拼成 messages
  ↓
发给 LLM
```

#### 长期记忆加载方式（codex的设计）

（1） 轻量索引：很短，始终加载。文件说明+路径，长期记忆的目录。

```python
- 用户偏好在 memory/preferences.md
- 项目架构在 memory/project_architecture.md
- MCP 文件代理方案在 memory/file_proxy.md
- 历史决策记录在 memory/decisions/
```

（2）主题文件：长期记忆的摘要，索引文件内容的摘要。按需拉进来。

```python
memory/file_proxy.md
memory/user_preferences.md
```

（3）原始记录：保存在一个个文件中的完整的内容。只在搜索时触达，不会完整塞进上下文，而是检索获取关键信息。

```python
完整聊天记录
历史运行日志
测试输出
PR 记录
原始实验报告
原始代码 diff
```

> 这里有一个很重要的设计原则：**Agent 对自己的记忆只能当成提示，不能当成事实。 真要执行动作之前，还是得回到真实状态再核对一次。**

### 4. prompt组装

每一轮里，真正送进模型的内容，都是 harness 当场组装出来的。

这通常是一个分层栈：

```python
1. system prompt
2. tool definitions
3. memory files
4. conversation history
5. current user message
```

OpenAI 的 Codex 还有一套更严格的优先级：服务端 system message 最高，其次是工具定义、developer instructions、级联指令文件，再往后才是会话历史。

### 5. 输出解析与结构化返回（Output Parsing）

现在模型的输出越来越依赖于tool calling，只要有工具调用，模型就会输出结构化的tool_calls，而不是一段自然语言。所以判断是否为最终输出的逻辑就是：看是不是tool_calls，是的话就继续执行循环，不是就是最终输出答案。

### 6. 状态持久化与 Checkpoint（State Persistence）

多步任务需要记忆运行状态、中间结果，所以需要checkpoint。如果没有状态保存，任何中断都会把整个过程打回起点。

不同系统的实现路径不一样：

（1） LangGraph/deepagents 会把 agent 当前状态存在一个结构化 state 里，可以理解成一个字典，每执行完一个关键节点，就保存一次，内容是当前 state + 下一步执行信息。

```python
node A: 调模型
			<-- checkpoint1
node B: 执行工具
			<-- checkpoint2
node C: 更新状态
node D: 再调模型

其中checkpoint一般记录：
某个 thread_id
某一步 step number
某个 node 执行后的 state
下一步要执行哪个 node
metadata
```

（2）OpenAI 提供了应用层 memory、SDK session、服务端 conversation，以及更轻量的 response chaining。一次response可以理解为一个完整的模型交互（指令+模型输出+工具调用+结果返回）

```python
复杂多次交互任务：分析项目、修改代码、测试、提交 GitHub
  ↓
response_1：分析项目结构
response_2：修改代码
response_3：运行测试并修复
response_4：总结结果
```

（3）Claude Code 更偏工程化，直接把 git commit 当 checkpoint，把进度文件当结构化 scratchpad。他不是拆分逻辑运行步骤为 checkpoint，而是在运行过程中选取时刻固定代码，也可以理解为在某个工程状态稳定时，给代码拍快照。所以他不是每个 node / 每个 tool call 都 checkpoint，而是选取有意义的工程时刻固定代码状态。

```python
commit A：完成核心实现
commit B：测试通过
commit C：文档更新
commit D：清理并发布
```

这层设计的价值很直接：任务可以恢复，可以回溯，也能做 time-travel debugging。

### 7. 错误恢复与重试（Error Handling）

多步流程会让错误叠加。一个 10 步流程，如果每一步成功率都是 99%，端到端成功率也只有大约 90.4%。算一下就知道，错误不能只记录日志，得被设计成系统能力，即假设错误一定会发生，并在系统架构里内置发现、隔离、恢复、重试、回滚、人工介入的机制。

实践里，常见的错误类型大概有四类：

```python
1.瞬时错误：重试加退避。（网络超时、限流、临时 5xx等）
2.LLM 可恢复错误：把错误作为 tool message 回传，让模型自己修正。（参数名写错、枚举值不合法、缺少必要参数）
3.用户可修复错误：中断并请求人工输入。（缺少信息/文件/权限，高风险操作需要人工确定）
4.非预期错误：向上抛出，进入调试链路。（可能是系统本身的bug，记录下来）
```


> 比较成熟的 harness，不会让 tool handler 一报错就把整轮循环打断，而是尽量把失败变成模型可理解、可处理的反馈。

### 8. 权限与 Guardrails（Permissions and Safety）

模型负责推理，harness负责控制权限。

信任边界（哪些资源可信、哪些文件敏感、哪些工具能用、哪些操作要确认）

Claude Code 这种系统，会把工具能力切成很多离散权限，再分三层处理：

```python
1. 项目加载时建立信任边界。
2. 每次 tool call 前做权限检查。
3. 对高风险操作触发明确的人类确认。
```

OpenAI 的 SDK 也把 guardrail 分成输入、输出、工具三个层级，并支持 tripwire 直接中止 Agent。

```python
1.Input guardrail：检查用户输入（拦截恶意请求、越权请求、无关任务）
2.Tool guardrail：检查工具调用（校验参数、阻止敏感数据进工具、清洗工具输出）
3. Output guardrail：检查最终输出（防止泄露密钥、文件内容、违规内容）
```

### 9. 验证闭环（Verification Loop）

让模型自我验证输出的结果是否符合要求。模型未必要更聪明，也可以多检查两遍做到更严谨。Claude Code 团队提过一个很实用的判断：只要给模型足够好的验证路径，质量通常能提升 2 到 3 倍。这也是区分生产级agent和玩具demo的一个判断点。Anthropic提出了三类验证手段：

```python
1.规则型反馈：tests、linters、type checkers。跑规则，跑测试。适合用来验证代码语法、类型、单元测试、接口契约、安全规则、文件是否存在、配置是否正确 这种有严格答案的部分。

2.视觉型反馈：规则正确不代表显示正确。例如用 Playwright 截图检查 UI。适合用来验证 UI/视觉/布局/渲染效果，看有没有遮挡，布局是否正常，是否能正常显示等。

3.LLM-as-judge：让另一个模型或子 Agent 来做评审。有一些并没有明确是非标准的任务比如报告撰写的质量可以用这个。适合开放式质量评估。
```

### 10. Sub-agent 与执行模型（Execution Models）

当任务足够复杂时，单个上下文窗口会很快失控，这时候就会用到 sub-agent。

Claude Code 给了三种很有代表性的执行模型：

```python
1. Fork：父上下文的字节级复制，给subagent。
适合：当前上下文很重要、子任务和主任务强相关、需要快速分出去检查一个分支
2. Teammate：更像“另一个同事”。单独终端，用文件或消息和主agent做通信。
适合：独立检查、并行调研、跑测试、代码审查、让另一个 agent 当 reviewer
3. Worktree：独立 git worktree，隔离分支执行。子 agent 可以大胆改代码、跑测试，不会污染主工作区。
适合：多个实现方案并行、大规模重构、风险较高的代码修改、长期子任务
```

OpenAI 也支持把 specialist agent 当工具调用（专家agent负责一个专门的子能力而不是整个任务），或者把控制权 handoff 给另一个 agent（这个任务继续由另一个agent继续执行）。LangGraph 则更像把 sub-agent 建成嵌套状态图。

### 11. 终止条件与生命周期（Termination and Lifecycle）

一个循环什么时候该停，不能只靠模型“自己感觉做完了”。

常见终止条件至少包括：

```python
模型输出里没有 tool call。
最大轮次超限。
token budget 耗尽。
tripwire 触发。（警报线）
用户主动中断。
安全拒答返回。
```


简单问题也许 1 到 2 轮就结束，复杂重构任务可能要跨几十轮，串起大量 tool call。生命周期设计不清楚，系统很快就会出现失控、卡死或无意义循环。

## 整体循环流程

![Notion asset](/img/notion/39daeaf18f61805bb5e7c26f792eaee9.png)

### 七个步骤

1. Prompt Assembly：系统把 system prompt、tool schema、memory、history、用户消息拼成当前轮输入。重要信息优先放在开头和结尾，尽量避开“中间被吃掉”的位置。

1. LLM Inference：请求发给模型，模型返回文本、tool call，或者两者都有。

1. Output Classification：如果只有文本、没有 tool call，循环结束；如果有 tool call，进入执行；如果是 handoff，就切换当前 agent。

1. Tool Execution：校验参数、检查权限、在沙箱里执行，采集结果。只读操作可以并行，改写类操作更适合串行。

1. Result Packaging：把成功结果或错误结果重新包装成模型能读懂的 observation。

1. Context Update：把结果追加到历史；如果快到窗口上限，就触发 compaction。

1. Loop：回到下一轮，继续重复。


### 为什么要把文件系统也纳入 Harness？

有些系统会把整个工作流拆成长期协作角色：初始化 Agent 负责准备环境、落初始进度文件、做第一次提交；后续 Coding Agent 每次开工先读 git log 和 progress file，再把最高优先级的未完成任务接着做。

这样一来，**文件系统就成了跨上下文窗口的连续性载体**。

```python
文件系统 =代码文件 + 用户输入文件 + 工具输出文件 + agent 工作状态 + 日志审计 + 缓存索引 + 临时文件 + git/checkpoint 状态
```

## MCP 与 Claude Agent SDK

MCP：Client 首先与 Server 握手并获取工具清单，Host 把这些清单连同用法注入系统提示词；LLM 根据提示输出结构化调用（通常是 JSON，也可兼容早期 XML 包装）；Client 解析调用并向 Server 发起请求，收到结果后回传 Host，Host 再携带最新上下文进行下一轮模型推理。

![Notion asset](/img/notion/398aeaf18f6180fab0d8e14fe99b6caa.jpg)

MCP Client-server的传输格式是Json.RPC 2.0： 约定消息长什么样、需要有哪些字段

MCP Client-server的传输信息方式是：

### 1. STDIO（本地进程，client和server在一台机器上）

```python
Client  --stdin-->   Server process
Client  <--stdout--  Server process
```

### 2. SSE Transport

远程服务，`Client` 和 `Server` 不通过本地进程管道通信，而是通过 HTTP 连接通信，其中 Server 用一条持续打开的 SSE 连接，把事件/消息持续推送给 Client。为什么要持续打开？：避免client需要轮询反复问sevrer是否有结果，可以让server只要有结果就返回给client

```python
Client  --HTTP request-->  Server
Client  <--SSE stream----- Server
Client  --HTTP POST------> Server
```

claude agent SDK 是开发基于claude大模型的agent的工具包，和Claude Code Cli 的区别是你可以通过编程来自己控制工具、许可、花销限制、输出内容

做出的Agent本质上思路和Claude Code一样：都是 用户prompt→agentic loop（评估prompt→call tool→tool result） → 最终输出

![Notion asset](/img/notion/390aeaf18f6180ce8434d946e9e420fb.png)

## 对比几家主流 Agent 框架

![Notion asset](/img/notion/39daeaf18f6180db9467ea2c58c93493.png)

### 大家都在做相似的 agent 系统（同样的loop），但控制权到底应该放在哪里？

控制权就是 agent 系统中“下一步怎么走”的决策权；不同框架的区别，是把这个决策权主要交给模型、代码、图、角色任务，还是 agent 之间的对话协议。

可以这样理解：

| 框架 | 控制权主要放在哪里 | 主要控制什么 | 可以理解为 |
| --- | --- | --- | --- |
| Claude Agent  | 模型自己 | 灵活规划 | agent自己执行并自主决定下一步怎么做 |
| OpenAI Agents  | Runner / 代码定义 | 能力边界和执行规则 | LLM负责提议动作，runner负责实际执行并维护循环规则 |
| LangGraph | 状态图 | 流程路径 | 像是提前写好一整套城市地铁网络，定义好每一个节点和边，但最终走哪一条线路由LLM决定。是一种强制控制，模型不能忽略。 |
| CrewAI | 角色和任务结构 | 分工和任务顺序 | 更像项目排期，`task-first，先有任务清单和分工，再按任务调度 agent。`分为很多子agent，每个都有自己的角色+任务列表，不是每一步都由agent决定谁来做，而是提前就在系统里规定好了谁负责做。CrewAI 是“先排任务，再让对应角色执行” |
| AutoGen | agent 间对话协议 | 多 agent 协作节奏 | 更像多人会议，message-first，先有对话流，再根据 agent 消息决定下一位 agent。AutoGen 是“让多个 agent 对话，根据消息和 manager 决策决定谁接着说”。 |

### Anthropic

薄 Harness，智能尽量留给模型

Anthropic 的 Claude Agent SDK 给我的感觉一直很克制，核心入口就是一个 query()，底层启动 agentic loop，然后用 async iterator 持续流出消息。

它的路子很清楚：runtime 保持薄，智能尽量留在模型里。Claude Code 的工作节奏也很统一，就是 Gather、Act、Verify 三步反复循环。

OpenAI Agents SDK 更像是在开发者用代码定义好的能力边界、handoff 关系、guardrail 和输出结构之内，让 LLM 做决策；Claude Agent SDK / Claude Code 更像是在提供工具环境、权限检查和安全边界后，尽量减少流程上的硬约束，让模型自主规划和推进任务。


### OpenAI Agents SDK

更像是在给工程师一套顺手的工作流工具，核心是 Runner，支持 async、sync、streamed 三种模式。

它强调的是“工作流逻辑直接写在 Python 里”，不用先被迫进入图 DSL。

Codex 在这个基础上又做了架构的三层拆分：

1. Codex Core：agent code 和 runtime。就是harness/runtime。也即agent的真实能力（调用模型、调用工具、管理上下文、执行命令、读写文件等）

2. App Server：双向 JSON-RPC API。负责传递client和core之间的信息，可以理解为一个开放接口的信息管道。

3. Client Surfaces：用户操作界面（CLI、VS Code、Web）。因为 CLI、VS Code 和 Web 共用同一套 Codex Core/harness，所以即便是网页版入口，也不是普通聊天窗口，而是接入了同一套 agent runtime，能执行工具、管理状态、检查权限并完成真实任务。

```plain text
agent = Agent(
    name="Image Agent",
    instructions="你是图片处理助手",
    tools=[convert_image, resize_image],
    guardrails=[...],
    handoffs=[...],
)

result = await Runner.run(agent, input="把图片转成 jpeg")
```

控制权体现在代码结构里：

```plain text
Agent 对象
Runner
Tool 定义
Guardrail 定义
Handoff 定义
Output schema
Session
```

也就是说，开发者通过代码明确声明：

```plain text
这个 agent 有哪些工具
哪些 guardrail
能 handoff 给谁
输出格式是什么
Runner 怎么跑
```

### LangGraph

```plain text
graph.add_node("model", call_model)
graph.add_node("tools", call_tools)
graph.add_edge("model", "tools")
graph.add_conditional_edges(...)
```

规划好的任务地图。它是 graph-first。

### CrewAI

```plain text
researcher = Agent(role="Researcher")
writer = Agent(role="Writer")
task1 = Task(description="调研", agent=researcher)
task2 = Task(description="写报告", agent=writer)
crew = Crew(agents=[researcher, writer], tasks=[task1, task2])
```

核心是 role/task，先分task，再找agent。它是 role/task-first。

### AutoGen

```plain text
user_proxy.initiate_chat(coder, message="实现这个功能")
```

核心是 agent 之间对话的消息。它是 conversation-first。

## 如果把任务看作盖大楼

![Notion asset](/img/notion/39eaeaf18f6180f1b757d6545c763436.png)

Agent就是一个包括脚手架、工人、砖头和各种材料的大型施工行为。

其中：

- LLM是负责思考怎么盖的包工头和工人，你可以选择用不同能力的工人，聪明的工人干活快但是工资高，便宜的工人干活慢而且容易出错。
- Tools是工人要用的砖头、水泥等工具
- Harness就是脚手架，帮助工人爬高，按层（对话轮数）增加高度（记忆、上下文）；保证安全界限（楼下的安全网），你可以选择不同的脚手架（Claude、openai、langGraph、DeepAgents等），你的工人本事越大脚手架就可以简单一点，但如果你的工人已经习惯了某套脚手架体系，如果你突然换一种，可能会导致模型效果变差。如果完全没有脚手架，LLM只能告诉你要怎么做，没有真正动手的能力。
- Loop就是一层一层往上盖的过程，每一层可能用到不同的材料（tools），要盖几层/什么时候结束由工人（LLM）决定。

## 构建 Harness 的 7 个选择

![Notion asset](/img/notion/39eaeaf18f6180128684c5b572e3d07d.png)

### 1. 单 Agent 还是 Multi-Agent

Anthropic 和 OpenAI 的建议都很一致：先把单 Agent 做到极限。

Multi-Agent 会带来额外路由开销、更多 LLM 调用，以及 handoff 过程中的上下文损失。通常要等到工具数已经多到互相干扰，或者任务域确实天然分离时，拆开才更划算。

### 2. ReAct 还是 Plan-and-Execute

ReAct 的优点是灵活，每一步都能边想边做；代价是每一步都要付推理成本。

Plan-and-Execute 把规划和执行拆开，路径更稳定，吞吐也可能更高。有研究报告过，相比顺序 ReAct，这条路线能拿到 3.6 倍的速度提升。

### 3. 上下文窗口怎么管

常见做法包括定时清空、会话摘要、observation masking、结构化笔记、sub-agent delegation。这里没有万能方案。得先想清楚当前任务更怕什么，是 token 成本太高，还是关键信息在压缩过程中丢掉。

### 4. 验证闭环怎么搭

计算型验证，比如 tests、linters，优点是确定性强；

推断型验证，比如 LLM-as-judge，优点是能发现语义层问题，但会带来延迟和额外成本。

实际落地时，通常还是两种一起上。先用 tests、linters 兜住确定性问题，再让 LLM-as-judge 去补语义层检查。

### 5. 权限要放宽还是收紧

宽松权限跑得快，但风险高。严格权限更安全，但人类确认会拖慢节奏。

这不是体验偏好的问题，跟部署场景直接相关。开发沙箱、个人环境、生产系统，默认策略本来就应该完全不同。

### 6. 工具要暴露多少

工具不是越多越好。工具一多，模型选择成本会升高，误用概率也会上来。

更稳的做法是按步骤懒加载，或者在当前阶段只暴露最小必要工具集。说白了，只给当下任务真正需要的那几把刀。

### 7. Harness 应该多厚

说到底，这是一个很现实的架构取舍：到底把多少控制逻辑写死在 harness 里，多少交给模型自己消化。

Anthropic 更偏薄 harness，赌模型会越来越会做规划和控制。

图式框架则更偏显式控制，把很多行为写死在图上。

两边没有绝对对错，但趋势已经很明显：随着模型能力增强，很多以前要写在 harness 里的 planning 逻辑，会慢慢被删掉。
