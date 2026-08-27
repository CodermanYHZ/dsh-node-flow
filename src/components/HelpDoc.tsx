/**
 * Usage / help + AI authoring guide for dsh-node-flow.
 *
 * @module components/HelpDoc
 */

import type { ReactNode } from 'react'

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wf-helpdoc__note">
      <strong>{title}：</strong>
      <span>{children}</span>
    </div>
  )
}

function Warn({ children }: { children: ReactNode }) {
  return <div className="wf-helpdoc__warn">⚠️ {children}</div>
}

function Code({ children }: { children: string }) {
  return <pre className="wf-helpdoc__code">{children}</pre>
}

function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th key={i}>{c}</th>
        ))}
      </tr>
    </thead>
  )
}

export function HelpDoc({ onClose }: { onClose: () => void }) {
  return (
    <div className="wf-helpdoc" role="dialog" aria-modal="true" aria-label="生成工作流指南">
      <div className="wf-helpdoc__head">
        <div className="wf-helpdoc__title">工作流生成指南（给 AI / 使用者）</div>
        <button className="wf-helpdoc__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="wf-helpdoc__body">
        {/* ---------- 0 快速认识 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>0. 快速认识</h2>
          <p>
            这是一个 <strong>n8n 风格的可视化工作流画布</strong>。工作流 = <b>一批节点</b> + <b>一批连线</b>。数据沿着连线流动：每个节点读取上游结果（变量{' '}
            <code>result</code>）、处理、把结果交给下游。画布手动点 <b>▶ 运行</b> 走「图遍历」；定时任务走宿主的图遍历执行器（行为一致）。
          </p>
          <Note title="给 AI">
            你能直接生成一个 JSON 工作流文档（下面数据结构），或按本文逐节点属性把用户要的流程拼出来。所有 <code>sourceHandle</code>/{' '}
            <code>targetHandle</code> 必须用文档里给的<b>精确字符串</b>，否则连线不生效。
          </Note>
        </section>

        {/* ---------- 1 数据结构 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>1. 工作流数据结构（JSON）</h2>
          <p>一份文档包含 <code>version</code>、<code>name</code>、<code>nodes[]</code>、<code>edges[]</code>。</p>
          <Code>{`{
  "version": 1,
  "name": "我的工作流",
  "description": "可选",
  "nodes": [
    { "id": "t1", "type": "workflow", "position": { "x": 40, "y": 200 },
      "data": { "kind": "trigger", "label": "入口", "text": "任务内容" },
      "style": { "width": 124, "height": 124 } }
  ],
  "edges": [ { "id": "e1", "source": "t1", "target": "c1" } ]
}`}</Code>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '说明']} />
            <tbody>
              <tr><td><code>version</code></td><td>固定为 <code>1</code>。</td></tr>
              <tr><td><code>name</code></td><td>工作流名，会显示在顶部和定时任务里。</td></tr>
              <tr><td><code>nodes[]</code></td><td>节点数组，每个见下方「节点结构」。</td></tr>
              <tr><td><code>edges[]</code></td><td>连线数组，见「连线规则」。</td></tr>
            </tbody>
          </table>
          <h3>节点结构</h3>
          <Code>{`{
  "id": "唯一id",              // 必须唯一，line/edges 靠它引用
  "type": "workflow",          // 固定
  "position": { "x": 0, "y": 0 },  // 画布坐标，x 越大越靠右
  "data": { "kind": "触发器", "label": "显示名", ... },
  "style": { "width": 124, "height": 124 }  // 按类型对应尺寸
}`}</Code>
          <Warn>
            文档不需要 <code>selected</code> / <code>measured</code> 这些 React Flow 运行时字段，生成了也无妨，但<b>省略即可</b>。<code>style</code> 的宽高按下方「节点尺寸」给，否则连接点会偏。
          </Warn>
          <h3>节点尺寸（style.width/height）</h3>
          <Code>{`trigger/schedule/code/output: 124×124
agent: 212×128
if/switch/loop/while: 132×132
note: 168×120`}</Code>
        </section>

        {/* ---------- 2 通用 data 字段 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>2. 通用 <code>data</code> 字段</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '类型', '必填', '作用 / 怎么填']} />
            <tbody>
              <tr><td><code>kind</code></td><td>string</td><td>是</td><td>节点类型，见下。决定这个节点干什么。</td></tr>
              <tr><td><code>label</code></td><td>string</td><td>是</td><td>画布上显示的名字，填一句话。</td></tr>
              <tr><td><code>model</code></td><td>string</td><td>否</td><td>仅 agent：<code>"provider|modelId"</code>，空/缺省 = 沿用当前会话模型。</td></tr>
              <tr><td><code>timeout</code></td><td>string(秒)</td><td>否</td><td>仅 code/agent：超时秒数，如 <code>"30"</code>；缺省=不限制。</td></tr>
              <tr><td><code>onError</code></td><td>string</td><td>否</td><td>仅 code/agent：<code>"stop"</code>(默认, 失败=断开后续) / <code>"continue"</code>(失败=往下传空值)。</td></tr>
              <tr><td><code>notes</code></td><td>string</td><td>否</td><td>备注，不参与执行。</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- 3 节点详解 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>3. 每类节点详解（属性怎么填）</h2>

          <h3>3.1 触发器 trigger</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>text</code></td><td>流程入口内容，会作为下游第一个节点的输入。</td><td><code>"请总结AI热点"</code></td></tr>
            </tbody>
          </table>
          <p>只有一个右侧输出口，连到下一个节点的左侧输入口。</p>

          <h3>3.2 定时触发 schedule</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>cron</code></td><td>5 段 cron（分 时 日 月 周），到点由宿主后台执行整条流程。</td><td><code>"30 8 * * *"</code> = 每天08:30</td></tr>
              <tr><td><code>timezone</code></td><td>IANA 时区，预留（当前按宿主本地时区匹配）。</td><td><code>"Asia/Shanghai"</code></td></tr>
              <tr><td><code>text</code></td><td>任务文字，作为流程输入（可选）。</td><td><code>"抓取新闻"</code></td></tr>
            </tbody>
          </table>
          <p>用户点「保存定时」后到「定时任务」看板管理。cron 校验：<code>分0-59 时0-23 日1-31 月1-12 周0-6</code>。</p>

          <h3>3.3 Agent agent</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>prompt</code></td><td>发给子代理的 system prompt，会拼在「上游输入」之后一起发。</td><td><code>"请总结成一句话"</code></td></tr>
              <tr><td><code>model</code></td><td>模型路由 <code>provider|modelId</code>；缺省=继承。</td><td><code>"deepseek-official|deepseek-chat"</code></td></tr>
              <tr><td><code>timeout</code>/<code>onError</code></td><td>同通用字段。</td><td><code>"60"</code> / <code>"stop"</code></td></tr>
            </tbody>
          </table>
          <Note title="模型从哪来">
            模型下拉数据来自宿主 <code>/models</code>（<code>ctx.llm</code>）。让 AI 别硬编码模型名；要么留空继承、要么用真实存在的 <code>provider|modelId</code>。
          </Note>
          <Note title="子代理能力与记忆">
            Agent 节点会启动一个 <b>真实的 DSH 子代理</b>，它拥有<b>你在 DSH 里的全部能力</b>（各种工具、联网、web 搜索、文件操作等），并继承当前工作区/上下文。
            但注意：<b>子代理不带父代理的对话记忆/上下文</b>——每次只拿到「上游输入 + 你填的 system prompt」。如果需要带上下文/记忆，让 AI 用 <b>code 节点</b> 把关键信息拼进输入传给子代理即可（code 节点什么都能做）。
          </Note>

          <h3>3.4 代码执行 code</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>language</code></td><td>类型 <code>"typescript"</code>(默认) 或 <code>"python"</code>。</td><td><code>"python"</code></td></tr>
              <tr><td><code>code</code></td><td>源码。TypeScript 用 <code>return</code> 返回结果；Python 用 <code>print</code> 输出结果。</td><td>见下</td></tr>
              <tr><td><code>timeout</code>/<code>onError</code></td><td>同通用字段。</td><td><code>"30"</code> / <code>"continue"</code></td></tr>
            </tbody>
          </table>
          <Code>{`// TypeScript：读上游输入
const it = await dsh.input(null)      // 注意必须传参数，写 null
return JSON.stringify({ item: it })`}</Code>
          <Code>{`# Python：读上游输入（环境变量）
import os
s = os.environ.get('DSH_INPUT', '')
print('got:', s)`}</Code>
          <Warn>
            <code>dsh.input()</code> 不带参数会报「binding arguments must be lossless JSON」，<b>必须写</b>{' '}
            <code>await dsh.input(null)</code>。Python 结果通过 stdout 返回；TypeScript 通过 <code>return</code> 返回。
          </Warn>

          <h3>3.5 输出 output</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>template</code></td><td>展示模板。用 <code>{'{{result}}'}</code> 引用上游结果；留空=直接显示结果。</td><td><code>"结果: {'{{result}}'}"</code></td></tr>
            </tbody>
          </table>

          <h3>3.6 If if（布尔分流）</h3>
          <p><code>condition</code> 是一个<b>布尔表达式</b>，变量 <code>result</code> = 上游输出。为真走 <code>true</code> 口，为假走 <code>false</code> 口。</p>
          <Note title="为什么表达式要这么写">
            <code>result</code> <b>永远是字符串</b>（上游节点的输出被序列化成文本）。所以要比较数字得先 <code>Number()</code>，要读 JSON 字段得先 <code>JSON.parse()</code>，要判断文本直接用字符串方法。
          </Note>
          <p>常见四种写法（按上游 result 的类型选）：</p>
          <Code>{`// 上游是数字字符串，如 "15" → 用 Number()
Number(result) > 10            // true

// 上游是 JSON 对象字符串，如 {"n":15} → 先 parse 再取字段
Number(JSON.parse(result).n) > 10

// 上游是 agent 输出的一段文本 → 直接字符串方法
result.includes("AI")          // 判断文本里是否含 "AI"

// 上游是 JSON，想按取值精确判断
JSON.parse(result).code === 0  // 天气 code 是否为 0（晴）`}</Code>
          <table className="wf-helpdoc__table">
            <THead cols={['上游 result', '推荐 condition', '为什么']} />
            <tbody>
              <tr><td><code>"15"</code></td><td><code>Number(result) &gt; 10</code></td><td>字符串不能直接比较大小，先转数字。</td></tr>
              <tr><td><code>{'{"n":15}'}</code></td><td><code>Number(JSON.parse(result).n) &gt; 10</code></td><td>先解析成对象，再取字段。</td></tr>
              <tr><td><code>"AI 又升级了"</code></td><td><code>result.includes("AI")</code></td><td>文本判断，直接用字符串方法。</td></tr>
              <tr><td><code>{'{"code":0}'}</code></td><td><code>JSON.parse(result).code === 0</code></td><td>取值做精确比较。</td></tr>
            </tbody>
          </table>
          <p>输出口：<code>true</code>（上）/ <code>false</code>（下）。表达式必须返回布尔值。</p>

          <h3>3.7 Switch switch（多路分流）</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>condition</code></td><td>取值表达式，<code>result</code> = 上游输出，其值用于匹配 case。</td><td><code>result</code></td></tr>
              <tr><td><code>cases</code></td><td>逗号分隔的 case 值，每个对应一个输出口。</td><td><code>"morning, afternoon, evening"</code></td></tr>
            </tbody>
          </table>
          <p>输出口：每个 case + 一个 <code>default</code>（兜底）。不匹配任何 case 走 <code>default</code>。</p>
          <Warn>
            case 是<b>全等字符串</b>比较：switch 会把 <code>condition</code> 算出来的值 <code>String()</code> 后与 case 逐一全等。所以上游值必须和 case 完全一致（如 <code>morning</code> 不能是 <code>Morning</code>）。
          </Warn>

          <h3>3.8 Loop loop（遍历 / 重复）</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>mode</code></td><td><code>"items"</code>(默认, 遍历数组) 或 <code>"count"</code>(固定次数)。</td><td><code>"items"</code></td></tr>
              <tr><td><code>itemsExpr</code></td><td>mode=items 时，从 <code>result</code> 求数组的表达式。</td><td><code>JSON.parse(result)</code></td></tr>
              <tr><td><code>count</code></td><td>mode=count 时的次数（字符串）。</td><td><code>"5"</code></td></tr>
              <tr><td><code>maxIters</code></td><td>硬上限，默认 100，防死循环。</td><td><code>"100"</code></td></tr>
              <tr><td><code>collect</code></td><td>布尔。开=把每轮结果收集成数组交给 <code>done</code>；关=只留最后一轮。</td><td>true</td></tr>
            </tbody>
          </table>
          <p>
            端口：<b>iterate</b>（进 body）、<b>done</b>（全部跑完接后续）、左侧 <b>in</b>（首次进入）、<b>back</b>（body 尾端连回，供迭代回流）。
          </p>
          <Warn>
            loop 只对 <b>body 子图</b>（从 <code>iterate</code> 出发、直到连回 <code>back</code> 的那段）重复执行。把 body 最后一个节点连回 loop 的 <code>back</code> 口，结果才算「本轮返回值」；不连回则会用 body 最后一个节点的输出作为本轮结果。
          </Warn>

          <h3>3.9 While while（条件循环）</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用', '示例']} />
            <tbody>
              <tr><td><code>condition</code></td><td>每轮开始判断，<code>result</code> = 当前累积值；为真继续，为假结束。</td><td><code>result !== "完成"</code></td></tr>
              <tr><td><code>maxIters</code></td><td>硬上限，默认 100。</td><td><code>"100"</code></td></tr>
              <tr><td><code>collect</code></td><td>布尔。开=收集每轮结果成数组。</td><td>true</td></tr>
            </tbody>
          </table>
          <Note title="条件别用数字">
            用字符串/内容判断更稳（如 <code>result !== "完成"</code>）。body 每次改变 <code>result</code>，直到条件为假。
          </Note>

          <h3>3.10 备注 note</h3>
          <p>纯注释（<code>text</code> 字段），<b>没有连接口</b>，不参与执行。仅 <code>kind:'note'</code> 用 <code>text</code> 存内容，尺寸 168×120。</p>

        </section>

        {/* ---------- 4 连线规则 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>4. 连线规则（source / target + handle）</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['源节点', 'sourceHandle', 'targetHandle', '说明']} />
            <tbody>
              <tr><td>trigger/schedule/code/agent/output/note</td><td>（无）</td><td>（无）</td><td>普通单进单出，直接 source→target。</td></tr>
              <tr><td>if</td><td><code>"true"</code> 或 <code>"false"</code></td><td>（无）</td><td>按布尔走一路。</td></tr>
              <tr><td>switch</td><td>case 值 或 <code>"default"</code></td><td>（无）</td><td>按值匹配。</td></tr>
              <tr><td>loop / while</td><td><code>"iterate"</code> 或 <code>"done"</code></td><td><code>"in"</code>(首次进入) 或 <code>"back"</code>(body回流)</td><td>见循环端口说明。</td></tr>
            </tbody>
          </table>
          <Code>{`// 普通连线
{ "id": "e1", "source": "t1", "target": "c1" }
// if 的 true 分支
{ "id": "e2", "source": "i1", "target": "a1", "sourceHandle": "true" }
// loop: 进 body / body 回流 / 跑完接后续
{ "id": "e3", "source": "l1", "target": "b1", "sourceHandle": "iterate" }
{ "id": "e4", "source": "b1", "target": "l1", "targetHandle": "back" }
{ "id": "e5", "source": "l1", "target": "o1", "sourceHandle": "done" }`}</Code>
        </section>

        {/* ---------- 5 result 语义 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>5. result 变量与数据流</h2>
          <p>每个节点接收上游输出，那个值在表达式里叫 <code>result</code>：</p>
          <ul>
            <li>if/switch 的条件、loop 的 <code>itemsExpr</code>、while 的条件都读 <code>result</code>。</li>
            <li>上游是 JSON 对象字符串 → 用 <code>JSON.parse(result)</code>；是数字字符串 → <code>Number(result)</code>；是普通文本 → 直接字符串操作。</li>
            <li>代码节点读输入：TS <code>await dsh.input(null)</code>；Python <code>os.environ.get('DSH_INPUT')</code>。输出（TS return / Python print）会成为下游的 <code>result</code>。</li>
          </ul>
        </section>

        {/* ---------- 6 坑点清单 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>6. 坑点清单（务必遵守）</h2>
          <ol>
            <li><b>连线 handle 字符串必须精确</b>：if 用 <code>true/false</code>，switch 用 case 或 <code>default</code>，loop/while 用 <code>iterate/done</code> + <code>in/back</code>。</li>
            <li><b>代码读输入必须传参</b>：<code>await dsh.input(null)</code>，否则运行时抛错。</li>
            <li><b>switch 是字符串全等</b>，case 必须和上游值完全一致。</li>
            <li><b>loop/while 一定要设 <code>maxIters</code></b>（默认 100），否则可能死循环。</li>
            <li><b>agent/code 默认失败即停</b>。若希望失败也继续，设 <code>onError:"continue"</code>。</li>
            <li><b>model 别乱填</b>：格式 <code>provider|modelId</code>，留空 = 继承；否则用真实存在于 <code>/models</code> 的。</li>
            <li><b>节点 id 唯一</b>，边引用要一致；<code>type:"workflow"</code> 固定。</li>
            <li><b>定时任务</b>：存的是你保存那一刻的<b>工作流快照</b>（含分支/循环，宿主导入执行）；按<b>宿主本地时区</b>匹配；<b>宿主进程需存活</b>；<b>错过不补跑</b>。</li>
            <li><b>备注 note 无连接口</b>，别给它连线。</li>
            <li><b>Agent 需宿主有活父 agent</b> 才能委派，否则该步骤失败。</li>
          </ol>
        </section>

        {/* ---------- 7 完整示例 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>7. 完整可复制示例（AI 可照此生成）</h2>
          <p>「定时抓 AI 热点 → 总结 → 输出」（含定时、Python 代码、Agent、输出）：</p>
          <Code>{`{
  "version": 1,
  "name": "定时AI热点简报",
  "nodes": [
    { "id": "s1", "type": "workflow", "position": { "x": 20, "y": 200 },
      "data": { "kind": "schedule", "label": "每日定时", "cron": "30 8 * * *", "text": "抓取今日AI热点并总结" },
      "style": { "width": 124, "height": 124 } },
    { "id": "c1", "type": "workflow", "position": { "x": 220, "y": 200 },
      "data": { "kind": "code", "label": "拉取热点", "language": "python",
        "code": "import json, urllib.request\\nreq = urllib.request.Request('https://aihot.virxact.com/api/v1/items?mode=selected&window=7d&limit=5', headers={'User-Agent':'aihot-skill/1.5.4'})\\nwith urllib.request.urlopen(req, timeout=20) as r:\\n    data = json.load(r)\\nprint('\\\\n'.join((it.get('title','') + ' ' + it.get('summary','')) for it in (data.get('items') or [])))",
        "timeout": "30" },
      "style": { "width": 124, "height": 124 } },
    { "id": "a1", "type": "workflow", "position": { "x": 440, "y": 200 },
      "data": { "kind": "agent", "label": "总结", "prompt": "把下面AI热点整理成简洁中文简报，按重要度排序" },
      "style": { "width": 212, "height": 128 } },
    { "id": "o1", "type": "workflow", "position": { "x": 720, "y": 200 },
      "data": { "kind": "output", "label": "简报", "template": "{{result}}" },
      "style": { "width": 124, "height": 124 } }
  ],
  "edges": [
    { "id": "e1", "source": "s1", "target": "c1" },
    { "id": "e2", "source": "c1", "target": "a1" },
    { "id": "e3", "source": "a1", "target": "o1" }
  ]
}`}</Code>
        </section>
      </div>
    </div>
  )
}
