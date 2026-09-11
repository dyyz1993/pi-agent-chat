import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "promo/press-kit/posters/feature-series");
mkdirSync(outDir, { recursive: true });

const posters = [
  {
    slug: "01-overview",
    kicker: "AGENT WORKFLOW · HUMAN CONTROL",
    title: ["不是只会聊天的", "AI 编程 Agent。"],
    subtitle: "把执行过程变成可审批、可审查、可回滚的工作区。",
    footer: "Chat → Execute → Approve → Review → Git → Rollback",
    cards: [
      ["对话与执行", "流式对话、消息队列、工具调用和活动时间线。", "CHAT / TOOLS", "#35E0B4"],
      ["审批与权限", "ALLOW / ASK / DENY，危险操作先交给人确认。", "HUMAN CONTROL", "#F6C85F"],
      ["变更审查", "逐文件查看 diff，批准或拒绝 Agent 的修改。", "REVIEW / DIFF", "#58A6FF"],
      ["快照与回滚", "工具执行后保留快照，不满意可以回到之前的状态。", "SNAPSHOT", "#F6C85F"],
      ["Git 工作区", "分支、文件状态、diff、stage、commit 都在界面内。", "BRANCH / COMMIT", "#FF7C86"],
      ["Goal 驱动", "目标、验收条件、执行证据和状态持续可追踪。", "OBJECTIVE → EVIDENCE", "#B98CFF"],
    ],
  },
  {
    slug: "02-control",
    kicker: "PERMISSIONS · HOOKS · RULES",
    title: ["每一次执行，", "都保留人的控制权。"],
    subtitle: "让权限、规则和 Hooks 在执行路径里可见，而不是藏在配置里。",
    footer: "ASK BEFORE ACTION · POLICY AS UI",
    cards: [
      ["ALLOW / ASK / DENY", "工具调用和文件操作可以逐项确认、允许或阻止。", "DECISION", "#35E0B4"],
      ["路径边界", "区分项目路径、读写范围和危险 Bash 请求。", "PATH / BASH", "#F6C85F"],
      ["Hooks 日志", "记录 Pre、Post、Stop 等事件的决策、耗时和原因。", "PRE · POST · STOP", "#B98CFF"],
      ["Rules 生命周期", "查看 loaded、injected、reloaded、expired 状态。", "MATCH / INJECT", "#58A6FF"],
      ["权限规则", "保存项目级、会话级和 provider 相关的允许/拒绝规则。", "PROJECT / SESSION", "#FF7C86"],
      ["待处理请求", "confirm、select、input、editor 等请求统一回到主界面。", "PENDING CENTER", "#35E0B4"],
    ],
  },
  {
    slug: "03-review",
    kicker: "REVIEW · GIT · SNAPSHOT",
    title: ["改了什么，", "先看清再接受。"],
    subtitle: "从 Agent 产生的文件变更，到 Git 提交和快照回滚，全部留在同一条链路。",
    footer: "SEE THE DIFF · DECIDE · RECOVER",
    cards: [
      ["变更列表", "新增、修改、删除文件集中进入待审查列表。", "ADDED / MODIFIED / DELETED", "#58A6FF"],
      ["逐文件 Diff", "查看 old/new content 和 unified diff，不靠猜测。", "OLD → NEW", "#35E0B4"],
      ["Approve / Reject", "单文件处理，也支持批量 approve all / reject all。", "REVIEW DECISION", "#F6C85F"],
      ["快照基线", "审批和回滚依赖持久化快照，而不是前端临时状态。", "PERSISTED BASELINE", "#B98CFF"],
      ["Git 历史", "分支、提交、历史 diff 和 ahead/behind 状态可查看。", "BRANCH / HISTORY", "#FF7C86"],
      ["回滚与恢复", "预览恢复文件，回滚到快照，也可以取消回滚。", "ROLLBACK / UNREVERT", "#F6C85F"],
    ],
  },
  {
    slug: "04-collaboration",
    kicker: "AGENTS · SESSIONS · GOALS",
    title: ["一个 Agent 不够，", "就让任务协作起来。"],
    subtitle: "把 Agent、子任务、会话树和目标进度放进一个可管理的工作空间。",
    footer: "DELEGATE · FOLLOW UP · KEEP CONTEXT",
    cards: [
      ["Agent Profiles", "切换 Agent、工具集、权限模式、模型和 thinking level。", "AGENT / TOOLS", "#35E0B4"],
      ["子 Agent", "独立子会话实时回传消息、工具调用、结果和错误。", "SUBAGENT", "#58A6FF"],
      ["Coordinator", "委派、查询状态、发送 follow-up、steer、停止和清理。", "DELEGATE / STEER", "#B98CFF"],
      ["Goal Contract", "目标、阶段、依赖、验收标准和执行证据。", "PLAN / EVIDENCE", "#F6C85F"],
      ["Session Tree", "历史分页、消息树导航、fork、clone 和摘要。", "TREE / FORK", "#FF7C86"],
      ["Worktree 协作", "让多个任务、分支、worker 和项目工作区保持对应。", "BRANCH / WORKTREE", "#35E0B4"],
    ],
  },
  {
    slug: "05-engineering",
    kicker: "MCP · LSP · MEMORY · OBSERVABILITY",
    title: ["把上下文、工具和诊断，", "都变成可观察的系统。"],
    subtitle: "不只看最终回答，也看工具、模型、上下文、记忆和诊断如何共同工作。",
    footer: "TOOLS · CONTEXT · DIAGNOSTICS · LEARNING",
    cards: [
      ["MCP 管理", "查看 server 状态和工具，支持启用、禁用、重启。", "MCP / TOOLS", "#35E0B4"],
      ["LSP 诊断", "查看语言服务状态，在 agent_end 或 edit_write 时获取诊断。", "LSP / DIAGNOSTICS", "#58A6FF"],
      ["Memory", "搜索、注入、保存记忆，并标记不相关结果。", "RECALL / SAVE", "#B98CFF"],
      ["Learning", "记忆提取、Skill distill、curator 和候选审核。", "MEMORY / SKILL", "#F6C85F"],
      ["Context Usage", "拆解 tools、MCP、skills、memory、rules、LSP 等上下文来源。", "TOKENS / CONTEXT", "#FF7C86"],
      ["Usage 观测", "统计 token、费用、tool calls、MCP、Skill、Hook 和低效模式。", "COST / PATTERNS", "#35E0B4"],
    ],
  },
  {
    slug: "06-remote",
    kicker: "SSH · ROUTING · PREVIEW · DESKTOP + WEB",
    title: ["本地 UI，远程项目，", "仍然是一个工作区。"],
    subtitle: "项目文件、开发预览、端口代理和 Agent runtime 都有清晰的边界。",
    footer: "LOCAL CONTROL · REMOTE EXECUTION",
    cards: [
      ["SSH 项目", "配置主机、目录、Shell，测试连接并打开远程项目。", "SSH / REMOTE", "#35E0B4"],
      ["Remote Runtime", "Standard SSH 使用远端 Agent；Quick Sandbox 用于快速验证。", "REMOTE AGENT", "#58A6FF"],
      ["资源同步", "按受控规则同步 Skills、Agents、Rules，不透传敏感配置。", "SYNC / MANAGED ROOT", "#B98CFF"],
      ["文件路由", "本地文件、远程 shadow path 和沙箱内容统一走预览路由。", "FS / FILE / INFO", "#F6C85F"],
      ["开发端口代理", "检测 localhost/LAN 地址并转成同源预览或公开 URL。", "PORT / PROXY", "#FF7C86"],
      ["Desktop + Web", "Electrobun IPC 与浏览器 WebSocket RPC 共用同一套能力契约。", "IPC / RPC", "#35E0B4"],
    ],
  },
];

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function textLines(lines, x, y, className, gap = 30) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * gap}" class="${className}">${esc(line)}</text>`).join("\n");
}

