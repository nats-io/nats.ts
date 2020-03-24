/*
 * Copyright 2018-2020 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import {ChildProcess, spawn, execSync} from 'child_process'
import * as net from 'net'
import {Socket} from 'net'
import path from 'path'
import fs from 'fs'
import {URL} from 'url'
import Timer = NodeJS.Timer

const SERVER = (process.env.TRAVIS) ? 'nats-server/nats-server' : 'nats-server'
const PID_DIR = (process.env.TRAVIS) ? process.env.TRAVIS_BUILD_DIR : process.env.TMPDIR

let SERVER_VERSION: any[]

export type Cb = () => void

// context for tests
export interface SC {
  server: Server
  servers: Server[];
}

export interface Ports {
  nats: string[];
  monitoring: string[] | undefined;
  cluster: string[] | undefined;
  profile: string[] | undefined;
}

export interface Server extends ChildProcess {
  args: string[];
  nats: string;
  ports: Ports;
  port: number;
  clusterPort: number;
}

export function natsURL(s: Server): string {
  return s.nats
}

export function wsURL(s: Server): string {
  return s.nats
}

export function getPort(urlString: string): number {
  const u = new URL(urlString)
  return parseInt(u.port, 10)
}

export function addClusterMember(s: Server, optFlags?: string[]): Promise<Server> {
  return new Promise((resolve, reject) => {
    optFlags = optFlags || []
    if (optFlags.indexOf('--routes') !== -1) {
      reject(new Error('addClusterMember doesn\'t take a --routes flag as an option'))
      return
    }

    optFlags = optFlags.concat(['--routes', `nats://127.0.0.1:${s.clusterPort}`])
    startServer(optFlags)
    .then((v) => {
      resolve(v)
    })
    .catch((err) => {
      reject(err)
    })
  })
}

export function startServer(optFlags?: string[]): Promise<Server> {
  return new Promise((resolve, reject) => {
    optFlags = optFlags || []
    let flags: string[] = []

    // filter host
    if (optFlags.indexOf('-a') === -1) {
      flags = flags.concat(['-a', '127.0.0.1'])
    }

    // filter port -p or --port
    if (optFlags.indexOf('-p') === -1 && optFlags.indexOf('--port') === -1) {
      flags = flags.concat(['-p', '-1'])
    }

    if (optFlags.indexOf('--cluster') === -1) {
      flags = flags.concat(['--cluster', 'nats://127.0.0.1:-1'])
    }

    if (optFlags.indexOf('--http_port') === -1 && optFlags.indexOf('-m') === -1) {
      flags = flags.concat(['--m', '-1'])
    }

    flags = flags.concat(['--ports_file_dir', PID_DIR] as string[])

    let port = -1

    if (optFlags) {
      flags = flags.concat(optFlags)
    }

    if (process.env.PRINT_LAUNCH_CMD) {
      // tslint:disable-next-line:no-console
      console.log(flags.join(' '))
    }

    const server = spawn(SERVER, flags) as Server
    // server.stderr.on('data', function (data) {
    //     let lines = data.toString().split('\n');
    //     lines.forEach((m) => {
    //         console.log(m);
    //     });
    // });

    server.args = flags

    const start = Date.now()
    let waitTime: number = 0
    const maxWait = 5 * 1000 // 5 secs
    const delta = 250
    let socket: Socket | null
    let timer: Timer | null

    function resetSocket() {
      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
        socket = null
      }
    }

    function finish(err?: Error) {
      resetSocket()
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (err === undefined) {
        // return where the ws is running
        resolve(server)
        return
      }
      reject(err)
    }

    let count = 50
    new Promise<any>((rslv, rjct) => {
      const t = setInterval(() => {
        --count
        if (count === 0) {
          clearInterval(t)
          rjct('Unable to find the pid')
        }
        // @ts-ignore
        const portsFile = path.join(PID_DIR, `nats-server_${server.pid}.ports`)
        if (fs.existsSync(portsFile)) {
          const data = fs.readFileSync(portsFile).toString()
          const s = (server as Server)
          const ports = JSON.parse(data)
          s.nats = ports.nats[0]
          s.port = port = getPort(server.nats)
          s.clusterPort = getPort(ports.cluster[0])
          s.ports = ports
          clearInterval(t)
          rslv()
        }

      }, 150)
    }).then(() => {
      // Test for when socket is bound.
      timer = (setInterval(() => {
        resetSocket()

        waitTime = Date.now() - start
        if (waitTime > maxWait) {
          finish(new Error('Can\'t connect to server on port: ' + port))
        }

        // Try to connect to the correct port.
        socket = net.createConnection(port)

        // Success
        socket.on('connect', () => {
          if (server.pid === null) {
            // We connected but not to our server..
            finish(new Error('Server already running on port: ' + port))
          } else {
            finish()
          }
        })

        // Wait for next try..
        socket.on('error', (error) => {
          finish(new Error('Problem connecting to server on port: ' + port + ' (' + error + ')'))
        })

      }, delta) as any)
    })
    .catch((err) => {
      reject(err)
    })


    // Other way to catch another server running.
    server.on('exit', (code, signal) => {
      if (code === 1) {
        finish(new Error('Server exited with bad code, already running? (' + code + ' / ' + signal + ')'))
      }
    })

    // Server does not exist..
    // @ts-ignore
    server.stderr.on('data', (data) => {
      if (/^execvp\(\)/.test(data.toString())) {
        if (timer) {
          clearInterval(timer)
        }
        finish(new Error('Can\'t find the ' + SERVER))
      }
    })
  })

}

function wait(server: Server, done?: Cb): void {
  if (server.killed) {
    if (done) {
      done()
    }
  } else {
    setTimeout(() => {
      wait(server, done)
    }, 0)
  }
}

export function stopServer(server: Server | null, done?: Cb): void {
  if (server && !server.killed) {
    server.kill()
    wait(server, done)
  } else if (done) {
    done()
  }
}

export function serverVersion(): any[] {
  if (SERVER_VERSION === undefined) {
    SERVER_VERSION = initServerVersion()
  }
  return SERVER_VERSION
}

function initServerVersion(): any[] {
  const v = execSync(SERVER + ' -v', {
    timeout: 1000
  }).toString()
  return normalizeVersion(v)
}

function normalizeVersion(s: string): any[] {
  s = s.replace('version ', 'v')
  s = s.replace(':', '')
  // 1.x formats differently
  s = s.replace('nats-server ', '')
  s = s.replace('nats-server', '')
  s = s.replace('v', '')
  const i = s.indexOf('-')
  if (i !== -1) {
    s = s.substring(0, i)
  }
  const a = s.split('.')
  a.forEach((v, idx) => {
    const vv = parseInt(v, 10)
    if (!isNaN(vv)) {
      // @ts-ignore
      a[idx] = vv
    }
  })
  return a
}
