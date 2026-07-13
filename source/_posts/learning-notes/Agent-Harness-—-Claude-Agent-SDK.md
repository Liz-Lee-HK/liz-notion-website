---
title: "Agent Harness — Claude Agent SDK"
date: "2026-07-01T01:50:00.000Z"
updated: "2026-07-13T06:11:00.000Z"
categories: ["学习笔记"]
tags: ["Notion", "学习笔记", "Agent", "Claude Agent SDK"]
layout: "post"
notion_sync: true
notion_mapping: "agent-harness-claude-agent-sdk"
notion_id: "390aeaf1-8f61-80e6-8c31-da4a4597ee56"
---

LLM：大语言模型，基于对话的计算模型，agent的大脑。

Harness：给予agent实际执行能力的一套设计机制，拓展agent的能力，确定他的边界，加上一些校验和审核，保证agent稳定运行减少出错保证安全输出我们想要的结果。大语言模型的操作系统

DeepAgents 和OpenAI Agents SDK以及Claude Agents SDK已经是成品的agent harness也就是操作系统了，只是说可以自定义修改一些配置，所以被理解为开发工具，但其实他们并不是让你自由开发的零散组件。

Agent：包括LLM、Skills、agent主程序、工具函数的一整套智能实体，本质上是以LLM为大脑，工具为手脚的智能体。

Agent = LLM大脑 + Harness运行调度层 + 工具/技能集 + 记忆与上下文管理

经典的AI就是网页或软件聊天那种，能生成一定的东西，但难以执行任务。Agent就是能做到执行层面，但易出错，准确性不足。Harness就是专门研究如何控制Agent的能力与边界的工程，提到任务执行的质量。

Agent Loop：agent执行任务的核心模块/逻辑，本质是 思考→调用外部工具 / 环境→接收结果→再思考」的循环。有几种不同的实现办法，ReAct和Plan-and-Execute

ReAct：全称叫Reasoning & Acting, 即思考→执行→看看结果，迭代循环。是绝大多数 Agent 框架（LangChain、OpenAI Agents SDK、Claude Agent）底层默认的循环逻辑。

Plan-and-Execute：先计划完整流程，再分步执行。

记忆与上下文管理：大模型本身没有记忆，每次对话都要带上之前的上下文，但上下文太长而上下文窗口有限的时候就要进行上下文管理，上下文中会有（系统提示词、用户指令、工具返回结果、AI思考过程等信息），对话轮数多了就需要压缩上下文，通过压缩历史内容或丢掉一部分。

压缩历史上下文：当快达到上下文窗口极限时，压缩之前的内容为摘要。缺点是会丢失信息，agent反复犯错也是因为这个。

多agent协作：主agent负责分任务，子agent负责一部分的工作，只用返回结果。上下文被分散到每一个子agent中，避免上下文爆炸。

MCP：Client 首先与 Server 握手并获取工具清单，Host 把这些清单连同用法注入系统提示词；LLM 根据提示输出结构化调用（通常是 JSON，也可兼容早期 XML 包装）；Client 解析调用并向 Server 发起请求，收到结果后回传 Host，Host 再携带最新上下文进行下一轮模型推理。

![Notion asset](/img/notion/398aeaf18f6180fab0d8e14fe99b6caa.jpg)

MCP Client-server的传输格式是Json.RPC 2.0： 约定消息长什么样、需要有哪些字段

MCP Client-server的传输信息方式是：
  1️⃣STDIO（本地进程，client和server在一台机器上）

  ```python
  Client  --stdin-->   Server process
  Client  <--stdout--  Server process
  ```

  2️⃣SSE Transport（远程服务，`Client` 和 `Server` 不通过本地进程管道通信，而是通过 HTTP 连接通信，其中 Server 用一条持续打开的 SSE 连接，把事件/消息持续推送给 Client。为什么要持续打开？：避免client需要轮询反复问sevrer是否有结果，可以让server只要有结果就返回给client）

  ```python
  Client  --HTTP request-->  Server
  Client  <--SSE stream----- Server
  Client  --HTTP POST------> Server
  ```

claude agent SDK 是开发基于claude大模型的agent的工具包，和Claude Code Cli 的区别是你可以通过编程来自己控制工具、许可、花销限制、输出内容

做出的Agent本质上思路和Claude Code一样：都是 用户prompt→agentic loop（评估prompt→call tool→tool result） → 最终输出

![Notion asset](/img/notion/390aeaf18f6180ce8434d946e9e420fb.png)
