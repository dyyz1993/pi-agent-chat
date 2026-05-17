"use strict";

/**
 * @fileoverview 强制使用语义化颜色 token，禁止裸用 Tailwind 原色类
 *
 * 规则：语义颜色必须使用 CSS 变量驱动的 Tailwind token，
 *       如 text-status-success、bg-semantic-agent 等。
 *       这些 token 通过 CSS 变量自动适配 light/dark 主题。
 *
 * 替换映射：
 *   green/emerald    → status-success
 *   red              → status-error
 *   amber/yellow     → status-warning
 *   blue/sky         → status-info
 *   purple           → semantic-agent
 *   cyan             → semantic-tool
 *   teal             → semantic-memory
 *   indigo           → semantic-accent
 *   orange           → semantic-notify
 *
 * 覆盖范围：
 *   - 所有色阶（100-900），不限于暗色优化的 300/400
 *   - text / bg / border / ring / fill / stroke 前缀
 *   - hover: / active: / focus: 等变体前缀
 *   - JSX className 属性 + clsx/cn() 调用 + 对象属性值中的字符串字面量
 *
 * 豁免：
 *   - 已有 dark: 配对的类（token 自动适配，无需配对）
 *   - AnsiText.tsx 终端颜色码映射表
 */

const COLOR_TO_TOKEN = {
  green: "status-success",
  emerald: "status-success",
  red: "status-error",
  amber: "status-warning",
  yellow: "status-warning",
  blue: "status-info",
  sky: "status-info",
  purple: "semantic-agent",
  cyan: "semantic-tool",
  teal: "semantic-memory",
  indigo: "semantic-accent",
  orange: "semantic-notify",
};

const SEMANTIC_COLORS = Object.keys(COLOR_TO_TOKEN);

const COLOR_CLASS_RE =
  /(?:text|bg|border|ring|outline|decoration|shadow|from|via|to|fill|stroke)-([a-z]+)-(\d+)(?:\/([\d.]+))?/;

function parseClasses(classNameStr) {
  if (!classNameStr || typeof classNameStr !== "string") return [];
  return classNameStr.split(/\s+/).filter(Boolean);
}

function extractColorToken(cls) {
  COLOR_CLASS_RE.lastIndex = 0;
  const match = COLOR_CLASS_RE.exec(cls);
  if (!match) return null;
  return { color: match[1], shade: match[2], opacity: match[3], full: cls };
}

function isDarkPrefixed(cls) {
  return cls.startsWith("dark:");
}

function hasDarkPair(classes, baseColor) {
  return classes.some((cls) => {
    if (!cls.startsWith("dark:")) return false;
    const stripped = cls.slice(5);
    const token = extractColorToken(stripped);
    return token && token.color === baseColor;
  });
}

