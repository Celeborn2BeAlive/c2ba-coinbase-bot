const express = require('express')
const exphbs = require('express-handlebars')
const handlebars = require('handlebars')
const jsonfile = require('jsonfile-promised');
const path = require('path')
const Gdax = require('gdax')
const Aigle = require('aigle')
const { chain } = Aigle.mixin(require('lodash'))
const { timeout, coinbaseURI } = require('./utils')

const { api: apiURI } = coinbaseURI

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
    const app = express()
    const port = process.argv[3]

    app.listen(port, function () {
        console.log(`Listening on port ${port}.`)
    })

    app.engine('handlebars', exphbs({
        defaultLayout: 'main'
    }))
    app.set('view engine', 'handlebars')

    const pathToConfig = path.join(process.argv[2], 'config.json')

    const {
        apiKey, apiSecret, passPhrase, investTimeOrigin, investPeriod, loopPeriod, investAmount,
        baseCurrency, cancelAfter, limitBaseCurrency, printStatePeriod, fake,
        investCountLimit
    } = await jsonfile.readFile(pathToConfig)

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

    const getDate = async () => {
        return new Date(await getTime())
    }

    const products = await chain(publicClient.getProducts()).
        keyBy("id")

    const accounts = await authedClient.getAccounts()
    const baseCurrencyAccountId = accounts.filter(account => account.currency == baseCurrency)[0].id
    console.log(`baseCurrencyAccountId ${baseCurrencyAccountId}\n`)

    const currentTimestamp = await getTime() - originTimestamp
    const previousPeriodIdx = Math.floor(currentTimestamp / investPeriodMs)
    let nextPeriodTimestamp = originTimestamp + (previousPeriodIdx + 1) * investPeriodMs

    let pendingOrders = []
    let assetsToBuy = []

    let history = []

    let investCount = 0

    const genFakeOrder = async asset => {
        const timestamp = await getTime()
        return {
            id: "0",
            product_id: asset + '-' + baseCurrency,
            status: "pending",
            timestamp,
            created_at: new Date(timestamp),
            seconds_to_fill: Math.random() * 10
        }
    }

    const placeOrder = async asset => {
        if (fake) {
            history.push({
                time: await getDate(),
                action: "place_fake_order",
            })
            return await genFakeOrder(asset)
        }

        const market = asset + '-' + baseCurrency
        const allOrders = await publicClient.getProductOrderBook(market, { level: 2 });

        const buyPrice = parseFloat(allOrders['bids'][0][0])
        const buyPriceBase = Math.round(buyPrice * 100) / 100
        const size = investAmount[asset] / buyPrice
        const sizeBtc = Math.round(size * 10e7) / 10e7

        const productId = `${asset}-${baseCurrency}`
        const minSize = parseFloat(products[productId].base_min_size)
        const maxSize = parseFloat(products[productId].base_max_size)

        const buySize = Math.min(Math.max(sizeBtc, minSize), maxSize)

        const params = {
            side: 'buy',
            price: buyPriceBase.toString(),
            size: buySize.toString(),
            product_id: productId,
            post_only: true,
            time_in_force: 'GTT',
            cancel_after: cancelAfter
        };

        console.log("Placing order with params: ", params)
        history.push({
            time: await getDate(),
            action: "place_order",
            params: {
                ...params,
                "value": buySize * buyPriceBase
            }
        })
        return await authedClient.placeOrder(params)
    }

    const checkStatus = async order => {
        if (fake) {
            const currentTimestamp = await getTime()
            if (currentTimestamp - order.timestamp > order.seconds_to_fill * 1000) {
                console.log("Order fake filled.")
                history.push({
                    time: await getDate(),
                    action: "filled_order",
                    params: order
                })
                return null
            }
            return order
        }

        try {
            const result = await authedClient.getOrder(order.id)
            if (result.status == "open") {
                return order
            } else {
                console.log("Order filled :", result)
                history.push({
                    time: await getDate(),
                    action: "filled_order",
                    params: result
                })
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
                history.push({
                    time: await getDate(),
                    action: "cancel_order",
                    params: order
                })
            } catch (e) {
                console.log(`${e}`)
            }
        }
    }

    const getPrice = async (currency) => {
        if (currency == baseCurrency) {
            return 1
        }
        const ticker = await publicClient.getProductTicker(currency + '-' + baseCurrency)
        return ticker.price
    }

    app.get('/', async (req, res) => {
        const currentTimestamp = await getTime()
        const msRemaining = nextPeriodTimestamp - currentTimestamp
        const seconds = Math.floor(msRemaining / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        let assetInfo = []

        for (asset in investAmount) {
            const price = await getPrice(asset)
            const size = investAmount[asset] / price
            const sizeBtc = Math.round(size * 10e7) / 10e7

            const productId = `${asset}-${baseCurrency}`
            const minSize = parseFloat(products[productId].base_min_size)
            const maxSize = parseFloat(products[productId].base_max_size)

            const buySize = Math.min(Math.max(sizeBtc, minSize), maxSize)
            const trueInvestAmount = buySize * price

            assetInfo.push({
                currency: asset,
                price,
                buySize,
                buyValue: trueInvestAmount,
                wantedBuyValue: investAmount[asset],
                wantedSize: sizeBtc,
                minSize,
                maxSize,
                minValue: minSize * price,
                maxValue: maxSize * price
            })
        }

        res.render("index", {
            nextBuyingTime: new Date(nextPeriodTimestamp),
            days: days,
            hours: hours % 24,
            minutes: minutes % 60,
            seconds: seconds % 60,
            pendingOrders,
            assetsToBuy,
            fake,
            assetInfo,
            investCount,
            investCountLimit
        })
    })

    app.get('/accounts', async (req, res) => {
        const accounts = await chain(authedClient.getAccounts()).
            filter(account => account.balance > 0).
            map(
                async account => ({
                    ...account,
                    value: (await getPrice(account.currency)) * account.balance
                })
            )
        const portfolioValue = accounts.reduce((accum, order) => accum + order.value, 0)
        res.render("accounts", {
            baseCurrency,
            portfolioValue,
            accounts: accounts.map(account => ({
                ...account,
                percentage: Math.round(100 * (100.0 * account.value / portfolioValue)) / 100
            }))
        })
    })

    app.get('/log', async (req, res) => {
        res.render("log", {
            history: history.reverse()
        })
    })

    let error = ""
    let done = false;

    process.on('exit', () => { done = true });
    // catch ctrl+c event and exit normally
    process.on('SIGINT', function () {
        console.log('Ctrl-C...')
        done = true
    });

    //catch uncaught exceptions, trace, then exit normally
    process.on('uncaughtException', (e) => {
        console.log('Uncaught Exception...')
        console.log(e.stack)
        done = true
    });

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

                if (pendingOrders.length == 0 && investCountLimit > 0) {
                    ++investCount
                }
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
                    } else {
                        console.log(`Unkown status ${result.status} for order.`)
                    }
                    history.push({
                        time: await getDate(),
                        action: "place_order_result",
                        params: result
                    })

                } catch (e) {
                    console.log('Order rejected: ', e)
                    remainingAssetsToBuy.push(asset)
                    history.push({
                        time: await getDate(),
                        action: "rejected_order",
                        params: e
                    })
                }
            }
            assetsToBuy = remainingAssetsToBuy

            // If we are idle, and an invest period has passed, then try to buy again next loop turn
            if (assetsToBuy.length == 0 && pendingOrders.length == 0 && msRemaining < 0 && (investCountLimit == 0 || investCount < investCountLimit)) {
                for (const asset in investAmount) {
                    assetsToBuy.push(asset)
                }
                const previousPeriodIdx = Math.floor((currentTimestamp - originTimestamp) / investPeriodMs)
                nextPeriodTimestamp = originTimestamp + (previousPeriodIdx + 1) * investPeriodMs
            }

        } catch (e) {
            console.error(`[Coinbase] ${e}`)
            history.push({
                time: await getDate(),
                action: "exception_catched",
                params: e
            })
        }
        await timeout(loopPeriodMs);
    }

    await cancelPendingOrders()

    if (error.length > 0) {
        throw new Error(error);
    }

    process.exit(0)
}

main()