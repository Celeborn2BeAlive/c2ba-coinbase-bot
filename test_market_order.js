const jsonfile = require('jsonfile-promised');
const path = require('path')
const Gdax = require('gdax')
const { timeout, coinbaseURI } = require('./utils')

// Test on sandbox
const { sandbox: apiURI } = coinbaseURI

async function main() {
    const pathToConfig = process.argv[2]
    const { apiKey, apiSecret, passPhrase } = await jsonfile.readFile(pathToConfig)
    const publicClient = new Gdax.PublicClient(apiURI)
    const authedClient = new Gdax.AuthenticatedClient(apiKey, apiSecret, passPhrase, apiURI)

    const deposit = false

    if (deposit) {
        const account = (await authedClient.getCoinbaseAccounts()).filter(a => a.currency == 'EUR')[0]
        console.log(account)

        const depositParams = {
            currency: 'EUR',
            coinbase_account_id: account.id,
            amount: '100000'
        }
        const deposit = await authedClient.deposit(depositParams)
        console.log(deposit)

        return
    }

    // Notes:
    // Market orders can be tricky
    // Either size or funds must be specified
    // size can be dangerous, because if you try to buy more BTC than the account can afford, it spend
    // the maximum it can, with no error. time_in_force = Fill or Kill cannot be used because it is only for limit orders
    // funds allows to buy BTC for a specific quantity of EUR; also, it can buy less BTC than the base_min_size specified for the product
    // (eg if the base_min_size of BTC is 0.001, you can still buy less with a market order having 'funds' low enough such that 'funds' / current_price < 0.001)
    // However funds must be higher than the quote_increment, and a multiple of it

    const params = {
        side: 'buy',
        type: 'market',
        size: '0.01',
        //funds: '1000',
        product_id: `BTC-EUR`,
    };

    const result = await authedClient.placeOrder(params)
    console.log(result)

    const order = await authedClient.getOrder(result.id)
    console.log(order)
}

main()