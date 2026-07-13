# Liz Notion Website

这是基于 `/Users/liruolin/liz-website/` 新建的独立 Hexo 项目副本，保留了原网站的结构、内容和 `meow` 主题，并增加了一个 Notion 白名单同步层。

## 工作方式

- GitHub 仓库存放网站代码、主题和同步脚本。
- Notion 只作为指定内容源，不会同步整个工作区。
- `notion-sync.config.cjs` 显式声明哪些 Notion 页面或数据库要进入哪个网站栏目。
- Vercel 构建时先执行 `npm run sync:notion`，再执行 `hexo generate` 生成静态网站。

## 配置 Notion

1. 在 Notion 创建 integration，拿到 `NOTION_TOKEN`。
2. 只把需要公开到网站的页面或数据库 share 给这个 integration。
3. 在 `notion-sync.config.cjs` 的 `mappings` 里添加映射。

示例：

```js
{
  name: 'learning-notes',
  source: {
    type: 'database',
    id: 'YOUR_NOTION_DATABASE_ID'
  },
  target: {
    dir: 'source/_posts/learning-notes',
    category: '学习笔记',
    tags: ['学习笔记']
  },
  properties: {
    title: 'Name',
    date: 'Date',
    summary: 'Summary',
    tags: 'Tags',
    category: 'Category',
    slug: 'Slug'
  },
  filter: {
    property: 'Status',
    status: {
      equals: 'Published'
    }
  }
}
```

## Vercel

在 Vercel 项目里设置环境变量：

```text
NOTION_TOKEN=secret_xxx
```

Vercel 会读取 `vercel.json`：

```text
Build Command: npm run vercel-build
Output Directory: public
```

## 本地命令

```bash
npm install
npm run sync:notion
npm run build
npm run server
```

如果 `mappings` 为空，Notion 同步会自动跳过，方便先验证原站点是否能正常构建。
