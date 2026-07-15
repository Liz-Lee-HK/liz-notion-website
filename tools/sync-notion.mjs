import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOTION_VERSION = '2022-06-28'
const TOKEN = process.env.NOTION_TOKEN
const execFileAsync = promisify(execFile)

async function main() {
  const config = await loadConfig()
  const mappings = Array.isArray(config.mappings) ? config.mappings : []

  if (!mappings.length) {
    console.log('[notion-sync] No mappings configured. Skipping Notion sync.')
    return
  }

  if (!TOKEN) {
    throw new Error('NOTION_TOKEN is required when notion-sync.config.cjs has mappings.')
  }

  for (const mapping of mappings) {
    validateMapping(mapping)
    const pages = await fetchMappedPages(mapping)
    const targetDir = resolveInsideRoot(mapping.target.dir)

    await fs.mkdir(targetDir, { recursive: true })

    if (config.clean !== false && mapping.clean !== false) {
      await cleanGeneratedFiles(targetDir, mapping.name)
    }

    for (const page of pages) {
      const markdown = await pageToMarkdown(page, mapping, config)
      const slug = getSlug(page, mapping)
      const filePath = path.join(targetDir, `${slug}.md`)
      await fs.writeFile(filePath, markdown, 'utf8')
      console.log(`[notion-sync] Wrote ${path.relative(ROOT, filePath)}`)
    }
  }
}

async function loadConfig() {
  if (process.env.NOTION_SYNC_CONFIG) {
    return JSON.parse(process.env.NOTION_SYNC_CONFIG)
  }

  const localPath = path.join(ROOT, 'notion-sync.config.local.cjs')
  if (await exists(localPath)) {
    return importCjs(localPath)
  }

  const defaultPath = path.join(ROOT, 'notion-sync.config.cjs')
  if (await exists(defaultPath)) {
    return importCjs(defaultPath)
  }

  return { mappings: [] }
}

async function importCjs(filePath) {
  const imported = await import(pathToFileURL(filePath).href)
  return imported.default || imported
}

function validateMapping(mapping) {
  if (!mapping?.name) throw new Error('Every mapping needs a name.')
  if (!mapping?.source?.id) throw new Error(`Mapping "${mapping.name}" needs source.id.`)
  if (!['page', 'database'].includes(mapping.source.type)) {
    throw new Error(`Mapping "${mapping.name}" source.type must be "page" or "database".`)
  }
  if (!mapping?.target?.dir) throw new Error(`Mapping "${mapping.name}" needs target.dir.`)
}

