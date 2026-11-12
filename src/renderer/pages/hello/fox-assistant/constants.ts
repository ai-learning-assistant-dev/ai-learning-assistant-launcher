/**
 * 狐狸学伴 AI 助手（开源仓库：AI Browser Assistant）宣传位常量
 *
 * 文案与卖点依据 docs/视觉方案-狐狸学伴AI助手.md
 * 所有链接均为已核实的真实地址，不要替换成推测地址。
 */

export const FOX_ASSISTANT_NAME = '狐狸学伴 AI 助手';

/** 主标语：一眼看懂省掉了哪一步 */
export const FOX_ASSISTANT_SLOGAN = '打开网页，直接问 AI';

/** 副标语 */
export const FOX_ASSISTANT_SUB_SLOGAN = '整页内容自动成为上下文，不用复制粘贴';

/** Chrome 应用商店安装页（最省事的安装方式） */
export const FOX_ASSISTANT_STORE_URL =
  'https://chromewebstore.google.com/detail/%E7%8B%90%E7%8B%B8%E5%AD%A6%E4%BC%B4ai%E5%8A%A9%E6%89%8B/ciiofdknohdbobbmgglpdejgnincnadp?hl=zh';

/** 开源仓库 */
export const FOX_ASSISTANT_REPO_URL =
  'https://github.com/shiftonetothree/chrome-LLM-plugin';

/** 源码打包下载（手动加载已解压扩展程序时使用） */
export const FOX_ASSISTANT_ZIP_URL =
  'https://github.com/shiftonetothree/chrome-LLM-plugin/archive/refs/heads/main.zip';

/** 隐私政策：明确写了数据去向，浮窗里必须给出入口 */
export const FOX_ASSISTANT_PRIVACY_URL =
  'https://github.com/shiftonetothree/chrome-LLM-plugin/blob/main/PRIVACY.md';

/** 轮播页上的能力标签 */
export const FOX_ASSISTANT_TAGS = ['开源', '密钥自填', '本地存储'] as const;

/** 差异化徽标 */
export const FOX_ASSISTANT_BADGE = 'B 站视频字幕也能问';

/** 详情浮窗的能力清单（均为已核实能力） */
export const FOX_ASSISTANT_FEATURES = [
  {
    key: 'chat',
    title: '整页提问',
    desc: '侧边栏直接问，当前网页自动成为上下文，支持多轮追问',
  },
  {
    key: 'translate',
    title: '划词翻译',
    desc: '右键「翻译此段落」，译文直接插在原文下方',
  },
  {
    key: 'search',
    title: '联网搜索',
    desc: '需要最新信息时调用 Bing / Google / 百度 / Wikipedia',
  },
  {
    key: 'bilibili',
    title: '视频也能读',
    desc: 'B 站视频的字幕、评论、章节一起喂给 AI',
  },
] as const;

/** 各浏览器的安装步骤 */
export const FOX_ASSISTANT_INSTALL_GUIDES = [
  {
    key: 'chrome',
    label: 'Chrome',
    steps: [
      '打开 chrome://extensions/',
      '右上角开启「开发者模式」',
      '点「加载已解压的扩展程序」，选择解压后的文件夹',
    ],
  },
  {
    key: 'edge',
    label: 'Edge',
    steps: [
      '打开 edge://extensions/',
      '左下角开启「开发者模式」',
      '点「加载已解压的扩展程序」，选择解压后的文件夹',
    ],
  },
  {
    key: 'firefox',
    label: 'Firefox',
    steps: [
      '打开 about:debugging#/runtime/this-firefox',
      '点「临时载入附加组件…」',
      '选择文件夹里的 manifest.json',
    ],
    extra:
      '长期安装需在 Firefox 开发者中心打包签名；仓库内有 package.bat 可一键打包。',
  },
] as const;

/** 首次使用三步 */
export const FOX_ASSISTANT_SETUP_STEPS = [
  '选一个模型提供商（DeepSeek / 硅基流动 / OpenAI / 本地 Ollama 等）',
  '填入你自己的 API Key，模型列表会自动拉取',
  '打开任意网页，直接开始问',
] as const;

/** 如实说明的限制，不藏 */
export const FOX_ASSISTANT_NOTICES = [
  '配置与对话存在你自己的浏览器里',
] as const;
