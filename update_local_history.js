const jsonfile = require('jsonfile-promised')
const fs = require('fs')
const Gdax = require('gdax')
const Aigle = require('aigle')
const { chain } = Aigle.mixin(require('lodash'))
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

    const previousHistory = fs.existsSync(pathToLocalHistory) ?
        await jsonfile.readFile(pathToLocalHistory) :
        { accounts: {}, orders: {} }
    const registeredAccounts = previousHistory.accounts

    const { apiKey, apiSecret, passPhrase } = await jsonfile.readFile(pathToConfig)

    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)

    const getAccountHistoryAndTransfers = async account => {
        const registeredTransfers = registeredAccounts[account.id] ?
            registeredAccounts[account.id].transfers :
            {}
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

    const updatedAccounts = await chain(authedClient.getAccounts())
        .map(getAccountHistoryAndTransfers)
        .filter(account => { return account.history.length > 0 || Object.keys(account.transfers).length > 0 })

    const getOrderIdsOfAccount = account =>
        account.history
            .filter(event => "order_id" in event.details)
            .map(event => event.details.order_id)

    const currentOrders = previousHistory.orders
    const newOrders = await chain(updatedAccounts)
        .map(getOrderIdsOfAccount)
        .reduce((prev, curr) => curr.concat(prev))
        .uniq()
        .filter(order => !(order in currentOrders))
        .map((orderId, index, ordersToRequest) => {
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