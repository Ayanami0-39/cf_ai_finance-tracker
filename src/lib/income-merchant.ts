/**
 * 收入来源（merchant）归一化。
 * 与 worker/ai/parse-expense.ts 中的 normalizeIncomeMerchant 保持一致：
 * 小模型对同一来源常产出随机变体（卖课件/卖了课件收入/课件），
 * 前端在收入来源聚合时再次归一化，可把历史已入库的旧变体合并展示。
 */
export function normalizeIncomeMerchant(merchant: string): string {
  let m = merchant.trim();
  if (!m) return "收入";
  // 去尾缀（可重复出现，如「课件收入」）
  m = m.replace(/(收入|进账|入账|到账|款项|货款)+$/g, "").trim();
  // 剥离开头动作词 + 时态助词（可叠加，如「卖掉了」）
  m = m.replace(
    /^(卖了|卖掉|卖出|售出|卖|收到|收到了|进账|入账|到账|收入|转账|退了|退款|报销了|报销)+/g,
    ""
  ).trim();
  return m || "收入";
}
