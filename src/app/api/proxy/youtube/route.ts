/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

export const runtime = 'nodejs';

// Invidious实例列表（用于获取YouTube视频流）
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
  'https://invidious.privacyredirect.com',
  'https://yt.artemislena.eu',
];

// 获取可用的Invidious实例
async function getWorkingInstance(): Promise<string | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(`${instance}/api/v1/stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return instance;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// 获取视频信息和流地址
async function getVideoInfo(videoId: string, instance: string): Promise<any> {
  const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get video info: ${response.status}`);
  }
  
  return response.json();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('v');
  const type = searchParams.get('type') || 'info'; // info, video, audio
  
  if (!videoId) {
    return NextResponse.json({ error: 'Missing video ID' }, { status: 400 });
  }

  // 验证videoId格式
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 });
  }

  try {
    const instance = await getWorkingInstance();
    if (!instance) {
      return NextResponse.json({ error: 'No available proxy instance' }, { status: 503 });
    }

    if (type === 'info') {
      // 返回视频信息
      const videoInfo = await getVideoInfo(videoId, instance);
      
      // 构建代理URL
      const proxyBase = new URL(request.url).origin;
      
      // 找到最佳质量的视频流
      const adaptiveFormats = videoInfo.adaptiveFormats || [];
      const formatStreams = videoInfo.formatStreams || [];
      
      // 获取视频流（优先选择720p或更低以节省带宽）
      const videoStreams = formatStreams
        .filter((f: any) => f.type?.includes('video'))
        .map((f: any) => ({
          quality: f.qualityLabel,
          url: `${proxyBase}/api/proxy/youtube?v=${videoId}&type=video&itag=${f.itag}`,
          directUrl: f.url,
          type: f.type,
        }));

      // 获取音频流
      const audioStreams = adaptiveFormats
        .filter((f: any) => f.type?.includes('audio'))
        .map((f: any) => ({
          quality: f.audioQuality,
          url: `${proxyBase}/api/proxy/youtube?v=${videoId}&type=audio&itag=${f.itag}`,
          directUrl: f.url,
          type: f.type,
          bitrate: f.bitrate,
        }));

      return NextResponse.json({
        videoId,
        title: videoInfo.title,
        author: videoInfo.author,
        lengthSeconds: videoInfo.lengthSeconds,
        thumbnail: videoInfo.videoThumbnails?.[0]?.url,
        videoStreams,
        audioStreams,
        // 提供一个合并的视频+音频流URL（如果有的话）
        combinedStream: formatStreams[0] ? {
          quality: formatStreams[0].qualityLabel,
          url: `${proxyBase}/api/proxy/youtube?v=${videoId}&type=video&itag=${formatStreams[0].itag}`,
          directUrl: formatStreams[0].url,
        } : null,
        instance,
      });
    }

    // 代理视频/音频流
    const itag = searchParams.get('itag');
    if (!itag) {
      return NextResponse.json({ error: 'Missing itag parameter' }, { status: 400 });
    }

    const videoInfo = await getVideoInfo(videoId, instance);
    
    // 查找对应的流
    const allFormats = [...(videoInfo.formatStreams || []), ...(videoInfo.adaptiveFormats || [])];
    const format = allFormats.find((f: any) => f.itag?.toString() === itag);
    
    if (!format || !format.url) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
    }

    // 代理视频流
    const range = request.headers.get('range');
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    
    if (range) {
      headers['Range'] = range;
    }

    const streamResponse = await fetch(format.url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!streamResponse.ok && streamResponse.status !== 206) {
      return NextResponse.json({ error: 'Failed to fetch stream' }, { status: streamResponse.status });
    }

    // 构建响应头
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', format.type || 'video/mp4');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range');
    responseHeaders.set('Accept-Ranges', 'bytes');
    
    const contentLength = streamResponse.headers.get('Content-Length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }
    
    const contentRange = streamResponse.headers.get('Content-Range');
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers: responseHeaders,
    });

  } catch (error: any) {
    console.error('YouTube proxy error:', error);
    return NextResponse.json({ 
      error: 'Proxy failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}

// 处理OPTIONS请求（CORS预检）
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}