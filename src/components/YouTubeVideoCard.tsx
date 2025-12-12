'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

interface YouTubeVideo {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
        width: number;
        height: number;
      };
    };
    channelTitle: string;
    publishedAt: string;
    channelId: string;
  };
}

interface YouTubeVideoCardProps {
  video: YouTubeVideo;
}

interface StreamInfo {
  quality: string;
  url: string;
  type: string;
}

const YouTubeVideoCard = ({ video }: YouTubeVideoCardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleEmbedPlay = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 获取视频流信息
      const response = await fetch(`/api/proxy/youtube?v=${video.id.videoId}&type=info`);
      if (!response.ok) {
        throw new Error('无法获取视频信息');
      }
      
      const data = await response.json();
      
      // 优先使用合并流（包含视频和音频）
      if (data.combinedStream?.url) {
        setStreamUrl(data.combinedStream.url);
        setIsPlaying(true);
      } else if (data.videoStreams?.length > 0) {
        // 选择第一个可用的视频流
        setStreamUrl(data.videoStreams[0].url);
        setIsPlaying(true);
      } else {
        throw new Error('没有可用的视频流');
      }
    } catch (err: any) {
      console.error('获取视频流失败:', err);
      setError(err.message || '播放失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenInNewTab = () => {
    window.open(`https://www.youtube.com/watch?v=${video.id.videoId}`, '_blank');
  };

  // 当streamUrl变化时自动播放
  useEffect(() => {
    if (streamUrl && videoRef.current) {
      videoRef.current.play().catch(console.error);
    }
  }, [streamUrl]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const truncateTitle = (title: string, maxLength = 50) => {
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 overflow-hidden">
      {/* 视频缩略图区域 */}
      <div className="relative aspect-video bg-gray-200 dark:bg-gray-700">
        {isPlaying && streamUrl ? (
          <div className="w-full h-full">
            <video
              ref={videoRef}
              src={streamUrl}
              className="w-full h-full"
              controls
              autoPlay
              playsInline
              title={video.snippet.title}
            />
            {/* 关闭播放按钮 */}
            <button
              onClick={() => {
                setIsPlaying(false);
                setStreamUrl(null);
              }}
              className="absolute top-2 right-2 bg-black bg-opacity-75 text-white p-2 rounded-full hover:bg-opacity-90 transition-opacity z-10"
              aria-label="关闭播放"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            {!imageError ? (
              <Image
                src={video.snippet.thumbnails.medium.url}
                alt={video.snippet.title}
                fill
                className="object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-300 dark:bg-gray-600">
                <svg className="w-12 h-12 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
              </div>
            )}
            
            {/* 加载中或错误提示 */}
            {isLoading && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                <div className="text-white text-center">
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <span className="text-sm">加载中...</span>
                </div>
              </div>
            )}
            
            {error && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                <div className="text-white text-center p-4">
                  <svg className="w-8 h-8 mx-auto mb-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">{error}</span>
                  <button
                    onClick={() => setError(null)}
                    className="block mx-auto mt-2 text-xs text-blue-300 hover:text-blue-200"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
            
            {/* 播放按钮覆盖层 */}
            {!isLoading && !error && (
              <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-300 flex items-center justify-center group">
                <button
                  onClick={handleEmbedPlay}
                  className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-red-600 hover:bg-red-700 text-white rounded-full p-4 transform hover:scale-110 transition-transform"
                  aria-label="播放视频"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              </div>
            )}
            
            {/* YouTube标识 */}
            <div className="absolute bottom-2 right-2 bg-red-600 text-white text-xs px-2 py-1 rounded flex items-center">
              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube
            </div>
          </>
        )}
      </div>

      {/* 视频信息区域 */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-2 line-clamp-2">
          {truncateTitle(video.snippet.title)}
        </h3>
        
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-3">
          <span className="truncate">{video.snippet.channelTitle}</span>
          <span>{formatDate(video.snippet.publishedAt)}</span>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex space-x-2">
          <button
            onClick={handleEmbedPlay}
            disabled={isLoading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white text-xs py-2 px-3 rounded transition-colors flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <div className="w-3 h-3 mr-1 border border-white border-t-transparent rounded-full animate-spin"></div>
                加载中
              </>
            ) : (
              <>
                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                代理播放
              </>
            )}
          </button>
          <button
            onClick={handleOpenInNewTab}
            className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-xs py-2 px-3 rounded transition-colors flex items-center justify-center"
          >
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            新窗口
          </button>
        </div>
      </div>
    </div>
  );
};

export default YouTubeVideoCard;