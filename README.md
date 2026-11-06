# Multi Input MCP

一个 AI 决策端，多个输入执行通道。包含真正可调用的 MCP 服务、浏览器执行器、本地协作文档编辑器、配套 Skill，以及可录屏重放的演示。

## 已实现的行为

| 场景 | 实现 | 如何验证 |
|---|---|---|
| 一个表单的十道题 | 一次 `form_patch` 定向选择十个选项 | 读取真实浏览器 DOM 的 checked 值 |
| 十个文本输入框 | 一次 `form_patch` 设置十个值，并触发 input/change | 回读每个输入框实际值 |
| 多页面并行键盘输入 | 独立 Playwright BrowserContext 和 Page，各自执行 `pressSequentially` | 起止时间重叠；三个页面的文字分别正确 |
| 同一文档多位置同时插入 | 每个光标持有排他行锁、Yjs 相对位置锚点、独立 Y.Doc 副本 | 最终全文精确匹配；前面插入换行后，后面位置不漂移 |
| AI 自选通道数量 | `workspace_observe` 返回容量；AI 提交任意有效批次和 `parallelism` | 当前上限 10；演示分别采用 4、1、3 路 |
| 本地文档文件 | `document_open` / `document_save` 支持 `.txt` 和 `.md` | 保存后读取文件，验证字节内容一致 |

这里的“并发”指独立任务执行时间重叠。页面 JavaScript 事件和 Yjs 事务仍有应用顺序。一个表单的批量操作不是十个操作系统鼠标；界面中的十个标记显示十个目标。

## 架构

```text
当前 Codex（唯一的模型决策端）
       │ MCP / stdio
       ▼
src/mcp-server.mjs —— 工具定义、参数校验、服务 instructions
       │ loopback HTTP
       ▼
src/service.mjs —— 状态、工具路由、文件读写、实时预览
       ├── scheduler.mjs —— 资源队列、并发上限、依赖、取消
       ├── browser.mjs —— Playwright、批量 DOM 操作、逐字输入
       └── documents.mjs —— Yjs 副本、相对锚点、行锁、合并
```

执行器内部不调用任何模型，也不需要额外模型 API Key。Skill 指导当前 AI 如何观察、拆分任务、选择数量、验证和继续。`parallelism: "auto"` 仅计算独立执行资源数量和上限，不具备任务语义判断能力。

同页普通鼠标/键盘动作串行；不同页面并发；同一文档不同光标锁并发。不同批次之间也共用资源锁和全局并发上限。同一光标只能有一个活动写入者。

## 安装

需要 Node.js 20 或更新版本，以及 Chromium。首次使用：

```bash
npm ci
npx playwright install chromium
npm run install:codex
```

安装脚本通过官方 `codex mcp add` 注册 `multi-input`，并把配套 Skill 复制到 Codex skills 目录；不会覆盖不同内容的同名配置或 Skill。需要安装了 Codex CLI，且它位于 PATH。

**开始新的 Codex 聊天/会话后，工具和 Skill 才能被发现。** 当前聊天通过独立 MCP 客户端完成协议测试，不代表原生工具目录可以热加载。

本地运行时会在第一次工具调用时自动启动。默认端口 `43187`，仅监听 `127.0.0.1`。演示工作台：

```text
http://127.0.0.1:43187/
```

也可以单独运行 `npm start`。界面中的表单/多页面面板是只读实时观察视图，实际输入发生在执行器管理的独立浏览器页面；文档面板直接显示合并后的共享文档和真实锚点。

## 在 Codex 中使用

新聊天可以这样要求：

> 使用 $multi-input。观察工作区，根据任务自行选择并发数量。在同一文档的不同段落插入内容，批量填写表单，完成后回读验证并保存。

工具：

| 工具 | 作用 |
|---|---|
| `workspace_observe` | 获取页面元素 refs、文档行、光标、容量、任务状态 |
| `page_open` | 打开独立浏览器上下文 |
| `document_create` | 创建新的内存文档 |
| `document_open` | 从配置的文档目录读取 `.txt` / `.md` |
| `document_save` | 保存并回读验证文件 |
| `cursor_lock` | 一次锁定多个不重叠的行，并创建稳定光标锚点 |
| `cursor_release` | 释放已停止写入的光标锁 |
| `execute_batch` | 提交动作、依赖和期望并发数，返回任务编号 |
| `job_status` | 查询实际结果、每项起止时间和峰值并发 |
| `job_cancel` | 取消排队任务和文档逐字输入 |

示例：先观察文档，再锁定两个实际存在的行。

```json
{
  "document_id": "notes",
  "cursors": [
    {"id": "A", "line": 5},
    {"id": "B", "line": 8}
  ]
}
```

然后调用 `execute_batch`：

