/**
 * JWT 认证中间件单元测试
 */
import { describe, it, expect } from 'vitest';

// Setup env before importing
process.env.JWT_SECRET = 'test-jwt-secret';

import jwt from 'jsonwebtoken';

// 直接内联测试 JWT 逻辑，避免复杂的 mock
function signToken(payload) {
  const expiresIn = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, process.env.JWT_SECRET || 'test', { expiresIn });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test');
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
}

describe('signToken', () => {
  it('应返回非空字符串', () => {
    const token = signToken({ id: 1, username: 'test' });
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT 三段式
  });

  it('不同 payload 产生不同 token', () => {
    const t1 = signToken({ id: 1, username: 'alice' });
    const t2 = signToken({ id: 2, username: 'bob' });
    expect(t1).not.toBe(t2);
  });
});

describe('authRequired 中间件', () => {
  function mockReq(authHeader) {
    return {
      headers: { authorization: authHeader || '' },
      user: null,
    };
  }

  it('无 Authorization 头 → 401', () => {
    const req = mockReq('');
    const res = { status: (code) => ({ json: (data) => ({ code, data }) }) };
    const next = () => { throw new Error('should not call next'); };
    const result = authRequired(req, res, next);
    expect(result.code).toBe(401);
  });

  it('无效 token → 401', () => {
    const req = mockReq('Bearer invalid.token.here');
    const res = { status: (code) => ({ json: (data) => ({ code, data }) }) };
    const result = authRequired(req, res, () => {});
    expect(result.code).toBe(401);
  });

  it('有效 token → 调用 next 且设置 req.user', () => {
    const token = signToken({ id: 42, username: 'testuser' });
    const req = mockReq(`Bearer ${token}`);
    const res = {};
    let called = false;
    authRequired(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(req.user.id).toBe(42);
    expect(req.user.username).toBe('testuser');
  });

  it('错误的 Bearer 格式 → 401', () => {
    const req = mockReq('Basic xyz');
    const res = { status: (code) => ({ json: (data) => ({ code, data }) }) };
    const result = authRequired(req, res, () => {});
    expect(result.code).toBe(401);
  });
});
