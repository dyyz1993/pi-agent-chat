/**
 * @fileoverview Require async onClick handlers to have a guard against duplicate
 * concurrent invocations (double-click protection).
 *
 * Async onClick handlers without guards can be triggered multiple times before
 * the first invocation completes, causing duplicate RPC calls, race conditions,
 * or unintended side effects (e.g. deleting a session twice, sending a goal
 * twice, pushing git changes twice).
 *
 * A handler is considered "guarded" if it meets ANY of:
 * 1. Uses `useAsyncGuard()` hook (project-standard reusable guard)
 * 2. Uses a `useRef(false)` flag checked at the top of the handler
 * 3. The button element has `disabled={someState}` that is set to true during
 *    the async operation
 *
 * @example BAD
 *   const handleDelete = async () => {
 *     await apiClient.call("session.delete", { id });
 *   };
 *   <button onClick={handleDelete}>Delete</button>
 *
 * @example GOOD — useAsyncGuard
 *   const [handleDelete, isDeleting] = useAsyncGuard(async () => {
 *     await apiClient.call("session.delete", { id });
 *   });
 *   <button onClick={handleDelete} disabled={isDeleting}>Delete</button>
 *
 * @example GOOD — ref flag
 *   const deletingRef = useRef(false);
 *   const handleDelete = async () => {
 *     if (deletingRef.current) return;
 *     deletingRef.current = true;
 *     try { await apiClient.call("session.delete", { id }); }
 *     finally { deletingRef.current = false; }
 *   };
 *
 * @example GOOD — disabled prop
 *   const [isDeleting, setIsDeleting] = useState(false);
 *   const handleDelete = async () => {
 *     setIsDeleting(true);
 *     try { await apiClient.call("session.delete", { id }); }
 *     finally { setIsDeleting(false); }
 *   };
 *   <button onClick={handleDelete} disabled={isDeleting}>Delete</button>
 */

"use strict";

/**
 * Recursively walk an AST node tree to find AwaitExpression.
 * Returns true as soon as one is found.
 */
function containsAwait(node) {
  if (!node || typeof node !== "object") return false;

  // Fast path: if this node is an AwaitExpression, done
  if (node.type === "AwaitExpression") return true;

  // Don't descend into nested functions — their awaits belong to the inner fn
  const isFn =
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration";
  if (isFn && node !== containsAwait.rootNode) return false;

  // Walk all child properties
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "range" || key === "loc") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === "object" && containsAwait(c)) return true;
      }
    } else if (child && typeof child === "object") {
      if (containsAwait(child)) return true;
    }
  }
  return false;
}

/**
 * Check if a function body contains an await expression.
 */
function hasAsyncOperation(fnNode) {
  if (!fnNode) return false;
  containsAwait.rootNode = fnNode;
  return containsAwait(fnNode);
}

/**
 * Check if the component uses useAsyncGuard for this specific handler name.
 * We look for `const [handlerName, ...] = useAsyncGuard(...)`.
 */
