/**
 * 脱敏：移植 FleetingEcho redact.ts 的 denylist 思路。
 * 三时机执行：材料送 LLM 前、正文落库前、（未来导出前）。
 * 这是兜底不是保证——worker prompt 里另有「禁止输出密钥」约束（纵深防御）。
 */
const PATTERNS: Array<[RegExp, string]> = [
  // PEM 私钥块（含前后护栏）
  [/-{2,}BEGIN [A-Z ]*PRIVATE KEY-{2,}[\s\S]*?-{2,}END [A-Z ]*PRIVATE KEY-{2,}/g, '[REDACTED-PRIVATE-KEY]'],
  // AWS Access Key ID
  [/\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]'],
  // OpenAI / Anthropic
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED-API-KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED-ANTHROPIC-KEY]'],
  // GitHub token / fine-grained PAT
  [/\b(?:ghp|gho|ghu|ghs|ghr)_\w{20,}\b/g, '[REDACTED-GITHUB-TOKEN]'],
  [/\bgithub_pat_\w{22,}\b/g, '[REDACTED-GITHUB-PAT]'],
  // Slack
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED-SLACK-TOKEN]'],
  // Google API key
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED-GOOGLE-KEY]'],
  // Bearer 头
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'Bearer [REDACTED]'],
  // JWT 三段式
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._~-]{10,}\.[A-Za-z0-9._~-]{10,}\b/g, '[REDACTED-JWT]'],
  // 通用赋值式：保留键名只抹值（≥8 字符的值才抹，避免误伤普通单词）
  [/\b((?:API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_-]*)\s*[=:]\s*(["']?)[A-Za-z0-9._~+/=-]{8,}\2/gi, '$1=$2[REDACTED]$2'],
]

/** 按顺序应用全部脱敏规则。 */
export function redact(text: string): string {
  let out = text
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}
