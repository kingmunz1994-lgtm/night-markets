import { WebSocket } from 'ws';
const ws = new WebSocket('wss://indexer.preprod.midnight.network/api/v3/graphql/ws', ['graphql-transport-ws']);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
});
ws.on('message', (msg) => {
  const data = JSON.parse(msg.toString());
  if (data.type === 'connection_ack') {
    ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: 'subscription { unshieldedTransactions(address: "mn_addr_preprod1d0u8sxgft0vhatft73k0gghrk0phlwd8653ajvmtl7q7gxduheaqsq95qj") { __typename ... on UnshieldedTransactionsProgress { highestTransactionId } ... on UnshieldedTransaction { createdUtxos { owner value tokenType } } } }' } }));
  }
  if (data.type === 'next') {
    console.log(JSON.stringify(data.payload, null, 2));
  }
  if (data.type === 'error') {
    console.log('error:', JSON.stringify(data.payload));
    ws.close();
  }
});
setTimeout(() => { console.log('done'); ws.close(); }, 10000);
