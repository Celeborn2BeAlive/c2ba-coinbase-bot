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

    return { s, m, h, d, w }[suffix]
}

function periodToMilliseconds(investPeriod) {
    const number = parseInt(investPeriod.substr(0, investPeriod.length - 1))
    const suffix = investPeriod.substr(investPeriod.length - 1, 1)
    const multiplier = suffixToMultiplier(suffix)

    return number * multiplier
}

async function main() {
    const pathToConfig = path.join(process.argv[2], 'config.json')

    const { apiKey, apiSecret, passPhrase, investPeriod, loopPeriod, investAmount,
        baseCurrency, cancelAfter, limitBaseCurrency } = await jsonfile.readFile(pathToConfig)

    const publicClient = new Gdax.PublicClient()
    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)

    const investPeriodMs = periodToMilliseconds(investPeriod)
    const loopPeriodMs = periodToMilliseconds(loopPeriod)

    const getTime = async () => {
        return parseInt((await publicClient.getTime()).epoch * 1000)
    }

    const accounts = await authedClient.getAccounts()
    const baseCurrencyAccountId = accounts.filter(account => account.currency == baseCurrency)[0].id
    console.log("baseCurrencyAccountId: ", baseCurrencyAccountId)

    const currentTimestamp = await getTime()
    const previousPeriodIdx = Math.floor(currentTimestamp / investPeriodMs)
    const previousPeriodTimestamp = previousPeriodIdx * investPeriodMs
    let nextPeriodTimestamp = (previousPeriodIdx + 1) * investPeriodMs

    let pendingOrders = []
    let assetsToBuy = []

    const placeOrder = async asset => {
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

            const baseCurrencyAccount = await authedClient.getAccount(baseCurrencyAccountId)
            //console.log(`Remaining base currency: ${baseCurrencyAccount.balance} (limit: ${limitBaseCurrency})`)
            const remainingBaseCurrency = parseFloat(baseCurrencyAccount.balance)
            if (remainingBaseCurrency < limitBaseCurrency) {
                error = "Remaining base currency is lower than limit."
                break;
            }

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

            if (pendingOrders.length > 0) {
                let openOrders = []
                console.log(`Wait for orders ${pendingOrders}...`)
                for (const order of pendingOrders) {
                    try {
                        const result = await authedClient.getOrder(order.id)
                        if (result.status == "open") {
                            openOrders.push(order)
                        } else {
                            console.log("Order done :", result)
                        }
                    } catch (e) {
                        // Order was cancelled, try again
                        assetsToBuy.push(order.product_id.split('-')[0])
                        console.log(`Order ${order.id} canceled, trying again`)
                    }
                }

                pendingOrders = openOrders
            } else {
                const msRemaining = nextPeriodTimestamp - currentTimestamp

                console.log(`Next investment time: ${new Date(nextPeriodTimestamp)} (${msRemaining} milliseconds remaining)`)

                if (msRemaining < 0) {
                    for (const asset in investAmount) {
                        assetsToBuy.push(asset)
                    }
                    nextPeriodTimestamp += investPeriodMs // Update timestamp to wait the next period
                }
            }

        } catch (e) {
            console.error(`[Coinbase]${e}`)
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