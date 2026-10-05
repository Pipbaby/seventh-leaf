#!/usr/bin/env python3
"""Seventh Leaf's launcher for macOS and Linux (started by "Start Seventh Leaf.command").

The same as serve.ps1 on Windows: a small web server for this folder, reachable only from this
computer (127.0.0.1), on a fixed port so the browser finds its saved library again. Every copy
answers GET /__seventh-leaf with its version and folder. Before starting, the launcher asks the
ports in turn: the same copy already running is simply opened again; another copy (an older
version, or another folder) is stopped and replaced; a port held by another program is skipped.

    python3 tools/launcher/serve.py [--no-browser] [--port N]
"""
import http.client
import http.server
import json
import os
import re
import socket
import sys
import time
import urllib.parse
import webbrowser

PORTS = list(range(41777, 41787))
ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
VERSION = '?'
try:
    with open(os.path.join(ROOT, 'CHANGELOG.md'), encoding='utf-8') as f:
        m = re.search(r'^## (\d+\.\d+\.\d+)', f.read(), re.M)
        if m:
            VERSION = m.group(1)
except OSError:
    pass

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
    '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg', '.wav': 'audio/wav', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
}
PART = 8 << 20  # open-ended ranges are served in parts of at most 8 MB


def ask(port, method, path, headers=None):
    """One request to 127.0.0.1 (no proxy settings involved); None if nothing answers."""
    try:
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        c.request(method, path, headers=headers or {})
        r = c.getresponse()
        body = r.read()
        c.close()
        return r.status, body
    except (OSError, http.client.HTTPException):
        return None


def probe(port):
    """What is on a port: 'free', 'other' (another program), or a Seventh Leaf copy's details."""
    r = ask(port, 'GET', '/__seventh-leaf')
    if r is None:
        return 'free'
    try:
        info = json.loads(r[1])
        if info.get('app') == 'seventh-leaf':
            return info
    except (ValueError, AttributeError):
        pass
    return 'other'


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def reply(self, code, text, kind='text/plain; charset=utf-8', extra=None):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def end_headers(self):
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.close_connection = True
        super().end_headers()

    def addressed_here(self):
        # only requests addressed to this server, so another web page cannot reach it under a borrowed name
        port = self.server.server_address[1]
        if self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}'):
            return True
        self.reply(421, 'Not for this server')
        return False

    def do_POST(self):
        if not self.addressed_here():
            return
        # a web page cannot send this header without asking first (CORS), and this server never agrees
        if self.path == '/__seventh-leaf/quit' and self.headers.get('X-Seventh-Leaf') == 'quit':
            self.reply(200, 'stopping')
            self.server.replaced = True
            self.server.running = False
        else:
            self.reply(403, 'No')

    def do_OPTIONS(self):
        self.reply(405, 'GET only')

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.addressed_here():
            return
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path == '/__seventh-leaf':
            info = {'app': 'seventh-leaf', 'version': VERSION, 'root': ROOT, 'pid': os.getpid()}
            return self.reply(200, json.dumps(info), 'application/json; charset=utf-8')
        if path == '/__seventh-leaf/quit':
            return self.reply(403, 'No')
        file = os.path.realpath(os.path.join(ROOT, path.lstrip('/').replace('\\', '/')))
        if file != ROOT and not file.startswith(ROOT + os.sep):
            return self.reply(403, 'Outside the project folder')
        if os.path.isdir(file):
            file = os.path.join(file, 'index.html')
        if not os.path.isfile(file):
            return self.reply(404, 'Not found')
        kind = TYPES.get(os.path.splitext(file)[1].lower(), 'application/octet-stream')
        size = os.path.getsize(file)
        start, count, code = 0, size, 200
        extra = {'Accept-Ranges': 'bytes'}
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range') or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else min(size - 1, start + PART - 1)
            else:
                start, end = max(0, size - int(m.group(2))), size - 1
            if start >= size or end < start:
                return self.reply(416, '', extra={'Content-Range': f'bytes */{size}'})
            count, code = end - start + 1, 206
            extra['Content-Range'] = f'bytes {start}-{end}/{size}'
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(count))
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(file, 'rb') as f:
            f.seek(start)
            left = count
            while left > 0:
                chunk = f.read(min(1 << 18, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # never share a port with another program (on Windows, SO_REUSEADDR would allow exactly that)
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    args = sys.argv[1:]
    browser = '--no-browser' not in args
    ports = [int(args[args.index('--port') + 1])] if '--port' in args else PORTS
    say = lambda text='': print('  ' + text if text else '', flush=True)
    print()
    say(f'Seventh Leaf {VERSION}')
    say(ROOT)
    print()
    server, skipped = None, []
    for p in ports:
        there = probe(p)
        if there == 'other':
            skipped.append(p)
            continue
        if isinstance(there, dict):
            if there.get('version') == VERSION and there.get('root') == ROOT:
                say(f'Seventh Leaf is already running at http://127.0.0.1:{p}/ - opening it.')
                if browser:
                    webbrowser.open(f'http://127.0.0.1:{p}/')
                return 0
            say(f"Another copy is running on this address: version {there.get('version')} from")
            say(f"  {there.get('root')}")
            say('It is being stopped and replaced by this one.')
            print()
            ask(p, 'POST', '/__seventh-leaf/quit', {'X-Seventh-Leaf': 'quit'})
            for _ in range(50):
                if not isinstance(probe(p), dict):
                    break
                time.sleep(0.1)
        try:
            server = Server(('127.0.0.1', p), Handler)
            break
        except OSError:
            skipped.append(p)  # in use, or reserved by the system
    if not server:
        say(f'Could not start: ports {ports[0]}-{ports[-1]} are all in use by other programs.')
        say('Close some programs, or restart the computer, and try again.')
        return 1
    port = server.server_address[1]
    if skipped:
        say(f"Port {', '.join(map(str, skipped))} is used by another program, so Seventh Leaf uses {port}.")
        say('Pictures, settings and folders are remembered per address: at this one the library')
        say(f'starts empty, and comes back once port {ports[0]} is free again.')
        print()
    say(f'Running at http://127.0.0.1:{port}/')
    say('Only this computer can reach it. Close this window (or press Ctrl+C) to stop Seventh Leaf.')
    print()
    if browser:
        webbrowser.open(f'http://127.0.0.1:{port}/')
    server.running = True
    server.replaced = False
    server.timeout = 0.25
    try:
        while server.running:
            server.handle_request()
    except KeyboardInterrupt:
        pass
    server.server_close()
    if server.replaced:
        say('Stopped: another copy of Seventh Leaf was started and took over this address.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