function reportViolation(context, node, cls) {
  const token = extractColorToken(cls);
  if (!token || !SEMANTIC_COLORS.includes(token.color)) return;

  const semanticToken = COLOR_TO_TOKEN[token.color];
  if (!semanticToken) return;

  const prefixMatch = cls.match(
    /^(hover:|active:|focus:|prose-a:|group-hover:)*(text|bg|border|ring|fill|stroke)/,
  );
  const prefixStr = prefixMatch ? prefixMatch[0] : "";
  const cleanPrefix = prefixStr.replace(/-$/, "");
  const opacityStr = token.opacity ? `/${token.opacity}` : "";

  context.report({
    node,
    messageId: "useSemanticToken",
    data: {
      class: cls,
      prefix: cleanPrefix ? `${cleanPrefix}-` : "",
      token: semanticToken,
      opacity: opacityStr,
    },
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "语义颜色必须使用 CSS 变量 token（status-*/semantic-*），禁止裸用 Tailwind 原色",
      category: "Theme Constraints",
      recommended: "error",
    },
    messages: {
      useSemanticToken:
        '禁止裸用 "{{class}}"。请使用语义 token "{{prefix}}{{token}}{{opacity}}"，' +
        "该 token 自动适配 light/dark 主题。\n" +
        "可用 token: status-success/error/warning/info, semantic-agent/tool/memory/accent/notify",
    },
    schema: [],
    fixable: null,
  },

  create(context) {
    const filename = context.getFilename();
    if (!/\.[jt]sx?$/.test(filename)) return {};

    // Skip AnsiText.tsx — terminal ANSI codes are intentionally raw colors
    if (filename.includes("AnsiText")) return {};

    function checkClassString(classNode, rawValue) {
      const classes = parseClasses(rawValue);
      if (classes.length === 0) return;

      for (const cls of classes) {
        if (isDarkPrefixed(cls)) continue;

        const token = extractColorToken(cls);
        if (!token) continue;
        if (!SEMANTIC_COLORS.includes(token.color)) continue;

        // 检查是否有同色的 dark: 变体（已有配对则跳过）
        if (hasDarkPair(classes, token.color)) continue;

        reportViolation(context, classNode, cls);
      }
    }

    function checkTemplateLiteral(node) {
      for (const quasi of node.quasis) {
        const trimmed = quasi.value.raw.trim();
        if (trimmed) {
          checkClassString(quasi, trimmed);
        }
      }
    }

    /** 检查对象属性值中的颜色字符串字面量 */
    function checkObjectPropertyValues(node) {
      if (node.type !== "ObjectExpression") return;
      for (const prop of node.properties) {
        if (
          prop.type !== "Property" ||
          !prop.value ||
          prop.value.type !== "Literal"
        )
          continue;
        const val = String(prop.value.value);
        if (!val) continue;
        for (const cls of parseClasses(val)) {
          if (isDarkPrefixed(cls)) continue;
          const token = extractColorToken(cls);
          if (!token || !SEMANTIC_COLORS.includes(token.color)) continue;
          reportViolation(context, prop.value, cls);
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "Identifier" &&
          node.name.type !== "JSXIdentifier"
        )
          return;
        if (node.name.name !== "className") return;

        if (
          node.value?.type === "Literal" ||
          node.value?.type === "StringLiteral"
        ) {
          checkClassString(node, node.value.value);
        } else if (node.value?.type === "TemplateLiteral") {
          checkTemplateLiteral(node.value);
        }
      },

      CallExpression(node) {
        const { callee, arguments: args } = node;
        const arg = args[0];
        if (!arg) return;

        const isClsx =
          (callee.type === "Identifier" &&
            ["clsx", "cn", "classnames", "twMerge"].includes(callee.name)) ||
          (callee.type === "MemberExpression" &&
            callee.property?.type === "Identifier" &&
            ["clsx", "cn", "classnames"].includes(callee.property.name));

        if (isClsx) {
          if (arg.type === "Literal" || arg.type === "StringLiteral") {
            checkClassString(arg, arg.value);
          } else if (arg.type === "TemplateLiteral") {
            checkTemplateLiteral(arg);
          } else if (arg.type === "ArrayExpression") {
            for (const el of arg.elements) {
              if (el?.type === "Literal" || el?.type === "StringLiteral") {
                checkClassString(el, el.value);
              } else if (el?.type === "TemplateLiteral") {
                checkTemplateLiteral(el);
              } else if (el?.type === "ObjectExpression") {
                checkObjectPropertyValues(el);
              }
            }
          } else if (arg.type === "ObjectExpression") {
            checkObjectPropertyValues(arg);
          }
        }
      },

      /** 检测变量声明中的对象属性值 */
      VariableDeclarator(node) {
        if (node.init?.type === "ObjectExpression") {
          checkObjectPropertyValues(node.init);
        }
      },

      /** 检测赋值表达式右侧的对象 */
      AssignmentExpression(node) {
        if (node.right?.type === "ObjectExpression") {
          checkObjectPropertyValues(node.right);
        }
      },
    };
  },
};
