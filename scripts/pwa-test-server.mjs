// Test-only deployment switch. Never used by the production build or Vercel.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('dist')
let release = 1
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const index = await readFile(resolve(root, 'index.html'), 'utf8')
function html() { return index.replace('</head>', `<meta name="test-release" content="${release}"></head>`) }
createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4173').pathname)
  if (request.method === 'POST' && path === '/__test/release') { release++; response.end('ok'); return }
  const file = resolve(root, `.${path}`)
  if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return }
  try {
    let data
    let type = types[extname(file)] ?? 'text/html'
    if (path === '/sw.js') {
      data = (await readFile(file, 'utf8')).replace(/"revision":"[^"]+","url":"index.html"/, `"revision":"${createHash('md5').update(html()).digest('hex')}","url":"index.html"`)
    } else if (type === 'text/html') data = html()
    else data = await readFile(file)
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data)
  } catch { response.writeHead(404).end() }
}).listen(4173, '127.0.0.1')