async function fetchMappedPages(mapping) {
  if (mapping.source.type === 'page') {
    return [await notion(`/pages/${mapping.source.id}`)]
  }

  const pages = []
  let cursor
  do {
    const body = {
      page_size: 100,
      start_cursor: cursor,
      filter: mapping.filter,
      sorts: mapping.sorts
    }
    const response = await notion(`/databases/${mapping.source.id}/query`, {
      method: 'POST',
      body: compactJson(body)
    })
    pages.push(...response.results)
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  return pages
}

async function pageToMarkdown(page, mapping, config) {
  const blocks = await fetchBlocks(page.id)
  const body = await blocksToMarkdown(blocks, 0, config)
  const frontMatter = buildFrontMatter(page, mapping, config)
  const markdown = `---\n${frontMatter}---\n\n${body.trim()}\n`

  return postprocessMarkdown(markdown, mapping)
}

function postprocessMarkdown(markdown, mapping) {
  if (mapping.postprocess !== 'agent-harness-layout') return markdown
  return formatAgentHarnessLayout(markdown)
}

function formatAgentHarnessLayout(markdown) {
  const replacements = [
    [
      `![Notion asset](/img/notion/39daeaf18f618080a4b8ffe8f9b64dc3.png)\n\nLLM：大语言模型，基于对话的计算模型，agent的大脑。\n\nHarness：给予agent实际执行能力的一套设计机制，拓展agent的能力，确定他的边界，加上一些校验和审核，保证agent稳定运行减少出错保证安全输出我们想要的结果。大语言模型的操作系统\n\n“If you’re not the model, you’re the harness.”\n\nDeepAgents 和OpenAI Agents SDK以及Claude Agents SDK已经是成品的agent harness也就是操作系统了，只是说可以自定义修改一些配置，所以被理解为开发工具，但其实他们并不是让你自由开发的零散组件。`,
      `![Notion asset](/img/notion/39daeaf18f618080a4b8ffe8f9b64dc3.png)\n\n## 核心概念\n\n> “If you’re not the model, you’re the harness.”\n\n- LLM：大语言模型，基于对话的计算模型，agent的大脑。\n- Harness：给予agent实际执行能力的一套设计机制，拓展agent的能力，确定他的边界，加上一些校验和审核，保证agent稳定运行减少出错保证安全输出我们想要的结果。大语言模型的操作系统\n- Agent：包括LLM、Skills、agent主程序、工具函数的一整套智能实体，本质上是以LLM为大脑，工具为手脚的智能体。\n\nDeepAgents 和OpenAI Agents SDK以及Claude Agents SDK已经是成品的agent harness也就是操作系统了，只是说可以自定义修改一些配置，所以被理解为开发工具，但其实他们并不是让你自由开发的零散组件。`
    ],
    [
      `自己开发 harness 则是你自己决定所有边界。相当于自己开发一个操作系统。\n\nAgent：包括LLM、Skills、agent主程序、工具函数的一整套智能实体，本质上是以LLM为大脑，工具为手脚的智能体。\n\nAgent = LLM大脑 + Harness运行调度层 + 工具/技能集 + 记忆与上下文管理`,
      `自己开发 harness 则是你自己决定所有边界。相当于自己开发一个操作系统。\n\n> Agent = LLM大脑 + Harness运行调度层 + 工具/技能集 + 记忆与上下文管理`
    ],
    [`生产级harness的组件：`, `## 生产级 Harness 的组件`],
    [
      `1.Agent Loop：agent执行任务的核心模块/逻辑，本质是 思考→调用外部工具 / 环境→接收结果→再思考」的循环。有几种不同的实现办法，ReAct和Plan-and-Execute\n\nReAct：全称叫Reasoning & Acting, 即思考→执行→看看结果（组装prompt、调用模型、解析输出、执行tool call、把结果塞进上下文、继续下一轮），迭代循环。是绝大多数 Agent 框架（LangChain、OpenAI Agents SDK、Claude Agent）底层默认的循环逻辑。\n\nPlan-and-Execute：先计划完整流程，再分步执行。`,
      `### 1. Agent Loop\n\nagent执行任务的核心模块/逻辑，本质是 思考→调用外部工具 / 环境→接收结果→再思考」的循环。有几种不同的实现办法，ReAct和Plan-and-Execute\n\n- ReAct：全称叫Reasoning & Acting, 即思考→执行→看看结果（组装prompt、调用模型、解析输出、执行tool call、把结果塞进上下文、继续下一轮），迭代循环。是绝大多数 Agent 框架（LangChain、OpenAI Agents SDK、Claude Agent）底层默认的循环逻辑。\n- Plan-and-Execute：先计划完整流程，再分步执行。`
    ],
    [
      `2.上下文管理：大模型本身没有记忆，每次对话都要带上之前的上下文，但上下文太长而上下文窗口有限的时候就要进行上下文管理，上下文中会有（系统提示词、用户指令、工具返回结果、AI思考过程等信息），对话轮数多了就需要压缩上下文，通过压缩历史内容或丢掉一部分。\n\n压缩历史上下文：当快达到上下文窗口极限时，压缩之前的内容为摘要。缺点是会丢失信息，agent反复犯错也是因为这个。\n\nobservation masking：mask掉旧的tool output，只保留关键信息\n\n即时检索：靠轻量索引和局部读取，避免传入一整份大文件\n\n多agent协作：主agent负责分任务，子agent负责一部分的工作，只用返回结果。上下文被分散到每一个子agent中，避免上下文爆炸。`,
      `### 2. 上下文管理\n\n大模型本身没有记忆，每次对话都要带上之前的上下文，但上下文太长而上下文窗口有限的时候就要进行上下文管理，上下文中会有（系统提示词、用户指令、工具返回结果、AI思考过程等信息），对话轮数多了就需要压缩上下文，通过压缩历史内容或丢掉一部分。\n\n- 压缩历史上下文：当快达到上下文窗口极限时，压缩之前的内容为摘要。缺点是会丢失信息，agent反复犯错也是因为这个。\n- observation masking：mask掉旧的tool output，只保留关键信息\n- 即时检索：靠轻量索引和局部读取，避免传入一整份大文件\n- 多agent协作：主agent负责分任务，子agent负责一部分的工作，只用返回结果。上下文被分散到每一个子agent中，避免上下文爆炸。`
    ],
    [`3.记忆系统：分为短期记忆（当前回话历史）+长期记忆（跨对话保留。在项目文件，数据库session，本地持久层，结构化store中）`, `### 3. 记忆系统\n\n分为短期记忆（当前回话历史）+长期记忆（跨对话保留。在项目文件，数据库session，本地持久层，结构化store中）`],
    [`长期记忆加载方式（codex的设计）：`, `#### 长期记忆加载方式（codex的设计）`],
    [`这里有一个很重要的设计原则：**Agent 对自己的记忆只能当成提示，不能当成事实。 真要执行动作之前，还是得回到真实状态再核对一次。**`, `> 这里有一个很重要的设计原则：**Agent 对自己的记忆只能当成提示，不能当成事实。 真要执行动作之前，还是得回到真实状态再核对一次。**`],
    [`4.prompt组装`, `### 4. prompt组装`],
    [`5.输出解析与结构化返回（Output Parsing）`, `### 5. 输出解析与结构化返回（Output Parsing）`],
    [`6. 状态持久化与 Checkpoint（State Persistence）`, `### 6. 状态持久化与 Checkpoint（State Persistence）`],
    [`7.**错误恢复与重试（Error Handling）**`, `### 7. 错误恢复与重试（Error Handling）`],
    [`比较成熟的 harness，不会让 tool handler 一报错就把整轮循环打断，而是尽量把失败变成模型可理解、可处理的反馈。`, `> 比较成熟的 harness，不会让 tool handler 一报错就把整轮循环打断，而是尽量把失败变成模型可理解、可处理的反馈。`],
    [`8.**权限与 Guardrails（Permissions and Safety）**`, `### 8. 权限与 Guardrails（Permissions and Safety）`],
    [`9.**验证闭环（Verification Loop）**`, `### 9. 验证闭环（Verification Loop）`],
    [`10.**Sub-agent 与执行模型（Execution Models）**`, `### 10. Sub-agent 与执行模型（Execution Models）`],
    [`11.**终止条件与生命周期（Termination and Lifecycle）**`, `### 11. 终止条件与生命周期（Termination and Lifecycle）`],
    [`整体的循环流程`, `## 整体循环流程`],
    [`七个步骤：`, `### 七个步骤`],
    [`**为什么要把文件系统也纳入 Harness？**`, `### 为什么要把文件系统也纳入 Harness？`],
    [`MCP：Client 首先与 Server 握手并获取工具清单`, `## MCP 与 Claude Agent SDK\n\nMCP：Client 首先与 Server 握手并获取工具清单`],
    [
      `MCP Client-server的传输信息方式是：\n  1️⃣STDIO（本地进程，client和server在一台机器上）\n\n  \`\`\`python\n  Client  --stdin-->   Server process\n  Client  <--stdout--  Server process\n  \`\`\`\n\n  2️⃣SSE Transport（远程服务，\`Client\` 和 \`Server\` 不通过本地进程管道通信，而是通过 HTTP 连接通信，其中 Server 用一条持续打开的 SSE 连接，把事件/消息持续推送给 Client。为什么要持续打开？：避免client需要轮询反复问sevrer是否有结果，可以让server只要有结果就返回给client）\n\n  \`\`\`python\n  Client  --HTTP request-->  Server\n  Client  <--SSE stream----- Server\n  Client  --HTTP POST------> Server\n  \`\`\``,
      `MCP Client-server的传输信息方式是：\n\n### 1. STDIO（本地进程，client和server在一台机器上）\n\n\`\`\`python\nClient  --stdin-->   Server process\nClient  <--stdout--  Server process\n\`\`\`\n\n### 2. SSE Transport\n\n远程服务，\`Client\` 和 \`Server\` 不通过本地进程管道通信，而是通过 HTTP 连接通信，其中 Server 用一条持续打开的 SSE 连接，把事件/消息持续推送给 Client。为什么要持续打开？：避免client需要轮询反复问sevrer是否有结果，可以让server只要有结果就返回给client\n\n\`\`\`python\nClient  --HTTP request-->  Server\nClient  <--SSE stream----- Server\nClient  --HTTP POST------> Server\n\`\`\``
    ],
    [`**对比几家主流Agent框架**`, `## 对比几家主流 Agent 框架`],
    [`**大家都在做相似的 agent 系统（同样的loop），但控制权到底应该放在哪里？**`, `### 大家都在做相似的 agent 系统（同样的loop），但控制权到底应该放在哪里？`],
    [`| 框架 | 控制权主要放在哪里 | 主要控制什么 | 可以理解为 |\n\n| Claude Agent`, `| 框架 | 控制权主要放在哪里 | 主要控制什么 | 可以理解为 |\n| --- | --- | --- | --- |\n| Claude Agent`],
    [`**Anthropic：**`, `### Anthropic`],
    [`**OpenAI Agents SDK：**`, `### OpenAI Agents SDK`],
    [`**LangGraph** 规划好的任务地图`, `### LangGraph`],
    [`它是 graph-first。`, `规划好的任务地图。它是 graph-first。`],
    [`**CrewAI** 核心是 role/task，先分task，再找agent：`, `### CrewAI`],
    [`它是 role/task-first。`, `核心是 role/task，先分task，再找agent。它是 role/task-first。`],
    [`**AutoGen** 的核心是 agent 之间对话的消息：`, `### AutoGen`],
    [`它是 conversation-first。`, `核心是 agent 之间对话的消息。它是 conversation-first。`],
    [`**如果把任务看作盖大楼**`, `## 如果把任务看作盖大楼`],
    [`Agent就是一个包括脚手架、工人、砖头和各种材料的大型施工行为`, `Agent就是一个包括脚手架、工人、砖头和各种材料的大型施工行为。`],
    [`LLM是负责思考怎么盖的包工头和工人，你可以选择用不同能力的工人，聪明的工人干活快但是工资高，便宜的工人干活慢而且容易出错。\n\nTools是工人要用的砖头、水泥等工具\n\nHarness就是脚手架，帮助工人爬高，按层（对话轮数）增加高度（记忆、上下文）；保证安全界限（楼下的安全网），你可以选择不同的脚手架（Claude、openai、langGraph、DeepAgents等），你的工人本事越大脚手架就可以简单一点，但如果你的工人已经习惯了某套脚手架体系，如果你突然换一种，可能会导致模型效果变差。如果完全没有脚手架，LLM只能告诉你要怎么做，没有真正动手的能力。\n\nLoop就是一层一层往上盖的过程，每一层可能用到不同的材料（tools），要盖几层/什么时候结束由工人（LLM）决定。`, `- LLM是负责思考怎么盖的包工头和工人，你可以选择用不同能力的工人，聪明的工人干活快但是工资高，便宜的工人干活慢而且容易出错。\n- Tools是工人要用的砖头、水泥等工具\n- Harness就是脚手架，帮助工人爬高，按层（对话轮数）增加高度（记忆、上下文）；保证安全界限（楼下的安全网），你可以选择不同的脚手架（Claude、openai、langGraph、DeepAgents等），你的工人本事越大脚手架就可以简单一点，但如果你的工人已经习惯了某套脚手架体系，如果你突然换一种，可能会导致模型效果变差。如果完全没有脚手架，LLM只能告诉你要怎么做，没有真正动手的能力。\n- Loop就是一层一层往上盖的过程，每一层可能用到不同的材料（tools），要盖几层/什么时候结束由工人（LLM）决定。`],
    [`构建Harness的7个选择：`, `## 构建 Harness 的 7 个选择`],
    [`1.单 Agent 还是 Multi-Agent`, `### 1. 单 Agent 还是 Multi-Agent`],
    [`2. ReAct 还是 Plan-and-Execute`, `### 2. ReAct 还是 Plan-and-Execute`],
    [`3. 上下文窗口怎么管`, `### 3. 上下文窗口怎么管`],
    [`4. 验证闭环怎么搭`, `### 4. 验证闭环怎么搭`],
    [`5. 权限要放宽还是收紧`, `### 5. 权限要放宽还是收紧`],
    [`6. 工具要暴露多少`, `### 6. 工具要暴露多少`],
    [`7. Harness 应该多厚`, `### 7. Harness 应该多厚`]
  ]

  let formatted = markdown
  for (const [from, to] of replacements) {
    formatted = formatted.replace(from, to)
  }

  return formatted
    .replace(/\n\| (Claude Agent|OpenAI Agents|LangGraph|CrewAI|AutoGen)/g, '\n| $1')
    .replace(/(### Anthropic\n\n薄 Harness，智能尽量留给模型)\n(Anthropic)/, '$1\n\n$2')
}

async function fetchBlocks(blockId) {
  const blocks = []
  let cursor
  do {
    const query = new URLSearchParams({ page_size: '100' })
    if (cursor) query.set('start_cursor', cursor)
    const response = await notion(`/blocks/${blockId}/children?${query}`)
    blocks.push(...response.results)
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  for (const block of blocks) {
    if (block.has_children) {
      block.children = await fetchBlocks(block.id)
    }
  }

  return blocks
}

async function blocksToMarkdown(blocks, depth, config) {
  const lines = []

  for (const block of blocks) {
    const rendered = await blockToMarkdown(block, depth, config)
    if (rendered) lines.push(rendered)
  }

  return lines.join('\n\n')
}

async function blockToMarkdown(block, depth, config) {
  const type = block.type
  const data = block[type]
  const children = block.children?.length
    ? await blocksToMarkdown(block.children, depth + 1, config)
    : ''
  const indentedChildren = children ? indentMarkdown(children, depth + 1) : ''

  switch (type) {
    case 'paragraph':
      return withChildren(richText(data.rich_text), indentedChildren)
    case 'heading_1':
      return `# ${richText(data.rich_text)}`
    case 'heading_2':
      return `## ${richText(data.rich_text)}`
    case 'heading_3':
      return `### ${richText(data.rich_text)}`
    case 'bulleted_list_item':
      return withChildren(`${indent(depth)}- ${richText(data.rich_text)}`, indentedChildren)
    case 'numbered_list_item':
      return withChildren(`${indent(depth)}1. ${richText(data.rich_text)}`, indentedChildren)
    case 'to_do':
      return withChildren(`${indent(depth)}- [${data.checked ? 'x' : ' '}] ${richText(data.rich_text)}`, indentedChildren)
    case 'quote':
      return quoteBlock(withChildren(richText(data.rich_text), children))
    case 'callout':
      return quoteBlock(withChildren(`${iconText(data.icon)}${richText(data.rich_text)}`, children))
    case 'code':
      return `\`\`\`${data.language || ''}\n${data.rich_text?.map((part) => part.plain_text).join('') || ''}\n\`\`\``
    case 'equation':
      return `$$\n${data.expression}\n$$`
    case 'divider':
      return '---'
    case 'image':
      return renderAsset(block, data, config, true)
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio':
      return renderAsset(block, data, config, false)
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      return data.url ? `[${data.caption?.length ? richText(data.caption) : data.url}](${data.url})` : ''
    case 'child_page':
      return withChildren(`## ${data.title}`, children)
    case 'toggle':
      return `<details>\n<summary>${richText(data.rich_text)}</summary>\n\n${children}\n\n</details>`
    case 'column_list':
    case 'column':
    case 'synced_block':
      return children
    case 'table':
      return children
    case 'table_row':
      return `| ${data.cells.map((cell) => richText(cell)).join(' | ')} |`
    default:
      return children || `<!-- Unsupported Notion block: ${type} -->`
  }
}

function buildFrontMatter(page, mapping, config) {
  const title = getTitle(page, mapping)
  const date = getDateValue(page, mapping) || page.created_time
  const updated = page.last_edited_time
  const category = getPropertyValue(page, mapping.properties?.category) || mapping.target.category
  const tags = unique([
    ...toArray(config.defaults?.tags),
    ...toArray(mapping.target.tags),
    ...toArray(getPropertyValue(page, mapping.properties?.tags))
  ])
  const summary = getPropertyValue(page, mapping.properties?.summary)
  const cover = getCoverUrl(page)
  const layout = mapping.target.layout || config.defaults?.layout || 'post'

  return yaml({
    title,
    date,
    updated,
    categories: category ? [category] : [],
    tags,
    excerpt: summary || undefined,
    cover: cover || undefined,
    layout,
    notion_sync: true,
    notion_mapping: mapping.name,
    notion_id: page.id
  })
}

function getTitle(page, mapping) {
  const configured = getPropertyValue(page, mapping.properties?.title)
  if (configured) return configured

  for (const property of Object.values(page.properties || {})) {
    if (property.type === 'title') return richText(property.title)
  }

  return page.id
}

function getSlug(page, mapping) {
  const configured = getPropertyValue(page, mapping.properties?.slug)
  const raw = configured || getTitle(page, mapping)
  return slugify(raw || page.id)
}

function getDateValue(page, mapping) {
  const configured = getPropertyValue(page, mapping.properties?.date)
  if (configured) return configured

  for (const property of Object.values(page.properties || {})) {
    if (property.type === 'date' && property.date?.start) return property.date.start
  }

  return undefined
}

function getPropertyValue(page, name) {
  if (!name) return undefined
  const property = page.properties?.[name]
  if (!property) return undefined

  switch (property.type) {
    case 'title':
      return richText(property.title)
    case 'rich_text':
      return richText(property.rich_text)
    case 'select':
      return property.select?.name
    case 'status':
      return property.status?.name
    case 'multi_select':
      return property.multi_select?.map((item) => item.name)
    case 'date':
      return property.date?.start
    case 'url':
      return property.url
    case 'email':
      return property.email
    case 'phone_number':
      return property.phone_number
    case 'number':
      return property.number
    case 'checkbox':
      return property.checkbox
    default:
      return undefined
  }
}

function richText(parts = []) {
  return parts.map((part) => formatRichText(part)).join('')
}

function formatRichText(part) {
  let text = part.plain_text || ''
  if (!text) return ''

  if (part.href) text = `[${text}](${part.href})`
  if (part.annotations?.code) text = `\`${text}\``
  if (part.annotations?.bold) text = `**${text}**`
  if (part.annotations?.italic) text = `_${text}_`
  if (part.annotations?.strikethrough) text = `~~${text}~~`

  return text
}

async function renderAsset(block, data, config, isImage) {
  const url = data.type === 'external' ? data.external?.url : data.file?.url
  if (!url) return ''

  const caption = data.caption?.length ? richText(data.caption) : 'Notion asset'
  const finalUrl = await maybeDownloadAsset(block, url, config)
  return isImage ? `![${caption}](${finalUrl})` : `[${caption}](${finalUrl})`
}

async function maybeDownloadAsset(block, url, config) {
  if (config.assets?.download === false) return url

  const assetDir = resolveInsideRoot(config.assets?.dir || 'source/img/notion')
  const publicBase = config.assets?.publicBase || '/img/notion'
  const ext = extensionFromUrl(url) || '.bin'
  const filename = `${block.id.replaceAll('-', '')}${ext}`
  const filePath = path.join(assetDir, filename)

  try {
    await fs.mkdir(assetDir, { recursive: true })
    await fs.access(filePath)
    return `${publicBase}/${filename}`
  } catch {}

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(filePath, buffer)
    return `${publicBase}/${filename}`
  } catch (error) {
    console.warn(`[notion-sync] Asset download failed, using remote URL: ${error.message}`)
    return url
  }
}

async function cleanGeneratedFiles(targetDir, mappingName) {
  const entries = await fs.readdir(targetDir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const filePath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await cleanGeneratedFiles(filePath, mappingName)
      continue
    }

    if (!entry.isFile() || !entry.name.endsWith('.md')) continue

    const content = await fs.readFile(filePath, 'utf8')
    if (
      content.includes('notion_sync: true') &&
      content.includes(`notion_mapping: ${yamlValue(mappingName)}`)
    ) {
      await fs.unlink(filePath)
    }
  }
}

async function notion(endpoint, options = {}) {
  const url = `https://api.notion.com/v1${endpoint}`
  const request = {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }

  let response
  try {
    response = await fetch(url, request)
  } catch (error) {
    console.warn(
      `[notion-sync] Node fetch failed for ${endpoint}: ${formatFetchError(error)}`
    )
    return notionWithCurl(url, request)
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Notion API ${response.status} for ${endpoint}: ${message}`)
  }

  return response.json()
}

async function notionWithCurl(url, request) {
  const args = [
    '-sS',
    '--fail-with-body',
    '-X',
    request.method || 'GET',
    '-H',
    `Authorization: Bearer ${TOKEN}`,
    '-H',
    `Notion-Version: ${NOTION_VERSION}`,
    '-H',
    'Content-Type: application/json',
    url
  ]

  if (request.body) {
    args.splice(args.length - 1, 0, '--data', request.body)
  }

  try {
    const { stdout } = await execFileAsync('curl', args, {
      maxBuffer: 20 * 1024 * 1024
    })
    return JSON.parse(stdout)
  } catch (error) {
    const details = error.stderr || error.stdout || error.message
    throw new Error(`Notion API curl fallback failed: ${details}`)
  }
}

function formatFetchError(error) {
  const cause = error.cause
  if (!cause) return error.message
  return [error.message, cause.code, cause.message].filter(Boolean).join(' / ')
}

function compactJson(value) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
  )
}

function yaml(data) {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join('\n') + '\n'
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(', ')}]`
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

function resolveInsideRoot(relativePath) {
  const resolved = path.resolve(ROOT, relativePath)
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return resolved
}

function indent(depth) {
  return '  '.repeat(depth)
}

function indentMarkdown(markdown, depth) {
  const prefix = indent(depth)
  return markdown.split('\n').map((line) => line ? `${prefix}${line}` : line).join('\n')
}

function quoteBlock(markdown) {
  return markdown.split('\n').map((line) => `> ${line}`).join('\n')
}

function withChildren(line, children) {
  return children ? `${line}\n${children}` : line
}

function iconText(icon) {
  if (!icon) return ''
  if (icon.type === 'emoji') return `${icon.emoji} `
  return ''
}

function extensionFromUrl(url) {
  const pathname = new URL(url).pathname
  const ext = path.extname(pathname)
  return ext && ext.length <= 8 ? ext : ''
}

function getCoverUrl(page) {
  if (!page.cover) return undefined
  return page.cover.type === 'external' ? page.cover.external?.url : page.cover.file?.url
}

function slugify(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`;@=&]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'notion-page'
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(`[notion-sync] ${error.message}`)
  process.exitCode = 1
})
