const jsonfile = require('jsonfile-promised')
const fs = require('fs')
const Gdax = require('gdax')
const Aigle = require('aigle')
const { flow, filter, map, chain, union, uniq, curry } = Aigle.mixin(require('lodash'))
const { coinbaseURI, getAccountHistory, arrayToObject } = require('./utils')

const { api: apiURI } = coinbaseURI

class CoinbaseDoneOrder {
    id = ""
    client_oid = "" // optional, can be set by client to identify order
    product_id = ""
    side = "" // buy or sell
    created_at = ""
    done_at = ""
    done_reason = "" // filled ?
    fill_fees = ""
    filled_size = ""
    executed_value = "" // not sure what it is, seems to be funds or size * market_price - fees, but not sure
    stp = "" // optional, self trade prevention flag, dc, co, cn, cb
    stop = "" // optional, either loss or entry
    stop_price = "" // optional, trigger price
    status = "done"
}

class CoinbaseDoneLimitOrder extends CoinbaseOrder {
    type = "limit"
    price = "" // Price per base asset unit
    size = "" // Amount of base asset unit to trade
    time_in_force = "GTC" // optional, GTC, GTT, IOC or FOK
    cancel_after = "" // optional, min, hour or day
    post_only = false // optional, true or false, invalid if time in force is IOC or FOK
}

class CoinbaseDoneMarketOrder extends CoinbaseOrder {
    type = "market"
    post_only = false // only false is possible
    // either size or funds is specified
    size = "" // quantity of base asset to trade
    funds = "" // quantity of quoted asset dedicated to the trade
    specified_funds = "" // funds + quantity of quanted asset for the fees (amount specified when buying)
}

class CoinbaseHistoryItemMatchDetails {
    order_id = ""
    trade_id = ""
    product_id = "" // 'base_currency'-'quote_currency'
}

class CoinbaseHistoryItemTransferDetails {
    transfer_id = ""
    transfer_type = ""
}

class CoinbaseHistoryItem {
    created_at = "" // YYYY-MM-DDThh:mm:ss.usecZ
    id = ""
    amount = ""
    balance = ""
}

class CoinbaseHistoryMatchItem extends CoinbaseHistoryItem {
    type = "match"
    details = {
        order_id: "",
        trade_id: "",
        product_id: ""
    }
}

class CoinbaseHistoryTransferItem extends CoinbaseHistoryItem {
    type = "transfer"
    details = {
        transfer_id: "",
        transfer_type: "" // deposit or withdraw
    }
}

class CoinbaseAccount {
    id = ""
    currency = ""
    balance = ""
    available = ""
    hold = ""
    profile_id = ""
    history = []
    transfers = []
}

class CoinbaseHistory {
    accounts = {} // All accounts, identified by their coinbase ID
    orders = {} // All orders referenced by account history, identified by their coinbase ID
}

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