const { createInterface } = require('node:readline');
const { appendFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.IVM_TEST_SCENARIO || 'ok';
const log = (data) => { if (process.env.IVM_TEST_LOG) appendFileSync(process.env.IVM_TEST_LOG, JSON.stringify({ pid: process.pid, ...data }) + '\n'); };
const send = (data) => process.stdout.write(JSON.stringify(data) + '\n');
let thread = 0;
log({ event: 'process-start' });
if (mode === 'stubborn-descendant') {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
  log({ event: 'descendant', childPid: child.pid });
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  log({ event: method, refreshToken: params?.refreshToken });
  if (method === 'initialized') return;
  if (method === 'initialize') {
    if (mode === 'hang-init') return;
    if (mode === 'slow-init') return setTimeout(() => send({ id, result: {} }), 80);
    return send({ id, result: {} });
  }
  if (method === 'account/read') {
    if (mode === 'hang-account' || mode === 'stubborn-descendant') return;
    if (mode === 'crash-account') return process.exit(7);
    return send({ id, result: { account: mode === 'expired' ? null : { type: 'chatgpt', planType: 'test' } } });
  }
  if (method === 'model/list') return send({ id, result: { data: [{ id: 'gpt-5.6-terra' }] } });
  if (method === 'thread/start') return send({ id, result: { thread: { id: 'thread-' + (++thread) } } });
  if (method === 'turn/start') {
    const turnId = 'turn-' + thread;
    send({ id, result: { turn: { id: turnId } } });
    send({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: turnId } } });
    if (mode === 'hang-turn') return;
    setTimeout(() => {
      send({ method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: 'OK' } } });
      send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: turnId, status: mode === 'fail-turn' ? 'failed' : 'completed' } } });
      log({ event: 'turn-finished' });
    }, 40);
    return;
  }
  if (method === 'thread/unsubscribe' && mode === 'hang-cleanup') return;
  if (id !== undefined) send({ id, result: {} });
});
