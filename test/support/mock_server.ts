/*
 * Copyright 2013-2018 The NATS Authors
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
 */

import * as net from 'net';
import * as nuid from 'nuid';
import * as events from 'events';
import * as util from 'util';
import {Server, Socket} from "net";
import {EventEmitter} from "events";


const MAX_CONTROL = 1048576;

const PING = /^PING\r\n/i;
const CONNECT = /^CONNECT\s+([^\r\n]+)\r\n/i;

// default script handles a connect, and initial ping
function defaultScript(): Script[] {
    let script = [];
    script.push({
        re: CONNECT,
        h: sendOk,
        m: "connect"
    });
    script.push({
        re: PING,
        h: sendPong,
        m: "ping"
    });
    return script;
}

export interface Script {
    re: RegExp;
    h: ScriptHandler
    m: string
}

export interface handler {
    (...args: any[]): void;
}

export interface ScriptHandler {
    (socket: Socket, match: RegExpExecArray | null): void;
}

export interface Client extends Socket {
    buffer?: Buffer;
    script: Script[];
}

export class ScriptedServer extends EventEmitter {
    port: number;
    id: string;
    script: Script[];
    stream!: Server;
    sockets: Socket[];
    buffer!: Buffer;

    constructor(port: number, script?: Script[]) {
        super();
        this.port = port;
        this.sockets = [];
        this.id = nuid.next();
        this.script = script || defaultScript();
    }

    start() {
        this.stream = net.createServer((socket: Socket) => {
            this.emit('connect_request');
            this.sendInfo(socket);
            let client: Client = socket as Client;
            client.script = Array.from(this.script);
            client.on('data', this.handleData(this, client));
        });

        this.stream.on('connection', (socket) => {
            this.sockets.push(socket);
        });

        this.stream.on('close', () => {
            this.emit('close');
        });

        this.stream.on('error', (ex) => {
            this.emit('error', ex);
        });

        this.stream.on('listening', () => {
            this.emit('listening');
        });

        this.stream.listen(this.port);
    };

    stop(cb?: Function) {
        this.stream.close(cb);
        if (this.sockets) {
            this.sockets.forEach(function (socket) {
                if (!socket.destroyed) {
                    socket.destroy();
                }
            });
        }
    };

    sendInfo(socket: Socket) {
        socket.write("INFO " + JSON.stringify({
            server_id: "TEST",
            version: "0.0.0",
            node: "node0.0.0",
            host: "127.0.0.1",
            port: this.port,
            auth_required: false,
            ssl_required: false,
            tls_required: false,
            tls_verify: false,
            max_payload: MAX_CONTROL
        }) + "\r\n");
    }


    handleData(server: ScriptedServer, client: Client): handler {
        return function (data): void {
            // if we have a buffer append to it or make one
            if (client.buffer) {
                client.buffer = Buffer.concat([client.buffer, data]);
            } else {
                client.buffer = data;
            }

            if (client.buffer) {
                // convert to string like node-nats does so we can test protocol
                let buf = client.buffer.toString('binary', 0, MAX_CONTROL);
                if (client.script.length) {
                    let match = client.script[0].re.exec(buf);
                    if (match) {
                        // if we have a match, execute the handler
                        client.script[0].h(client, match);

                        // prune the buffer without the processed request
                        let len = match[0].length;
                        if (len >= client.buffer.length) {
                            delete client.buffer;
                        } else {
                            client.buffer = client.buffer.slice(len);
                        }

                        // delete the script step
                        client.script.shift();
                    } else {
                        server.emit('warn', 'no match:\n' + colorize(buf));
                    }
                } else {
                    server.emit('info', 'no more script handlers, ignoring:\n' + colorize(buf));
                }
            }
        };
    }
}


function colorize(str: string) {
    return str.replace(/(?:\r\n)/g, '\\r\\n\n');
}

export function sendOk(socket: Socket): void {
    socket.write("+OK\r\n");
}

export function sendPing(socket: Socket): void {
    socket.write("PING\r\n");
}

export function sendPong(socket: Socket): void {
    socket.write("PONG\r\n");
}
