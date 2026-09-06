# 交接板排障笔记

记录 2026-09-03 一次完整排障中实测得到的环境事实与工具用法，供后续迭代直接复用，
不必重新踩一遍。

## 1. 会话日志是多帧 zstd，Node 只解第一帧

`~/.dsh/sessions/<workspace>/<sessionId>/session.jsonl.zstd` 是**多帧追加压缩**。
Node 的 `zstdDecompressSync` 只解第一帧（只能看到 session 头），必须按帧魔数
`28 B5 2F FD` 切帧、逐帧解压才能拿到全文。

工具：`.scratch/decode.mjs`（导出 `readSessionLog(dir)` / `listSessionDirs(root)`；
也可直接 `node decode.mjs <sessions-root> --title <标题子串>` 按侧边栏标题找会话）。

## 2. 消息事件有两种 JSON 形状

| 事件 | 正文位置 |
|---|---|
| `user/message` | `data.content` |
| `assistant/message` | **`data.message.content`**（多一层 message） |

只读 `data.content` 会把助手轮次全部取成空串：材料从 ~10 万字符塌到 ~1.4 千，
生成的交接条写不出任何「已完成/已改动」。已在 `eventPlainText` 兼容两种形状。

排查工具：`.scratch/inspect.mjs <sessionDir>` 打印事件数、真实对话字符数、
取材预算是否超限、最近若干轮、事件类型分布。

## 3. 上游供应商有请求处理墙钟上限，且不随我们的超时改变

实测 `a61` 供应商：**约 296 秒**硬上限。超时后它不报错，而是把一段错误文本
当作模型正文回传：

```
[req_xxxxx] [hy4] **Request exceeded 296s limit:**
Your prompt took too long to process, likely due to a large context window or
heavy reasoning required by the AI provider...
```

不识别这段文本，就会拿它去验六段，最后报成「工人未产出合格正文」，完全指不到真因。
（已在 `isProviderLimitText` 中识别，并触发降级取材重试。）

推论：**把我们的超时调到大于 296s 没有意义**——供应商会先返回。末轮超时因此定在 320s。

## 4. 思考量由 reasoningEfforts 档位决定，不是由 maxTokens 决定

`~/.dsh/settings.yaml` 里每个模型声明 `reasoningEfforts` 映射表，
**只接受表里列出的档位**，传了没有的值会立刻返回
`UNSUPPORTED_REASONING_EFFORT`（耗时 0.0s）。

实测对比（同一份 23,680 字材料）：

| 档位 | 思考量 | 结果 |
|---|---|---|
| high（hy4-preview 默认） | 29,688–41,905 字 | 297s 被切，正文 0 |
| low | 7,748 字 | 86.5s 跑完 |

所以卡住时先查档位表，而不是调 maxTokens。查法：

```bash
node ~/.agents/skills/dsh-model-config/scripts/validate-settings.mjs \
  --provider <route> --model <id>
```

注意：`maxTokens` 太小也不行——low 档下 3,000 token 会被思考吃光
（思考 7,748 字、`finish=max-tokens`、正文 0 字）。要给足预算。

### 4.1 教训：不要在插件里替用户决定档位

2026-09-03 事故：为了绕开上面这个 296s 上限，我把交接工人的重试阶梯改成
第 1 轮硬编码传 `effort: 'low'`。结果另一台机器上用户选的是 xhigh，却被按 low
请求，而 `opencodezen / muse-spark-1.3-contributor-free` 未声明 low 档，
第 1 轮直接被 `UNSUPPORTED_REASONING_EFFORT` 拒绝。

**推理档位属于模型配置范畴，应该由用户在输入框/settings.yaml 里决定。
插件不得固定档位，降档最多只能作为失败后的兜底。** 当前实现已恢复上游原样
（前两轮尝试 `off`、第三轮不传档位）。

## 5. 取材预算对长会话压不下去

`packTurns` 有「每轮保底 48 字符」，于是 `available` 下限是 `轮数 × 48`。
1,100 轮会话的下限约 5.3 万字，远超 `MAX_MATERIAL_CHARS = 24,000`。

实测：把预算从 24,000 降到 8,000，实际材料只从 23,680 降到 18,837 字。

要真正缩小材料只能减少轮数——但那会动到「不丢轮次」的设计，需先确认再改。

## 6. 模型请求可能返回业务错误（与内容和代码无关）

例如 `fixed_merchant_unavailable`（固定商家繁忙/冷却/能力不匹配）。
这类错误在 finish 块里以 `reason.kind === 'error'` 出现，已单独归类为
【上游返回错误】。处置：在模型市场切换商家，或开启智能路由/兜底。
