const jsonfile = require('jsonfile-promised')
const fs = require('fs')
const Gdax = require('gdax')
const Aigle = require('aigle')
const { flow, filter, map, chain, union, uniq, curry } = Aigle.mixin(require('lodash'))
const { coinbaseURI, getAccountHistory, arrayToObject } = require('./utils')

const { api: apiURI } = coinbaseURI

async function main() {
    const pathToConfig = process.argv[2]
    if (!pathToConfig) {
        throw new Error("No path to config file provided.")
    }

    const pathToLocalHistory = process.argv[3]
    if (!pathToLocalHistory) {
        throw new Error("No path to local history file provided.")
    }

    const currentHistory = fs.existsSync(pathToLocalHistory) ? await jsonfile.readFile(pathToLocalHistory) : { accounts: {}, orders: {} }
    const registeredAccounts = currentHistory.accounts

    const { apiKey, apiSecret, passPhrase } = await jsonfile.readFile(pathToConfig)

    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)
    const accounts = await authedClient.getAccounts()

    const getAccountHistoryAndTransfers = async account => {
        const registeredTransfers = registeredAccounts[account.id] ? registeredAccounts[account.id].transfers : {}
        const coinbaseTransfers = arrayToObject(await authedClient.getAccountTransfers(account.id), "id")
        const transfers = {
            ...registeredTransfers,
            ...coinbaseTransfers
        }
        const currentHistory = registeredAccounts[account.id] ? registeredAccounts[account.id].history : []
        const history = await getAccountHistory(authedClient, account.id, currentHistory)
        return {
            ...account,
            history,
            transfers
        }
    }

    const updatedAccounts = await
        chain(accounts)
            .map(getAccountHistoryAndTransfers)
            .filter(account => { return account.history.length > 0 || Object.keys(account.transfers).length > 0 })

    const getAccountOrderIds = account =>
        account.history
            .filter(event => "order_id" in event.details)
            .map(event => event.details["order_id"])

    const allOrders = await
        chain(updatedAccounts)
            .map(getAccountOrderIds)
            .reduce((prev, curr) => curr.concat(prev))
            .uniq()

    const currentOrders = currentHistory.orders
    const ordersToRequest = allOrders.filter(order => !(order in currentOrders))

    const newOrders = await
        chain(allOrders)
            .filter(order => !(order in currentOrders))
            .map((orderId, index) => {
                console.log(`Requesting order ${orderId} (${index}/${ordersToRequest.length - 1})`)
                return authedClient.getOrder(orderId)
            })
            .thru(orders => arrayToObject(orders, "id"))

    const formatedHistory = {
        accounts: arrayToObject(updatedAccounts, 'id'),
        orders: { ...newOrders, ...currentOrders }
    }

    jsonfile.writeFile(pathToLocalHistory, formatedHistory, { spaces: 2 })
}

main()