/**
 * Notion -> Hexo mapping.
 *
 * Keep this file as a whitelist. The sync script only reads the Notion page or
 * database IDs listed here, so your whole Notion workspace is never scanned.
 */
module.exports = {
  clean: true,
  assets: {
    download: true,
    dir: 'source/img/notion',
    publicBase: '/img/notion'
  },
  defaults: {
    layout: 'post',
    tags: ['Notion']
  },
  mappings: [
    {
      name: 'agent-harness-claude-agent-sdk',
      source: {
        type: 'page',
        id: '390aeaf18f6180e68c31da4a4597ee56'
      },
      target: {
        dir: 'source/_posts/learning-notes',
        category: 'Study',
        tags: ['学习笔记', 'Agent', 'Claude Agent SDK']
      }
    }
  ]
}
