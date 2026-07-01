#!/bin/bash
# WeMusic 手机端一键部署脚本（Termux + Android）
set -e

echo "🎵 WeMusic 手机端安装"
echo "========================"

# 安装依赖
echo ">> 更新包管理器..."
pkg update -y
pkg install nodejs git bash -y

# 克隆项目
if [ -d "WeMusic" ]; then
  echo ">> 更新已有项目..."
  cd WeMusic && git pull
else
  echo ">> 克隆项目..."
  git clone https://github.com/sherlockguo/WeMusic.git
  cd WeMusic
fi

# 安装依赖 + 构建前端
echo ">> 安装依赖（这一步需要几分钟）..."
npm install
npm run build

# 初始化配置
if [ ! -f ".env" ]; then
  cp .env.example .env
fi

# 完成
echo ""
echo "✅ 安装完成！"
echo ""
echo "启动服务："
echo "  cd ~/WeMusic && npm start"
echo ""
echo "然后："
echo "  1. 手机浏览器打开 http://localhost:5174"
echo "  2. Chrome 菜单 → 添加到主屏幕"
echo "  3. 从桌面图标打开，全屏使用！"
echo ""
echo "后台运行："
echo "  cd ~/WeMusic && nohup npm start &"
echo ""
