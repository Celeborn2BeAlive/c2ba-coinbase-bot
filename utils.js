function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const coinbaseURI = {
    'api': 'https://api.pro.coinbase.com',
    'sandbox': 'https://api-public.sandbox.pro.coinbase.com'
}

module.exports = {
    timeout,
    coinbaseURI
}