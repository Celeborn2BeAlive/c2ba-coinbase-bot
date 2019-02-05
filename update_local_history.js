const jsonfile = require('jsonfile-promised')
const fs = require('fs')
const Gdax = require('gdax')
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

    const updatedAccounts = (await Promise.all(accounts.map(async account => {
        const transfers = {
            ...(registeredAccounts[account.id] ? registeredAccounts[account.id].transfers : {}),
            ...arrayToObject(await authedClient.getAccountTransfers(account.id), "id")
        }
        const currentHistory = registeredAccounts[account.id] ? registeredAccounts[account.id].history : []
        const history = await getAccountHistory(authedClient, account.id, currentHistory)
        return {
            ...account,
            history,
            transfers
        }
    }))).filter(account => account.history.length > 0 || Object.keys(account.transfers).length > 0)

    const allOrders = [...new Set(updatedAccounts.map(account => {
        return account.history.filter(event => "order_id" in event.details).map(event => event.details["order_id"])
    }).reduce((previous, current) => previous.concat(current), []))]

    const currentOrders = currentHistory.orders
    const ordersToRequest = allOrders.filter(order => !(order in currentOrders))
    const newOrders = arrayToObject(await Promise.all(ordersToRequest.map(async (orderId, index) => {
        console.log(`Requesting order ${orderId} (${index}/${ordersToRequest.length - 1})`)
        return await authedClient.getOrder(orderId)
    })), "id")

    const formatedHistory = {
        accounts: arrayToObject(updatedAccounts, 'id'),
        orders: { ...newOrders, ...currentOrders }
    }

    jsonfile.writeFile(pathToLocalHistory, formatedHistory, { spaces: 2 })
}

main()