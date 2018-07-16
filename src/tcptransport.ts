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


import * as net from "net";
import * as tls from "tls";
import {ConnectionOptions, TLSSocket} from "tls";
import {Transport, TransportHandlers} from "./transport";
import {UrlObject} from "url";

export class TCPTransport implements Transport {
    stream: net.Socket | TLSSocket | null = null;
    handlers: TransportHandlers;
    closed: boolean = false;

    constructor(handlers: TransportHandlers) {
        this.handlers = handlers;
    }

    connect(url: UrlObject): Promise<any> {
        return new Promise((resolve, reject) => {
            // Create the stream
            // See #45 if we have a stream release the listeners
            // otherwise in addition to the leak events will fire fire
            if (this.stream) {
                this.destroy();
            }
            let connected = false;
            // @ts-ignore typescript requires this parsed to a number
            this.stream = net.createConnection(parseInt(url.port, 10), url.hostname, () => {
                connected = true;
                resolve(this);
                this.handlers.connect();
            });
            this.stream.on('error', (error) => {
                if (!connected) {
                    reject(error);
                } else {
                    this.handlers.error(error);
                }
            });
            this.stream.setNoDelay(true);
            this.setupHandlers();
        });
    }

    isClosed(): boolean {
        return this.closed;
    }

    isConnected(): boolean {
        return this.stream != null && !this.stream.connecting;
    }

    isEncrypted(): boolean {
        return this.stream instanceof TLSSocket && this.stream.encrypted;
    }

    isAuthorized(): boolean {
        return this.stream instanceof TLSSocket && this.stream.authorized;
    }

    upgrade(tlsOptions: any, done: Function): void {
        if (!this.stream) {
            return
        }

        let opts: ConnectionOptions;
        if ('object' === typeof tlsOptions) {
            opts = tlsOptions as ConnectionOptions;
        } else {
            opts = {} as ConnectionOptions;
        }
        opts.socket = this.stream;
        this.stream.removeAllListeners();
        this.stream = tls.connect(opts, () => {
            done();
        });
        this.stream.on('error', (error) => {
            this.handlers.error(error);
        });
        this.setupHandlers();
    }

    write(data: Buffer | string): void {
        // if(typeof data === 'string') {
        //     console.log('>', [data]);
        // } else {
        //     console.log('>', [data.toString('binary')]);
        // }
        if (!this.stream) {
            return;
        }
        this.stream.write(data);
    }

    destroy(): void {
        if (!this.stream) {
            return;
        }
        if (this.closed) {
            this.stream.removeAllListeners();
        }
        this.stream.destroy();
        this.stream = null;
    }

    close(): void {
        this.closed = true;
        this.destroy();
    }

    pause(): void {
        if (!this.stream) {
            return;
        }
        this.stream.pause()
    }

    resume(): void {
        if (!this.stream) {
            return;
        }
        this.stream.resume();
    }

    private setupHandlers(): void {
        if (!this.stream) {
            return;
        }
        this.stream.on('close', this.handlers.close);
        this.stream.on('data', this.handlers.data);
    }
}