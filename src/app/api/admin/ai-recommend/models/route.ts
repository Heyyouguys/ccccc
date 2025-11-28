import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  
  // 检查用户权限
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { apiUrl, apiKey } = await request.json();
    
    if (!apiUrl || !apiKey) {
      return NextResponse.json({ error: 'API地址和密钥不能为空' }, { status: 400 });
    }

    // 构建请求URL - 获取模型列表
    let modelsUrl = apiUrl.trim();
    
    // 智能处理不同API提供商的模型列表端点
    if (modelsUrl.endsWith('/v1')) {
      modelsUrl = modelsUrl + '/models';
    } else if (modelsUrl.endsWith('/v1/')) {
      modelsUrl = modelsUrl + 'models';
    } else if (modelsUrl.includes('/chat/completions')) {
      modelsUrl = modelsUrl.replace('/chat/completions', '/models');
    } else if (!modelsUrl.includes('/models')) {
      // 如果URL不包含/models，尝试添加
      modelsUrl = modelsUrl.endsWith('/') ? modelsUrl + 'models' : modelsUrl + '/models';
    }

    // 发起请求获取模型列表
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (!response.ok) {
      let errorMessage = `获取模型列表失败 (HTTP ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = typeof errorData.error === 'string' 
            ? errorData.error 
            : errorData.error.message || errorMessage;
        }
      } catch (e) {
        // 忽略JSON解析错误
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const data = await response.json();
    
    // 解析模型列表 - 兼容不同API提供商的响应格式
    let models: string[] = [];
    
    if (data.data && Array.isArray(data.data)) {
      // OpenAI标准格式: { data: [{ id: "model-name" }] }
      models = data.data
        .map((model: any) => model.id || model.name)
        .filter((id: string) => id && typeof id === 'string');
    } else if (Array.isArray(data)) {
      // 直接数组格式: ["model1", "model2"]
      models = data.filter((item: any) => typeof item === 'string');
    } else if (data.models && Array.isArray(data.models)) {
      // 某些API的格式: { models: ["model1", "model2"] }
      models = data.models.filter((item: any) => typeof item === 'string');
    }

    // 过滤和排序模型
    models = models
      .filter(model => {
        // 过滤掉一些不常用的模型
        const lowerModel = model.toLowerCase();
        return !lowerModel.includes('embedding') && 
               !lowerModel.includes('whisper') &&
               !lowerModel.includes('tts') &&
               !lowerModel.includes('dall-e');
      })
      .sort((a, b) => {
        // 优先显示常用模型
        const priority = ['gpt-5', 'gpt-4', 'o3', 'o1', 'claude', 'gemini', 'deepseek', 'qwen', 'glm'];
        const aPriority = priority.findIndex(p => a.toLowerCase().includes(p));
        const bPriority = priority.findIndex(p => b.toLowerCase().includes(p));
        
        if (aPriority !== -1 && bPriority !== -1) {
          return aPriority - bPriority;
        }
        if (aPriority !== -1) return -1;
        if (bPriority !== -1) return 1;
        
        return a.localeCompare(b);
      });

    if (models.length === 0) {
      return NextResponse.json({ 
        error: '未找到可用模型，请检查API配置是否正确',
        hint: '某些API提供商可能不支持列出模型，您可以手动输入模型名称'
      }, { status: 404 });
    }

    return NextResponse.json({ 
      models,
      count: models.length 
    });

  } catch (error) {
    console.error('获取模型列表错误:', error);
    
    let errorMessage = '获取模型列表失败';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = '请求超时，请检查网络连接';
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json({ 
      error: errorMessage,
      hint: '如果API提供商不支持列出模型，您可以手动输入模型名称'
    }, { status: 500 });
  }
}