function wrapBody(text, maxWidth = 15) {
  const tokens = text.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/g) ?? [text];
  const lines = [];
  let line = "";
  let width = 0;
  for (const token of tokens) {
    if (/\s/.test(token)) {
      if (line && !line.endsWith(" ")) line += " ";
      continue;
    }
    const punctuation = /^[，。；：、！？）】》,.!?;:)]$/.test(token);
    const tokenWidth = /^[A-Za-z0-9]+$/.test(token) ? Math.max(1.5, token.length * 0.56) : 1;
    if (punctuation && line) {
      line += token;
      width += tokenWidth;
      continue;
    }
    if (punctuation && !line && lines.length) {
      lines[lines.length - 1] += token;
      continue;
    }
    if (line && width + tokenWidth > maxWidth) {
      lines.push(line.trim());
      line = "";
      width = 0;
    }
    line += token;
    width += tokenWidth;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 3);
}

function posterSvg(poster) {
  const cardW = 448;
  const cardH = 246;
  const left = 72;
  const right = 560;
  const top = 700;
  const rowGap = 270;
  const cards = poster.cards.map(([title, body, label, color], index) => {
    const x = index % 2 === 0 ? left : right;
    const y = top + Math.floor(index / 2) * rowGap;
    return `
      <g filter="url(#shadow)">
        <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="24" class="panel"/>
        <circle cx="${x + 48}" cy="${y + 54}" r="25" fill="${color}" fill-opacity=".18"/>
        <circle cx="${x + 48}" cy="${y + 54}" r="8" fill="${color}"/>
        <text x="${x + 92}" y="${y + 64}" class="sans white cardTitle">${esc(title)}</text>
        <text x="${x + 32}" y="${y + 120}" class="sans cardLabel" fill="${color}">${esc(label)}</text>
        ${textLines(wrapBody(body), x + 32, y + 170, "sans muted cardBody", 31)}
      </g>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" fill="none">
  <defs>
    <linearGradient id="bg" x1="70" y1="0" x2="1000" y2="1920" gradientUnits="userSpaceOnUse"><stop stop-color="#0B111B"/><stop offset="1" stop-color="#101B2A"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity="0.24"/></filter>
    <style>
      .sans { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Arial, sans-serif; }
      .white { fill: #F5FAFA; }
      .muted { fill: #9BAEAC; }
      .panel { fill: #142333; stroke: #29413F; stroke-width: 2; }
      .cardTitle { font-size: 29px; font-weight: 800; }
      .cardLabel { font-size: 19px; font-weight: 700; letter-spacing: 1.5px; }
      .cardBody { font-size: 21px; }
    </style>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="960" cy="112" r="260" fill="#172A39"/>
  <circle cx="70" cy="1800" r="300" fill="#122E34"/>
  <rect x="72" y="72" width="78" height="78" rx="21" fill="#0E1718" stroke="#35E0B4" stroke-width="3"/>
  <path d="M91 99h40M111 99v32M95 123c0 12 8 19 17 19 11 0 19-8 19-19" stroke="#F5FAFA" stroke-width="7" stroke-linecap="round"/>
  <path d="M87 137c27-5 43-24 57-42" stroke="#35E0B4" stroke-width="7" stroke-linecap="round"/>
  <text x="174" y="122" class="sans white" font-size="38" font-weight="700">Pi Agent Chat</text>
  <text x="72" y="218" class="sans" fill="#35E0B4" font-size="21" font-weight="700" letter-spacing="3">${esc(poster.kicker)}</text>
  ${textLines(poster.title, 72, 310, "sans white headline", 82)}
  <style>.headline { font-size: 68px; font-weight: 800; }</style>
  <rect x="72" y="430" width="936" height="4" rx="2" fill="#35E0B4"/>
  <text x="72" y="490" class="sans muted" font-size="28">${esc(poster.subtitle)}</text>
  <rect x="72" y="548" width="936" height="116" rx="24" fill="#101B28" stroke="#29413F" stroke-width="2"/>
  <circle cx="126" cy="606" r="18" fill="#35E0B4"/><circle cx="458" cy="606" r="18" fill="#58A6FF"/><circle cx="790" cy="606" r="18" fill="#F6C85F"/>
  <text x="126" y="614" text-anchor="middle" class="sans" fill="#071516" font-size="18" font-weight="800">1</text>
  <text x="458" y="614" text-anchor="middle" class="sans" fill="#071516" font-size="18" font-weight="800">2</text>
  <text x="790" y="614" text-anchor="middle" class="sans" fill="#071516" font-size="18" font-weight="800">3</text>
  <text x="164" y="600" class="sans white" font-size="25" font-weight="700">目标</text><text x="164" y="630" class="sans muted" font-size="20">Goal / context</text>
  <text x="496" y="600" class="sans white" font-size="25" font-weight="700">执行</text><text x="496" y="630" class="sans muted" font-size="20">Tools / timeline / runtime</text>
  <text x="828" y="600" class="sans white" font-size="25" font-weight="700">确认</text><text x="828" y="630" class="sans muted" font-size="20">Review / rollback</text>
  <path d="M340 606h62m-14-12 14 12-14 12M672 606h62m-14-12 14 12-14 12" stroke="#58A6FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ${cards}
  <rect x="72" y="1710" width="936" height="112" rx="24" fill="#0E1718" stroke="#35E0B4" stroke-width="2"/>
  <text x="108" y="1778" class="sans white" font-size="29" font-weight="700">${esc(poster.footer)}</text>
  <text x="72" y="1878" class="sans muted" font-size="21">Open source · desktop + web · local project control · AGPL-3.0</text>
</svg>`;
}

for (const poster of posters) {
  writeFileSync(join(outDir, `${poster.slug}.svg`), posterSvg(poster));
}

console.log(`Generated ${posters.length} feature poster SVGs in ${outDir}`);
