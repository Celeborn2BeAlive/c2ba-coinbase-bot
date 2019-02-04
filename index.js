const jsonfile = require('jsonfile-promised');
const path = require('path')
const Gdax = require('gdax')

const apiURI = 'https://api.pro.coinbase.com'
const sandboxURI = 'https://api-public.sandbox.pro.coinbase.com'

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function suffixToMultiplier(suffix) {
    const s = 1000
    const m = 60 * s
    const h = 60 * m
    const d = 24 * h
    const w = 7 * d

    const map = { s, m, h, d, w }
    if (!(suffix in map)) {
        throw new Error(`${suffix} not recognized for period.`)
    }

    return map[suffix]
}

function periodToMilliseconds(investPeriod) {
    const number = parseInt(investPeriod.substr(0, investPeriod.length - 1))
    const suffix = investPeriod.substr(investPeriod.length - 1, 1)
    const multiplier = suffixToMultiplier(suffix)

    return number * multiplier
}

async function main() {
    const pathToConfig = path.join(process.argv[2], 'config.json')

    const { apiKey, apiSecret, passPhrase, investTimeOrigin, investPeriod, loopPeriod, investAmount,
        baseCurrency, cancelAfter, limitBaseCurrency, printStatePeriod, fake } = await jsonfile.readFile(pathToConfig)

    if (fake) {
        console.log("Fake mode enabled.")
    } else {
        console.log("Real mode enabled.")
    }

    const publicClient = new Gdax.PublicClient()
    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)

    const investPeriodMs = periodToMilliseconds(investPeriod)
    const loopPeriodMs = periodToMilliseconds(loopPeriod)

    const originTimestamp = Date.parse(investTimeOrigin)
    const getTime = async () => {
        return parseInt((await publicClient.getTime()).epoch * 1000)
    }

    const accounts = await authedClient.getAccounts()
    const baseCurrencyAccountId = accounts.filter(account => account.currency == baseCurrency)[0].id
    console.log(`baseCurrencyAccountId ${baseCurrencyAccountId}\n`)

    const currentTimestamp = await getTime() - originTimestamp
    const previousPeriodIdx = Math.floor(currentTimestamp / investPeriodMs)
    let nextPeriodTimestamp = originTimestamp + (previousPeriodIdx + 1) * investPeriodMs

    let pendingOrders = []
    let assetsToBuy = []

    const genFakeOrder = asset => {
        return { id: "0", product_id: asset + '-' + baseCurrency, status: "pending" }
    }

    const placeOrder = async asset => {
        if (fake) {
            return genFakeOrder(asset)
        }

        const market = asset + '-' + baseCurrency
        const allOrders = await publicClient.getProductOrderBook(market, { level: 2 });

        const buyPrice = parseFloat(allOrders['bids'][0][0])
        const buyPriceBase = Math.round(buyPrice * 100) / 100
        const size = investAmount[asset] / buyPrice
        const sizeBtc = Math.round(size * 10e7) / 10e7

        const params = {
            side: 'buy',
            price: buyPriceBase.toString(),
            size: sizeBtc.toString(),
            product_id: `${asset}-${baseCurrency}`,
            post_only: true,
            time_in_force: 'GTT',
            cancel_after: cancelAfter
        };

        console.log("Placing order with params: ", params)
        return await authedClient.placeOrder(params)
    }

    const checkStatus = async order => {
        if (fake) {
            console.log("Order fake filled.")
            return null
        }

        try {
            const result = await authedClient.getOrder(order.id)
            if (result.status == "open") {
                return order
            } else {
                console.log("Order filled :", result)
                return null
            }
        } catch (e) {
            // Order was cancelled, try to buy again
            assetsToBuy.push(order.product_id.split('-')[0])
            console.log(`Order ${order.id} canceled, trying again`)
            return null
        }
    }

    const cancelPendingOrders = async () => {
        console.log(`Cancel ${pendingOrders.length} pending orders`)
        for (const order of pendingOrders) {
            try {
                await authedClient.cancelOrder(order.id)
            } catch (e) {
                console.log(`${e}`)
            }
        }
    }

    let error = ""
    let done = false;
    for (let loopCount = 0; !done; ++loopCount) {
        try {
            const currentTimestamp = await getTime()
            const msRemaining = nextPeriodTimestamp - currentTimestamp
            const baseCurrencyAccount = await authedClient.getAccount(baseCurrencyAccountId)
            const remainingBaseCurrency = parseFloat(baseCurrencyAccount.balance)

            if (loopCount % printStatePeriod == 0) {
                console.log("--State--")
                console.log(`  assetsToBuy: ${assetsToBuy}`)
                console.log(`  pendingOrders: ${pendingOrders.map(order => order.id)}`)
                console.log(`  remainingBaseCurrency: ${remainingBaseCurrency}`)
                console.log(`  Next investment time: ${new Date(nextPeriodTimestamp)} (${msRemaining / 1000.0} seconds remaining)`)
                console.log("--")
            }

            // If we have pending orders, check if they have been filled or canceled
            if (pendingOrders.length > 0) {
                let openOrders = []
                for (const order of pendingOrders) {
                    const maybeOrder = await checkStatus(order)
                    if (maybeOrder) {
                        openOrders.push(maybeOrder)
                    }
                }
                pendingOrders = openOrders
            }

            if (remainingBaseCurrency < limitBaseCurrency) {
                error = "Remaining base currency is lower than limit."
                break;
            }

            // If we have assets to buy, then place orders for them
            let remainingAssetsToBuy = []
            for (const asset of assetsToBuy) {
                try {
                    const result = await placeOrder(asset)
                    console.log("Result: ", result)
                    if (result.status == 'pending' || result.status == 'open') {
                        pendingOrders.push(result)
                    }

                } catch (e) {
                    console.log('Order rejected: ', result)
                    remainingAssetsToBuy.push(asset)
                }
            }
            assetsToBuy = remainingAssetsToBuy

            // If we are idle, and an invest period has passed, then try to buy again next loop turn
            if (assetsToBuy.length == 0 && pendingOrders.length == 0 && msRemaining < 0) {
                for (const asset in investAmount) {
                    assetsToBuy.push(asset)
                }
                const previousPeriodIdx = Math.floor((currentTimestamp - originTimestamp) / investPeriodMs)
                nextPeriodTimestamp = originTimestamp + (previousPeriodIdx + 1) * investPeriodMs

                //nextPeriodTimestamp += investPeriodMs // Update timestamp to wait the next period
            }

        } catch (e) {
            console.error(`[Coinbase] ${e}`)
        }
        await timeout(loopPeriodMs);
    }

    cancelPendingOrders();

    if (error.length > 0) {
        throw new Error(error);
    }
}

// Run main, catch and print any error
(async () => {
    try {
        await main()
    } catch (e) {
        console.error(`${e}`)
        process.exit(-1)
    }
})()