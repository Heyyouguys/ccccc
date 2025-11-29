/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Brain, Send, Sparkles, X, Play, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  addMovieTitleClickListeners,
  AI_RECOMMEND_PRESETS,
  AIMessage,
  cleanMovieTitle,
  formatAIResponseWithLinks,
  generateChatSummary,
  generateSearchUrl,
  sendAIRecommendMessage,
  MovieRecommendation,
} from '@/lib/ai-recommend.client';

interface AIRecommendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ExtendedAIMessage extends AIMessage {
  recommendations?: MovieRecommendation[];
  youtubeVideos?: any[];
  videoLinks?: any[];
  type?: string;
}

export default function AIRecommendModal({ isOpen, onClose }: AIRecommendModalProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ExtendedAIMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{message: string, details?: string} | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 从localStorage加载历史对话
  useEffect(() => {
    try {
      const cachedMessages = localStorage.getItem('ai-recommend-messages');
      if (cachedMessages) {
        const { messages: storedMessages, timestamp } = JSON.parse(cachedMessages);
        const now = new Date().getTime();
        // 30分钟缓存
        if (now - timestamp < 30 * 60 * 1000) {
          setMessages(storedMessages.map((msg: ExtendedAIMessage) => ({
            ...msg,
            timestamp: msg.timestamp || new Date().toISOString()
          })));
          return; // 有缓存就不显示欢迎消息
        } else {
          // 🔥 修复Bug #2: 超过30分钟时真正删除localStorage中的过期数据
          console.log('AI聊天记录已超过30分钟，自动清除缓存');
          localStorage.removeItem('ai-recommend-messages');
        }
      }
      
      // 没有有效缓存时显示欢迎消息
      const welcomeMessage: ExtendedAIMessage = {
        role: 'assistant',
        content: '你好！我是AI智能助手，支持以下功能：\n\n🎬 影视剧推荐 - 推荐电影、电视剧、动漫等\n🔗 视频链接解析 - 解析YouTube链接并播放\n📺 视频内容搜索 - 搜索相关视频内容\n\n💡 直接告诉我你想看什么类型的内容，或发送YouTube链接给我解析！',
        timestamp: new Date().toISOString()
      };
      setMessages([welcomeMessage]);
    } catch (error) {
      console.error("Failed to load messages from cache", error);
      // 发生错误时也清除可能损坏的缓存
      localStorage.removeItem('ai-recommend-messages');
    }
  }, []);

  // 保存对话到localStorage并滚动到底部
  useEffect(() => {
    scrollToBottom();
    try {
      // 🔥 修复Bug #1: 保持原有时间戳，不要每次都重置
      const existingCache = localStorage.getItem('ai-recommend-messages');
      let existingTimestamp = new Date().getTime(); // 默认当前时间
      
      if (existingCache) {
        try {
          const parsed = JSON.parse(existingCache);
          existingTimestamp = parsed.timestamp || existingTimestamp;
        } catch {
          // 解析失败时使用当前时间
        }
      }
      
      const cache = {
        messages,
        timestamp: existingTimestamp // 保持原有时间戳，不重置
      };
      localStorage.setItem('ai-recommend-messages', JSON.stringify(cache));
    } catch (error) {
      console.error("Failed to save messages to cache", error);
    }
  }, [messages]);

  // 处理片名点击搜索（保留用于文本中的链接点击）
  const handleTitleClick = (title: string) => {
    const cleanTitle = cleanMovieTitle(title);
    const searchUrl = generateSearchUrl(cleanTitle);
    router.push(searchUrl);
    onClose(); // 关闭对话框
  };

  // 处理推荐卡片点击
  const handleMovieSelect = (movie: MovieRecommendation) => {
    const searchQuery = encodeURIComponent(movie.title);
    router.push(`/search?q=${searchQuery}`);
    onClose(); // 关闭对话框
  };

  // 处理YouTube视频点击播放
  const handleYouTubeVideoSelect = (video: any) => {
    setPlayingVideoId(playingVideoId === video.id ? null : video.id);
  };

  // 处理视频链接解析结果
  const handleVideoLinkPlay = (video: any) => {
    if (video.playable && video.embedUrl) {
      setPlayingVideoId(playingVideoId === video.videoId ? null : video.videoId);
    }
  };

  // 发送消息 - 支持流式接收
  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);
    setError(null);

    // 创建一个临时的助手消息用于流式更新
    const tempAssistantMessage: ExtendedAIMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      recommendations: [],
      youtubeVideos: [],
      videoLinks: [],
      type: 'normal',
    };

    const updatedMessages = [...messages, userMessage];
    setMessages([...updatedMessages, tempAssistantMessage]);

    try {
      // 智能上下文管理：只发送最近8条消息（4轮对话）
      const conversationHistory = updatedMessages.slice(-8);
      
      // 使用流式API
      const response = await fetch('/api/ai-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(JSON.stringify(errorData));
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';
      let fullContent = '';
      let recommendations: MovieRecommendation[] = [];
      let youtubeVideos: any[] = [];
      let videoLinks: any[] = [];
      let messageType = 'normal';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          
          const data = trimmedLine.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'content' && parsed.content) {
              fullContent += parsed.content;
              
              // 实时更新消息内容
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage.role === 'assistant') {
                  lastMessage.content = fullContent;
                }
                return newMessages;
              });
              
              // 自动滚动到底部
              scrollToBottom();
            } else if (parsed.type === 'recommendations' && parsed.data) {
              recommendations = parsed.data;
            } else if (parsed.type === 'youtube_videos' && parsed.data) {
              youtubeVideos = parsed.data;
              messageType = 'youtube_recommend';
            } else if (parsed.type === 'video_links' && parsed.data) {
              videoLinks = parsed.data;
              messageType = 'video_link_parse';
            }
          } catch (e) {
            console.error('解析SSE数据失败:', e);
          }
        }
      }

      // 流结束后更新完整的消息
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage.role === 'assistant') {
          lastMessage.content = fullContent;
          lastMessage.recommendations = recommendations;
          lastMessage.youtubeVideos = youtubeVideos;
          lastMessage.videoLinks = videoLinks;
          lastMessage.type = messageType;
        }
        return newMessages;
      });

    } catch (error) {
      console.error('AI推荐请求失败:', error);
      
      // 移除临时的助手消息
      setMessages(prev => prev.slice(0, -1));
      
      if (error instanceof Error) {
        try {
          const errorResponse = JSON.parse(error.message);
          setError({
            message: errorResponse.error || error.message,
            details: errorResponse.details
          });
        } catch {
          setError({
            message: error.message,
            details: '如果问题持续，请联系管理员检查AI配置'
          });
        }
      } else {
        setError({
          message: '请求失败，请稍后重试',
          details: '未知错误，请检查网络连接'
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 处理预设问题
  const handlePresetClick = (preset: { title: string; message: string }) => {
    sendMessage(preset.message);
  };

  // 处理表单提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputMessage);
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputMessage);
    }
  };

  // 重置对话
  const resetChat = () => {
    // 清除localStorage缓存
    try {
      localStorage.removeItem('ai-recommend-messages');
    } catch (error) {
      console.error("Failed to clear messages cache", error);
    }
    
    // 重新显示欢迎消息
    const welcomeMessage: ExtendedAIMessage = {
      role: 'assistant',
      content: '你好！我是AI智能助手，支持以下功能：\n\n🎬 影视剧推荐 - 推荐电影、电视剧、动漫等\n🔗 视频链接解析 - 解析YouTube链接并播放\n📺 视频内容搜索 - 搜索相关视频内容\n\n💡 直接告诉我你想看什么类型的内容，或发送YouTube链接给我解析！',
      timestamp: new Date().toISOString()
    };
    setMessages([welcomeMessage]);
    setError(null);
    setInputMessage('');
  };

  // 不再需要为消息内容添加点击监听器，因为点击功能已移至右侧卡片

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 对话框 */}
      <div className="relative w-full max-w-4xl h-[80vh] mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-600 to-purple-600">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white bg-opacity-20 rounded-lg">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">AI 智能助手</h2>
              <p className="text-blue-100 text-sm">影视推荐 · 视频解析 · YouTube搜索</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {messages.length > 0 && (
              <button
                onClick={resetChat}
                className="px-3 py-1 text-sm bg-white bg-opacity-20 text-white rounded-md hover:bg-opacity-30 transition-colors"
              >
                清空对话
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div 
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-800"
        >
          {messages.length <= 1 && messages.every(msg => msg.role === 'assistant' && msg.content.includes('AI智能助手')) && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-4">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                欢迎使用AI智能助手
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                支持影视推荐、YouTube链接解析和视频搜索推荐
              </p>
              
              {/* 预设问题 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                {AI_RECOMMEND_PRESETS.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => handlePresetClick(preset)}
                    className="p-3 text-left bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all group"
                    disabled={isLoading}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {preset.title}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600'
                }`}
              >
                {message.role === 'assistant' ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: formatAIResponseWithLinks(message.content, handleTitleClick),
                    }}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
              </div>
              
              {/* 推荐影片卡片 */}
              {message.role === 'assistant' && message.recommendations && message.recommendations.length > 0 && (
                <div className="mt-3 space-y-2 max-w-[80%]">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full text-xs font-medium mr-2">
                        🎬 点击搜索
                      </span>
                      推荐影片卡片
                    </div>
                    <span className="text-gray-400 dark:text-gray-500">
                      {message.recommendations.length < 4 
                        ? `显示 ${message.recommendations.length} 个推荐`
                        : `显示前 4 个推荐`
                      }
                    </span>
                  </div>
                  {message.recommendations.map((movie, index) => (
                    <div
                      key={index}
                      onClick={() => handleMovieSelect(movie)}
                      className="p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 hover:scale-[1.02] transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        {movie.poster && (
                          <img
                            src={movie.poster}
                            alt={movie.title}
                            className="w-12 h-16 object-cover rounded flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-white text-sm flex items-center">
                            {movie.title}
                            {movie.year && (
                              <span className="text-gray-500 dark:text-gray-400 ml-1">({movie.year})</span>
                            )}
                            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 text-xs">
                              🔍 搜索
                            </span>
                          </h4>
                          {movie.genre && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{movie.genre}</p>
                          )}
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                            {movie.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* YouTube视频推荐卡片 */}
              {message.role === 'assistant' && message.youtubeVideos && message.youtubeVideos.length > 0 && (
                <div className="mt-3 space-y-2 max-w-[80%]">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 px-2 py-1 rounded-full text-xs font-medium mr-2">
                        📺 点击播放
                      </span>
                      YouTube视频推荐
                    </div>
                    <span className="text-gray-400 dark:text-gray-500">
                      {message.youtubeVideos.length} 个视频
                    </span>
                  </div>
                  {message.youtubeVideos.map((video, index) => (
                    <div key={index} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      {playingVideoId === video.id ? (
                        <div className="relative">
                          <div className="aspect-video">
                            <iframe
                              src={`https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0`}
                              className="w-full h-full"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                              allowFullScreen
                              title={video.title}
                            />
                          </div>
                          <button
                            onClick={() => setPlayingVideoId(null)}
                            className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full p-1 hover:bg-opacity-70 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <div className="p-3">
                            <h4 className="font-medium text-gray-900 dark:text-white text-sm">{video.title}</h4>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{video.channelTitle}</p>
                          </div>
                        </div>
                      ) : (
                        <div onClick={() => handleYouTubeVideoSelect(video)} className="p-3 cursor-pointer hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all">
                          <div className="flex items-start gap-3">
                            <div className="relative">
                              <img src={video.thumbnail} alt={video.title} className="w-16 h-12 object-cover rounded flex-shrink-0" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
                                <div className="bg-red-600 text-white rounded-full p-1">
                                  <Play className="w-3 h-3" />
                                </div>
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 dark:text-white text-sm line-clamp-2">{video.title}</h4>
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{video.channelTitle}</p>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{video.description}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 视频链接解析卡片 */}
              {message.role === 'assistant' && message.videoLinks && message.videoLinks.length > 0 && (
                <div className="mt-3 space-y-2 max-w-[80%]">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-2 py-1 rounded-full text-xs font-medium mr-2">
                        🔗 链接解析
                      </span>
                      视频链接解析结果
                    </div>
                    <span className="text-gray-400 dark:text-gray-500">
                      {message.videoLinks.length} 个链接
                    </span>
                  </div>
                  {message.videoLinks.map((video, index) => (
                    <div key={index} className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                      {video.playable ? (
                        <div className="space-y-3">
                          {playingVideoId === video.videoId ? (
                            <div className="relative">
                              <div className="aspect-video">
                                <iframe
                                  src={video.embedUrl}
                                  className="w-full h-full"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                  allowFullScreen
                                  title={video.title}
                                />
                              </div>
                              <button
                                onClick={() => setPlayingVideoId(null)}
                                className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full p-1 hover:bg-opacity-70 transition-opacity"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-3">
                              <div className="relative cursor-pointer" onClick={() => handleVideoLinkPlay(video)}>
                                <img 
                                  src={video.thumbnail} 
                                  alt={video.title}
                                  className="w-20 h-15 object-cover rounded"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
                                  <div className="bg-red-600 text-white rounded-full p-2">
                                    <Play className="w-4 h-4" />
                                  </div>
                                </div>
                              </div>
                              <div className="flex-1">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                  {video.title}
                                </h4>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  {video.channelName}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  原链接: {video.originalUrl}
                                </p>
                              </div>
                            </div>
                          )}
                          
                          <div className="flex gap-2">
                            {playingVideoId !== video.videoId && (
                              <button
                                onClick={() => handleVideoLinkPlay(video)}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm"
                              >
                                <Play className="w-4 h-4" />
                                直接播放
                              </button>
                            )}
                            <button
                              onClick={() => window.open(video.originalUrl, '_blank')}
                              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2 text-sm"
                            >
                              <ExternalLink className="w-4 h-4" />
                              原始链接
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-red-600 dark:text-red-400">
                          <p className="font-medium">解析失败</p>
                          <p className="text-sm">{video.error}</p>
                          <p className="text-xs mt-1">原链接: {video.originalUrl}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* 加载状态 */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-700 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-300">
                    {error.message}
                  </h3>
                  {error.details && (
                    <div className="mt-2 text-sm text-red-700 dark:text-red-400">
                      <p>{error.details}</p>
                    </div>
                  )}
                  <div className="mt-3">
                    <button
                      onClick={() => setError(null)}
                      className="text-sm bg-red-100 hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700 text-red-800 dark:text-red-200 px-3 py-1 rounded-md transition-colors"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <form onSubmit={handleSubmit} className="flex space-x-3">
            <div className="flex-1">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入影视推荐类型、YouTube搜索内容或直接粘贴YouTube链接..."
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                rows={2}
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={!inputMessage.trim() || isLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Send className="h-4 w-4" />
              <span>发送</span>
            </button>
          </form>
          
          {/* 提示信息 */}
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>💡 支持影视推荐、YouTube链接解析和视频搜索</span>
            <span>按 Enter 发送，Shift+Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  );
}