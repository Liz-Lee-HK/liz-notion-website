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

  return `---\n${frontMatter}---\n\n${body.trim()}\n`
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
