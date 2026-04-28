export function calculateNetWorthSummary(assetAccounts = [], liabilities = [], investmentMarketValue = 0) {
  const externalAssetsTotal = assetAccounts.reduce(
    (sum, item) => sum + Number(item.current_value || 0),
    0
  )

  const liabilitiesTotal = liabilities.reduce(
    (sum, item) => sum + Number(item.current_balance || 0),
    0
  )

  const totalAssets = Number(investmentMarketValue || 0) + externalAssetsTotal
  const netWorth = totalAssets - liabilitiesTotal

  return {
    investmentAssetsTotal: Number(investmentMarketValue || 0),
    externalAssetsTotal,
    totalAssets,
    liabilitiesTotal,
    netWorth
  }
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}