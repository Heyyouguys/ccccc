import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  generateSystemPrompt,
  RANDOM_RECOMMENDATION_HINTS,
  isReasoningModel,
  TOKEN_LIMITS
} from '@/lib/ai-recommend-constants';
import { getConfig, hasSpecialFeaturePermission } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  streamMode?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    
    // 检查用户权限
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;

    // 获取配置检查AI功能是否启用
    const adminConfig = await getConfig();

    // 检查用户是否有AI推荐功能权限（传入已获取的配置避免重复调用）
    const hasPermission = await hasSpecialFeaturePermission(username, 'ai-recommend', adminConfig);
    if (!hasPermission) {
      return NextResponse.json({
        error: '您无权使用AI推荐功能，请联系管理员开通权限'
      }, {
        status: 403,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Expires': '0',
          'Pragma': 'no-cache',
          'Surrogate-Control': 'no-store'
        }
      });
    }
    const aiConfig = adminConfig.AIRecommendConfig;

    if (!aiConfig?.enabled) {
      return NextResponse.json({
        error: 'AI推荐功能未启用'
      }, {
        status: 403,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Expires': '0',
          'Pragma': 'no-cache',
          'Surrogate-Control': 'no-store'
        }
      });
    }

    // 检查API配置是否完整
    if (!aiConfig.apiKey || !aiConfig.apiUrl) {
      return NextResponse.json({ 
        error: 'AI推荐功能配置不完整，请联系管理员' 
      }, { status: 500 });
    }

    const { messages, model, temperature, max_tokens, max_completion_tokens, streamMode } = await request.json() as ChatRequest;

    // 验证请求格式
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ 
        error: 'Invalid messages format' 
      }, { status: 400 });
    }

    // 优化缓存策略 - 只对简单的单轮问答进行短时缓存
    let cacheKey: string | null = null;
    let cachedResponse = null;
    
    // 只有在单轮对话且消息较短时才使用缓存，避免过度缓存复杂对话
    if (messages.length === 1 && messages[0].role === 'user' && messages[0].content.length < 50) {
      const questionHash = Buffer.from(messages[0].content.trim().toLowerCase()).toString('base64').slice(0, 16);
      cacheKey = `ai-recommend-simple-${questionHash}`;
      cachedResponse = await db.getCache(cacheKey);
    }
    
    if (cachedResponse) {
      return NextResponse.json(cachedResponse);
    }

    // 生成系统提示词
    const currentDate = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    const randomHint = RANDOM_RECOMMENDATION_HINTS[Math.floor(Math.random() * RANDOM_RECOMMENDATION_HINTS.length)];
    
    // 获取最后一条用户消息用于分析
    const userMessage = messages[messages.length - 1]?.content || '';
    
    // 检测用户消息中的YouTube链接
    const detectVideoLinks = (content: string) => {
      const youtubePattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]+)/g;
      const matches = [];
      let match;
      while ((match = youtubePattern.exec(content)) !== null) {
        matches.push({
          originalUrl: match[0],
          videoId: match[1],
          fullMatch: match[0]
        });
      }
      return matches;
    };

    // 检查是否包含YouTube链接
    const videoLinks = detectVideoLinks(userMessage);
    const hasVideoLinks = videoLinks.length > 0;

    // 获取YouTube配置，判断是否启用YouTube推荐功能
    const youtubeConfig = adminConfig.YouTubeConfig;
    const youtubeEnabled = youtubeConfig?.enabled;

    // 构建功能列表和详细说明
    const capabilities = ['影视剧推荐'];
    let youtubeSearchStatus = '';
    
    // 视频链接解析功能（所有用户可用）
    capabilities.push('YouTube视频链接解析');
    
    // YouTube推荐功能状态判断
    if (youtubeEnabled && youtubeConfig.apiKey) {
      capabilities.push('YouTube视频搜索推荐');
      youtubeSearchStatus = '✅ 支持YouTube视频搜索推荐（真实API）';
    } else if (youtubeEnabled) {
      youtubeSearchStatus = '⚠️ YouTube搜索功能已开启但未配置API Key，无法提供搜索结果';
    } else {
      youtubeSearchStatus = '❌ YouTube搜索功能未启用，无法搜索推荐YouTube视频';
    }

    const systemPrompt = generateSystemPrompt(
      currentDate,
      currentYear,
      lastYear,
      randomHint,
      capabilities,
      youtubeSearchStatus,
      !!youtubeEnabled,
      !!(youtubeConfig?.apiKey)
    );

    // 准备发送给OpenAI的消息
    const chatMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    // 使用配置中的参数或请求参数
    const requestModel = model || aiConfig.model;
    let tokenLimit = max_tokens || max_completion_tokens || aiConfig.maxTokens;
    
    // 判断是否是推理模型
    const useMaxCompletionTokens = isReasoningModel(requestModel);
    
    // 根据模型类型优化token限制
    if (useMaxCompletionTokens) {
      if (requestModel.includes('gpt-5')) {
        tokenLimit = Math.max(tokenLimit, TOKEN_LIMITS.GPT5_MIN);
        tokenLimit = Math.min(tokenLimit, TOKEN_LIMITS.GPT5_MAX);
      } else if (requestModel.startsWith('o3') || requestModel.startsWith('o4')) {
        tokenLimit = Math.max(tokenLimit, TOKEN_LIMITS.O3_O4_MIN);
        tokenLimit = Math.min(tokenLimit, TOKEN_LIMITS.O3_O4_MAX);
      } else {
        tokenLimit = Math.max(tokenLimit, TOKEN_LIMITS.REASONING_MIN);
      }
    } else {
      tokenLimit = Math.max(tokenLimit, TOKEN_LIMITS.NORMAL_MIN);
      if (requestModel.includes('gpt-4')) {
        tokenLimit = Math.min(tokenLimit, TOKEN_LIMITS.GPT4_MAX);
      }
    }
    
    // 根据配置或请求参数决定是否使用流式输出
    const useStream = streamMode ?? aiConfig.streamMode ?? true;
    
    const requestBody: any = {
      model: requestModel,
      messages: chatMessages,
      stream: useStream, // 根据配置启用或禁用流式输出
    };
    
    // 推理模型不支持某些参数
    if (!useMaxCompletionTokens) {
      requestBody.temperature = temperature ?? aiConfig.temperature;
    }
    
    // 根据模型类型使用正确的token限制参数
    if (useMaxCompletionTokens) {
      requestBody.max_completion_tokens = tokenLimit;
      // 推理模型不支持这些参数
      console.log(`使用推理模型 ${requestModel}，max_completion_tokens: ${tokenLimit}`);
    } else {
      requestBody.max_tokens = tokenLimit;
      console.log(`使用标准模型 ${requestModel}，max_tokens: ${tokenLimit}`);
    }

    // 调用AI API - 流式请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时
    
    let openaiResponse: Response;
    try {
      openaiResponse = await fetch(aiConfig.apiUrl.endsWith('/chat/completions')
        ? aiConfig.apiUrl
        : `${aiConfig.apiUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('AI API请求超时');
        return NextResponse.json({
          error: 'AI服务响应超时（60秒）',
          details: '请求超时，可能原因：\n1. API服务器响应慢\n2. 网络连接不稳定\n3. 模型处理时间过长\n\n建议：\n- 检查API地址是否正确\n- 尝试使用更快的模型\n- 检查网络连接',
          timeout: true
        }, { status: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error('OpenAI API Error:', errorData);
      
      // 提供更详细的错误信息
      let errorMessage = 'AI服务暂时不可用，请稍后重试';
      let errorDetails = '';
      
      try {
        const parsedError = JSON.parse(errorData);
        if (parsedError.error?.message) {
          errorDetails = parsedError.error.message;
        }
      } catch {
        errorDetails = errorData.substring(0, 200); // 限制错误信息长度
      }
      
      // 根据HTTP状态码提供更具体的错误信息
      if (openaiResponse.status === 401) {
        errorMessage = 'API密钥无效，请联系管理员检查配置';
      } else if (openaiResponse.status === 429) {
        errorMessage = 'API请求频率限制，请稍后重试';
      } else if (openaiResponse.status === 400) {
        errorMessage = '请求参数错误，请检查输入内容';
      } else if (openaiResponse.status >= 500) {
        errorMessage = 'AI服务器错误，请稍后重试';
      }
      
      return NextResponse.json({
        error: errorMessage,
        details: errorDetails,
        status: openaiResponse.status
      }, { status: 500 });
    }

    // 如果不使用流式输出，则使用传统方式处理
    if (!useStream) {
      const aiResult = await openaiResponse.json();
      
      // 检查AI响应的完整性
      if (!aiResult.choices || aiResult.choices.length === 0 || !aiResult.choices[0].message) {
        console.error('AI响应格式异常:', aiResult);
        return NextResponse.json({
          error: 'AI服务响应格式异常，请稍后重试',
          details: `响应结构异常: ${JSON.stringify(aiResult).substring(0, 200)}...`
        }, { status: 500 });
      }
      
      const aiContent = aiResult.choices[0].message.content;
      
      // 检查内容是否为空
      if (!aiContent || aiContent.trim() === '') {
        console.error('AI返回空内容');
        return NextResponse.json({
          error: 'AI返回了空回复',
          details: '建议：请尝试更详细地描述您想要的影视类型'
        }, { status: 500 });
      }
      
      // 处理视频链接解析
      if (hasVideoLinks) {
        try {
          const parsedVideos = await handleVideoLinkParsing(videoLinks);
          
          return NextResponse.json({
            id: aiResult.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: aiResult.created || Math.floor(Date.now() / 1000),
            model: aiResult.model || requestBody.model,
            choices: aiResult.choices,
            usage: aiResult.usage,
            videoLinks: parsedVideos,
            type: 'video_link_parse'
          });
        } catch (error) {
          console.error('视频链接解析失败:', error);
        }
      }
      
      // 检测是否为YouTube视频推荐
      const isYouTubeRecommendation = youtubeEnabled && youtubeConfig.apiKey &&
        aiContent.includes('【') && aiContent.includes('】');
      
      if (isYouTubeRecommendation) {
        try {
          const searchKeywords = extractYouTubeSearchKeywords(aiContent);
          const youtubeVideos = await searchYouTubeVideos(searchKeywords, youtubeConfig);
          
          return NextResponse.json({
            id: aiResult.id || `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: aiResult.created || Math.floor(Date.now() / 1000),
            model: aiResult.model || requestBody.model,
            choices: aiResult.choices,
            usage: aiResult.usage,
            youtubeVideos,
            type: 'youtube_recommend'
          });
        } catch (error) {
          console.error('YouTube推荐失败:', error);
        }
      }
      
      // 提取结构化推荐信息
      const recommendations = extractRecommendations(aiContent);
      
      return NextResponse.json({
        id: aiResult.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: aiResult.created || Math.floor(Date.now() / 1000),
        model: aiResult.model || requestBody.model,
        choices: aiResult.choices,
        usage: aiResult.usage,
        recommendations
      });
    }

    // 处理流式响应
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const reader = openaiResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = '';
        let fullContent = '';
        
        try {
          let isDone = false;
          while (!isDone) {
            const { done, value } = await reader.read();
            isDone = done;
            
            if (done) {
              // 流结束，发送最终处理结果
              if (fullContent) {
                // 处理视频链接解析
                if (hasVideoLinks) {
                  try {
                    const parsedVideos = await handleVideoLinkParsing(videoLinks);
                    const finalData = {
                      type: 'video_links',
                      data: parsedVideos
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));
                  } catch (error) {
                    console.error('视频链接解析失败:', error);
                  }
                }
                
                // 检测YouTube推荐
                const isYouTubeRecommendation = youtubeEnabled && youtubeConfig.apiKey &&
                  fullContent.includes('【') && fullContent.includes('】');
                
                if (isYouTubeRecommendation) {
                  try {
                    const searchKeywords = extractYouTubeSearchKeywords(fullContent);
                    const youtubeVideos = await searchYouTubeVideos(searchKeywords, youtubeConfig);
                    const finalData = {
                      type: 'youtube_videos',
                      data: youtubeVideos
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));
                  } catch (error) {
                    console.error('YouTube推荐失败:', error);
                  }
                } else {
                  // 提取影视推荐
                  const recommendations = extractRecommendations(fullContent);
                  if (recommendations.length > 0) {
                    const finalData = {
                      type: 'recommendations',
                      data: recommendations
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));
                  }
                }
              }
              
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
              
              if (trimmedLine.startsWith('data: ')) {
                const jsonStr = trimmedLine.slice(6);
                try {
                  const parsed = JSON.parse(jsonStr);
                  const content = parsed.choices?.[0]?.delta?.content;
                  
                  if (content) {
                    fullContent += content;
                    // 转发内容块
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'content',
                      content: content
                    })}\n\n`));
                  }
                } catch (e) {
                  console.error('解析SSE数据失败:', e);
                }
              }
            }
          }
        } catch (error) {
          console.error('流处理错误:', error);
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('AI推荐API错误:', error);
    
    // 提供更详细的错误信息
    let errorMessage = '服务器内部错误';
    let errorDetails = '';
    
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        errorMessage = '无法连接到AI服务，请检查网络连接';
        errorDetails = '网络连接错误，请稍后重试';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'AI服务响应超时，请稍后重试';
        errorDetails = '请求超时，可能是网络问题或服务器负载过高';
      } else if (error.message.includes('JSON')) {
        errorMessage = 'AI服务响应格式错误';
        errorDetails = '服务器返回了无效的数据格式';
      } else {
        errorDetails = error.message;
      }
    }
    
    return NextResponse.json({ 
      error: errorMessage,
      details: errorDetails
    }, { status: 500 });
  }
}

// 获取AI推荐历史
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    const historyKey = `ai-recommend-history-${username}`;
    const history = await db.getCache(historyKey) || [];

    return NextResponse.json({
      history: history,
      total: history.length
    });

  } catch (error) {
    console.error('获取AI推荐历史错误:', error);
    return NextResponse.json({ 
      error: '获取历史记录失败' 
    }, { status: 500 });
  }
}

// 视频链接解析处理函数
async function handleVideoLinkParsing(videoLinks: any[]) {
  const parsedVideos = [];
  
  for (const link of videoLinks) {
    try {
      // 使用YouTube oEmbed API获取视频信息（公开，无需API Key）
      const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${link.videoId}&format=json`);
      
      if (response.ok) {
        const videoInfo = await response.json();
        parsedVideos.push({
          videoId: link.videoId,
          originalUrl: link.originalUrl,
          title: videoInfo?.title || '直接播放的YouTube视频',
          channelName: videoInfo?.author_name || '未知频道',
          thumbnail: `https://img.youtube.com/vi/${link.videoId}/mqdefault.jpg`,
          playable: true,
          embedUrl: `https://www.youtube.com/embed/${link.videoId}?autoplay=1&rel=0`
        });
      } else {
        // 即使oEmbed失败，也提供基本信息
        parsedVideos.push({
          videoId: link.videoId,
          originalUrl: link.originalUrl,
          title: '直接播放的YouTube视频',
          channelName: '未知频道',
          thumbnail: `https://img.youtube.com/vi/${link.videoId}/mqdefault.jpg`,
          playable: true,
          embedUrl: `https://www.youtube.com/embed/${link.videoId}?autoplay=1&rel=0`
        });
      }
    } catch (error) {
      console.error(`解析视频 ${link.videoId} 失败:`, error);
      parsedVideos.push({
        videoId: link.videoId,
        originalUrl: link.originalUrl,
        title: '解析失败的视频',
        error: '无法获取视频信息',
        playable: false
      });
    }
  }
  
  return parsedVideos;
}

