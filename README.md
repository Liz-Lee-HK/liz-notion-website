# Liz Notion Website

这是基于 liz-website 新建的独立 Hexo 项目副本，保留了原网站的结构、内容和 `meow` 主题，并增加了一个 Notion 白名单同步层。

## 工作方式

- GitHub 仓库存放网站代码、主题和同步脚本。
- Notion 只作为指定内容源，不会同步整个工作区。
- `notion-sync.config.cjs` 显式声明哪些 Notion 页面或数据库要进入哪个网站栏目。
- Vercel 构建时先执行 `npm run sync:notion`，再执行 `hexo generate` 生成静态网站。

## 配置 Notion

1. 在 Notion 创建 integration，拿到 `NOTION_TOKEN`。
2. 只把需要公开到网站的页面或数据库 share 给这个 integration。
3. 在 `notion-sync.config.cjs` 的 `mappings` 里添加映射。

单篇学习笔记示例：

```js
{
  name: 'agent-harness-claude-agent-sdk',
  source: {
    type: 'page',
    id: 'YOUR_NOTION_PAGE_ID'
  },
  target: {
    dir: 'source/_posts/learning-notes',
    category: 'Study',
    tags: ['学习笔记', 'Agent']
  }
}
```

单篇项目示例：

```js
{
  name: 'my-project-name',
  source: {
    type: 'page',
    id: 'YOUR_NOTION_PAGE_ID'
  },
  target: {
    dir: 'source/_posts/projects',
    category: 'Projects',
    tags: ['项目']
  }
}
```

注意：导航栏里的“学习笔记”实际对应 Hexo 分类 `Study`，项目集对应 `Projects`，随手记对应 `Notes`。`category` 要填这些英文分类，中文可以放在 `tags` 里。

## 日常更新流程

### 新增一篇 Notion 页面

1. 在 Notion 打开新页面。
2. 右上角 `...` -> `Add connections`，选择 `Liz Website Sync` integration。
3. 复制页面链接，取里面的 Notion page ID。
4. 在 `notion-sync.config.cjs` 的 `mappings` 数组里新增一条 `source.type: 'page'` 映射。
5. 本地执行同步和构建检查：

```bash
npm run sync:notion
npm run build
```

6. 提交并推送到 GitHub，Vercel 会自动重新部署：

```bash
git add .
git commit -m "add notion page"
git push
```

### 更新已有 Notion 文章

如果这篇文章已经在 `notion-sync.config.cjs` 里有映射，不需要改配置。

推荐流程：

```bash
npm run sync:notion
npm run build
git add .
git commit -m "update notion notes"
git push
```

这样线上网站会更新，GitHub 仓库里的 Markdown 也会保留最新版本。

也可以只在 Vercel 的 `Deployments` 页面点最新部署右侧的 `...` -> `Redeploy`。这种方式会更新线上网站，但不会把同步后的 Markdown 提交回 GitHub。

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
