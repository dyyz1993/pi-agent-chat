"use strict";

const DEFAULT_BANNED_PORTS = ["3100", "3110", "3111", "3112"];

function extractPorts(str) {
  const ports = [];
  const re = /:(\d{2,5})\b/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    ports.push(match[1]);
  }
  return ports;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent hardcoded backend ports; resolve them from VITE_API_TARGET instead.",
      category: "Best Practices",
    },
    schema: [
      {
        type: "object",
        properties: {
          bannedPorts: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hardcodedPort:
        "Hardcoded backend port :{{port}} is not allowed. Resolve the backend target from import.meta.env.VITE_API_TARGET instead.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const bannedPorts = new Set(options.bannedPorts || DEFAULT_BANNED_PORTS);

    function checkLiteral(node) {
      if (!node || typeof node.value !== "string") return;
      const ports = extractPorts(node.value);
      for (const port of ports) {
        if (bannedPorts.has(port)) {
          context.report({
            node,
            messageId: "hardcodedPort",
            data: { port },
          });
        }
      }
    }

    function checkTemplateLiteral(node) {
      if (!node) return;
      for (const quasi of node.quasis) {
        if (!quasi.value || !quasi.value.cooked) continue;
        const ports = extractPorts(quasi.value.cooked);
        for (const port of ports) {
          if (bannedPorts.has(port)) {
            context.report({
              node: quasi,
              messageId: "hardcodedPort",
              data: { port },
            });
          }
        }
      }
    }

    return {
      Literal(node) {
        checkLiteral(node);
      },
      TemplateLiteral(node) {
        checkTemplateLiteral(node);
      },
    };
  },
};