```json
{
  "parallelism": 2,
  "actions": [
    {"id": "a", "op": "document_insert", "document_id": "notes", "cursor_id": "A", "text": "第一处新增内容"},
    {"id": "b", "op": "document_insert", "document_id": "notes", "cursor_id": "B", "text": "第二处新增内容"}
  ]
}
```

不必创建固定数量的操作系统光标。AI 根据任务选择锁定几个位置；调度器根据独立资源和容量安排执行。

## 验证与录屏

### 白底文档 / 工作表短片

新增 `/film` 白底文档场景，以及 `/sheet` 工作表场景。它们是 Word / Google Sheets 风格的本地可交互演示页面，底层仍由同一 MCP 执行实际修改，没有接入这两个产品的账号或编辑 API。

新版 `form_patch` 支持 `fill`、`set_checked`、`select_option`。后者接受下拉值字符串，或原生多选框的值数组；页面观察会返回可用 options 和已选值。一次示例批次完成 6 条记录、54 个目标：文本、单选、多选勾选、下拉、日期、数字。

当需要自然错峰时，一次提交完整批次，并为独立目标设置不同的 `start_ms`；文本目标可设置 `typing_ms`，下拉预览可设置 `preview_ms`。文档动作则支持 `start_ms` 和 `pace_ms`。这些参数调整实际写入时间，任务仍在同一批次内重叠推进，而不是逐项等待模型重新决策。

```bash
npm run test:mixed
npm run capture:film -- .runtime/white-film
npm run film:cards -- .runtime/white-film
python3 scripts/edit-film.py .runtime/white-film music.wav final.mp4
```

`capture:film` 会清空本服务自己的演示状态，然后通过真实 MCP 客户端录制 4K 素材；`edit-film.py` 将它剪成 28 秒、1080p / 30 fps 的配乐版本，包含 13 个镜头、推近、横向聚焦和字幕。配乐文件由调用者提供；脚本默认使用开头 28 秒并在结尾淡出。字幕默认使用 macOS 黑体字体，在其他平台需调整字体路径。

### 原始工作台演示

```bash
npm test
npm run test:e2e
npm run demo
```

`test:e2e` 和 `demo` 会清空这个服务自己的演示工作区，不会清理外部文件。演示默认写入 `demo-results/`：录屏 WebM、截图、工具调用记录、计划说明、验证结果和最终 Markdown 文档。

演示是**本次 Codex 根据观察编排的计划，通过真实 MCP stdio 客户端执行的可重放示例**。它没有把脚本冒充另一个实时思考的 AI。新任务的动态规划由接入工具后的 Codex 完成；这个重放脚本本身不调用模型。

录屏展示真实状态变化，没有以 CSS 动画伪造输入。为便于看清多路同时输入，演示使用 `pace_ms: 140` 放慢逐字输入；它不是效率基准。表单仍按实际批量执行速度完成。

可以用独立客户端直接检查协议：

```bash
npm run call -- tools/list
npm run call -- workspace_observe '{"page_ids":[]}'
```

测试覆盖：并发锚点漂移、中文/emoji、重叠锁拒绝、同资源跨任务互斥、依赖环、失败依赖跳过、取消保留已执行内容、失效表单引用、真实 DOM 回读、多页面键盘输入重叠、保存再打开。

## 配置与边界

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `MULTI_INPUT_PORT` | `43187` | 本地服务端口 |
| `MULTI_INPUT_URL` | 自动使用本地端口 | 连接已经运行的服务；此模式不自动启动服务 |
| `MULTI_INPUT_HEADLESS` | `1` | 设为 `0` 可显示执行器 Chromium 窗口 |
| `MULTI_INPUT_DOCUMENT_ROOT` | 项目下 `documents/` | `.txt` / `.md` 文件的读写目录 |

文档列偏移使用 UTF-16，与 JavaScript 字符串一致；省略 column 表示行末。演示按 Unicode 字素切分逐字写入，避免把 emoji 的代理对拆开显示。

文档尚未保存的内容在服务退出后丢失。批次不提供事务回滚；取消或失败会保留已执行的修改。正在运行的浏览器动作可能在取消后完成。一次 click 只证明事件已发出，应重新观察应用结果。

`form_patch` 使用合成 DOM 事件，适合普通 HTML 表单；特定框架或要求可信输入事件的网站可能需要改用普通 Playwright 操作或专用适配器。

**同一文档多光标能力目前针对内置协作编辑器。没有适配 Word、Google Docs、任意 Canvas 编辑器，也没有改变现有 UIT/电脑操作插件的内部实现。** 现有插件的页面引用不能直接传给本服务；本服务维护自己的浏览器和元素引用。

## 核心依据

- MCP SDK：https://github.com/modelcontextprotocol/typescript-sdk
- Codex MCP：https://learn.chatgpt.com/docs/extend/mcp
- Playwright：https://playwright.dev/docs/browser-contexts
- Yjs：https://github.com/yjs/yjs

依赖版本固定在 `package-lock.json`，便于复现本次验证。
