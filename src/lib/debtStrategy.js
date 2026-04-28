export function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}

export function formatDateLabel(date) {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short'
  })
}

function addMonthsToDate(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function buildWorkingDebts(liabilities = []) {
  return liabilities
    .map((item) => ({
      id: item.id,
      name: item.name || 'Unnamed Debt',
      liability_type: item.liability_type || 'other',
      balance: Number(item.current_balance || 0),
      apr: Number(item.interest_rate || 0),
      minimumPayment: Number(item.minimum_payment || 0),
      paidOffMonth: null,
      totalInterestPaid: 0,
      totalPaid: 0
    }))
    .filter((item) => item.balance > 0 && item.minimumPayment > 0)
}

function sortDebtsForStrategy(debts, strategy) {
  const copied = [...debts]

  if (strategy === 'snowball') {
    copied.sort((a, b) => {
      if (a.balance !== b.balance) return a.balance - b.balance
      return b.apr - a.apr
    })
    return copied
  }

  // avalanche
  copied.sort((a, b) => {
    if (a.apr !== b.apr) return b.apr - a.apr
    return a.balance - b.balance
  })
  return copied
}

export function calculateMultiDebtPayoff({
  liabilities = [],
  strategy = 'avalanche',
  extraMonthlyPayment = 0,
  startDate = new Date()
}) {
  const debts = buildWorkingDebts(liabilities)
  const extraPayment = Number(extraMonthlyPayment || 0)

  if (debts.length === 0) {
    return {
      valid: false,
      error: 'No liabilities with positive balance and minimum payment were found.'
    }
  }

  if (extraPayment < 0) {
    return {
      valid: false,
      error: 'Extra monthly payment cannot be negative.'
    }
  }

  for (const debt of debts) {
    const monthlyRate = debt.apr / 100 / 12
    if (monthlyRate > 0 && debt.minimumPayment <= debt.balance * monthlyRate) {
      return {
        valid: false,
        error: `Minimum payment for "${debt.name}" is too low to ever pay off that debt.`
      }
    }
  }

  let monthCount = 0
  let totalInterestPaid = 0
  let totalPaid = 0
  const monthlySnapshots = []
  const payoffOrder = []

  while (debts.some((d) => d.balance > 0.005) && monthCount < 1200) {
    monthCount += 1

    // interest phase
    for (const debt of debts) {
      if (debt.balance <= 0.005) continue

      const monthlyRate = debt.apr / 100 / 12
      const interest = debt.balance * monthlyRate
      debt.balance += interest
      debt.totalInterestPaid += interest
      totalInterestPaid += interest
    }

    // minimum payments
    for (const debt of debts) {
      if (debt.balance <= 0.005) continue

      const payment = Math.min(debt.minimumPayment, debt.balance)
      debt.balance -= payment
      debt.totalPaid += payment
      totalPaid += payment

      if (debt.balance <= 0.005 && debt.paidOffMonth == null) {
        debt.balance = 0
        debt.paidOffMonth = monthCount
        payoffOrder.push({
          id: debt.id,
          name: debt.name,
          monthNumber: monthCount,
          payoffDate: formatDateLabel(addMonthsToDate(startDate, monthCount - 1))
        })
      }
    }

    // extra payment by strategy
    let remainingExtra = extraPayment

    while (remainingExtra > 0.005) {
      const unpaidDebts = debts.filter((d) => d.balance > 0.005)

      if (unpaidDebts.length === 0) break

      const ordered = sortDebtsForStrategy(unpaidDebts, strategy)
      const target = ordered[0]

      const extraToApply = Math.min(remainingExtra, target.balance)

      target.balance -= extraToApply
      target.totalPaid += extraToApply
      totalPaid += extraToApply
      remainingExtra -= extraToApply

      if (target.balance <= 0.005 && target.paidOffMonth == null) {
        target.balance = 0
        target.paidOffMonth = monthCount
        payoffOrder.push({
          id: target.id,
          name: target.name,
          monthNumber: monthCount,
          payoffDate: formatDateLabel(addMonthsToDate(startDate, monthCount - 1))
        })
      }
    }

    monthlySnapshots.push({
      monthNumber: monthCount,
      paymentDate: formatDateLabel(addMonthsToDate(startDate, monthCount - 1)),
      remainingTotalBalance: debts.reduce((sum, d) => sum + Number(d.balance || 0), 0),
      activeDebts: debts.filter((d) => d.balance > 0.005).length
    })
  }

  if (monthCount >= 1200 && debts.some((d) => d.balance > 0.005)) {
    return {
      valid: false,
      error: 'Debt payoff simulation exceeded safe limit. Please review balances, APRs, and payments.'
    }
  }

  const payoffDate = addMonthsToDate(startDate, monthCount - 1)

  const debtResults = debts.map((debt) => ({
    id: debt.id,
    name: debt.name,
    liability_type: debt.liability_type,
    apr: debt.apr,
    originalBalance: Number(
      liabilities.find((item) => item.id === debt.id)?.current_balance || 0
    ),
    minimumPayment: debt.minimumPayment,
    totalInterestPaid: debt.totalInterestPaid,
    totalPaid: debt.totalPaid,
    paidOffMonth: debt.paidOffMonth,
    payoffDateLabel:
      debt.paidOffMonth != null
        ? formatDateLabel(addMonthsToDate(startDate, debt.paidOffMonth - 1))
        : 'Not paid off'
  }))

  return {
    valid: true,
    strategy,
    extraMonthlyPayment: extraPayment,
    monthsToDebtFree: monthCount,
    payoffDate,
    payoffDateLabel: formatDateLabel(payoffDate),
    totalInterestPaid,
    totalPaid,
    debtResults,
    payoffOrder,
    monthlySnapshots
  }
}