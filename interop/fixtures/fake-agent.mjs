/* A stand-in for Claude Code and Codex, so the helper's guards can be tested
   without an account. It speaks both real output formats. The two failure
   transcripts below are not invented: they are what the real programs printed
   on the machine this was built on (an expired Claude Code sign-in stalls after
   `init`; an outdated Codex CLI is refused by the API).

   The helper passes the model name as an argument, so the tests use it to say
   how this stand-in should behave:  --model <mode>  or  -m <mode>            */
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('stand-in agent 1.0 (not a real one)'); process.exit(0); }
const flag = (...names) => { for (const n of names) { const i = argv.indexOf(n); if (i >= 0) return argv[i + 1]; } return null; };
const mode = flag('--model', '-m') || 'ok';
const asCodex = argv[0] === 'exec';
const say = o => process.stdout.write(JSON.stringify(o) + '\n');
const dump = process.env.FAKE_DUMP;

let stdin = '';
process.stdin.on('data', d => { stdin += d; });
process.stdin.on('end', () => {
  if (dump) fs.writeFileSync(dump, JSON.stringify({ argv, stdin, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), pid: process.pid,
    sawToken: 'BYLINE_HELPER_TOKEN' in process.env }));

  if (mode === 'stall') {                     // real: Claude Code with an expired sign-in
    say({ type: 'system', subtype: 'init', tools: [], mcp_servers: [], model: 'claude-sonnet-4-6' });
    /* detached: Node on Windows takes its ordinary children down with it, which a real
       agent (Bun, Rust) does not do — so an ordinary child would prove nothing about the tree kill */
    const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
    kid.unref();
    if (dump) fs.writeFileSync(dump + '.pids', JSON.stringify({ parent: process.pid, child: kid.pid }));
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'flood') { say({ type: 'system', subtype: 'init' }); setInterval(() => say({ type: 'noise', pad: 'x'.repeat(8192) }), 1); return; }
  if (mode === 'codex-old') {                 // real: Codex CLI older than the account's model wants
    const inner = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error',
      message: "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again." } });
    say({ type: 'thread.started', thread_id: '00000000-0000-0000-0000-000000000000' });
    say({ type: 'turn.started' });
    process.stdout.write('SUCCESS: The process with PID 50844 (child process of PID 35380) has been terminated.\n');
    say({ type: 'error', message: inner });
    say({ type: 'turn.failed', error: { message: inner } });
    process.exit(1);
  }
  if (mode === 'slow') { say(asCodex ? { type: 'turn.started' } : { type: 'system', subtype: 'init' });
    setTimeout(() => { say({ type: 'assistant', message: { content: [{ type: 'text', text: 'slow but here' }] } });
      say({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 3 } }); process.exit(0); }, 900); return; }

  const reply = 'I read ' + stdin.length + ' characters and have nothing to add.';
  if (asCodex) {
    say({ type: 'thread.started', thread_id: 't' }); say({ type: 'turn.started' });
    say({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'thinking' } });
    say({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls', status: 'completed' } });
    say({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: reply } });
    say({ type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 0, output_tokens: 14 } });
  } else {
    say({ type: 'system', subtype: 'init', tools: [], mcp_servers: [], model: 'claude-sonnet-4-6' });
    say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'harbour dredging licence' } }] } });
    say({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } });
    say({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: reply, usage: { input_tokens: 210, output_tokens: 16 } });
  }
  process.exit(0);
});
