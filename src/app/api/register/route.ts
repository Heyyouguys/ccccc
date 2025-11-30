/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

// 生成签名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
  includePassword = false
): Promise<string> {
  const authData: any = { role: role || 'user' };

  // 只在需要时包含 password
  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    // 使用密码作为密钥对用户名进行签名
    const signature = await generateSignature(username, process.env.PASSWORD);
    authData.signature = signature;
    authData.timestamp = Date.now(); // 添加时间戳防重放攻击
  }

  return encodeURIComponent(JSON.stringify(authData));
}

// 获取客户端IP地址
function getClientIp(req: NextRequest): string {
  // 尝试从各种可能的头部获取真实IP
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  if (forwarded) {
    // x-forwarded-for 可能包含多个IP，取第一个
    return forwarded.split(',')[0].trim();
  }
  
  if (realIp) {
    return realIp;
  }
  
  // 如果都获取不到，返回未知
  return 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    // localStorage 模式不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage 模式不支持用户注册' },
        { status: 400 }
      );
    }

    const { username, password, confirmPassword } = await req.json();
    
    // 获取注册IP
    const registrationIp = getClientIp(req);

    // 先检查配置中是否允许注册（在验证输入之前）
    try {
      const config = await getConfig();
      const allowRegister = config.UserConfig?.AllowRegister !== false; // 默认允许注册
      
      if (!allowRegister) {
        return NextResponse.json(
          { error: '管理员已关闭用户注册功能' },
          { status: 403 }
        );
      }
    } catch (err) {
      console.error('检查注册配置失败', err);
      return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
    }

    // 验证输入
    if (!username || typeof username !== 'string' || username.trim() === '') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: '两次输入的密码不一致' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码长度至少6位' }, { status: 400 });
    }

    // 检查是否与管理员用户名冲突
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '该用户名已被使用' }, { status: 400 });
    }

    // 检查用户名格式（只允许字母数字和下划线）
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字和下划线，长度3-20位' },
        { status: 400 }
      );
    }

    try {
      // 先获取配置
      const config = await getConfig();
      
      // 检查该IP的注册次数
      const ipRegistrationCount = config.UserConfig.Users.filter(
        (u) => u.registrationIp === registrationIp
      ).length;
      
      if (ipRegistrationCount >= 3) {
        return NextResponse.json(
          { error: '请不要频繁申请' },
          { status: 429 }
        );
      }
      
      // 检查用户是否已存在
      const userExists = await db.checkUserExist(username);
      if (userExists) {
        return NextResponse.json({ error: '该用户名已被注册' }, { status: 400 });
      }
      
      // 根据配置决定是否需要审核
      const requireApproval = config.UserConfig.RequireApproval !== false; // 默认需要审核
      
      // 创建新用户配置对象
      const newUser = {
        username: username,
        role: 'user' as const,
        approved: !requireApproval, // 根据配置设置审核状态
        createdAt: Date.now(), // 设置注册时间戳
        registrationIp: registrationIp, // 记录注册IP
        ...(requireApproval ? {} : { approvedAt: Date.now() }) // 如果不需要审核，设置审核通过时间
      };

      // 先将新用户添加到配置中
      config.UserConfig.Users.push(newUser);

      // 然后注册用户到数据库
      await db.registerUser(username, password);

      // 保存更新后的配置
      // 注意：这里保存的配置已经包含了新用户，且 approved 状态正确
      await db.saveAdminConfig(config);

      // 清除缓存，确保下次获取配置时是最新的
      clearConfigCache();

      // 根据审核状态返回不同的响应
      if (requireApproval) {
        // 需要审核
        return NextResponse.json(
          {
            ok: true,
            pending: true,
            message: '注册信息已提交审核，请等待管理员通过后再登录'
          },
          { status: 202 }
        );
      } else {
        // 无需审核，直接登录
        const authCookie = await generateAuthCookie(username, password, 'user');
        return NextResponse.json(
          {
            ok: true,
            pending: false,
            message: '注册成功，已自动登录'
          },
          {
            status: 200,
            headers: {
              'Set-Cookie': `auth=${authCookie}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure;' : ''} Max-Age=${60 * 60 * 24 * 7}` // 7天有效期
            }
          }
        );
      }
    } catch (err) {
      console.error('注册用户失败', err);
      return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
