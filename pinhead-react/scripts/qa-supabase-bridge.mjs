// QA-мост: dev-only Vite-плагин, проксирующий /sb/* на Supabase через curl.
// Зачем: в облачном контейнере исходящий HTTPS идёт через локальный прокси,
// порт которого меняется при перезапусках — браузер с «протухшим» портом
// теряет REST к Supabase (ERR_CONNECTION_RESET). curl запускается на каждый
// запрос в свежем окружении и всегда берёт актуальный $HTTPS_PROXY, поэтому
// браузеру достаточно ходить на localhost.
// Включение: QA_SB_BRIDGE=1 npm run dev + VITE_SUPABASE_URL=http://127.0.0.1:5173/sb
// Realtime (wss) мост не поддерживает — известное ограничение QA-окружения.
import { spawn } from 'node:child_process'

const TARGET = 'https://glhwbktsokphgksdvcxj.supabase.co'
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'te', 'trailer', 'accept-encoding',
])

export function qaSupabaseBridge() {
  return {
    name: 'qa-supabase-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sb', (req, res) => {
        const url = TARGET + req.url
        const args = ['-sS', '--suppress-connect-headers', '--max-time', '60', '-X', req.method, '-D', '-', '--output', '-']
        for (const [k, v] of Object.entries(req.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase()) && v != null) {
            for (const vv of Array.isArray(v) ? v : [v]) args.push('-H', `${k}: ${vv}`)
          }
        }
        if (!['GET', 'HEAD'].includes(req.method)) args.push('--data-binary', '@-')
        args.push(url)

        const curl = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
        if (!['GET', 'HEAD'].includes(req.method)) req.pipe(curl.stdin)
        else curl.stdin.end()

        let raw = Buffer.alloc(0)
        let headersDone = false
        curl.stdout.on('data', (chunk) => {
          if (headersDone) { res.write(chunk); return }
          raw = Buffer.concat([raw, chunk])
          // куски заголовков могут идти сериями (редиректы не ждём — Supabase их не шлёт)
          const sep = raw.indexOf('\r\n\r\n')
          if (sep === -1) return
          const head = raw.slice(0, sep).toString('utf8')
          const body = raw.slice(sep + 4)
          const [statusLine, ...headerLines] = head.split('\r\n')
          const status = Number(statusLine.split(' ')[1]) || 502
          res.statusCode = status
          for (const line of headerLines) {
            const i = line.indexOf(':')
            if (i === -1) continue
            const name = line.slice(0, i).trim().toLowerCase()
            if (HOP_BY_HOP.has(name) || name === 'content-encoding' || name === 'content-length') continue
            try { res.setHeader(name, line.slice(i + 1).trim()) } catch { /* invalid header — skip */ }
          }
          headersDone = true
          if (body.length) res.write(body)
        })
        curl.on('close', (code) => {
          if (!headersDone) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: 'qa-bridge: curl failed', code }))
          } else {
            res.end()
          }
        })
        curl.on('error', () => {
          if (!res.headersSent) res.statusCode = 502
          res.end()
        })
      })
    },
  }
}
