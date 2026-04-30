const http = require('http');
http.get('http://localhost:3000/api/stock/candles?symbol=BINANCE:BTCUSDT&resolution=D&from=1714348800&to=1745884800', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const data = JSON.parse(body);
    let isSorted = true;
    for (let i = 1; i < data.candles.length; i++) {
      if (data.candles[i].time <= data.candles[i-1].time) {
        console.log('Error at index', i, ':', data.candles[i-1].time, '>=', data.candles[i].time);
        isSorted = false;
        break;
      }
    }
    console.log('Is sorted:', isSorted);
    console.log('Length:', data.candles.length);
  });
});
