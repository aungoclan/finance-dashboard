export function getTopOverspendingCategory(budgetRows = []) {
  const overBudgetRows = budgetRows
    .filter((row) => Number(row.usagePercent || 0) > 100)
    .sort((a, b) => Number(b.usagePercent || 0) - Number(a.usagePercent || 0))

  if (overBudgetRows.length > 0) {
    return overBudgetRows[0]
  }

  const nearLimitRows = budgetRows
    .filter((row) => Number(row.usagePercent || 0) >= 80)
    .sort((a, b) => Number(b.usagePercent || 0) - Number(a.usagePercent || 0))

  if (nearLimitRows.length > 0) {
    return nearLimitRows[0]
  }

  return null
}