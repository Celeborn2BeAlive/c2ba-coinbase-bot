const jsonfile = require('jsonfile-promised')
const Gdax = require('gdax')
const { coinbaseURI, getAccountHistory } = require('./utils')

const { api: apiURI } = coinbaseURI

async function main() {
    const pathToConfig = process.argv[2]
    if (!pathToConfig) {
        throw new Error("No path to config file provided.")
    }

    const { apiKey, apiSecret, passPhrase, baseCurrency } = await jsonfile.readFile(pathToConfig)

    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)
    const accounts = await authedClient.getAccounts()

    const baseAccountId = accounts.filter(account => account.currency == baseCurrency)[0].id

    const baseEvents = (await getAccountHistory(authedClient, baseAccountId, 0)).reverse()
    const t = await authedClient.getAccountTransfers(baseAccountId)
    for (const event of baseEvents) {
        if (event.type == "transfer") {

        } else if (event.type == "match") {

        } else if (event.type == "fee") {

        } else {
        }
    }

    let pru = 0
    let balance = 0

    const accountId = accounts.filter(account => account.currency == 'BTC')[0].id
    const events = (await getAccountHistory(authedClient, accountId, 0)).reverse()

    // Getting orders is quite long; I should have a cache, for exemple in a mongodb database on mLab
    // the pattern would then be to ask to the mLab db first, and if not found ask to coinbase
    for (const e of events.slice(0)) {
        const amount = parseFloat(e.amount)
        const newBalance = balance + amount;

        if (e.type == "match") {
            const order = await authedClient.getOrder(e.details.order_id)
            if (order.side == "buy") {
                pru = newBalance > 0 ? (balance * pru + amount * parseFloat(order.price)) / newBalance : 0
            }
        }
        else if (e.type == "transfer") {

        }

        balance = newBalance
        console.log(pru, balance)
    }
    console.log(balance)
    console.log(pru)
}

(async () => {
    try {
        await main()
    } catch (e) {
        console.error(`${e}`)
        process.exit(-1)
    }
})()