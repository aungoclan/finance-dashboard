export function buildPortfolioAllocationData(holdings = []) {
  return holdings
    .filter((item) => Number(item.market_value || 0) > 0)
    .map((item) => ({
      label: item.symbol || item.display_name || 'Unknown',
      value: Number(item.market_value || 0)
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
}

export function buildCashflowChartData(summary = {}) {
  return [
    {
      label: 'This Month',
      income: Number(summary.totalIncome || 0),
      expense: Number(summary.totalExpenses || 0)
    }
  ]
}

export function buildBudgetChartData(budgetRows = []) {
  return budgetRows
    .filter((row) => Number(row.planned || 0) > 0 || Number(row.actual || 0) > 0)
    .map((row) => ({
      category: row.category || 'Uncategorized',
      planned: Number(row.planned || 0),
      actual: Number(row.actual || 0)
    }))
    .sort((a, b) => {
      const aTotal = Math.max(a.planned, a.actual)
      const bTotal = Math.max(b.planned, b.actual)

      return bTotal - aTotal
    })
    .slice(0, 8)
}

export function buildNetWorthOverviewTrend(summary = {}) {
  return [
    {
      label: 'Investments',
      netWorth: Number(summary.investmentAssetsTotal || 0)
    },
    {
      label: 'Assets',
      netWorth: Number(summary.totalAssets || 0)
    },
    {
      label: 'Net Worth',
      netWorth: Number(summary.netWorth || 0)
    }
  ]
}