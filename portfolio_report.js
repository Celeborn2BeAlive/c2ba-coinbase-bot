const jsonfile = require('jsonfile-promised')
const { coinbaseURI, getAccountHistory } = require('./utils')
const Gdax = require('gdax')
const Aigle = require('aigle')

const lodash = require('lodash')
const { reverse } = lodash
const { chain } = Aigle.mixin(lodash)

const { api: apiURI } = coinbaseURI

async function main() {
    const pathToHistory = process.argv[2]
    if (!pathToHistory) {
        throw new Error("No path to history file provided.")
    }

    const publicClient = new Gdax.PublicClient(apiURI)

    const quoteCurrency = "EUR"
    const { accounts, orders } = await jsonfile.readFile(pathToHistory)

    const [baseAccount, otherAccounts] = await chain(accounts).
        partition(account => account.currency == quoteCurrency)

    const startDate = Date.parse("1970-01-01T00:00:00")
    //const startDate = Date.parse("2019-01-01T00:00:00")

    const output = {}
    let coherencyTest = 0;

    {
        const account = baseAccount[0]
        let events = []
        let quantity = 0
        let depositAmount = 0
        let withdrawAmount = 0
        for (const event of reverse(account.history)) {
            if (event.type == "transfer") {
                const transfer = account.transfers[event.details.transfer_id]
                const amount = parseFloat(transfer.amount)
                const date = Date.parse(transfer.completed_at)

                if (date < startDate)
                    continue

                if (transfer.type == "withdraw") {
                    const newQty = quantity - amount
                    events.push({
                        type: "transfer",
                        size: "withdraw",
                        amount: amount,
                        previousQty: quantity,
                        newQty,
                        date: transfer.completed_at
                    })
                    quantity = newQty
                    withdrawAmount += amount
                } else {
                    const newQty = quantity + amount
                    events.push({
                        type: "transfer",
                        size: "deposit",
                        amount: amount,
                        previousQty: quantity,
                        newQty,
                        date: transfer.completed_at
                    })
                    quantity = newQty
                    depositAmount += amount
                }
            }
        }
        const balance = parseFloat(account.balance)
        const report = {
            currency: account.currency,
            quantity,
            withdrawAmount,
            depositAmount,
            balance
        }
        coherencyTest += depositAmount - withdrawAmount - balance

        output[account.currency] = {
            report,
            events
        }
    }

    const processedOrders = new Set()

    for (const account of otherAccounts) {
        let averageUnitCost = 0
        let quantity = 0
        let realizedPnL = 0
        let events = []
        let depositAmount = 0
        let withdrawAmount = 0
        let withdrawAmountValue = 0
        for (const event of reverse(account.history)) {
            if (event.type == "match") {
                if (processedOrders.has(event.details.order_id))
                    continue

                processedOrders.add(event.details.order_id)

                const order = orders[event.details.order_id]

                const date = Date.parse(order.done_at)
                if (date < startDate)
                    continue

                if (order.product_id.split("-")[1] != "EUR") {
                    console.warning("Order not from EUR detected.")
                    continue
                }

                const executedValue = parseFloat(order.executed_value)
                const fillFees = parseFloat(order.fill_fees)
                const filledSize = parseFloat(order.filled_size)

                if (order.side == "buy") {
                    const cost = executedValue + fillFees
                    const unitPrice = cost / filledSize

                    const newQty = quantity + filledSize
                    const newAUC = (quantity * averageUnitCost + cost) / newQty

                    events.push({
                        type: "match",
                        side: order.side,
                        cost,
                        unitPriceWithFee: unitPrice,
                        unitPriceWithoutFee: executedValue / filledSize,
                        filledSize,
                        fillFees,
                        executedValue,
                        previousQty: quantity,
                        newQty,
                        previousAUC: averageUnitCost,
                        newAUC,
                        date: order.done_at
                    })

                    averageUnitCost = newAUC
                    quantity = newQty
                } else {
                    const gain = executedValue - fillFees
                    const unitPrice = gain / filledSize

                    const unitPnL = unitPrice - averageUnitCost

                    const newQty = quantity - filledSize
                    const newAUC = newQty > 0 ? averageUnitCost : 0

                    events.push({
                        type: "match",
                        side: order.side,
                        gain,
                        unitPnL,
                        unitPriceWithFee: unitPrice,
                        unitPriceWithoutFee: executedValue / filledSize,
                        filledSize,
                        fillFees,
                        executedValue,
                        previousQty: quantity,
                        newQty,
                        previousAUC: averageUnitCost,
                        newAUC,
                        date: order.done_at
                    })

                    averageUnitCost = newAUC
                    quantity = newQty
                    realizedPnL += unitPnL * filledSize
                }
            }
            else if (event.type == "transfer") {
                const transfer = account.transfers[event.details.transfer_id]
                const amount = parseFloat(transfer.amount)
                const date = Date.parse(transfer.completed_at)

                if (date < startDate)
                    continue

                if (transfer.type == "withdraw") {
                    const newQty = quantity - amount
                    const newAUC = newQty > 0 ? averageUnitCost : 0
                    events.push({
                        type: "transfer",
                        size: "withdraw",
                        amount: amount,
                        previousQty: quantity,
                        newQty,
                        previousAUC: averageUnitCost,
                        newAUC,
                        date: transfer.completed_at
                    })
                    quantity = newQty
                    withdrawAmount += amount
                    withdrawAmountValue += amount * averageUnitCost
                    averageUnitCost = newAUC
                } else {
                    const newQty = quantity + amount
                    events.push({
                        type: "transfer",
                        size: "deposit",
                        amount: amount,
                        previousQty: quantity,
                        newQty,
                        date: transfer.completed_at
                    })
                    quantity = newQty
                    depositAmount += amount
                }
            }
        }

        const ticker = await publicClient.getProductTicker(account.currency + '-EUR');
        const price = parseFloat(ticker.price)

        const unitPnL = price - averageUnitCost
        const unrealizedPnL = unitPnL * quantity

        const balance = parseFloat(account.balance)

        const report = {
            currency: account.currency,
            price,
            averageUnitCost,
            quantity,
            realizedPnL,
            unrealizedPnL,
            value: quantity * price,
            cost: quantity * averageUnitCost,
            withdrawAmount,
            withdrawAmountValue,
            depositAmount,
            balance
        }
        coherencyTest -= (withdrawAmountValue + report.cost)
        coherencyTest += realizedPnL

        output[account.currency] = {
            report,
            events
        }
    }

    // Should be almost zero
    console.log(coherencyTest)

    await jsonfile.writeFile("report.json", output, { spaces: 2 })
}

main()