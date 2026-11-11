export type ParsedCardKey = {
  cardNo: string | null;
  secret: string;
};

/**
 * 解析批量导入文本：一行一条。
 * 支持纯卡密，或「卡号+卡密」：card,secret / card----secret / card<TAB>secret / 两个空格分隔的 token。
 * 空行忽略。
 */
export function parseCardKeyLines(text: string): ParsedCardKey[] {
  const out: ParsedCardKey[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseCardKeyLine(line);
    if (!parsed.secret) continue;
    out.push(parsed);
  }
  return out;
}

export function parseCardKeyLine(line: string): ParsedCardKey {
  const dash = line.indexOf('----');
  if (dash >= 0) {
    const cardNo = line.slice(0, dash).trim();
    const secret = line.slice(dash + 4).trim();
    if (cardNo && secret) return { cardNo, secret };
  }

  const comma = line.indexOf(',');
  if (comma >= 0) {
    const cardNo = line.slice(0, comma).trim();
    const secret = line.slice(comma + 1).trim();
    if (cardNo && secret) return { cardNo, secret };
  }

  if (line.includes('\t')) {
    const parts = line
      .split('\t')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 2) return { cardNo: parts[0], secret: parts[1] };
  }

  const spaceParts = line.split(/\s+/).filter(Boolean);
  if (spaceParts.length === 2) {
    return { cardNo: spaceParts[0], secret: spaceParts[1] };
  }

  return { cardNo: null, secret: line };
}

export function formatCardKeyText(cardNo: string | null, secret: string): string {
  if (cardNo) return `卡号：${cardNo}  卡密：${secret}`;
  return secret;
}
