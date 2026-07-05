// 角色权限中间件
// 用法: requireRole('admin')     → admin 及以上可访问
//       requireRole('super_admin') → 仅超级管理员
//       requireRole('admin', 'moderator') → admin 或 moderator

import db from '../db.js';

const ROLE_HIERARCHY = {
  super_admin: 4,
  admin: 3,
  moderator: 2,
  viewer: 1,
  user: 0,
};

export function requireRole(...roles) {
  const minLevel = Math.min(...roles.map((r) => ROLE_HIERARCHY[r] || 0));
  return (req, res, next) => {
    // 从数据库查询角色（不从 JWT 取，确保角色变更即时生效）
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    const userRole = row?.role || 'user';
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    // 附加到 req.user 供后续使用
    req.user.role = userRole;

    if (userLevel < minLevel) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

// 获取当前用户的角色信息
export function getUserRole(username) {
  const row = db.prepare('SELECT role FROM users WHERE username = ?').get(username);
  return row?.role || 'user';
}

// 检查用户是否被归档（无法登录）
export function isArchived(username) {
  const row = db.prepare('SELECT archived_at FROM users WHERE username = ?').get(username);
  return !!row?.archived_at;
}
