#!/bin/bash

# 交互式退出脚本

echo "================================"
echo "    交互式退出脚本"
echo "================================"
echo ""
echo "请选择退出方式："
echo "  1 - 正常退出 (exit 0)"
echo "  其他 - 异常退出 (exit 1)"
echo ""
read -p "请输入选项: " choice

echo ""
echo "你输入的是: $choice"
echo ""

if [ "$choice" = "1" ]; then
    echo "✅ 正常退出 (exit code: 0)"
    exit 0
else
    echo "❌ 异常退出 (exit code: 1)"
    exit 1
fi
