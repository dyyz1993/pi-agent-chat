/**
 * @fileoverview 强制 RPC 模块文件的命名和导出规范
 *
 * 1. modules/ 下的文件必须导出 <Name>Methods 接口
 * 2. 如果有事件，必须导出 <Name>Events 接口
 * 3. 方法 key 必须以文件名（模块名）开头
 * 4. 不允许存在不在 modules/ 下的模块定义
 */

"use strict";

/**
 * 从文件路径提取模块名
 * e.g. "/path/to/modules/file.ts" → "file"
 */
function getModuleName(filename) {
  const match = filename.match(/\/modules\/([^/]+)\.[jt]sx?$/);
  return match ? match[1] : null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "RPC 模块文件必须遵循命名和导出规范",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      missingMethodsExport:
        '模块文件 "{{file}}" 必须导出 "{{ModuleName}}Methods" 接口。',
      methodPrefixMismatch:
        '方法 "{{method}}" 的前缀不匹配模块 "{{module}}"。必须以 "{{module}}." 开头。',
      eventPrefixMismatch:
        '事件 "{{event}}" 的前缀不匹配模块 "{{module}}"。必须以 "{{module}}." 开头。',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    const moduleName = getModuleName(filename);
    if (!moduleName) return {};

    // 将文件名转为 PascalCase: "file-system" → "FileSystem", "file" → "File"
    const moduleNamePascal = moduleName
      .split(/[-_]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");

    let hasMethodsExport = false;

    return {
      TSInterfaceDeclaration(node) {
        const name = node.id.name;

        // 检查是否导出了 <Module>Methods
        if (name === `${moduleNamePascal}Methods`) {
          hasMethodsExport = true;

          // 检查方法 key 是否以模块名开头
          if (node.body && node.body.body) {
            for (const member of node.body.body) {
              if (member.type === "TSPropertySignature" && member.key) {
                const key =
                  member.key.type === "Literal" ? String(member.key.value) : null;
                if (key && !key.startsWith(`${moduleName}.`)) {
                  context.report({
                    node: member,
                    messageId: "methodPrefixMismatch",
                    data: { method: key, module: moduleName },
                  });
                }
              }
            }
          }
        }

        // 检查事件 key 是否以模块名开头
        if (name === `${moduleNamePascal}Events`) {
          if (node.body && node.body.body) {
            for (const member of node.body.body) {
              if (member.type === "TSPropertySignature" && member.key) {
                const key =
                  member.key.type === "Literal" ? String(member.key.value) : null;
                if (key && !key.startsWith(`${moduleName}.`)) {
                  context.report({
                    node: member,
                    messageId: "eventPrefixMismatch",
                    data: { event: key, module: moduleName },
                  });
                }
              }
            }
          }
        }
      },

      "Program:exit"() {
        if (!hasMethodsExport) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "missingMethodsExport",
            data: {
              file: filename.split("/").pop(),
              ModuleName: moduleNamePascal,
            },
          });
        }
      },
    };
  },
};
