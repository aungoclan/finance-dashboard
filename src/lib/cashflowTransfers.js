export function isTransferEntry(entry) {
  return String(entry?.type || '').trim().toLowerCase() === 'transfer'
}

export function getTransferAmountForAccount(entry, accountId) {
  if (!isTransferEntry(entry) || !accountId) return 0

  const amount = Math.abs(Number(entry?.amount || 0))
  if (!Number.isFinite(amount) || amount <= 0) return 0

  if (entry?.target_account_id === accountId) return amount
  if (entry?.source_account_id === accountId) return -amount

  return 0
}

export function getCashflowBalanceAmountForAccount(entry, accountId) {
  if (!accountId || (entry?.account_id || '') !== accountId) {
    return getTransferAmountForAccount(entry, accountId)
  }

  const amount = Math.abs(Number(entry?.amount || 0))
  if (!Number.isFinite(amount) || amount <= 0) return 0

  if (isTransferEntry(entry)) {
    return getTransferAmountForAccount(entry, accountId)
  }

  if (entry?.type === 'income') return amount
  if (entry?.type === 'expense') return -amount

  return 0
}
