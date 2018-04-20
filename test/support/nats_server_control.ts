/*
 * Copyright 2018 The NATS Authors
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

import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {Socket} from 'net';
import Timer = NodeJS.Timer;

let SERVER = (process.env.TRAVIS) ? 'gnatsd/gnatsd' : 'gnatsd';
let DEFAULT_PORT = 4222;

export interface Server extends ChildProcess {
    args: string[];
}


export function start_server(port: number, opt_flags?: string[], done?: Function): Server {
    if (!port) {
        port = DEFAULT_PORT;
    }
    if (typeof opt_flags == 'function') {
        done = opt_flags;
        opt_flags = [];
    }
    let flags = ['-p', port.toString(), '-a', '127.0.0.1'];

    if (opt_flags) {
        flags = flags.concat(opt_flags);
    }

    if (process.env.PRINT_LAUNCH_CMD) {
        console.log(flags.join(" "));
    }

    let server = spawn(SERVER, flags) as Server;
    server.args = flags;

    let start = Date.now();
    let wait: number = 0;
    let maxWait = 5 * 1000; // 5 secs
    let delta = 250;
    let socket: Socket | null;
    let timer: Timer | null;

    function resetSocket() {
        if (socket) {
            socket.removeAllListeners();
            socket.destroy();
            socket = null;
        }
    }

    function finish(err?: Error) {
        resetSocket();
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (done) {
            done(err);
        }
    }

    // Test for when socket is bound.
    timer = setInterval(function () {
        resetSocket();

        wait = Date.now() - start;
        if (wait > maxWait) {
            finish(new Error('Can\'t connect to server on port: ' + port));
        }

        // Try to connect to the correct port.
        socket = net.createConnection(port);

        // Success
        socket.on('connect', function () {
            if (server.pid === null) {
                // We connected but not to our server..
                finish(new Error('Server already running on port: ' + port));
            } else {
                finish();
            }
        });

        // Wait for next try..
        socket.on('error', function (error) {
            finish(new Error("Problem connecting to server on port: " + port + " (" + error + ")"));
        });

    }, delta);

    // Other way to catch another server running.
    server.on('exit', function (code, signal) {
        if (code === 1) {
            finish(new Error('Server exited with bad code, already running? (' + code + ' / ' + signal + ')'));
        }
    });

    // Server does not exist..
    server.stderr.on('data', function (data) {
        if (/^execvp\(\)/.test(data.toString())) {
            if (timer) {
                clearInterval(timer);
            }
            finish(new Error('Can\'t find the ' + SERVER));
        }
    });

    return server;
}

function wait_stop(server: Server, done?: Function): void {
    if (server.killed) {
        if (done) {
            done();
        }
    } else {
        setTimeout(function () {
            wait_stop(server, done);
        }, 0);
    }
}

export function stop_server(server: Server | null, done?: Function): void {
    if (server && !server.killed) {
        server.kill();
        wait_stop(server, done);
    } else if (done) {
        done();
    }
}


// starts a number of servers in a cluster at the specified ports.
// must call with at least one port.
export function start_cluster(ports: number[], route_port: number, opt_flags?: string[], done?: Function): Server[] {
    if (typeof opt_flags == 'function') {
        done = opt_flags;
        opt_flags = [];
    }
    let servers: Server[] = [];
    let started = 0;
    let server = add_member(ports[0], route_port, route_port, opt_flags, () => {
        started++;
        servers.push(server);
        if (started === ports.length && done) {
            done();
        }
    });

    let others = ports.slice(1);
    others.forEach(function (p) {
        let s = add_member(p, route_port, p + 1000, opt_flags, () => {
            started++;
            servers.push(s);
            if (started === ports.length && done) {
                done();
            }
        });
    });
    return servers;
}

// adds more cluster members, if more than one server is added additional
// servers are added after the specified delay.
export function add_member_with_delay(ports: number[], route_port: number, delay: number, opt_flags?: string[], done?: Function): Server[] {
    if (typeof opt_flags == 'function') {
        done = opt_flags;
        opt_flags = [];
    }
    let servers: Server[] = [];
    ports.forEach(function (p, i) {
        setTimeout(function () {
            let s = add_member(p, route_port, p + 1000, opt_flags, function () {
                servers.push(s);
                if (servers.length === ports.length && done) {
                    done();
                }
            });
        }, i * delay);
    });

    return servers;
}

export function add_member(port: number, route_port: number, cluster_port: number, opt_flags?: string[], done?: Function): Server {
    if (typeof opt_flags == 'function') {
        done = opt_flags;
        opt_flags = [];
    }
    opt_flags = opt_flags || [];
    let opts = JSON.parse(JSON.stringify(opt_flags));
    opts.push('--routes', 'nats://localhost:' + route_port);
    opts.push('--cluster', 'nats://localhost:' + cluster_port);

    return start_server(port, opts, done);
}


export function stop_cluster(servers: Server[], done: Function): void {
    let count = servers.length;
    function latch() {
        count--;
        if (count === 0) {
            done();
        }
    }

    servers.forEach(function (s) {
        stop_server(s, latch);
    });
}

export function find_server(pn: number, servers: Server[]): Server | void {
    let port = pn.toString();
    return servers.find(function (s) {
        return s.args[1] === port;
    });
}

let startPort = 6000;
export const nonAllocatedPort = 65000;

export function alloc(): number {
    console.log('alloc', startPort);
    return startPort++;
}

export function allocn(count: number): number[] {
    let a: number[] = [];
    if(count) {
        for(let i=0; i < count; i++) {
            a.push(alloc());
        }
    }
    return a;
}
