/**
 * Usage / help + AI authoring guide for dsh-node-flow.
 *
 * Mounted through `overlayHost()` like the other page windows, so it covers the
 * node-mode page rather than the whole application window.
 *
 * Keep this document in step with the implementation: `/run` and `/run-agent`
 * are the only host routes a node calls, scheduled and listened runs walk the
 * same graph as the toolbar's Run, and every execution is stored as a run file.
 *
 * @module components/HelpDoc
 */

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { overlayHost } from './overlayHost.js'

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
  return createPortal(
    <div className="wf-helpdoc" role="dialog" aria-label="工作流使用指南">
      <div className="wf-helpdoc__head">
        <div className="wf-helpdoc__title">工作流使用指南</div>
        <button className="wf-helpdoc__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="wf-helpdoc__body">
        {/* ---------- 1 这是什么 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>1. 这是什么</h2>
          <p>
            「节点模式」是 DSH 里的一页画布（注册在宿主主页面的 <code>main</code> 槽），不是浮层。一张工作流 ={' '}
            <b>一批节点</b> + <b>一批连线</b>：每个节点读上游结果（表达式里叫 <code>result</code>），处理完再交给下游。
          </p>
          <p>同一张图有两种执行入口，规则完全一致：</p>
          <table className="wf-helpdoc__table">
            <THead cols={['入口', '谁在跑', '用什么触发']} />
            <tbody>
              <tr>
                <td>手动运行</td>
                <td>浏览器里的画布逐节点驱动，代码/Agent 节点调宿主路由</td>
                <td>顶栏 <b>▶ 运行</b></td>
              </tr>
              <tr>
                <td>定时 / 监听</td>
                <td>宿主后台跑同一张图，无需打开画布</td>
                <td><b>定时触发</b> 节点（cron）或 <b>监听</b> 节点（常驻进程）</td>
              </tr>
            </tbody>
          </table>
          <h3>数据放在哪</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['路径（相对 workflow-canvas/）', '内容']} />
            <tbody>
              <tr><td><code>workflows/&lt;id&gt;.json</code></td><td>工作流文档，一次保存一份</td></tr>
              <tr><td><code>runs/</code></td><td>每次运行一份记录（手动 / 定时 / 监听）</td></tr>
              <tr><td><code>schedules.json</code></td><td>定时任务，含保存那一刻的工作流快照</td></tr>
              <tr><td><code>listeners.json</code></td><td>监听进程状态与最近事件</td></tr>
              <tr><td><code>requests.json</code></td><td>最近 20 次路由判定（排查 401/403 用）</td></tr>
              <tr><td><code>health.json</code></td><td>能力自检报告</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- 2 界面速览 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>2. 界面速览</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['位置', '控件', '作用']} />
            <tbody>
              <tr><td>侧栏</td><td>节点模式</td><td>打开画布页；再点会话即回到对话</td></tr>
              <tr><td>顶栏左</td><td>工作流名 / 执行工作区</td><td>重命名；选择 Agent 节点在哪个工作区里执行</td></tr>
              <tr><td>顶栏右</td><td>📖 使用文档</td><td>本文档</td></tr>
              <tr><td>顶栏右</td><td>保存 / 导入 / 导出</td><td>存到 <code>workflows/</code>；导入或导出单个 <code>.workflow.json</code></td></tr>
              <tr><td>顶栏右</td><td>定时/监听</td><td>定时任务板与监听板</td></tr>
              <tr><td>顶栏右</td><td>▶ 运行 / 退出节点模式</td><td>手动跑一遍；回到对话</td></tr>
              <tr><td>画布左下</td><td>➕ 添加节点 / 📂 工作流</td><td>节点面板；工作流库（可点、可拖到画布）</td></tr>
              <tr><td>画布右侧</td><td>检查器</td><td>选中节点后在这里改属性</td></tr>
            </tbody>
          </table>
          <p>
            运行结束后节点边框会变色（绿=成功、红=失败、蓝=进行中），节点上显示耗时与时间；点「定时/监听」里的某次运行可以回放，
            画布顶部会出现「返回编辑」浮条。
          </p>
          <Note title="删除">
            选中节点/连线后按 <code>Delete</code> 或 <code>Backspace</code> 删除；在输入框里打字时不会误删。
          </Note>
        </section>

        {/* ---------- 3 执行模型 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>3. 执行模型（先看这一节）</h2>

          <h3>3.1 手动运行：浏览器逐节点驱动</h3>
          <ul>
            <li>起点是所有 <b>触发器 / 定时触发 / 监听</b> 节点；一个都没有时从全部节点开始。</li>
            <li>单次遍历，每个节点在一次运行里只进一次；循环体内每轮用独立的访问记录，所以 body 每轮都会真跑。</li>
            <li>步骤上限 <b>100000</b> 步，超过会报「可能死循环」并中断。</li>
            <li>代码节点调 <code>POST /dsh-node-flow/run</code>，Agent 节点调 <code>POST /dsh-node-flow/run-agent</code>；分支、循环、输出在浏览器内求值。</li>
            <li>节点失败默认<b>切断这条分支</b>（下游不跑）；<code>onError:"continue"</code> 时把空串继续往下传。</li>
            <li><code>retries</code> 只重试<b>本节点自己</b>的失败，不重试下游报错，也不重试步数守卫。</li>
            <li>运行结束会写一条运行记录，所以手动运行也能在「定时/监听」里回放。</li>
          </ul>

          <h3>3.2 定时运行：宿主后台跑快照</h3>
          <ul>
            <li>到达 <code>nextFireAt</code> 时，宿主执行<b>保存这个定时任务那一刻的工作流快照</b>（<code>schedules.json</code> 里的 <code>doc</code>），不是磁盘上的最新文件。</li>
            <li>先推进锚点再执行：崩在运行中途只损失那一次，不会无限重放。</li>
            <li>进程睡眠/关机错过多次触发时，恢复后<b>只补一次</b>（锚点直接跳到下一个未来时间）。</li>
            <li>同一个定时任务上一次还没跑完时，这一次<b>直接跳过</b>，不会叠跑。</li>
            <li>Agent 节点用文档里记的执行工作区（缺省用最近用过的）创建或复用运行会话。</li>
          </ul>

          <h3>3.3 监听运行：常驻进程，一行一个事件</h3>
          <ul>
            <li>监听节点的 Python 脚本由宿主常驻运行；<b>stdout 每一行 = 一个事件</b>，每个事件完整跑一遍流程。</li>
            <li>以 <code>[ready]</code> 开头的行只记状态，不触发。</li>
            <li><code>minIntervalMs</code>（默认 500，最大 60000）内的连续事件<b>合并成最新一条</b>；队列最多 5 条，超出丢最旧的并记 <code>droppedCount</code>。</li>
            <li>事件严格串行：上一次没跑完不会开下一次。</li>
            <li>必须先保存工作流，才能在「定时/监听」里启动；进程退出会变成 error 并停止。</li>
          </ul>
        </section>

        {/* ---------- 4 文档结构 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>4. 工作流文档（JSON）</h2>
          <p>保存到 <code>workflows/&lt;id&gt;.json</code> 的内容，也是「导出」下载的格式：</p>
          <Code>{`{
  "version": 1,
  "name": "我的工作流",
  "description": "可选",
  "executionWorkspaceId": "可选，Agent 节点的执行工作区",
  "executionWorkspaceTitle": "可选，仅用于显示",
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
              <tr><td><code>version</code></td><td>固定 <code>1</code>。</td></tr>
              <tr><td><code>name</code></td><td>工作流名；保存时宿主的同名去重会把它改成 <code>X (2)</code> 这类。</td></tr>
              <tr><td><code>nodes[]</code> / <code>edges[]</code></td><td>节点与连线，见下。</td></tr>
              <tr><td><code>executionWorkspaceId</code></td><td>可选。定时/监听运行时 Agent 节点用哪个工作区。</td></tr>
            </tbody>
          </table>

          <h3>节点结构</h3>
          <Code>{`{
  "id": "唯一 id",                 // 必须唯一，连线靠它引用
  "type": "workflow",              // 固定
  "position": { "x": 0, "y": 0 },  // 画布坐标，x 向右、y 向下
  "data": { "kind": "code", "label": "显示名", ... },
  "style": { "width": 124, "height": 124 }  // 必须与下面尺寸一致
}`}</Code>
          <Warn>
            导入时不会自动修正尺寸（<code>style</code> 原样生效），尺寸不对连接点就会偏。文档里不需要
            <code>selected</code> / <code>measured</code> / <code>lastRun</code> / <code>updatedAt</code>，写了也无害。
          </Warn>
          <h3>节点尺寸（style.width / height）</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['节点', '尺寸']} />
            <tbody>
              <tr><td>trigger / schedule / listen / code / output</td><td><code>124 × 124</code></td></tr>
              <tr><td>agent</td><td><code>212 × 128</code></td></tr>
              <tr><td>if / switch / loop / while</td><td><code>132 × 132</code></td></tr>
              <tr><td>note</td><td><code>168 × 120</code></td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- 5 data 字段总表 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>5. <code>data</code> 字段总表</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '适用', '说明']} />
            <tbody>
              <tr><td><code>kind</code></td><td>全部</td><td>节点类型，决定行为。</td></tr>
              <tr><td><code>label</code></td><td>全部</td><td>画布上的显示名。</td></tr>
              <tr><td><code>text</code></td><td>trigger / schedule / listen / note</td><td>流程输入文字；note 用它存正文。</td></tr>
              <tr><td><code>cron</code></td><td>schedule</td><td>5 段 cron，宿主本地时区。</td></tr>
              <tr><td><code>timezone</code></td><td>schedule</td><td>当前<b>仅存储、不生效</b>（按宿主本地时区触发）。</td></tr>
              <tr><td><code>code</code></td><td>code / listen</td><td>Python 源码。</td></tr>
              <tr><td><code>language</code></td><td>code</td><td>仅为兼容旧文档保留；<b>一律按 Python 执行</b>。</td></tr>
              <tr><td><code>minIntervalMs</code></td><td>listen</td><td>事件合并窗口，默认 <code>"500"</code>，上限 60000。</td></tr>
              <tr><td><code>prompt</code></td><td>agent</td><td>追加在上游输入后面的指令。</td></tr>
              <tr><td><code>model</code></td><td>agent</td><td><code>"provider|modelId"</code>；空 = 继承当前模型。</td></tr>
              <tr><td><code>condition</code></td><td>if / switch / while</td><td>JS 表达式，变量只有 <code>result</code>。</td></tr>
              <tr><td><code>cases</code></td><td>switch</td><td>逗号分隔的匹配值，每个对应一个输出口。</td></tr>
              <tr><td><code>mode</code></td><td>loop</td><td><code>"items"</code>（默认）或 <code>"count"</code>。</td></tr>
              <tr><td><code>itemsExpr</code></td><td>loop(items)</td><td>从 <code>result</code> 求数组的表达式。</td></tr>
              <tr><td><code>count</code></td><td>loop(count)</td><td>重复次数（字符串，从 1 开始生成）。</td></tr>
              <tr><td><code>maxIters</code></td><td>loop / while</td><td>迭代硬上限，默认 100。</td></tr>
              <tr><td><code>collect</code></td><td>loop / while</td><td>true = 把每轮结果收成 JSON 数组交给 <code>done</code>。</td></tr>
              <tr><td><code>template</code></td><td>output</td><td>展示模板，支持 <code>{'{{result}}'}</code>。</td></tr>
              <tr><td><code>timeout</code></td><td>code / agent</td><td>秒；留空不额外限制（code 另有 10 分钟硬上限）。</td></tr>
              <tr><td><code>onError</code></td><td>code / agent</td><td><code>"stop"</code>（默认，切断分支）/ <code>"continue"</code>（传空串继续）。</td></tr>
              <tr><td><code>retries</code></td><td>code / agent</td><td>失败后额外尝试次数，0–5。</td></tr>
              <tr><td><code>retryDelayMs</code></td><td>code / agent</td><td>两次尝试之间等待毫秒数，0–10000。</td></tr>
              <tr><td><code>notes</code></td><td>全部</td><td>备注，不参与执行。</td></tr>
            </tbody>
          </table>
          <Note title="默认值">
            新建 code / agent 节点会自动带上 <code>timeout:"120"</code>；新建 listen 节点带 <code>minIntervalMs:"500"</code>。
          </Note>
        </section>

        {/* ---------- 6 节点详解 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>6. 节点详解</h2>

          <h3>6.1 触发器 trigger</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>text</code></td><td>流程输入，原样传给下游。</td></tr>
            </tbody>
          </table>
          <p>一个右侧输出口。手动运行时它是最先执行的起点之一。</p>

          <h3>6.2 定时触发 schedule</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>cron</code></td><td>5 段：分 时 日 月 周。支持 <code>*</code>、<code>N</code>、<code>a-b</code>、<code>*/n</code>、<code>a-b/n</code>、逗号列表。</td></tr>
              <tr><td><code>text</code></td><td>本次运行的输入文字（可选）。</td></tr>
              <tr><td><code>timezone</code></td><td>存档字段，目前不生效。</td></tr>
            </tbody>
          </table>
          <Code>{`30 8 * * *      # 每天 08:30
0 */2 * * *     # 每 2 小时整点
0 9 * * 1-5     # 工作日 09:00`}</Code>
          <Warn>
            不支持秒、星期英文名、<code>@daily</code> 这类写法，分钟精度、按<b>宿主本地时区</b>匹配。调度的是「保存定时任务那一刻的快照」，
            <b>改完代码要回到这个节点重新保存一次定时</b>，否则到点跑的还是旧快照。
          </Warn>

          <h3>6.3 监听 listen</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>code</code></td><td>常驻 Python 程序；每行 stdout 触发一次流程。</td></tr>
              <tr><td><code>minIntervalMs</code></td><td>合并窗口，默认 500ms；连发事件只保留最新一条。</td></tr>
            </tbody>
          </table>
          <Code>{`import sys, time
print('[ready] watching')      # 只记状态，不触发
for i in range(5):
    print('event ' + str(i))   # 每一行 = 一次运行
    sys.stdout.flush()
    time.sleep(2)`}</Code>
          <Note title="启动步骤">
            先<b>保存工作流</b>，再打开「定时/监听」→ 监听页启动。停止后 <code>enabled</code> 会记住，宿主重启会尝试恢复；
            启动失败或进程退出会在面板里显示 error 与最近日志。
          </Note>

          <h3>6.4 Agent agent</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>prompt</code></td><td>追加在上游输入后面的指令：最终提示 = 上游输出 + 空行 + prompt。</td></tr>
              <tr><td><code>model</code></td><td><code>"provider|modelId"</code>；留空继承当前会话模型。</td></tr>
              <tr><td><code>timeout</code> / <code>onError</code> / <code>retries</code> / <code>retryDelayMs</code></td><td>同通用字段。</td></tr>
            </tbody>
          </table>
          <Note title="它到底在跑什么">
            Agent 节点会启动一个<b>真实的 DSH 子代理</b>，拥有你在 DSH 里的工具能力（联网、文件、搜索等），
            并在<b>执行工作区</b>的运行会话下工作（首次运行会创建会话）。它<b>拿不到父对话的记忆</b>，只收到「上游输出 + prompt」。
          </Note>
          <Warn>
            手动运行时如果图里有 Agent 节点却没选执行工作区，运行会被拦下并提示先选工作区；定时运行时用文档里保存的
            <code>executionWorkspaceId</code>（缺省用最近用过的）。
          </Warn>

          <h3>6.5 代码执行 code（Python）</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>code</code></td><td>Python 源码，以 <code>python -u -c &lt;code&gt;</code> 执行。</td></tr>
              <tr><td><code>timeout</code></td><td>秒；<code>0</code>/空 = 不额外限制（仍有 600 秒硬上限）。</td></tr>
              <tr><td><code>onError</code> / <code>retries</code> / <code>retryDelayMs</code></td><td>同通用字段。</td></tr>
            </tbody>
          </table>
          <Code>{`import os, json
raw = os.environ.get('DSH_INPUT', '')   # 上游输出
n = len(json.loads(raw)) if raw.strip().startswith('[') else 0
print(json.dumps({'items': n}))         # stdout 就是节点输出`}</Code>
          <table className="wf-helpdoc__table">
            <THead cols={['细节', '行为']} />
            <tbody>
              <tr><td>输入</td><td>环境变量 <code>DSH_INPUT</code>（UTF-8）；非字符串输入会先 JSON 序列化。</td></tr>
              <tr><td>输出</td><td><b>stdout 去首尾空白后整段就是节点输出</b>；同时按行记入日志。</td></tr>
              <tr><td>失败</td><td>进程非 0 退出或超时才算失败，报错取 stderr（没有则取退出信息）。<b>退出码 0 时 stderr 不影响结果</b>。</td></tr>
              <tr><td>编码 / 时区</td><td>强制 UTF-8（<code>PYTHONIOENCODING</code>/<code>PYTHONUTF8</code>）；启动时会移除 <code>TZ</code>，Python 与系统时区一致。</td></tr>
              <tr><td>解释器</td><td>依次尝试 <code>python</code> → <code>python3</code> → <code>py</code>；都没有则节点报错。</td></tr>
            </tbody>
          </table>
          <Warn>
            只有 Python。旧文档里的 <code>language</code> 字段会被忽略，TypeScript 代码需要改写为 Python。stdout 尽量只打印结果，
            乱打印会让下游拿到一坨文本。
          </Warn>

          <h3>6.6 If 分流 if</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>condition</code></td><td>布尔表达式，变量 <code>result</code> = 上游输出。</td></tr>
            </tbody>
          </table>
          <p>两个输出口：<code>true</code> / <code>false</code>。为真走 true，否则走 false；都没连就原样把输入还给下游。</p>
          <Code>{`Number(result) > 10
Number(JSON.parse(result).n) > 10
result.includes("AI")
JSON.parse(result).code === 0`}</Code>

          <h3>6.7 Switch 多路 switch</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>condition</code></td><td>取值表达式（<code>result</code> 为上游输出）。</td></tr>
              <tr><td><code>cases</code></td><td>逗号分隔的匹配值；值会先 <code>String()</code> 再<b>全等</b>比较。</td></tr>
            </tbody>
          </table>
          <p>输出口：每个 case 一个，外加 <code>default</code> 兜底。</p>
          <Warn>
            全等比较是大小写敏感的：<code>Morning</code> 不会命中 <code>morning</code>。case 里不要写引号或多余空格。
          </Warn>

          <h3>6.8 Loop 循环 loop</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>mode</code></td><td><code>"items"</code> 遍历数组（默认）；<code>"count"</code> 固定次数（生成 "1".."N"）。</td></tr>
              <tr><td><code>itemsExpr</code></td><td>mode=items 时求数组的表达式，如 <code>JSON.parse(result)</code>。</td></tr>
              <tr><td><code>count</code></td><td>mode=count 时的次数。</td></tr>
              <tr><td><code>maxIters</code></td><td>硬上限，默认 100。</td></tr>
              <tr><td><code>collect</code></td><td>true = 每轮结果收成 JSON 数组交给 <code>done</code>；false = 只用最后一轮。</td></tr>
            </tbody>
          </table>
          <p>
            端口：右侧 <code>iterate</code>（进 body）、<code>done</code>（跑完接后续）；左侧 <code>in</code>（首次进入）、<code>back</code>（body 回流）。
            body 最后一个节点连回 <code>back</code>，它的输出就是「本轮结果」。
          </p>

          <h3>6.9 While 条件循环 while</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>condition</code></td><td>每轮开始判断，<code>result</code> = 当前值（首轮是上游输出）。</td></tr>
              <tr><td><code>maxIters</code></td><td>硬上限，默认 100。</td></tr>
              <tr><td><code>collect</code></td><td>true = 收集每轮结果。</td></tr>
            </tbody>
          </table>
          <p>端口同 loop。<code>back</code> 回流的值成为下一轮的当前值，直到条件为假。</p>
          <Note title="写条件的建议">
            用字符串/状态判断更稳：<code>result !== "完成"</code>。数字比较记得先 <code>Number(result)</code>。
          </Note>

          <h3>6.10 输出 output</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['字段', '作用']} />
            <tbody>
              <tr><td><code>template</code></td><td>展示模板，支持 <code>{'{{result}}'}</code> 占位；留空等价于 <code>{'{{result}}'}</code>。</td></tr>
            </tbody>
          </table>
          <p>它是流程的收尾展示节点，渲染结果会继续往下传（一般不再接后续）。</p>

          <h3>6.11 备注 note</h3>
          <p>纯注释，正文存在 <code>text</code> 里，<b>没有任何连接口</b>，不参与执行。</p>
        </section>

        {/* ---------- 7 端口与连线 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>7. 端口与连线（handle 必须精确）</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['源节点', 'sourceHandle', 'targetHandle']} />
            <tbody>
              <tr><td>trigger / schedule / listen / code / agent / output</td><td>无</td><td>无</td></tr>
              <tr><td>if</td><td><code>true</code> / <code>false</code></td><td>无</td></tr>
              <tr><td>switch</td><td>case 值 或 <code>default</code></td><td>无</td></tr>
              <tr><td>loop / while（出）</td><td><code>iterate</code> / <code>done</code></td><td>无</td></tr>
              <tr><td>loop / while（入）</td><td>无</td><td><code>in</code> / <code>back</code></td></tr>
              <tr><td>note</td><td>不可连</td><td>不可连</td></tr>
            </tbody>
          </table>
          <Code>{`{ "id": "e1", "source": "t1", "target": "c1" }
{ "id": "e2", "source": "i1", "target": "a1", "sourceHandle": "true" }
{ "id": "e3", "source": "l1", "target": "b1", "sourceHandle": "iterate" }
{ "id": "e4", "source": "b1", "target": "l1", "targetHandle": "back" }
{ "id": "e5", "source": "l1", "target": "o1", "sourceHandle": "done" }`}</Code>
          <Warn>
            if 的普通连线如果没写 <code>sourceHandle</code>，运行时会当作 <code>true</code>；switch 没有匹配项、也没连
            <code>default</code> 时，流程会在该节点停住并把输入原样交回。别依赖这些兜底，把 handle 写全。
          </Warn>
        </section>

        {/* ---------- 8 result 与表达式 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>8. <code>result</code> 与表达式</h2>
          <p>
            表达式用 JS 求值（等价于 <code>new Function('result', 'return (表达式)')</code>），浏览器和宿主各跑一次，结果是
            <b>普通 JS 值</b>；但传进节点的 <code>result</code> <b>永远是字符串</b>。
          </p>
          <table className="wf-helpdoc__table">
            <THead cols={['上游 result', '推荐写法', '原因']} />
            <tbody>
              <tr><td><code>"15"</code></td><td><code>Number(result) &gt; 10</code></td><td>字符串比较会按字典序，先转数字。</td></tr>
              <tr><td><code>{'{"n":15}'}</code></td><td><code>JSON.parse(result).n &gt; 10</code></td><td>先解析再取字段。</td></tr>
              <tr><td><code>"AI 又更新了"</code></td><td><code>result.includes("AI")</code></td><td>文本判断直接用字符串方法。</td></tr>
              <tr><td><code>{'{"code":0}'}</code></td><td><code>JSON.parse(result).code === 0</code></td><td>取精确值比较。</td></tr>
            </tbody>
          </table>
          <Note title="结果从哪来">
            代码节点 = stdout；Agent 节点 = 子代理最终回答；输出节点 = 模板渲染后的文本；循环/分流节点 = 各自的判定值或收集值。
          </Note>
        </section>

        {/* ---------- 9 定时/监听板 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>9. 定时任务与监听板</h2>
          <h3>9.1 定时任务板</h3>
          <table className="wf-helpdoc__table">
            <THead cols={['操作', '说明']} />
            <tbody>
              <tr><td>立即运行</td><td>用已保存的快照当场跑一次（不改锚点）。</td></tr>
              <tr><td>结束（clear）</td><td>停止触发但保留记录与历史，之后可以「恢复」。</td></tr>
              <tr><td>恢复（resume）</td><td>从下一个触发点重新开始，不补跑停机期间欠的次数。</td></tr>
              <tr><td>删除</td><td>移除任务记录；已经产生的运行文件仍留在 <code>runs/</code> 里。</td></tr>
            </tbody>
          </table>
          <p>
            列表会显示下次触发、上次触发、状态（active / ended）与最近一次运行结果。任务下面只列<b>属于这个任务</b>的运行
            （带 <code>scheduleId</code>）；手动 ▶ 运行的记录不挂在任务下。
          </p>

          <h3>9.2 监听板</h3>
          <p>
            启动 / 停止 / 重启 / 删除监听进程，查看最近日志与事件，清空某个监听节点的运行记录；停止会记住 <code>enabled</code>，
            宿主重启后会尝试恢复（启动失败则自动置为停止并留下错误信息）。
          </p>
          <Warn>
            定时与监听都依赖<b>宿主进程存活</b>：DSH 关闭后不会再触发（重启时会补一次错过的定时）。修改工作流后，
            要重新「保存定时」才会更新快照；监听节点则要停止后重新启动才会加载新代码。
          </Warn>
        </section>

        {/* ---------- 10 运行历史 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>10. 运行历史</h2>
          <p>
            每次运行（手动 / 定时 / 监听）都会在 <code>runs/</code> 留一份记录：每个节点的状态、输出、耗时、是否有重试，
            以及整次运行的最终输出。定时任务与监听面板里可以打开属于它们的运行并<b>回放</b>：画布显示那一次的节点结果，
            顶部出现「返回编辑」。
          </p>
          <Note title="手动运行的记录">
            画布只保留「最近一次」的节点结果；手动运行结束也会落一份运行记录，但它不挂在任何定时任务下，
            所以任务历史里不会出现——需要时直接看 <code>runs/</code> 下的文件。
          </Note>
        </section>

        {/* ---------- 11 排障 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>11. 排查</h2>
          <table className="wf-helpdoc__table">
            <THead cols={['入口', '能看出什么']} />
            <tbody>
              <tr><td><code>GET /dsh-node-flow/health</code></td><td>路由清单、Python、模型、工作区、运行会话，以及一次真实 Python 自检。</td></tr>
              <tr><td><code>requests.json</code></td><td>最近的路由判定：<code>gate</code> / <code>verdict</code> / origin / host。403 先看这里。</td></tr>
              <tr><td><code>runs/&lt;runId&gt;.json</code></td><td>逐节点状态与报错，比画布上的提示更全。</td></tr>
              <tr><td><code>listeners.json</code></td><td>监听进程的 pid、状态、最近事件、丢弃计数。</td></tr>
            </tbody>
          </table>
          <table className="wf-helpdoc__table">
            <THead cols={['症状', '常见原因']} />
            <tbody>
              <tr><td>代码节点报「找不到 Python」</td><td>宿主 PATH 里没有 python / python3 / py。</td></tr>
              <tr><td>Agent 节点报服务不可用</td><td>宿主没有 <code>agents</code> / <code>subagents</code> 服务，或没有可用工作区。</td></tr>
              <tr><td>定时到点没跑</td><td>宿主没启动、任务被「结束」、快照不存在，或上一次还在跑。</td></tr>
              <tr><td>改了代码但定时还是旧行为</td><td>定时保存的是快照，需要重新保存定时任务。</td></tr>
              <tr><td>监听启动失败</td><td>工作流没保存、监听代码为空、Python 起不来，看面板里的日志。</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---------- 12 给 AI 的生成规则 ---------- */}
        <section className="wf-helpdoc__section">
          <h2>12. 给 AI：生成规则与示例</h2>
          <Note title="按这个顺序检查">
            ① <code>type</code> 全是 <code>"workflow"</code>；② 节点 id 唯一、连线引用存在；③ 分支/循环的 handle 用精确字符串；
            ④ <code>style</code> 尺寸与节点类型一致；⑤ Python 是唯一语言；⑥ Agent 节点要预留执行工作区；
            ⑦ 定时任务提醒用户「保存后重新保存定时」；⑧ note 不连线。
          </Note>
          <p>
            下面是一份可直接导入的完整示例：每天 08:30 抓 AI HOT 精选，交给 Agent 整理成中文简报，再输出。
            AI HOT 接口匿名只读，请遵守其使用规则（个人非商业自用没问题，对外产品需先获得授权）。
          </p>
          <h3>第 1 步：代码节点里的 Python（阅读用）</h3>
          <Code>{`import json, urllib.request

req = urllib.request.Request(
    'https://aihot.news/api/v1/items?mode=selected&window=7d&limit=10',
    headers={'User-Agent': 'aihot-api/2.0.0'},
)
with urllib.request.urlopen(req, timeout=20) as r:
    data = json.load(r)

for it in (data.get('items') or [])[:8]:
    print('- ' + it.get('title', '') + '：' + it.get('summary', ''))`}</Code>
          <h3>第 2 步：完整工作流 JSON（可直接导入）</h3>
          <Code>{`{
  "version": 1,
  "name": "定时 AI 热点简报",
  "nodes": [
    { "id": "s1", "type": "workflow", "position": { "x": 20, "y": 200 },
      "data": { "kind": "schedule", "label": "每日 08:30", "cron": "30 8 * * *", "text": "抓取今日 AI 热点并总结" },
      "style": { "width": 124, "height": 124 } },
    { "id": "c1", "type": "workflow", "position": { "x": 230, "y": 200 },
      "data": { "kind": "code", "label": "拉取热点", "language": "python", "timeout": "30",
        "code": "import json, urllib.request\\nreq = urllib.request.Request('https://aihot.news/api/v1/items?mode=selected&window=7d&limit=10', headers={'User-Agent': 'aihot-api/2.0.0'})\\nwith urllib.request.urlopen(req, timeout=20) as r:\\n    data = json.load(r)\\nfor it in (data.get('items') or [])[:8]:\\n    print('- ' + it.get('title', '') + '：' + it.get('summary', ''))" },
      "style": { "width": 124, "height": 124 } },
    { "id": "a1", "type": "workflow", "position": { "x": 450, "y": 200 },
      "data": { "kind": "agent", "label": "整理简报", "prompt": "把下面的 AI 热点整理成简洁中文简报，按重要度排序，每条只留标题和一句摘要。", "timeout": "120" },
      "style": { "width": 212, "height": 128 } },
    { "id": "o1", "type": "workflow", "position": { "x": 730, "y": 200 },
      "data": { "kind": "output", "label": "简报", "template": "{{result}}" },
      "style": { "width": 124, "height": 124 } }
  ],
  "edges": [
    { "id": "e1", "source": "s1", "target": "c1" },
    { "id": "e2", "source": "c1", "target": "a1" },
    { "id": "e3", "source": "a1", "target": "o1" }
  ]
}`}</Code>
          <Note title="导入与运行">
            顶栏「导入」选这个 JSON → 选好执行工作区 → ▶ 运行。定时触发需要再打开「定时/监听」保存一次，才会按点触发。
            想换成别的数据源，只改代码节点即可；Agent 节点负责总结，不负责取数。
          </Note>
          <Warn>
            示例里的 UA 只是礼貌标识，不是鉴权；请不要把别人的旧 UA、旧域名（如已经废弃的接口地址）抄进新工作流。
            接口返回结构以对方文档为准，取字段时用 <code>.get()</code> 兜底，避免某天字段变动直接抛异常。
          </Warn>
        </section>
      </div>
    </div>,
    overlayHost(),
  )
}