function usesUseAsyncGuard(handlerName, scope) {
  if (!scope) return false;
  const variable = scope.set.get(handlerName);
  if (!variable) return false;

  for (const def of variable.defs) {
    if (def.type === "Variable" && def.node.init) {
      // Check if it's destructured from useAsyncGuard()
      // Pattern: const [handlerName, ...] = useAsyncGuard(...)
      const init = def.node.init;
      if (
        init.type === "CallExpression" &&
        init.callee &&
        init.callee.type === "Identifier" &&
        init.callee.name === "useAsyncGuard"
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a handler function has a ref.current guard at the top.
 * Pattern: if (someRef.current) return;
 */
function hasRefGuard(handlerNode) {
  if (!handlerNode) return false;
  if (
    handlerNode.type !== "FunctionExpression" &&
    handlerNode.type !== "ArrowFunctionExpression"
  ) {
    return false;
  }
  const body = handlerNode.body;
  if (!body || body.type !== "BlockStatement") return false;

  // Check first few statements for a ref.current guard
  const stmts = body.body.slice(0, 5);
  for (const stmt of stmts) {
    if (stmt.type !== "IfStatement") continue;
    const test = stmt.test;

    // Pattern: if (refName.current) return
    if (
      test.type === "MemberExpression" &&
      test.property &&
      test.property.type === "Identifier" &&
      test.property.name === "current"
    ) {
      return true;
    }

    // Pattern: if (!refName.current) ... (inverted guard also counts)
    if (
      test.type === "UnaryExpression" &&
      test.operator === "!" &&
      test.argument &&
      test.argument.type === "MemberExpression" &&
      test.argument.property &&
      test.argument.property.type === "Identifier" &&
      test.argument.property.name === "current"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if the JSX element has a disabled prop (boolean or expression).
 */
function hasDisabledProp(jsxElement) {
  if (!jsxElement || jsxElement.type !== "JSXElement") return false;
  const opening = jsxElement.openingElement;
  if (!opening || !opening.attributes) return false;

  for (const attr of opening.attributes) {
    if (attr.type !== "JSXAttribute") continue;
    if (attr.name && attr.name.name === "disabled") {
      // disabled={false} doesn't count, but disabled={anyVar} does
      if (attr.value && attr.value.type === "JSXExpressionContainer") {
        const expr = attr.value.expression;
        if (expr.type === "Literal" && expr.value === false) continue;
        return true;
      }
      // disabled (boolean shorthand) also counts
      if (!attr.value) return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "async onClick handler 必须有防重复触发保护（useAsyncGuard / ref flag / disabled prop）",
      category: "React Best Practices",
      recommended: "warn",
    },
    messages: {
      missingGuard:
        "async onClick handler '{{name}}' 缺少防重复触发保护。" +
        "请使用 useAsyncGuard() hook，或在 handler 顶部添加 ref.current 检查，" +
        "或在按钮上添加 disabled={isRunning}。" +
        "未保护的 async onClick 会被连续点击触发多次，导致重复 RPC 调用。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    // Only check .tsx/.jsx files in the components directory
    if (!/\.tsx?$/.test(filename)) return {};
    if (!/\/components?\//.test(filename)) return {};

    // Collect handler names that are async and unguarded
    const asyncHandlers = new Map(); // name → { node, hasRefGuard, usesGuard }

    return {
      // Track variable declarations of async handlers
      VariableDeclarator(node) {
        if (!node.id || node.id.type !== "Identifier") return;
        if (!node.init) return;

        const handlerName = node.id.name;

        // Check if init is an async arrow function or function expression
        let fnNode = null;
        if (node.init.type === "ArrowFunctionExpression" && node.init.async) {
          fnNode = node.init;
        } else if (node.init.type === "FunctionExpression" && node.init.async) {
          fnNode = node.init;
        } else if (
          node.init.type === "CallExpression" &&
          node.init.callee &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "useCallback"
        ) {
          // useCallback(async () => ..., deps)
          const callbackArg = node.init.arguments[0];
          if (callbackArg && callbackArg.async) {
            fnNode = callbackArg;
          }
        }

        if (!fnNode) return;

        // Check if it has async operations (await)
        const hasAwait = hasAsyncOperation(fnNode);
        if (!hasAwait) return;

        // Check if it uses useAsyncGuard
        let usesGuard = false;
        try {
          usesGuard = usesUseAsyncGuard(handlerName, context.getScope());
        } catch {
          // Scope not available yet — skip this check
        }
        if (usesGuard) return;

        // Check if it has a ref.current guard
        const hasGuard = hasRefGuard(fnNode);

        asyncHandlers.set(handlerName, {
          node,
          fnNode,
          hasRefGuard: hasGuard,
          hasDisabled: false, // will be checked at JSX time
        });
      },

      // Check JSX onClick attributes
      JSXAttribute(node) {
        if (!node.name) return;
        // JSX attribute names are JSXIdentifier (not Identifier)
        const attrName = node.name.name;
        if (attrName !== "onClick") return;

        // Get the handler reference
        let handlerName = null;
        if (node.value && node.value.type === "JSXExpressionContainer") {
          const expr = node.value.expression;
          if (expr.type === "Identifier") {
            handlerName = expr.name;
          } else if (
            expr.type === "ArrowFunctionExpression" ||
            expr.type === "FunctionExpression"
          ) {
            // Inline handler — check for await + guard
            if (expr.async && hasAsyncOperation(expr)) {
              if (!hasRefGuard(expr)) {
                // Check parent JSX element for disabled
                const jsxEl = findParentJSXElement(node);
                if (!hasDisabledProp(jsxEl)) {
                  context.report({
                    node,
                    messageId: "missingGuard",
                    data: { name: "(inline)" },
                  });
                }
              }
            }
            return;
          }
        }

        if (!handlerName) return;

        const handlerInfo = asyncHandlers.get(handlerName);
        if (!handlerInfo) return;

        // Check if the parent JSX element has disabled prop
        const jsxEl = findParentJSXElement(node);
        const hasDisabled = hasDisabledProp(jsxEl);

        if (!handlerInfo.hasRefGuard && !hasDisabled) {
          context.report({
            node,
            messageId: "missingGuard",
            data: { name: handlerName },
          });
        }
      },
    };
  },
};

/**
 * Walk up the AST to find the enclosing JSXElement.
 */
function findParentJSXElement(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXOpeningElement") {
      return current.parent; // the JSXElement
    }
    current = current.parent;
  }
  return null;
}
