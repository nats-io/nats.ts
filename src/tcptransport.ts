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

import * as net from 'net';
import * as tls from 'tls';
import {ConnectionOptions, TLSSocket} from 'tls';
import {Transport, TransportHandlers} from './transport';
import {UrlObject} from 'url';
import {Messages, NatsError, ErrorCode} from "./error";

/**
 * @hidden
 */
export class TCPTransport implements Transport {
    connectedOnce: boolean = false;
    stream: net.Socket | TLSSocket | null = null;
    handlers: TransportHandlers;
    closed: boolean = false;
    dialTime: number = 0;


    constructor(handlers: TransportHandlers) {
        this.handlers = handlers;
    }

    connect(url: UrlObject, timeout?: number): Promise<any> {
        let dialStart = 0;
        if(timeout) {
            dialStart = Date.now();
        }
        return new Promise((resolve, reject) => {
            // Create the stream
            // See #45 if we have a stream release the listeners
            // otherwise in addition to the leak events will fire fire
            if (this.stream) {
                this.destroy();
            }
            let connected = false;
            let to: NodeJS.Timeout | undefined;
            if(timeout) {
                to = setTimeout(() => {
                    if (!this.connectedOnce) {
                        reject(NatsError.errorForCode(ErrorCode.CONN_TIMEOUT));
                        this.destroy();
                    } else {
                        // if the client didn't resolve, the error handler
                        // is not set, so emitting 'error' will shutdown node
                        this.handlers.error(NatsError.errorForCode(ErrorCode.CONN_TIMEOUT));
                    }
                }, timeout);
            }
            // @ts-ignore typescript requires this parsed to a number
            this.stream = net.createConnection(parseInt(url.port, 10), url.hostname, () => {
                if(to) {
                    this.dialTime = Date.now() - dialStart;
                    clearTimeout(to);
                    to = undefined;
                }
                resolve();
                connected = true;
                this.connectedOnce = true;
                this.handlers.connect();
            });
            // @ts-ignore
            this.stream.setNoDelay(true);
            // @ts-ignore
            this.stream.on('error', (error) => {
                if (!this.connectedOnce) {
                    reject(error);
                    this.destroy();
                } else {
                    // if the client didn't resolve, the error handler
                    // is not set, so emitting 'error' will shutdown node
                    this.handlers.error(error);
                }
            });
            // @ts-ignore
            this.stream.on('close', () => {
                if (this.connectedOnce) {
                    this.handlers.close();
                }
            });
            // @ts-ignore
            this.stream.on('data', (data: Buffer) => {
                // console.log('data', '< ', data.toString());
                this.handlers.data(data);
            });
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
        if (this.stream) {
            let opts: ConnectionOptions;
            if ('object' === typeof tlsOptions) {
                opts = tlsOptions as ConnectionOptions;
            } else {
                opts = {} as ConnectionOptions;
            }
            opts.socket = this.stream;
            this.stream.removeAllListeners();
            try {
                this.stream = tls.connect(opts, () => {
                    done();
                });
                this.stream.on('error', (error) => {
                    this.handlers.error(error);
                });
                this.stream.on('close', () => {
                    this.handlers.close();
                });
                this.stream.on('data', (data: Buffer) => {
                    this.handlers.data(data);
                });
            } catch (err) {
                this.handlers.error(new NatsError(Messages.getMessage(ErrorCode.SSL_ERR), ErrorCode.SSL_ERR, err));
            }
        }
    }

    write(data: Buffer | string): void {
        // if (typeof data === 'string') {
        //     console.log('>', [data]);
        // } else {
        //     console.log('>', [data.toString('binary')]);
        // }
        if (this.stream) {
            this.stream.write(data);
        }
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
        if (this.stream) {
            this.stream.pause();
        }
    }

    resume(): void {
        if (this.stream && this.stream.isPaused()) {
            this.stream.resume();
        }
    }

    dialDuration(): number {
        return this.dialTime;
    }
}
