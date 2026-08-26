/**
 * 六段交接条的工人指令与结构校验。
 * 段名常量单点驱动：prompt 构造与产物校验共用（FleetingEcho HANDOFF_SECTIONS 模式）。
 */

export const SIX_SECTIONS = [
  '任务目标',
  '已完成',
  '当前状态与开放问题',
  '关键决策与否决',
  '踩坑与阻塞',
  '下一步与新会话先读清单',
] as const

/** 工人 system 指令：模板 + 三条硬性纪律（票05 定稿）。 */
export function buildWorkerSystem(): string {
  return [
    '你是交接条工人。基于给定的会话材料，产出一份中文交接条（Markdown）。',
    '',
    '硬性纪律（违反即废稿）：',
    '1. 不许猜：只陈述材料能支撑的事实。没运行过的验证必须原样写「未运行」；不确定的事写「未确认」。下一位读者会把这份交接当作契约，一条想当然的"已完成"会污染后续所有工作。',
    '2. 引用不复制：指向文件路径与文档位置即可，禁止整段复制代码或文档内容。',
    '3. 禁止输出任何密钥、令牌、密码、个人敏感信息。',
    '',
    '输出格式：恰好包含以下六个二级标题，顺序固定，不得增删改名：',
    ...SIX_SECTIONS.map((s) => '## ' + s),
    '',
    '写作要求：',
    '- 每段 1~6 条要点，宁缺毋滥；',
    '- 「已完成」逐条带文件路径与验证结果；',
    '- 「关键决策与否决」必须包含被否掉的方案及否决理由（这是本文件最值钱的段落）；',
    '- 「下一步与新会话先读清单」给出可立即执行的第一步与应读文件的路径。',
  ].join('\n')
}

/** 校验工人输出是否包含全部六段（容忍 2~4 级标题与行首空白；代码围栏剔除）。 */
export function validateSections(body: string): { ok: boolean; missing: string[] } {
  const normalized = body.replace(/```[a-z]*/gi, '')
  const missing = SIX_SECTIONS.filter(
    (s) => !new RegExp(`^\\s*#{2,4}\\s*${s}`, 'm').test(normalized),
  )
  return { ok: missing.length === 0, missing }
}
