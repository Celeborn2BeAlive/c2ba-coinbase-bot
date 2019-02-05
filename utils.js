function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const coinbaseURI = {
    'api': 'https://api.pro.coinbase.com',
    'sandbox': 'https://api-public.sandbox.pro.coinbase.com'
}

async function getAccountHistory(authedClient, accountId, currentHistory) {
    const before = currentHistory.length > 0 ? currentHistory[0].id : 1
    const h = await (async () => {
        return await authedClient.getAccountHistory(accountId, { before })
    })()
    return h.length > 0 ? (await getAccountHistory(authedClient, accountId, h.concat(currentHistory))) : currentHistory
}

function arrayToObject(array, keyField) {
    return array.reduce((obj, item) => {
        obj[item[keyField]] = item
        return obj
    }, {})
}

module.exports = {
    timeout,
    coinbaseURI,
    getAccountHistory,
    arrayToObject
}