// 从AI回复中提取YouTube搜索关键词（参考alpha逻辑）
function extractYouTubeSearchKeywords(content: string): string[] {
  const keywords: string[] = [];
  const videoPattern = /【([^】]+)】/g;
  let match;

  while ((match = videoPattern.exec(content)) !== null && keywords.length < 4) {
    keywords.push(match[1].trim());
  }

  return keywords;
}

// YouTube视频搜索函数（仅支持真实API）
async function searchYouTubeVideos(keywords: string[], youtubeConfig: any) {
  const videos = [];

  // 检查API Key
  if (!youtubeConfig.apiKey) {
    throw new Error('YouTube API Key未配置');
  }

  // 使用真实YouTube API
  for (const keyword of keywords) {
    if (videos.length >= 4) break;

    try {
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('key', youtubeConfig.apiKey);
      searchUrl.searchParams.set('q', keyword);
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('maxResults', '1');
      searchUrl.searchParams.set('order', 'relevance');

      const response = await fetch(searchUrl.toString());
      
      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          const video = data.items[0];
          videos.push({
            id: video.id.videoId,
            title: video.snippet.title,
            description: video.snippet.description,
            thumbnail: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url,
            channelTitle: video.snippet.channelTitle,
            publishedAt: video.snippet.publishedAt
          });
        }
      }
    } catch (error) {
      console.error(`搜索关键词 "${keyword}" 失败:`, error);
    }
  }

  return videos;
}

// 从AI回复中提取推荐信息的辅助函数
function extractRecommendations(content: string) {
  const recommendations = [];
  const moviePattern = /《([^》]+)》\s*\((\d{4})\)\s*\[([^\]]+)\]\s*-\s*(.*)/;
  const lines = content.split('\n');

  for (const line of lines) {
    if (recommendations.length >= 4) {
      break;
    }
    const match = line.match(moviePattern);
    if (match) {
      const [, title, year, genre, description] = match;
      recommendations.push({
        title: title.trim(),
        year: year.trim(),
        genre: genre.trim(),
        description: description.trim() || 'AI推荐影片',
      });
    }
  }
  return recommendations;
}