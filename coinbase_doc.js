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