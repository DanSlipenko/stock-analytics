const http = require('http');
http.get('http://localhost:3000/api/stock/candles?symbol=BINANCE:BTCUSDT&resolution=D&from=1714348800&to=1777500000', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const data = JSON.parse(body);
    const last = data.candles[data.candles.length - 1];
    console.log('Last time:', last.time);
    console.log('Is exactly midnight UTC:', last.time % 86400 === 0);
  });
});
