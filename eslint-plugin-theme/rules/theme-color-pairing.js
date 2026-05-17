"use strict";

/**
 * @fileoverview 强制使用语义化颜色 token，禁止裸用 Tailwind 原色类
 *
 * 规则：语义颜色必须使用 CSS 变量驱动的 Tailwind token，
 *       如 text-status-success、bg-semantic-agent 等。
 *       这些 token 通过 CSS 变量自动适配 light/dark 主题。
 *
 * 替换映射：
 *   green-400/300, emerald-400  → status-success
 *   red-400/300                 → status-error
 *   amber-400/300, yellow-400/300 → status-warning
 *   blue-400/300, sky-400       → status-info
 *   purple-400/300              → semantic-agent
 *   cyan-400/300                → semantic-tool
 *   teal-400/300                → semantic-memory
 *   indigo-400/300              → semantic-accent
 *   orange-400/300              → semantic-notify
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

const DARK_OPTIMIZED_SHADES = ["300", "400"];

const COLOR_CLASS_RE =
  /(?:text|bg|border|ring|outline|decoration|shadow|from|via|to|fill|stroke)-([a-z]+)-(\d+)(?:\/([\d.]+))?/;

function parseClasses(classNameStr) {
  if (!classNameStr || typeof classNameStr !== "string") return [];
  return classNameStr.split(/\s+/).filter(Boolean);
}

function extractColorToken(cls) {
  const match = COLOR_CLASS_RE.exec(cls);
  if (!match) return null;
  return { color: match[1], shade: match[2], opacity: match[3], full: cls };
}

function isDarkPrefixed(cls) {
  return cls.startsWith("dark:");
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

    function checkClassString(classNode, rawValue) {
      const classes = parseClasses(rawValue);
      if (classes.length === 0) return;

      for (const cls of classes) {
        if (isDarkPrefixed(cls)) continue;

        const token = extractColorToken(cls);
        if (!token) continue;
        if (!SEMANTIC_COLORS.includes(token.color)) continue;
        if (!DARK_OPTIMIZED_SHADES.includes(token.shade)) continue;

        const semanticToken = COLOR_TO_TOKEN[token.color];
        if (!semanticToken) continue;

        const hasDarkPair = classes.some((c) => {
          if (!c.startsWith("dark:")) return false;
          const darkCls = c.slice(5);
          const darkToken = extractColorToken(darkCls);
          return darkToken && darkToken.color === token.color;
        });

        if (hasDarkPair) continue;

        const prefix = cls.match(
          /^(hover:|active:|focus:|prose-a:|group-hover:)*(text|bg|border|ring|fill|stroke)/,
        );
        const prefixStr = prefix ? prefix[0] : "text-";
        const opacityStr = token.opacity ? `/${token.opacity}` : "";

        context.report({
          node: classNode,
          messageId: "useSemanticToken",
          data: {
            class: cls,
            prefix: prefixStr + "-".includes(prefixStr.slice(-1)) ? "" : prefixStr.replace(/-$/, "-"),
            token: semanticToken,
            opacity: opacityStr,
          },
        });
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
          if (
            arg.type === "Literal" ||
            arg.type === "StringLiteral"
          ) {
            checkClassString(arg, arg.value);
          } else if (arg.type === "TemplateLiteral") {
            checkTemplateLiteral(arg);
          } else if (arg.type === "ArrayExpression") {
            for (const el of arg.elements) {
              if (
                el?.type === "Literal" ||
                el?.type === "StringLiteral"
              ) {
                checkClassString(el, el.value);
              } else if (el?.type === "TemplateLiteral") {
                checkTemplateLiteral(el);
              }
            }
          }
        }
      },
    };
  },
};
