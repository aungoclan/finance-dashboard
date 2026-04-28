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

export function addMonthsToDate(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function formatDateLabel(date) {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short'
  })
}

export function calculateDebtPayoff({
  balance,
  apr,
  minimumPayment,
  extraPayment = 0,
  startDate = new Date()
}) {
  const currentBalance = Number(balance || 0)
  const annualRate = Number(apr || 0)
  const minPay = Number(minimumPayment || 0)
  const extraPay = Number(extraPayment || 0)

  if (currentBalance <= 0) {
    return {
      valid: false,
      error: 'Balance must be greater than 0'
    }
  }

  if (annualRate < 0) {
    return {
      valid: false,
      error: 'APR cannot be negative'
    }
  }

  if (minPay <= 0) {
    return {
      valid: false,
      error: 'Minimum payment must be greater than 0'
    }
  }

  if (extraPay < 0) {
    return {
      valid: false,
      error: 'Extra payment cannot be negative'
    }
  }

  const monthlyRate = annualRate / 100 / 12
  const monthlyPayment = minPay + extraPay

  if (monthlyRate > 0 && monthlyPayment <= currentBalance * monthlyRate) {
    return {
      valid: false,
      error: 'Monthly payment is too low to ever pay off this debt'
    }
  }

  let remainingBalance = currentBalance
  let monthCount = 0
  let totalInterestPaid = 0
  let totalPaid = 0
  const schedule = []

  while (remainingBalance > 0.005 && monthCount < 1200) {
    monthCount += 1

    const interestForMonth = remainingBalance * monthlyRate
    let principalPayment = monthlyPayment - interestForMonth
    let actualPayment = monthlyPayment

    if (monthlyRate === 0) {
      principalPayment = monthlyPayment
    }

    if (principalPayment <= 0) {
      return {
        valid: false,
        error: 'Payment does not cover interest. Increase your monthly payment.'
      }
    }

    if (principalPayment > remainingBalance) {
      principalPayment = remainingBalance
      actualPayment = principalPayment + interestForMonth
    }

    remainingBalance = remainingBalance - principalPayment
    totalInterestPaid += interestForMonth
    totalPaid += actualPayment

    schedule.push({
      monthNumber: monthCount,
      paymentDate: formatDateLabel(addMonthsToDate(startDate, monthCount - 1)),
      payment: actualPayment,
      interest: interestForMonth,
      principal: principalPayment,
      remainingBalance: remainingBalance < 0 ? 0 : remainingBalance
    })
  }

  const payoffDate = addMonthsToDate(startDate, monthCount - 1)

  return {
    valid: true,
    startingBalance: currentBalance,
    apr: annualRate,
    monthlyRatePercent: monthlyRate * 100,
    minimumPayment: minPay,
    extraPayment: extraPay,
    monthlyPayment,
    monthsToPayoff: monthCount,
    payoffDate,
    payoffDateLabel: formatDateLabel(payoffDate),
    totalInterestPaid,
    totalPaid,
    schedule
  }
}