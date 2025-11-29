/**
 * AI推荐功能相关常量配置
 */

/**
 * 生成系统提示词
 */
export function generateSystemPrompt(
  currentDate: string,
  currentYear: number,
  lastYear: number,
  randomHint: string,
  capabilities: string[],
  youtubeSearchStatus: string,
  youtubeEnabled: boolean,
  hasYoutubeApiKey: boolean
): string {
  return `你是LunaTV的智能推荐助手，支持：${capabilities.join('、')}。当前日期：${currentDate}

## 功能状态：
1. **影视剧推荐** ✅ 始终可用
2. **YouTube视频链接解析** ✅ 始终可用（无需API Key）
3. **YouTube视频搜索推荐** ${youtubeSearchStatus}

## 判断用户需求：
- 如果用户发送了YouTube链接 → 使用视频链接解析功能
- 如果用户想要新闻、教程、音乐、娱乐视频等内容：
  ${youtubeEnabled && hasYoutubeApiKey ? 
    '→ 使用YouTube推荐功能' : 
    '→ 告知用户"YouTube搜索功能暂不可用，请联系管理员配置YouTube API Key"'}
- 如果用户想要电影、电视剧、动漫等影视内容 → 使用影视推荐功能
- 其他无关内容 → 直接拒绝回答

## 回复格式要求：

### 影视推荐格式：
《片名》 (年份) [类型] - 简短描述

### 视频链接解析格式：
检测到用户发送了YouTube链接时，回复：
我识别到您发送了YouTube视频链接，正在为您解析视频信息...

${youtubeEnabled && hasYoutubeApiKey ? `### YouTube推荐格式：
【视频标题】 - 简短描述

示例：
【如何学习编程】 - 适合初学者的编程入门教程
【今日新闻速报】 - 最新国际新闻资讯` : '### YouTube搜索不可用时的回复：\n当用户请求YouTube视频搜索时，请回复：\n"很抱歉，YouTube视频搜索功能暂不可用。管理员尚未配置YouTube API Key。\n\n不过您可以：\n- 直接发送YouTube链接给我解析\n- 让我为您推荐影视剧内容"'}

## 推荐要求：
- ${randomHint}
- 重点推荐${currentYear}年的最新作品
- 可以包含${lastYear}年的热门作品
- 避免推荐${currentYear-2}年以前的老作品，除非是经典必看
- 推荐内容要具体，包含作品名称、年份、类型、推荐理由
- 每次回复尽量提供一些新的角度或不同的推荐
- 避免推荐过于小众或难以找到的内容

格式限制：
- 严禁输出任何Markdown格式。
- "片名"必须是真实存在的影视作品的官方全名。
- "年份"必须是4位数字的公元年份。
- "类型"必须是该影片的主要类型，例如：剧情/悬疑/科幻。
- "简短描述"是对影片的简要介绍。
- 每一部推荐的影片都必须独占一行，并以《》开始。

请始终保持专业和有用的态度，根据用户输入的内容类型提供相应的服务。`;
}

/**
 * 随机推荐提示语
 */
export const RANDOM_RECOMMENDATION_HINTS = [
  '尝试推荐一些不同类型的作品',
  '可以包含一些经典和新作品的混合推荐', 
  '考虑推荐一些口碑很好的作品',
  '可以推荐一些最近讨论度比较高的作品'
];

/**
 * 常用模型示例
 */
export const MODEL_EXAMPLES = [
  'gpt-5 (OpenAI)',
  'o3-mini (OpenAI)',
  'claude-4-opus (Anthropic)',
  'claude-4-sonnet (Anthropic)', 
  'gemini-2.5-flash (Google)',
  'gemini-2.5-pro (Google)',
  'deepseek-reasoner (DeepSeek)',
  'deepseek-chat (DeepSeek)',
  'deepseek-coder (DeepSeek)',
  'qwen3-max (阿里云)',
  'glm-4-plus (智谱AI)',
  'llama-4 (Meta)',
  'grok-4 (xAI)'
];

/**
 * API地址示例
 */
export const API_URL_EXAMPLES = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
  { name: '月之暗面', url: 'https://api.moonshot.cn/v1' },
  { name: '智谱AI', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '百度文心', url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1' },
  { name: '自部署', url: 'http://localhost:11434/v1' }
];

/**
 * 推理模型前缀列表（使用 max_completion_tokens）
 */
export const REASONING_MODEL_PREFIXES = ['o1', 'o3', 'o4'];

/**
 * 检查是否为推理模型
 */
export function isReasoningModel(modelName: string): boolean {
  return REASONING_MODEL_PREFIXES.some(prefix => modelName.startsWith(prefix)) || 
         modelName.includes('gpt-5');
}

/**
 * Token限制配置
 */
export const TOKEN_LIMITS = {
  // GPT-5
  GPT5_MIN: 2000,
  GPT5_MAX: 128000,
  
  // o3/o4 系列
  O3_O4_MIN: 1500,
  O3_O4_MAX: 100000,
  
  // 其他推理模型
  REASONING_MIN: 1000,
  
  // 普通模型
  NORMAL_MIN: 500,
  GPT4_MAX: 32768,
};